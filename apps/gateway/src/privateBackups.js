import { pool, query } from './db.js';
import { collectSharedDraftAssetIds } from './sharedDraftAssets.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (value) => UUID.test(String(value || ''));
const validProjectId = (value) => /^[a-zA-Z0-9._-]{1,120}$/.test(String(value || ''))
    && value !== '.' && value !== '..';
const owner = (req) => ({ orgId: Number(req.user?.orgId), userId: Number(req.user?.id) });
const fail = (res, status, message) => res.status(status).json({ ok: false, message });
const safeDate = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : null;
};

export const listProjects = async (req, res) => {
    const { orgId, userId } = owner(req);
    const rows = (await query(
        `SELECT project_id AS "projectId", title, source_updated_at AS "sourceUpdatedAt",
                updated_at AS "backedUpAt", version,
                (data->>'exported' = 'true') AS exported,
                CASE WHEN jsonb_typeof(data->'mediaTakes') = 'array'
                     THEN jsonb_array_length(data->'mediaTakes') ELSE 0 END AS "mediaCount",
                data #>> '{adData,videoModel}' AS "videoModel"
           FROM private_backup_projects
          WHERE org_id = $1 AND user_id = $2 AND trashed_at IS NULL
          ORDER BY source_updated_at DESC`,
        [orgId, userId]
    )).rows;
    res.json({ ok: true, projects: rows });
};

export const getProject = async (req, res) => {
    if (!validProjectId(req.params.projectId)) return fail(res, 400, 'Projeto inválido.');
    const { orgId, userId } = owner(req);
    const row = (await query(
        `SELECT title, data, source_updated_at AS "sourceUpdatedAt", updated_at AS "backedUpAt", version
           FROM private_backup_projects
          WHERE org_id = $1 AND user_id = $2 AND project_id = $3 AND trashed_at IS NULL`,
        [orgId, userId, req.params.projectId]
    )).rows[0];
    if (!row) return fail(res, 404, 'Backup não encontrado nesta conta.');
    res.json({ ok: true, project: row });
};

export const saveProject = async (req, res) => {
    if (!validProjectId(req.params.projectId)) return fail(res, 400, 'Projeto inválido.');
    const data = req.body?.data;
    const sourceUpdatedAt = safeDate(data?.updatedAt);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !sourceUpdatedAt) {
        return fail(res, 400, 'Backup inválido ou sem data de atualização.');
    }
    const title = String(data.title || data.adData?.title || 'Rascunho sem título').trim().slice(0, 180);
    const assetIds = collectSharedDraftAssetIds(data);
    const { orgId, userId } = owner(req);
    if (Number(req.body?.ownerOrgId) !== orgId || Number(req.body?.ownerUserId) !== userId) {
        return fail(res, 409, 'A sessão mudou durante o backup. Tente novamente na conta correta.');
    }
    const expectedVersion = req.body?.expectedVersion == null ? null : Number(req.body.expectedVersion);
    if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
        return fail(res, 400, 'Versão de backup inválida.');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const existing = (await client.query(
            `SELECT version FROM private_backup_projects
              WHERE org_id = $1 AND user_id = $2 AND project_id = $3 FOR UPDATE`,
            [orgId, userId, req.params.projectId]
        )).rows[0];
        if ((existing && Number(existing.version) !== expectedVersion)
            || (!existing && expectedVersion !== null && expectedVersion !== 0)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'O backup mudou em outro computador. A cópia local foi preservada.');
        }
        if (assetIds.length) {
            const visible = (await client.query(
                `SELECT id FROM media_items WHERE org_id = $1 AND id = ANY($2::uuid[])
                   AND (visibility <> 'backup' OR created_by = $3)
                   AND (trashed_at IS NULL OR EXISTS (
                       SELECT 1 FROM shared_draft_assets da WHERE da.asset_item_id = media_items.id
                   ) OR EXISTS (
                       SELECT 1 FROM private_backup_project_assets pa WHERE pa.asset_item_id = media_items.id
                   ))`,
                [orgId, assetIds, userId]
            )).rows;
            if (visible.length !== assetIds.length) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'Uma ou mais mídias do projeto não estão disponíveis para este backup.');
            }
        }
        await client.query(
            `INSERT INTO private_backup_projects
                (org_id, user_id, project_id, title, data, source_updated_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (org_id, user_id, project_id) DO UPDATE
               SET title = EXCLUDED.title, data = EXCLUDED.data,
                   source_updated_at = EXCLUDED.source_updated_at,
                   version = private_backup_projects.version + 1,
                   updated_at = now(), trashed_at = NULL, purge_after = NULL`,
            [orgId, userId, req.params.projectId, title, JSON.stringify(data), sourceUpdatedAt]
        );
        await client.query(
            'DELETE FROM private_backup_project_assets WHERE org_id = $1 AND user_id = $2 AND project_id = $3',
            [orgId, userId, req.params.projectId]
        );
        if (assetIds.length) {
            await client.query(
                `INSERT INTO private_backup_project_assets (org_id, user_id, project_id, asset_item_id)
                 SELECT $1, $2, $3, i.id FROM media_items i
                  WHERE i.org_id = $1 AND i.id = ANY($4::uuid[])`,
                [orgId, userId, req.params.projectId, assetIds]
            );
            await client.query(
                `UPDATE media_items SET purge_after = NULL
                  WHERE org_id = $1 AND id = ANY($2::uuid[]) AND visibility IN ('project', 'backup')`,
                [orgId, assetIds]
            );
        }
        await client.query('COMMIT');
        res.json({ ok: true, projectId: req.params.projectId, version: existing ? Number(existing.version) + 1 : 1 });
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const deleteProject = async (req, res) => {
    if (!validProjectId(req.params.projectId)) return fail(res, 400, 'Projeto inválido.');
    const { orgId, userId } = owner(req);
    const result = await query(
        `UPDATE private_backup_projects
            SET trashed_at = now(), purge_after = now() + interval '30 days'
          WHERE org_id = $1 AND user_id = $2 AND project_id = $3 AND trashed_at IS NULL
          RETURNING project_id`,
        [orgId, userId, req.params.projectId]
    );
    if (!result.rowCount) return fail(res, 404, 'Backup não encontrado nesta conta.');
    res.json({ ok: true });
};

