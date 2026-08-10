import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/test';
process.env.TOKEN_SECRET = 'test-token-secret';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.OPS_CLIENT_ID = 'test-client';
process.env.OPS_CLIENT_SECRET = 'test-client-secret';
process.env.OPS_REDIRECT_URI = 'http://127.0.0.1/callback';
process.env.OPS_TOKEN_ENCRYPTION_KEY = 'test-ops-token-key';

const queuedResponses = [];
const requests = [];
const fakeOps = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
        requests.push({ method: req.method, url: req.url, body });
        const next = queuedResponses.shift() || {
            status: 500,
            payload: { error: 'server_error', error_description: 'Resposta não preparada.' },
        };
        res.writeHead(next.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(next.payload));
    });
});

await new Promise((resolve, reject) => {
    fakeOps.once('error', reject);
    fakeOps.listen(0, '127.0.0.1', resolve);
});
const address = fakeOps.address();
process.env.OPS_BASE_URL = `http://127.0.0.1:${address.port}`;

const [{ refreshAccessToken }, { isTransientOpsRefreshError, refreshOpsTokenSafely }] = await Promise.all([
    import('../src/opsClient.js'),
    import('../src/opsConnectionRecovery.js'),
]);

test.after(async () => {
    await new Promise((resolve) => fakeOps.close(resolve));
});

test('fluxo HTTP preserva falhas temporárias, recupera depois e reconhece revogação real', async () => {
    queuedResponses.push({
        status: 503,
        payload: { error: 'server_error', error_description: 'Ops temporariamente indisponível.' },
    });
    const beforeTemporary = requests.length;
    await assert.rejects(
        refreshOpsTokenSafely(() => refreshAccessToken('refresh-sintetico')),
        (error) => {
            assert.equal(error.status, 503);
            assert.equal(error.code, 'server_error');
            assert.equal(isTransientOpsRefreshError(error), true);
            return true;
        }
    );
    assert.equal(requests.length - beforeTemporary, 1, 'não deve repetir o token rotativo após um 503 ambíguo');

    queuedResponses.push({
        status: 200,
        payload: {
            access_token: 'access-sintetico',
            refresh_token: 'refresh-rotacionado-sintetico',
            expires_in: 600,
            scope: 'account.read assets.write',
        },
    });
    const recovered = await refreshOpsTokenSafely(() => refreshAccessToken('refresh-sintetico'));
    assert.equal(recovered.accessToken, 'access-sintetico');
    assert.equal(recovered.refreshToken, 'refresh-rotacionado-sintetico');

    queuedResponses.push({
        status: 429,
        payload: { error: 'slow_down', error_description: 'Tente novamente depois.' },
    });
    await assert.rejects(
        refreshOpsTokenSafely(() => refreshAccessToken('refresh-rotacionado-sintetico')),
        (error) => error.code === 'slow_down' && isTransientOpsRefreshError(error)
    );

    queuedResponses.push({
        status: 401,
        payload: { error: 'invalid_grant', error_description: 'Refresh revogado.' },
    });
    await assert.rejects(
        refreshOpsTokenSafely(() => refreshAccessToken('refresh-rotacionado-sintetico')),
        (error) => error.code === 'invalid_grant' && !isTransientOpsRefreshError(error)
    );

    for (const request of requests) {
        assert.equal(request.method, 'POST');
        assert.equal(request.url, '/api/integrations/mileto-ai-video/oauth/token');
        const body = new URLSearchParams(request.body);
        assert.equal(body.get('grant_type'), 'refresh_token');
    }
    assert.deepEqual(
        requests.map((request) => new URLSearchParams(request.body).get('refresh_token')),
        [
            'refresh-sintetico',
            'refresh-sintetico',
            'refresh-rotacionado-sintetico',
            'refresh-rotacionado-sintetico',
        ]
    );
});
