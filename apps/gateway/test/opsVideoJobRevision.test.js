import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    normalizeOpsIdempotencyKey,
    normalizeVideoJobRetryInput,
} from '../src/opsVideoJobRevision.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const integration = read('../src/opsIntegration.js');
const client = read('../../client/src/lib/gateway.ts');

test('normaliza a mesma Idempotency-Key do caller sem gerar outra chave', () => {
    const supplied = '123E4567-E89B-12D3-A456-426614174000';
    assert.equal(normalizeOpsIdempotencyKey(supplied), supplied.toLowerCase());
    assert.equal(normalizeOpsIdempotencyKey(supplied), supplied.toLowerCase());
});

test('rejeita Idempotency-Key ausente, ambigua ou fora do formato UUID', () => {
    for (const invalid of [undefined, '', 'retry-1', ['123e4567-e89b-12d3-a456-426614174000']]) {
        assert.throws(
            () => normalizeOpsIdempotencyKey(invalid),
            (error) => error.status === 422 && error.code === 'invalid_idempotency_key'
        );
    }
});

test('chave opcional do upload aceita UUID e preserva fallback legado', () => {
    const key = '123e4567-e89b-12d3-a456-426614174000';
    assert.equal(normalizeOpsIdempotencyKey(undefined, { required: false }), null);
    assert.equal(normalizeOpsIdempotencyKey(key, { required: false }), key);
    assert.throws(
        () => normalizeOpsIdempotencyKey('revisao-2', { required: false }),
        (error) => error.status === 422 && error.code === 'invalid_idempotency_key'
    );
});

test('normaliza somente os campos publicados pelo contrato de revisao', () => {
    assert.deepEqual(normalizeVideoJobRetryInput({
        projectId: ' ops-project-123 ',
        expectedRevision: 1,
        reason: ' integrity_temporal_1_4_27 ',
        minimumAppVersion: ' 1.4.27 ',
        outputAssetId: 'nao-deve-ser-encaminhado',
    }), {
        projectId: 'ops-project-123',
        expectedRevision: 1,
        reason: 'integrity_temporal_1_4_27',
        minimumAppVersion: '1.4.27',
    });
});

test('espelha limites de revisao, motivo e versao do Ops', () => {
    for (const invalid of [
        null,
        { projectId: '', expectedRevision: 1 },
        { projectId: 'ops-project-123', expectedRevision: 0 },
        { projectId: 'ops-project-123', expectedRevision: 1.5 },
        { projectId: 'ops-project-123', expectedRevision: 1, reason: '' },
        { projectId: 'ops-project-123', expectedRevision: 1, reason: 'x'.repeat(501) },
        { projectId: 'ops-project-123', expectedRevision: 1, minimumAppVersion: 'latest' },
    ]) {
        assert.throws(
            () => normalizeVideoJobRetryInput(invalid),
            (error) => error.status === 422 && error.code === 'invalid_video_job_retry'
        );
    }
});

test('proxy preserva delegacao, view context, body normalizado e chave recebida', () => {
    const retry = integration.slice(
        integration.indexOf('export const retryVideoJob'),
        integration.indexOf('export const updateVideoJob'),
    );
    assert.match(retry, /withDelegatedAccess\(req/);
    assert.match(retry, /assertAssetsWriteScope\(connection\)/);
    assert.match(retry, /OPS_VIEW_CONTEXT_HEADER/);
    assert.match(retry, /'Idempotency-Key': idempotencyKey/);
    assert.match(retry, /body: JSON\.stringify\(input\)/);
    assert.match(retry, /\/v1\/video-jobs\/\$\{encodeURIComponent\(jobId\)\}\/retry/);
    assert.doesNotMatch(retry, /randomUUID/);
    assert.doesNotMatch(retry, /catch\s*\(/);
});

test('upload usa chave fornecida na revisao e mantem fallback deterministico', () => {
    const upload = integration.slice(
        integration.indexOf('export const uploadExport'),
        integration.indexOf('export const getAsset'),
    );
    assert.match(upload, /hasOwnProperty\.call\(req\.body \|\| \{\}, 'idempotencyKey'\)/);
    assert.match(upload, /required: hasSuppliedIdempotencyKey/);
    assert.match(upload, /suppliedIdempotencyKey \|\| createOpsExportIdempotencyKey\(intentPayload, companyId\)/);
    assert.equal((upload.match(/'Idempotency-Key': idempotencyKey/g) || []).length, 2);
});

test('cliente exige a chave do caller e interpreta data.job do Ops', () => {
    const retry = client.slice(
        client.indexOf('async retryOpsVideoJob'),
        client.indexOf('async updateOpsVideoJob'),
    );
    assert.match(retry, /idempotencyKey: string/);
    assert.match(retry, /'Idempotency-Key': idempotencyKey/);
    assert.match(retry, /return normalizeOpsVideoJobProjectCompany\(response\.data\.job\)/);
    assert.doesNotMatch(retry, /randomUUID/);
});
