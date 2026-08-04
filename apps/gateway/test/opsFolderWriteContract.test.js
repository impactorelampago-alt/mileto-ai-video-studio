import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const integration = readFileSync(new URL('../src/opsIntegration.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('expoe criacao, alteracao e exclusao de pastas sem mudar as rotas de leitura', () => {
    assert.match(server, /app\.get\('\/v1\/integrations\/mileto-ops\/companies\/:companyId\/folders'/);
    assert.match(server, /app\.post\('\/v1\/integrations\/mileto-ops\/companies\/:companyId\/folders'/);
    assert.match(server, /app\.patch\('\/v1\/integrations\/mileto-ops\/folders\/:folderId'/);
    assert.match(server, /app\.delete\('\/v1\/integrations\/mileto-ops\/folders\/:folderId'/);
});

test('toda mutacao valida assets.write antes de chamar o Ops', () => {
    const create = integration.slice(integration.indexOf('export const createFolder'), integration.indexOf('export const updateFolder'));
    const update = integration.slice(integration.indexOf('export const updateFolder'), integration.indexOf('export const deleteFolder'));
    const remove = integration.slice(integration.indexOf('export const deleteFolder'), integration.indexOf('export const listAssets'));
    for (const handler of [create, update, remove]) {
        assert.match(handler, /assertAssetsWriteScope\(connection\)/);
        assert.match(handler, /withDelegatedAccess\(req/);
    }
});
