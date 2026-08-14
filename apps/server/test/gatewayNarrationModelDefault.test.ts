import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const tempDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-fish-model-default-'));
const previousUserDataPath = process.env.USER_DATA_PATH;
process.env.USER_DATA_PATH = tempDataPath;

// `gatewayNarration` lê estas dependências no carregamento. Substituí-las antes do
// require mantém o teste local, sem chamar a VPS, a Fish Audio ou o ffprobe.
const gatewayClient = require('../src/services/gatewayClient') as {
    gatewayTts: (...args: unknown[]) => Promise<unknown>;
};
const fishAudio = require('../src/services/fishAudio') as {
    getAudioDuration: (filePath: string) => Promise<number>;
};
const originalGatewayTts = gatewayClient.gatewayTts;
const originalGetAudioDuration = fishAudio.getAudioDuration;

let gatewayCalls: Array<{ token: string; payload: Record<string, unknown> }> = [];
let gatewayResult = { audio: Buffer.from('paid-model-audio'), demo: false, balance: 10, model: 's2.1-pro' };
gatewayClient.gatewayTts = async (token: unknown, payload: unknown) => {
    gatewayCalls.push({ token: String(token), payload: payload as Record<string, unknown> });
    return gatewayResult;
};
fishAudio.getAudioDuration = async () => 1;

const { synthesizeViaGateway } = require('../src/services/gatewayNarration') as {
    synthesizeViaGateway: (
        token: string,
        provider: string,
        voiceId: string,
        text: string,
        settings?: Record<string, unknown>,
        contract?: {
            narrationPlainText: string;
            narrationSynthesisText: string;
            ttsModel: string;
            directionMode: 'automatic' | 'manual' | 'clean';
            directionVersion: string;
            narrationDialect: 'fish-natural-v1' | 'mileto-ops-bracket-v1';
            protectedTerms: string[];
        },
    ) => Promise<{ url: string }>;
};

after(() => {
    gatewayClient.gatewayTts = originalGatewayTts;
    fishAudio.getAudioDuration = originalGetAudioDuration;
    if (previousUserDataPath === undefined) delete process.env.USER_DATA_PATH;
    else process.env.USER_DATA_PATH = previousUserDataPath;
    fs.rmSync(tempDataPath, { recursive: true, force: true });
});

test('synthesizeViaGateway envia s2.1-pro para cliente legado sem fishModel', async () => {
    gatewayCalls = [];
    gatewayResult = { audio: Buffer.from('paid-model-audio'), demo: false, balance: 10, model: 's2.1-pro' };

    await synthesizeViaGateway(
        'session-token',
        'fishAudio',
        'legacy-voice',
        'Texto legado sem modelo',
        { speed: 1, volume: 0 },
    );

    assert.equal(gatewayCalls.length, 1);
    assert.equal(gatewayCalls[0].token, 'session-token');
    assert.deepEqual(gatewayCalls[0].payload.voiceSettings, {
        speed: 1,
        volume: 0,
        fishModel: 's2.1-pro',
    });
});

test('contrato estruturado encaminha termos protegidos ao gateway', async () => {
    gatewayCalls = [];
    gatewayResult = { audio: Buffer.from('paid-model-audio'), demo: false, balance: 10, model: 's2.1-pro' };

    await synthesizeViaGateway(
        'session-token',
        'fishAudio',
        'structured-voice',
        '[confident] Visite a vivazz.',
        { fishModel: 's2.1-pro' },
        {
            narrationPlainText: 'Visite a vivazz.',
            narrationSynthesisText: '[confident] Visite a vivazz.',
            ttsModel: 's2.1-pro',
            directionMode: 'manual',
            directionVersion: 'fish-s2.1-natural-v1',
            narrationDialect: 'mileto-ops-bracket-v1',
            protectedTerms: ['vivazz'],
        },
    );

    assert.deepEqual(gatewayCalls[0].payload.protectedTerms, ['vivazz']);
    assert.equal(gatewayCalls[0].payload.narrationDialect, 'mileto-ops-bracket-v1');
});

test('cache novo não reutiliza MP3 gratuito salvo sob o antigo hash de s2-pro', async () => {
    gatewayCalls = [];
    gatewayResult = { audio: Buffer.from('paid-model-audio'), demo: false, balance: 10, model: 's2.1-pro' };
    const provider = 'fishAudio';
    const voiceId = 'legacy-contaminated-voice';
    const text = 'Texto que existia no cache contaminado';
    const oldCacheInput = `spoken-numbers-v4-ptbr-pronunciation-${provider}-${voiceId}-${text}-ms2-pro`;
    const oldHash = crypto.createHash('md5').update(oldCacheInput).digest('hex');
    const oldFileName = `narration-${oldHash}.mp3`;
    const narrationDir = path.join(tempDataPath, 'narrations');
    fs.mkdirSync(narrationDir, { recursive: true });
    fs.writeFileSync(path.join(narrationDir, oldFileName), 'free-model-audio');

    const result = await synthesizeViaGateway(
        'session-token',
        provider,
        voiceId,
        text,
        { speed: 1, volume: 0 },
    );

    assert.equal(gatewayCalls.length, 1, 'o cache v4 contaminado não pode impedir uma nova síntese paga');
    assert.notEqual(result.url, `/narrations/${oldFileName}`);
});

test('audio demo nunca ocupa o cache que depois sera usado pelo s2.1-pro pago', async () => {
    gatewayCalls = [];
    const args = ['session-token', 'fishAudio', 'demo-then-paid-voice', 'Texto demo e depois pago', {
        speed: 1,
        volume: 0,
    }] as const;

    gatewayResult = { audio: Buffer.from('silent-demo'), demo: true, balance: 0, model: 's2.1-pro' };
    const demo = await synthesizeViaGateway(...args);
    assert.match(demo.url, /^\/narrations\/demo-narration-/);

    gatewayResult = { audio: Buffer.from('paid-model-audio'), demo: false, balance: 10, model: 's2.1-pro' };
    const paid = await synthesizeViaGateway(...args);

    assert.equal(gatewayCalls.length, 2, 'a chamada paga nao pode reutilizar o silencio de demonstracao');
    assert.match(paid.url, /^\/narrations\/narration-/);
    assert.doesNotMatch(paid.url, /\/demo-/);
    assert.equal(
        fs.readFileSync(path.join(tempDataPath, 'narrations', paid.url.replace(/^\/narrations\//, '')), 'utf8'),
        'paid-model-audio',
    );
});
