import assert from 'node:assert/strict';
import test from 'node:test';
import {
    invalidatedNarrationDerivatives,
    narrationSourceKey,
} from '../src/lib/narrationState.ts';

test('invalidar a narração remove o áudio e todos os derivados sem tocar na música', () => {
    const patch = invalidatedNarrationDerivatives();

    assert.equal(patch.isNarrationGenerated, false);
    assert.equal(patch.narrationAudioUrl, null);
    assert.equal(patch.narrationAudioPath, null);
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
