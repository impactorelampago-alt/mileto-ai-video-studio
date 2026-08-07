import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const integration = readFileSync(new URL('../src/opsIntegration.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const coordinator = readFileSync(
    new URL('../../client/src/components/OpsVideoJobCoordinator.tsx', import.meta.url),
    'utf8'
);

const handler = (start, end) => integration.slice(integration.indexOf(start), integration.indexOf(end));

test('expõe polling, claim e atualização da fila somente pelo gateway autenticado', () => {
    assert.match(server, /app\.get\('\/v1\/integrations\/mileto-ops\/video-jobs\/next', authed/);
    assert.match(server, /app\.post\('\/v1\/integrations\/mileto-ops\/video-jobs\/:jobId\/claim', authed/);
    assert.match(server, /app\.patch\('\/v1\/integrations\/mileto-ops\/video-jobs\/:jobId', authed/);
});

test('as três operações exigem assets.write, delegação e X-Ops-View-Context', () => {
    const next = handler('export const nextVideoJob', 'export const claimVideoJob');
    const claim = handler('export const claimVideoJob', 'export const updateVideoJob');
    const update = handler('export const updateVideoJob', 'export const uploadExport');
    for (const source of [next, claim, update]) {
        assert.match(source, /withDelegatedAccess\(req/);
        assert.match(source, /assertAssetsWriteScope\(connection\)/);
        assert.match(source, /OPS_VIEW_CONTEXT_HEADER/);
    }
});

test('claim token só é encaminhado no PATCH e nunca é persistido pelo consumidor', () => {
    const update = handler('export const updateVideoJob', 'export const uploadExport');
    assert.match(update, /'X-Mileto-Job-Token': claimToken/);
    assert.match(coordinator, /claim\.claimToken/);
    assert.doesNotMatch(coordinator, /localStorage\.setItem\([^\n]*claim/i);
    assert.doesNotMatch(coordinator, /sessionStorage\.setItem\([^\n]*claim/i);
});

test('consumidor impede execução simultânea e só conclui após assetId real do Ops', () => {
    assert.match(coordinator, /runningRef\.current \|\| exportingRef\.current/);
    assert.match(coordinator, /waitForOpsExport\(job\.projectId\)/);
    assert.match(coordinator, /outputAssetId: assetId/);
    assert.match(coordinator, /completedExportFor\(job\)/);
});

test('empresa, ordem e automações vêm do job do Ops', () => {
    assert.match(coordinator, /opsCompany\(job\.companyId/);
    assert.match(coordinator, /job\.takeAssetIds\.map/);
    assert.match(coordinator, /job\.shuffleTakes\s*\?\s*deterministicShuffle/);
    assert.match(coordinator, /if \(job\.quickEdit\)/);
    assert.match(coordinator, /if \(job\.captions\)/);
    assert.match(coordinator, /if \(job\.automaticTitles\)/);
    assert.match(coordinator, /asset\.companyId !== job\.companyId/);
    assert.match(coordinator, /voice_preset_not_found/);
});

test('retoma apenas o projeto estavel que corresponde exatamente ao job', () => {
    assert.match(coordinator, /hasPreparedCheckpoint\(job\)/);
    assert.match(coordinator, /loadAutomatedProject\(job\.projectId\)/);
    assert.match(coordinator, /savedProject\.adData\.opsCompany\?\.id === job\.companyId/);
    assert.match(coordinator, /savedProject\.adData\.narrationText\.trim\(\)/);
    assert.match(coordinator, /hydratePreparedTakes/);
    assert.match(coordinator, /savePreparedCheckpoint\(job\)/);
});

test('falhas são estruturadas e o progresso remoto usa apenas marcos relevantes', () => {
    assert.match(coordinator, /patch\('failed', 0, parsed\.message/);
    assert.match(coordinator, /errorCode: parsed\.code/);
    assert.match(coordinator, /showLocalProgress\('takes'/);
    assert.doesNotMatch(coordinator, /await patch\('takes',[\s\S]{0,140}index \+ 1/);
});
