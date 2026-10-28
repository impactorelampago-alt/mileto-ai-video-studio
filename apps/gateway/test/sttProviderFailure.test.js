import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const providerUrl = new URL('../src/providers.js', import.meta.url);
const providerSource = readFileSync(providerUrl, 'utf8')
    .replace("import { getKey } from './settings.js';", "const getKey = async () => 'test-only-key';")
    .replace(/from '(\.\/[^']+)'/g, (_, specifier) => `from '${new URL(specifier, providerUrl).href}'`);
const { proxyStt, SttProviderError } = await import(
    `data:text/javascript;base64,${Buffer.from(providerSource).toString('base64')}`
);

for (const error of [
    { code: 'credit_balance_exhausted', type: 'insufficient_quota' },
    { code: 'insufficient_quota' },
    { type: 'insufficient_quota', code: null },
    { code: 'spend_limit_exceeded' },
]) {
    test(`STT distingue limite financeiro do provedor: ${error.code || error.type}`, async t => {
        let calls = 0;
        t.mock.method(globalThis, 'fetch', async () => {
            calls += 1;
            return { ok: false, status: 429, text: async () => JSON.stringify({
                error: { ...error, message: 'Private provider billing details: sk-secret-test' },
            }) };
        });
        await assert.rejects(proxyStt({ audio: Buffer.from('test audio') }), err => {
            assert.equal(err instanceof SttProviderError, true);
            assert.equal(err.status, 503);
            assert.equal(err.code, 'STT_PROVIDER_QUOTA_EXHAUSTED');
            assert.match(err.message, /OpenAI/);
            assert.doesNotMatch(err.message, /sk-secret|Private provider/);
            return true;
        });
        assert.equal(calls, 1, 'saldo esgotado não provoca nova chamada ao provedor');
    });
}

test('STT não confunde rate limit ou falha não JSON com falta de saldo', async t => {
    for (const [status, body] of [
        [429, JSON.stringify({ error: { code: 'rate_limit_exceeded' } })],
        [500, '<html>private proxy details</html>'],
        [401, JSON.stringify({ error: { code: 'invalid_api_key' } })],
    ]) {
        t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status, text: async () => body }));
        await assert.rejects(proxyStt({ audio: Buffer.from('test audio') }), err => {
            assert.equal(err.status, 502);
            assert.equal(err.code, 'STT_PROVIDER_UNAVAILABLE');
            assert.doesNotMatch(err.message, /sem saldo|private|invalid_api_key|<html>/);
            return true;
        });
        t.mock.restoreAll();
    }
});

test('STT mantém transcrição e timestamps reais do fornecedor', async t => {
    const words = [{ word: 'Olá', start: 0.1, end: 0.4 }, { word: 'mundo', start: 0.5, end: 1.2 }];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
        assert.equal(init.body.get('model'), 'whisper-1');
        assert.equal(init.body.get('timestamp_granularities[]'), 'word');
        assert.equal(init.body.get('file').name, 'test.mp3');
        return { ok: true, json: async () => ({ words, duration: 1.2 }) };
    });
    assert.deepEqual(await proxyStt({ audio: Buffer.from('test audio'), filename: 'test.mp3' }), {
        words, durationSec: 2, demo: false,
    });
});

const serverSource = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const routeStart = serverSource.indexOf("    '/v1/stt',");
const handlerStart = serverSource.indexOf('async (req, res) => {', routeStart);
const handlerEnd = serverSource.indexOf('\n    })\n);', handlerStart);
assert.ok(routeStart > 0 && handlerEnd > handlerStart);

const exerciseRoute = async ({ providerError, reserveError } = {}) => {
    const calls = [];
    const reservation = 0.25;
    const handler = vm.runInNewContext(`(${serverSource.slice(handlerStart, handlerEnd)}\n})`, {
        hasKey: async () => true,
        priceOf: async () => ({ charged: reservation }),
        reserve: async () => { calls.push('reserve'); if (reserveError) throw reserveError; return reservation; },
        proxyStt: async () => {
            calls.push('provider');
            if (providerError) throw providerError;
            return { words: [{ word: 'Olá', start: 0.1, end: 0.5 }], durationSec: 1, demo: false };
        },
        release: async data => { calls.push('release'); assert.equal(data.reserved, reservation); },
        settle: async data => { calls.push('settle'); assert.equal(data.units, 1); return { charged: 0.01, balanceAfter: 10 }; },
        billingError: (res, error) => res.status(402).json({ ok: false, message: error.message }),
        SttProviderError, console: { error() {} },
    });
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ user: { id: 3, orgId: 4 }, file: { buffer: Buffer.alloc(100), size: 100 }, body: {} }, response);
    return { response, calls };
};

test('rota STT devolve a reserva sem conciliar consumo quando o saldo da OpenAI acaba', async () => {
    const { response, calls } = await exerciseRoute({
        providerError: new SttProviderError(429, { error: { code: 'credit_balance_exhausted' } }),
    });
    assert.deepEqual(calls, ['reserve', 'provider', 'release']);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'STT_PROVIDER_QUOTA_EXHAUSTED');
    assert.equal(response.body.ok, false);
    assert.equal(response.body.words, undefined);
});

test('rota STT oculta falhas de rede e também devolve a reserva', async () => {
    const { response, calls } = await exerciseRoute({ providerError: new Error('secret backend details') });
    assert.deepEqual(calls, ['reserve', 'provider', 'release']);
    assert.equal(response.statusCode, 502);
    assert.doesNotMatch(response.body.message, /secret/);
});

test('saldo Mileto insuficiente não chama provedor nem inventa legendas', async () => {
    const { response, calls } = await exerciseRoute({ reserveError: new Error('Créditos Mileto insuficientes.') });
    assert.deepEqual(calls, ['reserve']);
    assert.equal(response.statusCode, 402);
});

test('STT bem-sucedido concilia o consumo uma vez e preserva as palavras', async () => {
    const { response, calls } = await exerciseRoute();
    assert.deepEqual(calls, ['reserve', 'provider', 'settle']);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.words[0].word, 'Olá');
    assert.equal(response.body.charged, 0.01);
});
