import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isRecoverableStoredOpsError,
    isTransientOpsRefreshError,
    publicOpsRefreshError,
    refreshOpsTokenWithRetry,
    storedOpsRefreshError,
} from '../src/opsConnectionRecovery.js';

test('quedas temporárias preservam a conexão persistente', () => {
    for (const error of [
        { status: 503, code: 'ops_token_failed' },
        { status: 504, code: 'ops_timeout' },
        { status: 429, code: 'rate_limited' },
        { code: 'ops_unavailable' },
    ]) {
        assert.equal(isTransientOpsRefreshError(error), true);
        assert.match(storedOpsRefreshError(error), /^temporary:/);
    }
});

test('credencial revogada exige uma nova autorização', () => {
    for (const error of [
        { status: 400, code: 'invalid_grant' },
        { status: 401, code: 'ops_token_failed' },
        { status: 403, code: 'refresh_token_revoked' },
    ]) {
        assert.equal(isTransientOpsRefreshError(error), false);
        assert.doesNotMatch(storedOpsRefreshError(error), /^temporary:/);
    }
});

test('erros temporários antigos também podem se recuperar automaticamente', () => {
    assert.equal(isRecoverableStoredOpsError('temporary:ops_timeout'), true);
    assert.equal(isRecoverableStoredOpsError('refresh_failed'), true);
    assert.equal(isRecoverableStoredOpsError('invalid_grant'), false);
    assert.equal(publicOpsRefreshError('temporary:ops_timeout'), 'ops_timeout');
});

test('renovação repete falhas transitórias e conclui sem novo login', async () => {
    let calls = 0;
    const waits = [];
    const token = await refreshOpsTokenWithRetry(
        async () => {
            calls += 1;
            if (calls < 3) throw Object.assign(new Error('temporário'), { status: 503, code: 'ops_unavailable' });
            return 'access-token';
        },
        { wait: async (milliseconds) => waits.push(milliseconds) }
    );
    assert.equal(token, 'access-token');
    assert.equal(calls, 3);
    assert.deepEqual(waits, [200, 400]);
});

test('renovação não repete credencial definitivamente inválida', async () => {
    let calls = 0;
    await assert.rejects(
        refreshOpsTokenWithRetry(
            async () => {
                calls += 1;
                throw Object.assign(new Error('revogado'), { status: 400, code: 'invalid_grant' });
            },
            { wait: async () => undefined }
        ),
        /revogado/
    );
    assert.equal(calls, 1);
});

