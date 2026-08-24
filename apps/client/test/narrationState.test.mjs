import assert from 'node:assert/strict';
import test from 'node:test';
import {
    invalidatedNarrationDerivatives,
    invalidatedNarrationVariantDerivatives,
    narrationSourceKey,
} from '../src/lib/narrationState.ts';
import { narrationOriginalSourceKey } from '../src/lib/audioIsolation.ts';

test('invalidar a narração remove o áudio e todos os derivados sem tocar na música', () => {
    const patch = invalidatedNarrationDerivatives();

    assert.equal(patch.isNarrationGenerated, false);
    assert.equal(patch.narrationAudioUrl, null);
    assert.equal(patch.narrationAudioPath, null);
    assert.equal(patch.narrationIsolation, undefined);
    assert.equal(patch.narrationDuration, 0);
    assert.equal(patch.audioTimeline, undefined);
    assert.equal(patch.sharedNarrationAssetId, undefined);
    assert.equal(patch.masterAudioUrl, undefined);
    assert.equal(patch.sharedMasterAssetId, undefined);
    assert.equal(patch.captions, undefined);
    assert.deepEqual(patch.dynamicTitles, []);
    assert.equal(patch.dynamicTitlesSourceKey, undefined);

    assert.equal(Object.hasOwn(patch, 'musicAudioUrl'), false);
    assert.equal(Object.hasOwn(patch, 'sharedMusicAssetId'), false);
    assert.equal(Object.hasOwn(patch, 'audioConfig'), false);
});

test('trocar Original e Isolada invalida somente derivados, sem apagar a narração original', () => {
    const patch = invalidatedNarrationVariantDerivatives();

    assert.equal(patch.masterAudioUrl, undefined);
    assert.equal(patch.sharedMasterAssetId, undefined);
    assert.equal(patch.captions, undefined);
    assert.deepEqual(patch.dynamicTitles, []);
    assert.equal(Object.hasOwn(patch, 'narrationAudioUrl'), false);
    assert.equal(Object.hasOwn(patch, 'narrationAudioPath'), false);
});

test('a chave de origem muda quando muda a identidade do áudio da narração', () => {
    const narration = {
        narrationText: 'Uma narração.',
        narrationAudioUrl: 'https://assets.example/voice-a.mp3',
        narrationAudioPath: null,
        sharedNarrationAssetId: undefined,
    };

    assert.notEqual(
        narrationSourceKey(narration),
        narrationSourceKey({ ...narration, narrationAudioUrl: 'https://assets.example/voice-b.mp3' }),
    );
});

test('a chave de origem acompanha a variante ativa para invalidar STT e títulos', () => {
    const narration = {
        narrationText: 'Uma narração.',
        narrationAudioUrl: 'https://assets.example/original.mp3',
        narrationAudioPath: null,
        sharedNarrationAssetId: undefined,
    };
    const isolation = {
        activeVariant: 'isolated',
        isolatedAudioUrl: 'https://assets.example/isolated.wav',
        isolatedAudioPath: null,
        isolationSourceKey: narrationOriginalSourceKey(narration),
    };
    const active = { ...narration, narrationIsolation: isolation };

    assert.notEqual(narrationSourceKey(narration), narrationSourceKey(active));
});