export const listFiles = async (req, res) => {
    const { orgId, userId } = owner(req);
    const rows = (await query(
        `SELECT f.source_id AS "sourceId", f.asset_item_id AS "assetId", f.rel_path AS "relPath",
                f.name, f.category, f.size_bytes AS size, f.source_mtime AS "sourceMtime",
                b.sha256, f.updated_at AS "backedUpAt", f.version
           FROM private_backup_files f
           JOIN media_items i ON i.id = f.asset_item_id
           JOIN media_blobs b ON b.id = i.blob_id
          WHERE f.org_id = $1 AND f.user_id = $2 AND i.trashed_at IS NULL
          ORDER BY f.rel_path`,
        [orgId, userId]
    )).rows;
    res.json({ ok: true, files: rows });
};

export const saveFile = async (req, res) => {
    if (!validId(req.params.sourceId) || !validId(req.body?.assetId)) {
        return fail(res, 400, 'Identificador de arquivo inválido.');
    }
    const relPath = String(req.body.relPath || '').replace(/\\/g, '/');
    const parts = relPath.split('/');
    if (parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))
        || !['Vídeos', 'Imagens', 'Músicas', 'Geração por IA', 'Moldura'].includes(parts[0])
        || relPath.length > 1000) return fail(res, 400, 'Caminho do arquivo inválido.');
    const sourceMtime = safeDate(req.body.sourceMtime);
    const size = Number(req.body.size);
    if (!sourceMtime || !Number.isSafeInteger(size) || size <= 0) return fail(res, 400, 'Metadados inválidos.');
    const { orgId, userId } = owner(req);
    if (Number(req.body?.ownerOrgId) !== orgId || Number(req.body?.ownerUserId) !== userId) {
        return fail(res, 409, 'A sessão mudou durante o backup. Tente novamente na conta correta.');
    }
    const expectedVersion = req.body?.expectedVersion == null ? null : Number(req.body.expectedVersion);
    if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
        return fail(res, 400, 'Versão de arquivo inválida.');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const item = (await client.query(
            `SELECT i.id, b.size_bytes FROM media_items i JOIN media_blobs b ON b.id = i.blob_id
              WHERE i.org_id = $1 AND i.id = $2 AND i.visibility = 'backup'
                AND i.created_by = $3 AND i.trashed_at IS NULL`,
            [orgId, req.body.assetId, userId]
        )).rows[0];
        if (!item || Number(item.size_bytes) !== size) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'Mídia privada do backup não encontrada.');
        }
        const existing = (await client.query(
            `SELECT version FROM private_backup_files
              WHERE org_id = $1 AND user_id = $2 AND source_id = $3 FOR UPDATE`,
            [orgId, userId, req.params.sourceId]
        )).rows[0];
        if ((existing && Number(existing.version) !== expectedVersion)
            || (!existing && expectedVersion !== null && expectedVersion !== 0)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'O arquivo mudou em outro computador. A cópia local foi preservada.');
        }
        await client.query(
            `INSERT INTO private_backup_files
                (org_id, user_id, source_id, asset_item_id, rel_path, name, category, size_bytes, source_mtime)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (org_id, user_id, source_id) DO UPDATE
                SET asset_item_id = EXCLUDED.asset_item_id, rel_path = EXCLUDED.rel_path,
                    name = EXCLUDED.name, category = EXCLUDED.category,
                    size_bytes = EXCLUDED.size_bytes, source_mtime = EXCLUDED.source_mtime,
                    version = private_backup_files.version + 1, updated_at = now()`,
            [orgId, userId, req.params.sourceId, req.body.assetId, relPath, parts.at(-1), parts[0], size, sourceMtime]
        );
        await client.query('UPDATE media_items SET purge_after = NULL WHERE id = $1', [req.body.assetId]);
        await client.query('COMMIT');
        res.json({ ok: true, version: existing ? Number(existing.version) + 1 : 1 });
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
