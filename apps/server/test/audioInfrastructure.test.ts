import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    ISOLATION_MIN_CORRELATION_CONFIDENCE,
    assertNonDestructiveAudioTarget,
    buildIsolationAlignmentFilter,
    detectPcmEnvelopeAlignment,
    hasSevereIsolationDurationDrift,
    isolateAudioSource,
    type AudioProbe,
} from '../src/services/audioInfrastructure';
import {
    buildTakeAudioFilterGraph,
    isolateAudio,
    mixTakeAudio,
    normalizeTakeAudioRequests,
} from '../src/controllers/audioInfrastructureController';

const temporaryDirectory = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-audio-infra-'));

const patternedPcm = (windowCount = 150, samplesPerWindow = 320): Buffer => {
    const pcm = Buffer.alloc(windowCount * samplesPerWindow * 2);
    for (let window = 0; window < windowCount; window += 1) {
        const amplitude = 600 + ((window * 7919) % 22000);
        for (let sample = 0; sample < samplesPerWindow; sample += 1) {
            const sign = sample % 2 === 0 ? 1 : -1;
            pcm.writeInt16LE(amplitude * sign, (window * samplesPerWindow + sample) * 2);
        }
    }
    return pcm;
};

test('correlação de envelope detecta saída sinteticamente atrasada em 200 ms', () => {
    const original = patternedPcm();
    const delayBytes = 10 * 320 * 2; // 10 janelas de 20 ms
    const delayed = Buffer.concat([
        Buffer.alloc(delayBytes),
        original.subarray(0, original.length - delayBytes),
    ]);

    const alignment = detectPcmEnvelopeAlignment(original, delayed);
    assert.ok(Math.abs(alignment.offsetSeconds - 0.2) < 1e-9, JSON.stringify(alignment));
    assert.ok(alignment.confidence > 0.95, JSON.stringify(alignment));
});
test('filtro de alinhamento compensa atraso e adiantamento antes de pad/trim', () => {
    assert.match(
        buildIsolationAlignmentFilter(3, 0.2),
        /^atrim=start=0\.200000,asetpts=PTS-STARTPTS,aresample=16000,apad,atrim=duration=3\.000000/,
    );
    assert.match(
        buildIsolationAlignmentFilter(3, -0.12),
        /^adelay=120:all=1,aresample=16000,apad,atrim=duration=3\.000000/,
    );
    assert.throws(
        () => buildIsolationAlignmentFilter(3, 0.4),
        /offset.*lip-sync/i,
    );
});

test('deriva grave de duração é rejeitada mesmo antes do alinhamento', () => {
    assert.equal(hasSevereIsolationDurationDrift(30, 30.9), false);
    assert.equal(hasSevereIsolationDurationDrift(30, 33), true);
    assert.equal(hasSevereIsolationDurationDrift(0, 1), true);
});

