import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createOpsViewContextCache } from '../src/lib/opsViewContextCache.ts';

const coordinatorSource = readFileSync(
    new URL('../src/components/OpsVideoJobCoordinator.tsx', import.meta.url),
    'utf8',
);

const response = (suffix, expiresIn = 600) => ({
    data: {
        defaultContextId: `default-${suffix}`,
        expiresIn,
        capabilities: { canViewTeam: true, canViewProfiles: true },
        contexts: [
            { contextId: `other-${suffix}`, mode: 'profile', label: 'Outro', subtitle: '', isDefault: false },
            { contextId: `default-${suffix}`, mode: 'self', label: 'Padrao', subtitle: '', isDefault: true },
        ],
    },
});

test('reutiliza o mesmo contexto nos pollings de 12s ate perto do vencimento', async () => {
    let now = 0;
    let calls = 0;
    const cache = createOpsViewContextCache(async () => response(++calls), () => now);

    for (let poll = 0; poll < 47; poll += 1) {
        const contexts = await cache.get();
        assert.equal(contexts[0].contextId, 'default-1');
        now += 12_000;
    }
    assert.equal(calls, 1, 'um ciclo de 9m24s deve emitir somente um lote de contextos');

    now = 570_000;
    const renewed = await cache.get();
    assert.equal(calls, 2);
    assert.equal(renewed[0].contextId, 'default-2');
});

test('compartilha uma unica renovacao entre fila e heartbeat concorrentes', async () => {
    let calls = 0;
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const cache = createOpsViewContextCache(async () => {
        calls += 1;
        await pending;
        return response(calls);
    });

    const queueRead = cache.get();
    const heartbeatRead = cache.get();
    assert.equal(calls, 1);
    release();
    assert.deepEqual(await queueRead, await heartbeatRead);
    assert.equal(calls, 1);
});

test('invalidacao descarta resposta em voo e renova para a sessao atual', async () => {
    let calls = 0;
    let releaseFirst;
    const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
    const cache = createOpsViewContextCache(async () => {
        calls += 1;
        if (calls === 1) await firstPending;
        return response(calls);
    });

    const staleRead = cache.get();
    cache.invalidate();
    releaseFirst();
    const contexts = await staleRead;

    assert.equal(calls, 2);
    assert.equal(contexts[0].contextId, 'default-2');
    assert.equal((await cache.get())[0].contextId, 'default-2');
});

test('TTL curto ainda preserva margem antes da expiracao', async () => {
    let now = 0;
    let calls = 0;
    const cache = createOpsViewContextCache(async () => response(++calls, 10), () => now);

    await cache.get();
    now = 8_999;
    await cache.get();
    assert.equal(calls, 1);
    now = 9_000;
    await cache.get();
    assert.equal(calls, 2);
});

test('coordenador liga fila e heartbeat ao cache e invalida acessos revogados', () => {
    assert.match(
        coordinatorSource,
        /createOpsViewContextCache\(\(\) => gatewayApi\.opsViewContexts\(\)\)/,
    );
    assert.match(
        coordinatorSource,
        /const orderedContexts = async[\s\S]*return opsViewContextCache\.get\(\)/,
    );
    assert.match(
        coordinatorSource,
        /\[401, 403, 404\]\.includes\(error\.status\)[\s\S]*opsViewContextCache\.invalidate\(\)/,
    );
});
