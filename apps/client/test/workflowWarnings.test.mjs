import assert from 'node:assert/strict';
import test from 'node:test';
import { narrationSourceKey } from '../src/lib/narrationState.ts';
import { missingInStep } from '../src/lib/workflowWarnings.ts';

const narration = (overrides = {}) => ({
    narrationText: 'Narração atual.',
    narrationAudioUrl: 'https://assets.example/current.mp3',
    narrationAudioPath: null,
    sharedNarrationAssetId: undefined,
    ...overrides,
});

const captionTrack = (sourceKey) => ({
    enabled: true,
    language: 'pt-BR',
    presetId: null,
    sourceKey,
    segments: [{ id: 'caption-1', start: 0, end: 1, text: 'Narração', words: [] }],
});

const title = (isActive) => ({
    id: 'title-1',
    text: 'Oferta',
    sourceText: 'Oferta',
    triggerId: 'offer',
    startSec: 0,
    durationSec: 1,
    isActive,
    posY: 30,
});

test('legendas só satisfazem a etapa 3 quando pertencem à narração atual', () => {
    const current = narration();
    const currentKey = narrationSourceKey(current);

    assert.deepEqual(missingInStep(3, {
        ...current,
        captions: captionTrack(currentKey),
    }, []), []);
    assert.deepEqual(missingInStep(3, {
        ...current,
        captions: captionTrack('narration-v1-stale'),
    }, []), ['legendas']);
    assert.deepEqual(missingInStep(3, {
        ...current,
        captions: captionTrack(undefined),
    }, []), ['legendas']);
});

test('títulos só satisfazem a etapa 4 quando são atuais e ao menos um está ativo', () => {
    const current = narration();
    const currentKey = narrationSourceKey(current);

    assert.deepEqual(missingInStep(4, {
        ...current,
        dynamicTitles: [title(true)],
        dynamicTitlesSourceKey: currentKey,
    }, []), []);
    assert.deepEqual(missingInStep(4, {
        ...current,
        dynamicTitles: [title(true)],
        dynamicTitlesSourceKey: 'narration-v1-stale',
    }, []), ['títulos ou chamadas visuais']);
    assert.deepEqual(missingInStep(4, {
        ...current,
        dynamicTitles: [title(false)],
        dynamicTitlesSourceKey: currentKey,
    }, []), ['títulos ou chamadas visuais']);
    assert.deepEqual(missingInStep(4, {
        ...current,
        dynamicTitles: [title(true)],
    }, []), ['títulos ou chamadas visuais']);
});
