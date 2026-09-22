import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.TOKEN_SECRET ||= 'test-secret';
process.env.ADMIN_PASSWORD ||= 'test-password';

const { pool } = await import('../src/db.js');
const backup = await import('../src/privateBackups.js');
const originalConnect = pool.connect;
const originalQuery = pool.query;
const assetId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const respond = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
});
const request = (expectedVersion, data = {}) => ({
    user: { id: 7, orgId: 9 },
    params: { projectId },
    body: { expectedVersion, ownerOrgId: 9, ownerUserId: 7,
        data: { title: 'Meu projeto', updatedAt: '2026-09-22T12:00:00Z', ...data } },
});

test.after(() => { pool.connect = originalConnect; pool.query = originalQuery; });

test('listagem do cofre é filtrada por organização e usuário', async () => {
    let params;
    pool.query = async (_sql, values) => { params = values; return { rows: [] }; };
    const res = respond();
    await backup.listProjects(request(null), res);
    assert.deepEqual(params, [9, 7]);
    assert.deepEqual(res.body.projects, []);
});

test('versão divergente impede sobrescrever projeto de outro PC', async () => {
    const statements = [];
    pool.connect = async () => ({
        query: async (sql) => {
            statements.push(sql);
            if (sql.includes('SELECT version FROM private_backup_projects')) return { rows: [{ version: '3' }] };
            return { rows: [], rowCount: 0 };
        },
        release() {},
    });
    const res = respond();
    await backup.saveProject(request(2), res);
    assert.equal(res.statusCode, 409);
    assert.ok(statements.some((sql) => sql === 'ROLLBACK'));
    assert.ok(!statements.some((sql) => sql.includes('INSERT INTO private_backup_projects')));
});

test('troca de sessão bloqueia projeto antes de tocar no banco', async () => {
    pool.connect = async () => { throw new Error('não deveria conectar'); };
    const req = request(null);
    req.body.ownerUserId = 8;
    const res = respond();
    await backup.saveProject(req, res);
    assert.equal(res.statusCode, 409);
});

test('mídia privada de outra pessoa impede declarar backup concluído', async () => {
    const statements = [];
    pool.connect = async () => ({
        query: async (sql, values) => {
            statements.push([sql, values]);
            if (sql.includes('SELECT version FROM private_backup_projects')) return { rows: [] };
            if (sql.includes('SELECT id FROM media_items')) return { rows: [] };
            return { rows: [], rowCount: 0 };
        },
        release() {},
    });
    const res = respond();
    await backup.saveProject(request(null, {
        mediaTakes: [{ sharedAssetId: assetId }],
    }), res);
    assert.equal(res.statusCode, 409);
    assert.ok(statements.some(([sql, values]) => sql.includes("visibility <> 'backup'") && values[2] === 7));
    assert.ok(!statements.some(([sql]) => sql.includes('INSERT INTO private_backup_projects')));
});

test('backup de projeto grava assets e avança versão somente em transação completa', async () => {
    const statements = [];
    pool.connect = async () => ({
        query: async (sql) => {
            statements.push(sql);
            if (sql.includes('SELECT version FROM private_backup_projects')) return { rows: [{ version: '3' }] };
            if (sql.includes('SELECT id FROM media_items')) return { rows: [{ id: assetId }] };
            return { rows: [], rowCount: 1 };
        },
        release() {},
    });
    const res = respond();
    await backup.saveProject(request(3, { mediaTakes: [{ sharedAssetId: assetId }] }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.version, 4);
    assert.ok(statements.some((sql) => sql.includes('INSERT INTO private_backup_project_assets')));
    assert.equal(statements.at(-1), 'COMMIT');
});

test('arquivo divergente entre PCs não troca o blob nem o caminho salvo', async () => {
    const statements = [];
    pool.connect = async () => ({
        query: async (sql) => {
            statements.push(sql);
            if (sql.includes('SELECT i.id, b.size_bytes')) return { rows: [{ id: assetId, size_bytes: '100' }] };
            if (sql.includes('SELECT version FROM private_backup_files')) return { rows: [{ version: '5' }] };
            return { rows: [], rowCount: 0 };
        },
        release() {},
    });
    const res = respond();
    await backup.saveFile({
        user: { id: 7, orgId: 9 },
        params: { sourceId: projectId },
        body: { assetId, relPath: 'Vídeos/teste.mp4', size: 100,
            sourceMtime: '2026-09-22T12:00:00Z', expectedVersion: 4,
            ownerOrgId: 9, ownerUserId: 7 },
    }, res);
    assert.equal(res.statusCode, 409);
    assert.ok(!statements.some((sql) => sql.includes('INSERT INTO private_backup_files')));
    assert.equal(statements.at(-1), 'ROLLBACK');
});
