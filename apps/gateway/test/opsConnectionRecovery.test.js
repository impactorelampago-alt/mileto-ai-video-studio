import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    isRecoverableStoredOpsError,
    isTransientOpsRefreshError,
    opsRefreshConnectionState,
    publicOpsRefreshError,
    refreshOpsTokenSafely,
    storedOpsRefreshError,
    storedOpsRefreshIssue,
} from '../src/opsConnectionRecovery.js';
import { parseOpsOAuthError } from '../src/opsOAuthError.js';

// Normaliza CRLF: literais multilinha com \n puro precisam casar em checkouts Windows.
const integrationUi = readFileSync(
    new URL('../../client/src/components/OpsIntegrationSection.tsx', import.meta.url),
    'utf8'
).replace(/\r\n/g, '\n');
const integrationSource = readFileSync(new URL('../src/opsIntegration.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('quedas temporárias preservam a conexão persistente', () => {
    for (const error of [
        { status: 503, code: 'ops_token_failed' },
        { status: 504, code: 'ops_timeout' },
        { status: 429, code: 'rate_limited' },
        { code: 'ops_unavailable' },
        { status: 500, code: 'invalid_grant' },
        { status: 401, code: 'ops_token_failed' },
    ]) {
        assert.equal(isTransientOpsRefreshError(error), true);
        assert.match(storedOpsRefreshError(error), /^temporary:/);
    }
});

test('credencial revogada exige uma nova autorização', () => {
    for (const error of [
        { status: 400, code: 'invalid_grant' },
        { status: 403, code: 'refresh_token_revoked' },
        { status: 403, code: 'access_denied' },
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
    assert.equal(storedOpsRefreshIssue('temporary:ops_timeout'), 'temporary');
    assert.equal(isTransientOpsRefreshError({ status: 401, code: 'invalid_client' }), true);
    assert.equal(storedOpsRefreshError({ status: 401, code: 'invalid_client' }), 'configuration:invalid_client');
    assert.equal(publicOpsRefreshError('configuration:invalid_client'), 'invalid_client');
    assert.equal(storedOpsRefreshIssue('configuration:invalid_client'), 'configuration');
    assert.equal(isRecoverableStoredOpsError('configuration:invalid_client'), true);
});

test('renovação não repete um refresh token rotativo após falha ambígua', async () => {
    let calls = 0;
    await assert.rejects(
        refreshOpsTokenSafely(
            async () => {
                calls += 1;
                throw Object.assign(new Error('resultado incerto'), { status: 503, code: 'ops_unavailable' });
            }
        ),
        /resultado incerto/
    );
    assert.equal(calls, 1);
});

test('uma operação futura pode renovar silenciosamente depois que o Ops volta', async () => {
    let calls = 0;
    const refresh = async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('temporário'), { status: 503, code: 'ops_unavailable' });
        return 'access-token';
    };
    await assert.rejects(refreshOpsTokenSafely(refresh), /temporário/);
    assert.equal(await refreshOpsTokenSafely(refresh), 'access-token');
    assert.equal(calls, 2);
});

test('renovação não repete credencial definitivamente inválida', async () => {
    let calls = 0;
    await assert.rejects(
        refreshOpsTokenSafely(
            async () => {
                calls += 1;
                throw Object.assign(new Error('revogado'), { status: 400, code: 'invalid_grant' });
            }
        ),
        /revogado/
    );
    assert.equal(calls, 1);
});

test('parser preserva o envelope OAuth padrão devolvido pelo Ops', () => {
    assert.deepEqual(
        parseOpsOAuthError({
            error: 'invalid_grant',
            error_description: 'Refresh revogado.',
            request_id: 'req-oauth-1',
        }),
        { code: 'invalid_grant', message: 'Refresh revogado.', requestId: 'req-oauth-1' }
    );
    assert.deepEqual(
        parseOpsOAuthError({ error: { code: 'slow_down', message: 'Tente depois.', requestId: 'req-1' } }),
        { code: 'slow_down', message: 'Tente depois.', requestId: 'req-1' }
    );
});

test('refresh rotacionado é persistido antes de solicitar atualização de escopos', () => {
    assert.deepEqual(
        opsRefreshConnectionState({
            tokenScopes: ['account.read'],
            storedScopes: ['account.read', 'assets.write'],
            requiredScopes: ['account.read', 'assets.write'],
        }),
        {
            scopes: ['account.read'],
            missingScopes: ['assets.write'],
            status: 'error',
            lastError: 'ops_scope_missing',
        }
    );
    assert.deepEqual(
        opsRefreshConnectionState({
            tokenScopes: [],
            storedScopes: ['account.read', 'assets.write'],
            requiredScopes: ['account.read', 'assets.write'],
        }),
        {
            scopes: ['account.read', 'assets.write'],
            missingScopes: [],
            status: 'active',
            lastError: null,
        }
    );

    const start = integrationSource.indexOf('const refreshState = opsRefreshConnectionState');
    const end = integrationSource.indexOf('const connectionAccessToken', start);
    const refresh = integrationSource.slice(start, end);
    const updateAt = refresh.indexOf('UPDATE ops_connections');
    const permissionErrorAt = refresh.indexOf("throw httpError(\n                403,\n                refreshState.lastError");
    assert.ok(start >= 0 && updateAt >= 0 && permissionErrorAt > updateAt);
    assert.match(refresh, /refresh_token_enc = \$4/);
    assert.match(refresh, /status = \$6, last_error = \$7/);
    assert.match(integrationUi, /Atualizar permissões do Mileto Ops/);
    assert.match(integrationUi, /vínculos de empresa e equipe serão preservados/);
});

test('tela explica a persistência e quando uma nova autorização é realmente necessária', () => {
    assert.match(integrationUi, /Conexão persistente/);
    assert.match(integrationUi, /Autorize uma vez/);
    assert.match(integrationUi, /acesso for revogado, ficar inválido ou precisar de novas permissões/);
    assert.match(integrationUi, /Wi-Fi vermelho no topo indica apenas que o executor deste computador está offline/);
    assert.match(integrationUi, /não significa que .* foi desconectada do Mileto Ops/);
    assert.match(integrationUi, /Nenhum novo login é necessário/);
});
