import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.TOKEN_SECRET ||= 'test-token-secret';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';

const {
    AUDIO_ISOLATION_FILE_FORMAT,
    AUDIO_ISOLATION_KIND,
    AUDIO_ISOLATION_MAX_BYTES,
    AUDIO_ISOLATION_MAX_SECONDS,
    ELEVENLABS_AUDIO_ISOLATION_URL,
    PCM_BYTES_PER_SECOND,
    createAudioIsolationHandler,
    inspectAudioIsolationInput,
    isolateWithElevenLabs,
} = await import('../src/audioIsolation.js');
const {
    AUDIO_ISOLATION_USD_PER_MINUTE,
    audioIsolationProviderCostUsd,
} = await import('../src/meter.js');
const { CREDIT_FEATURES } = await import('../src/settings.js');
const serverSource = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

const responseDouble = () => ({
    statusCode: 200,
    headers: new Map(),
    payload: undefined,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.payload = payload;
        return this;
    },
    setHeader(name, value) {
        this.headers.set(String(name).toLowerCase(), String(value));
        return this;
    },
    send(payload) {
        this.payload = payload;
        return this;
    },
});

const requestFor = (audio, body = {}) => ({
    user: { id: 17, orgId: 23 },
    file: { buffer: audio, size: audio.length },
    body: { file_format: AUDIO_ISOLATION_FILE_FORMAT, ...body },
});

