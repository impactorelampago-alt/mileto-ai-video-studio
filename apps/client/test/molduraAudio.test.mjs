import assert from 'node:assert/strict';
import test from 'node:test';
import {
    fullMolduraAudioConfig,
    isShortMolduraMaster,
    molduraNarrationUsesFullSource,
    previewTimelineDuration,
    projectAudioTimelineDuration,
} from '../src/lib/molduraAudio.ts';

const audioConfig = (overrides = {}) => ({
    narration: {
        enabled: true,
        volume: 1,
        offsetSec: 0,
        trimStart: 0,
        trimEnd: 11.6,
        fadeInSec: 0,
        fadeOutSec: 0,
        ...(overrides.narration || {}),
    },
    background: {
        enabled: true,
        volume: 0.3,
        offsetSec: 0,
        trimStart: 0,
        trimEnd: 11.6,
        fadeInSec: 0,
        fadeOutSec: 0,
        ...(overrides.background || {}),
    },
});

test('Moldura usa a narração inteira mesmo quando o recorte legado termina antes', () => {
    const adData = {
        videoModel: 'moldura',
        narrationDuration: 16.1,
        audioConfig: audioConfig(),
    };

    assert.equal(molduraNarrationUsesFullSource(adData), false);
    const repaired = fullMolduraAudioConfig(adData);
    assert.equal(repaired.narration.trimStart, 0);
    assert.equal(repaired.narration.trimEnd, 16.1);
    assert.equal(repaired.background.trimEnd, 11.6, 'a correção não apaga o ajuste da música');
    assert.equal(molduraNarrationUsesFullSource({ ...adData, audioConfig: repaired }), true);
});

test('relógio da Moldura ignora fim curto da configuração e preserva o CTA', () => {
    assert.equal(projectAudioTimelineDuration({
        videoModel: 'moldura',
        narrationDuration: 16.1,
        narrationTrackDuration: 11.6,
        backgroundTrackDuration: 11.6,
    }), 16.1);
    assert.equal(previewTimelineDuration({
        videoModel: 'moldura',
        narrationDuration: 16.1,
        measuredMasterDuration: 11.6,
        takesDuration: 16.1,
    }), 16.1);
    assert.equal(isShortMolduraMaster({ videoModel: 'moldura', narrationDuration: 16.1 }, 11.6), true);
});

test('modelo Takes continua respeitando o recorte intencional do áudio', () => {
    assert.equal(projectAudioTimelineDuration({
        videoModel: 'takes',
        narrationDuration: 16.1,
        narrationTrackDuration: 11.6,
        backgroundTrackDuration: 20,
    }), 11.6);
    assert.equal(previewTimelineDuration({
        videoModel: 'takes',
        narrationDuration: 16.1,
        measuredMasterDuration: 11.6,
        takesDuration: 16.1,
    }), 11.6);
});
