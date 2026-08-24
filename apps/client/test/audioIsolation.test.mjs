import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildTakeAudioMixItems,
    normalizeTakeAudio,
    narrationOriginalSourceKey,
    resolveEffectiveNarrationAudio,
    takeOriginalSourceKey,
} from '../src/lib/audioIsolation.ts';

const take = (overrides = {}) => ({
    id: 'take-1',
    fileName: 'take.mp4',
    type: 'video',
    url: 'http://localhost:3301/media/take.mp4',
    originalDurationSeconds: 12,
    trim: { start: 2, end: 6 },
    ...overrides,
});

test('projeto antigo sem configuração mantém áudio de take desligado', () => {
    assert.deepEqual(normalizeTakeAudio(undefined), {
        mode: 'off',
        volume: 1,
        isolatedAudioUrl: null,
        isolatedAudioPath: null,
        isolationSourceKey: undefined,
    });
    assert.deepEqual(buildTakeAudioMixItems([take({ muteOriginalAudio: false })]), []);
});

test('narração usa a variante isolada somente quando ativa, disponível e ligada ao original atual', () => {
    const original = {
        narrationAudioUrl: 'http://localhost:3301/narrations/original.mp3',
        narrationAudioPath: null,
        sharedNarrationAssetId: undefined,
    };
    const sourceKey = narrationOriginalSourceKey(original);
    const isolated = {
        ...original,
        narrationIsolation: {
            activeVariant: 'isolated',
            isolatedAudioUrl: 'http://localhost:3301/narrations/isolated.wav',
            isolatedAudioPath: 'C:/cache/isolated.wav',
            isolationSourceKey: sourceKey,
        },
    };

    assert.equal(resolveEffectiveNarrationAudio(original).variant, 'original');
    assert.deepEqual(resolveEffectiveNarrationAudio(isolated), {
        variant: 'isolated',
        url: 'http://localhost:3301/narrations/isolated.wav',
        path: 'C:/cache/isolated.wav',
    });
    assert.equal(
        resolveEffectiveNarrationAudio({ ...isolated, narrationAudioUrl: 'http://localhost:3301/narrations/new.mp3' }).variant,
        'original',
        'uma saída isolada antiga nunca substitui silenciosamente a nova fonte',
    );
});

test('payload de mix respeita opt-in, cortes, posição real e volume', () => {
    const first = take({ id: 'off', trim: { start: 0, end: 3 }, audio: undefined });
    const second = take({
        id: 'original',
        backendPath: 'C:/media/original.mp4',
        trim: { start: 1.25, end: 5.75 },
        audio: { mode: 'original', volume: 0.65 },
    });
    const thirdBase = take({
        id: 'isolated',
        url: 'http://localhost:3301/media/third.mp4',
        trim: { start: 4, end: 7 },
    });
    const third = {
        ...thirdBase,
        audio: {
            mode: 'isolated',
            volume: 1.2,
            isolatedAudioUrl: 'http://localhost:3301/audio/third-isolated.wav',
            isolatedAudioPath: 'C:/cache/third-isolated.wav',
            isolationSourceKey: takeOriginalSourceKey(thirdBase),
        },
    };

    const payload = buildTakeAudioMixItems([first, second, third]);
    assert.equal(payload.length, 2);
    assert.deepEqual(payload[0], {
        id: 'original',
        audioMode: 'original',
        volume: 0.65,
        sourceUrl: 'http://localhost:3301/media/take.mp4',
        sourcePath: 'C:/media/original.mp4',
        trim: { start: 1.25, end: 5.75 },
        timelineStartSec: 3,
        speed: 1,
    });
    assert.equal(payload[1].timelineStartSec, 7.5);
    assert.equal(payload[1].audioMode, 'isolated');
    assert.equal(payload[1].isolatedAudioPath, 'C:/cache/third-isolated.wav');
    assert.equal(payload[1].isolatedAudioUrl, 'http://localhost:3301/audio/third-isolated.wav');
});

test('áudio opt-in com velocidade variável bloqueia o payload em vez de degradar', () => {
    assert.throws(
        () => buildTakeAudioMixItems([take({
            speedPresetId: 'swoosh',
            audio: { mode: 'original', volume: 1 },
        })]),
        /take_audio_speed_unsupported/,
    );
});

test('identidade do take segue a fonte e sobrevive a cópia ou renomeação visual', () => {
    const original = take({ backendPath: 'C:/media/source.mp4' });
    const copied = {
        ...original,
        id: 'take-copy',
        fileName: 'source (cópia).mp4',
    };

    assert.equal(takeOriginalSourceKey(original), takeOriginalSourceKey(copied));
    assert.notEqual(
        takeOriginalSourceKey(original),
        takeOriginalSourceKey({ ...copied, backendPath: 'C:/media/other.mp4' }),
    );
});

test('mixagem rejeita isolamento obsoleto sem cair silenciosamente no áudio original', () => {
    assert.throws(
        () => buildTakeAudioMixItems([take({
            audio: {
                mode: 'isolated',
                volume: 1,
                isolatedAudioUrl: 'http://localhost:3301/audio/old.wav',
                isolationSourceKey: 'take-original-v1-obsoleto',
            },
        })]),
        /take_audio_isolation_stale/,
    );
});