test('rota multipart exige autenticação e aplica o uploader dedicado', () => {
    assert.match(
        serverSource,
        /app\.post\(\s*['"]\/v1\/audio-isolation['"],\s*asyncHandler\(requireAuth\),\s*parseAudioIsolationUpload,\s*asyncHandler\(audioIsolationHandler\)/
    );
    assert.match(serverSource, /fileSize:\s*AUDIO_ISOLATION_MAX_BYTES/);
});

test('deriva duração exclusivamente dos bytes PCM e aplica US$ 0,12 por minuto', () => {
    const audio = Buffer.alloc(60 * PCM_BYTES_PER_SECOND);
    const input = inspectAudioIsolationInput({ audio, fileFormat: AUDIO_ISOLATION_FILE_FORMAT });
    assert.equal(input.durationSeconds, 60);
    assert.equal(input.frameCount, 60 * 16_000);
    assert.equal(AUDIO_ISOLATION_USD_PER_MINUTE, 0.12);
    assert.equal(audioIsolationProviderCostUsd(input.durationSeconds), 0.12);
    assert.equal(CREDIT_FEATURES.some((feature) => feature.kind === AUDIO_ISOLATION_KIND), true);
});

test('rejeita formato, frame desalinhado, mais de 10 minutos e mais de 20 MB', () => {
    assert.throws(
        () => inspectAudioIsolationInput({ audio: Buffer.alloc(2), fileFormat: 'wav' }),
        (error) => error.code === 'audio_isolation_invalid_format' && error.status === 400
    );
    assert.throws(
        () => inspectAudioIsolationInput({ audio: Buffer.alloc(3), fileFormat: AUDIO_ISOLATION_FILE_FORMAT }),
        (error) => error.code === 'audio_isolation_unaligned_pcm' && error.status === 400
    );
    assert.throws(
        () => inspectAudioIsolationInput({
            audio: Buffer.alloc(AUDIO_ISOLATION_MAX_SECONDS * PCM_BYTES_PER_SECOND + 2),
            fileFormat: AUDIO_ISOLATION_FILE_FORMAT,
        }),
        (error) => error.code === 'audio_isolation_too_long' && error.status === 413
    );
    assert.throws(
        () => inspectAudioIsolationInput({
            audio: Buffer.alloc(AUDIO_ISOLATION_MAX_BYTES + 2),
            fileFormat: AUDIO_ISOLATION_FILE_FORMAT,
        }),
        (error) => error.code === 'audio_isolation_too_large' && error.status === 413
    );
});

test('envia o PCM ao endpoint oficial e preserva o content-type do provedor', async () => {
    const input = Buffer.alloc(320);
    const output = Buffer.from('isolated');
    const result = await isolateWithElevenLabs({
        key: 'eleven-secret',
        audio: input,
        fetchImpl: async (url, init) => {
            assert.equal(url, ELEVENLABS_AUDIO_ISOLATION_URL);
            assert.equal(init.method, 'POST');
            assert.equal(init.headers['xi-api-key'], 'eleven-secret');
            assert.equal(init.body.get('file_format'), AUDIO_ISOLATION_FILE_FORMAT);
            assert.equal(init.body.get('audio') instanceof Blob, true);
            return {
                ok: true,
                status: 200,
                headers: { get: (name) => name === 'content-type' ? 'audio/mpeg' : null },
                arrayBuffer: async () => output,
            };
        },
    });
    assert.deepEqual(result.audio, output);
    assert.equal(result.contentType, 'audio/mpeg');
    assert.equal(result.demo, false);
});

test('reserva, chama o provedor, concilia a duração real e devolve headers de cobrança', async () => {
    const audio = Buffer.alloc(60 * PCM_BYTES_PER_SECOND);
    const isolated = Buffer.from('isolated-audio');
    const calls = {};
    const handler = createAudioIsolationHandler({
        getKey: async (provider) => {
            calls.keyProvider = provider;
            return 'configured';
        },
        priceOf: async (...args) => {
            calls.price = args;
            return { providerCost: 0.12, charged: 180 };
        },
        reserve: async (input) => {
            calls.reserve = input;
            return 180;
        },
        isolate: async (input) => {
            calls.isolate = input;
            return { audio: isolated, contentType: 'audio/wav', demo: false };
        },
        release: async () => {
            calls.released = true;
        },
        settle: async (input) => {
            calls.settle = input;
            return { providerCost: 0.12, charged: 180, balanceAfter: 820 };
        },
    });
    const res = responseDouble();
    await handler(requestFor(audio, { duration: 1 }), res);

    assert.equal(calls.keyProvider, 'elevenLabs');
    assert.equal(calls.price[2], 60);
    assert.equal(calls.price[3], AUDIO_ISOLATION_KIND);
    assert.deepEqual(calls.reserve, { orgId: 23, estCharge: 180, demo: false });
    assert.equal(calls.isolate.audio, audio);
    assert.equal(calls.settle.units, 60);
    assert.equal(calls.settle.kind, AUDIO_ISOLATION_KIND);
    assert.equal(calls.released, undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload, isolated);
    assert.equal(res.headers.get('content-type'), 'audio/wav');
    assert.equal(res.headers.get('x-mileto-demo'), 'false');
    assert.equal(res.headers.get('x-mileto-charged'), '180');
    assert.equal(res.headers.get('x-mileto-balance'), '820');
});

test('libera a reserva e não concilia quando a ElevenLabs falha', async () => {
    const calls = {};
    const handler = createAudioIsolationHandler({
        getKey: async () => 'configured',
        priceOf: async () => ({ providerCost: 0.01, charged: 15 }),
        reserve: async () => 15,
        isolate: async () => {
            throw new Error('upstream 500');
        },
        release: async (input) => {
            calls.release = input;
        },
        settle: async () => {
            calls.settled = true;
        },
    });
    const res = responseDouble();
    await handler(requestFor(Buffer.alloc(PCM_BYTES_PER_SECOND)), res);

    assert.deepEqual(calls.release, { orgId: 23, reserved: 15, demo: false });
    assert.equal(calls.settled, undefined);
    assert.equal(res.statusCode, 502);
    assert.equal(res.payload.code, 'AUDIO_ISOLATION_PROVIDER_ERROR');
});

test('sem chave faz passthrough sinalizado e não cobra créditos', async () => {
    const audio = Buffer.from([1, 0, 2, 0]);
    const calls = {};
    const handler = createAudioIsolationHandler({
        getKey: async () => '',
        priceOf: async () => ({ providerCost: 0.00000025, charged: 0.000375 }),
        reserve: async (input) => {
            calls.reserve = input;
            return input.estCharge;
        },
        isolate: async () => {
            throw new Error('não deve chamar provedor em demo');
        },
        release: async () => {
            calls.released = true;
        },
        settle: async (input) => {
            calls.settle = input;
            return { providerCost: 0.00000025, charged: 0, balanceAfter: 99 };
        },
    });
    const res = responseDouble();
    await handler(requestFor(audio), res);

    assert.equal(calls.reserve.demo, true);
    assert.equal(calls.settle.demo, true);
    assert.equal(calls.settle.units, audio.length / PCM_BYTES_PER_SECOND);
    assert.equal(calls.released, undefined);
    assert.equal(res.payload, audio);
    assert.equal(res.headers.get('x-mileto-demo'), 'true');
    assert.equal(res.headers.get('x-mileto-charged'), '0');
    assert.equal(res.headers.get('x-mileto-balance'), '99');
});

test('saldo insuficiente interrompe antes do provedor', async () => {
    let providerCalled = false;
    const handler = createAudioIsolationHandler({
        getKey: async () => 'configured',
        priceOf: async () => ({ providerCost: 0.12, charged: 180 }),
        reserve: async () => {
            const error = new Error('Saldo de créditos insuficiente.');
            error.code = 'INSUFFICIENT_CREDIT';
            throw error;
        },
        isolate: async () => {
            providerCalled = true;
        },
    });
    const res = responseDouble();
    await handler(requestFor(Buffer.alloc(PCM_BYTES_PER_SECOND)), res);
    assert.equal(res.statusCode, 402);
    assert.equal(providerCalled, false);
});