test('isolamento nunca sobrescreve a fonte e reutiliza cache validado', async () => {
    const root = temporaryDirectory();
    try {
        const sourceDirectory = path.join(root, 'narrations');
        fs.mkdirSync(sourceDirectory, { recursive: true });
        const sourcePath = path.join(sourceDirectory, 'original.wav');
        const originalBytes = Buffer.from('original-preservado-'.repeat(20));
        fs.writeFileSync(sourcePath, originalBytes);

        const pcm = patternedPcm(100);
        let gatewayCalls = 0;
        const fakeProbe = async (filePath: string): Promise<AudioProbe> => ({
            duration: 2,
            hasAudio: fs.existsSync(filePath),
        });
        const dependencies = {
            probe: fakeProbe,
            extractPcm: async (_sourcePath: string, targetPath: string) => {
                await fs.promises.writeFile(targetPath, pcm);
            },
            gateway: async () => {
                gatewayCalls += 1;
                return {
                    audio: Buffer.from('provider-audio'),
                    mimeType: 'audio/wav',
                    demo: false,
                    charged: 1.25,
                    balance: 98.75,
                };
            },
            align: async (_providerPath: string, targetPath: string) => {
                await fs.promises.writeFile(targetPath, Buffer.alloc(256, 7));
            },
        };

        const first = await isolateAudioSource({
            sourcePath,
            sourceType: 'narration',
            token: 'token-teste',
            dataRoot: root,
        }, dependencies);
        assert.equal(first.cacheHit, false);
        assert.equal(first.charged, 1.25);
        assert.equal(first.detectedOffsetSeconds, 0);
        assert.ok(first.correlationConfidence > ISOLATION_MIN_CORRELATION_CONFIDENCE);
        assert.notEqual(path.resolve(first.outputPath), path.resolve(sourcePath));
        assert.deepEqual(fs.readFileSync(sourcePath), originalBytes);
        assert.equal(gatewayCalls, 1);

        const second = await isolateAudioSource({
            sourcePath,
            sourceType: 'narration',
            token: 'outro-token',
            dataRoot: root,
        }, dependencies);
        assert.equal(second.cacheHit, true);
        assert.equal(second.charged, 0);
        assert.equal(gatewayCalls, 1);
        assert.deepEqual(fs.readFileSync(sourcePath), originalBytes);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('falha do provedor preserva original e não publica saída parcial', async () => {
    const root = temporaryDirectory();
    try {
        const sourceDirectory = path.join(root, 'narrations');
        fs.mkdirSync(sourceDirectory, { recursive: true });
        const sourcePath = path.join(sourceDirectory, 'original.wav');
        const originalBytes = Buffer.from('fonte-que-nao-pode-mudar');
        fs.writeFileSync(sourcePath, originalBytes);
        const pcm = patternedPcm(100);

        await assert.rejects(
            isolateAudioSource({
                sourcePath,
                sourceType: 'narration',
                token: 'token-teste',
                dataRoot: root,
            }, {
                probe: async () => ({ duration: 2, hasAudio: true }),
                extractPcm: async (_sourcePath, targetPath) => fs.promises.writeFile(targetPath, pcm),
                gateway: async () => {
                    throw new Error('provedor indisponível');
                },
            }),
            /provedor indisponível/,
        );

        assert.deepEqual(fs.readFileSync(sourcePath), originalBytes);
        const isolatedDirectory = path.join(root, 'narrations', 'isolated');
        assert.deepEqual(fs.readdirSync(isolatedDirectory), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('proteção de destino rejeita explicitamente sobrescrita do original', () => {
    const root = temporaryDirectory();
    try {
        const source = path.join(root, 'source.wav');
        fs.writeFileSync(source, 'original');
        assert.throws(() => assertNonDestructiveAudioTarget(source, source), /nunca pode sobrescrever/i);
        assert.equal(fs.readFileSync(source, 'utf8'), 'original');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('takes sem audioMode permanecem ignorados para retrocompatibilidade', () => {
    const normalized = normalizeTakeAudioRequests([
        { id: 'legado', trim: { start: 0, end: 3 }, sourcePath: 'C:\\nao-deve-ser-lido.mp4' },
        {
            id: 'opt-in',
            audioMode: 'original',
            sourcePath: 'C:\\fonte.mp4',
            trim: { start: 1, end: 5 },
            timelineStartSec: 3,
            speed: 2,
        },
    ]);

    assert.equal(normalized.takes[0].audioMode, null);
    assert.equal(normalized.takes[0].source, null);
    assert.equal(normalized.takes[1].audioMode, 'original');
    assert.equal(normalized.takes[1].playbackDuration, 2);
    assert.equal(normalized.visualEnd, 5);
});

test('take opt-in com remapeamento não linear é rejeitado para preservar lip-sync', () => {
    assert.throws(
        () => normalizeTakeAudioRequests([{
            id: 'curva',
            audioMode: 'original',
            sourcePath: 'C:\\fonte.mp4',
            trim: { start: 0, end: 3 },
            speed: 'swoosh',
        }]),
        /non_linear_speed_unsupported|remapeamento não linear/i,
    );
});

test('take explicitamente opt-in sem faixa de áudio falha em vez de virar silêncio', () => {
    assert.throws(
        () => buildTakeAudioFilterGraph({
            masterInputIndex: null,
            duration: 3,
            takes: [{
                id: 'imagem-opt-in',
                audioMode: 'original',
                source: { sourcePath: 'imagem.png' },
                trimStart: 0,
                trimEnd: 3,
                playbackDuration: 3,
                timelineStartSec: 0,
                speed: 1,
                volume: 1,
                sourcePath: 'imagem.png',
                sourceSha256: '0'.repeat(64),
                inputIndex: null,
                hasAudio: false,
                sourceAudioDuration: 3,
            }],
        }),
        /take_audio_stream_missing/,
    );
});

test('mix de takes preserva duração contratada e aplica limiter pós-mix', () => {
    const graph = buildTakeAudioFilterGraph({
        masterInputIndex: 0,
        duration: 8.25,
        takes: [{
            id: 'voz',
            audioMode: 'original',
            source: { sourcePath: 'take.mp4' },
            trimStart: 1,
            trimEnd: 5,
            playbackDuration: 2,
            timelineStartSec: 3,
            speed: 2,
            volume: 0.8,
            sourcePath: 'take.mp4',
            sourceSha256: '1'.repeat(64),
            inputIndex: 1,
            hasAudio: true,
            sourceAudioDuration: 10,
        }],
    });
    assert.match(graph, /atempo=2/);
    assert.match(graph, /adelay=3000:all=1/);
    assert.match(graph, /alimiter=limit=0\.95:level=0/);
    assert.match(graph, /atrim=duration=8\.25/);
});

test('endpoints novos exigem Bearer antes de ler qualquer fonte local', async () => {
    const responseState = { status: 200, body: null as unknown };
    const response = {
        status(code: number) {
            responseState.status = code;
            return this;
        },
        json(body: unknown) {
            responseState.body = body;
            return this;
        },
    };
    await isolateAudio({ headers: {}, body: {} } as never, response as never);
    assert.equal(responseState.status, 401);

    responseState.status = 200;
    responseState.body = null;
    await mixTakeAudio({ headers: {}, body: {} } as never, response as never);
    assert.equal(responseState.status, 401);
});
