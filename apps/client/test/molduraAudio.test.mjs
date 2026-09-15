import assert from 'node:assert/strict';
import test from 'node:test';
import {
    audioConfigForProjectTimeline,
    canonicalProjectTimelineDuration,
    configuredBackgroundTimelineDuration,
    configuredNarrationTimelineDuration,
    deriveTimelineContract,
    fullMolduraAudioConfig,
    isAudioSourceShortForTimeline,
    isAudioSourceInvalidForTimeline,
    isShortMolduraMaster,
    masterAudioContractFromMix,
    masterAudioContractIsCurrent,
    molduraNarrationUsesFullSource,
    previewTimelineDuration,
    projectAudioTimelineDuration,
    withCanonicalTimelineContract,
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
    assert.equal(isShortMolduraMaster({ videoModel: 'moldura', narrationDuration: 16.1 }, 0), true);
});

test('modelo Takes continua respeitando o recorte intencional do áudio', () => {
    const adData = {
        videoModel: 'takes',
        narrationDuration: 16.1,
        audioConfig: audioConfig(),
    };
    const configuredDuration = configuredNarrationTimelineDuration(adData);
    assert.equal(configuredDuration, 11.6);
    assert.equal(projectAudioTimelineDuration({
        videoModel: 'takes',
        narrationDuration: 16.1,
        narrationTrackDuration: 11.6,
        backgroundTrackDuration: 20,
    }), 11.6);
    assert.equal(previewTimelineDuration({
        videoModel: 'takes',
        narrationDuration: 16.1,
        configuredAudioDuration: configuredDuration,
        measuredMasterDuration: 11.6,
        takesDuration: 16.1,
    }), 11.6);
});

test('modelo Takes não deixa um master antigo de 10s encurtar uma narração atual de 15,83s', () => {
    const adData = {
        videoModel: 'takes',
        narrationDuration: 15.83,
        audioConfig: audioConfig({
            narration: { trimEnd: 15.83 },
            background: { trimEnd: 15.83 },
        }),
    };
    const configuredDuration = configuredNarrationTimelineDuration(adData);

    assert.equal(configuredDuration, 15.83);
    assert.equal(isAudioSourceShortForTimeline(configuredDuration, 10), true);
    assert.equal(isAudioSourceShortForTimeline(configuredDuration, 0), true, 'duração desconhecida não é aceita');
    assert.equal(isAudioSourceInvalidForTimeline(configuredDuration, 16.5), true, 'duração excedente também diverge do contrato');
    assert.equal(previewTimelineDuration({
        videoModel: 'takes',
        narrationDuration: 15.83,
        configuredAudioDuration: configuredDuration,
        measuredMasterDuration: 10,
        takesDuration: 15.83,
    }), 15.83);
});

test('contrato canônico é estável e invalida master quando a configuração muda', () => {
    const base = {
        videoModel: 'takes',
        narrationDuration: 15.83,
        narrationAudioUrl: 'http://localhost:3301/narrations/current.mp3',
        narrationAudioPath: null,
        sharedNarrationAssetId: undefined,
        narrationIsolation: undefined,
        musicAudioUrl: null,
        sharedMusicAssetId: undefined,
        audioConfig: audioConfig({
            narration: { trimEnd: 15.83 },
            background: { enabled: false },
        }),
    };
    const timeline = deriveTimelineContract(base, 10);
    assert.equal(timeline.durationSec, 15.83);
    assert.equal(timeline.source, 'narration');
    assert.equal(canonicalProjectTimelineDuration({ ...base, timelineContract: timeline }, 10), 15.83);
    const reordered = {
        ...base,
        audioConfig: {
            background: { fadeOutSec: 0, trimEnd: 11.6, enabled: false, volume: 0.3, offsetSec: 0, trimStart: 0, fadeInSec: 0 },
            narration: { fadeOutSec: 0, trimEnd: 15.83, enabled: true, volume: 1, offsetSec: 0, trimStart: 0, fadeInSec: 0 },
        },
    };
    assert.equal(deriveTimelineContract(reordered, 10).fingerprint, timeline.fingerprint);

    const masterAudioContract = masterAudioContractFromMix(
        { ...base, timelineContract: timeline },
        {
            durationSec: 15.86,
            expectedDurationSec: 15.83,
            mixIdentity: 'mix-current',
        },
        10,
    );
    assert.equal(masterAudioContractIsCurrent({ ...base, timelineContract: timeline, masterAudioContract }, 10), true);
    assert.throws(() => masterAudioContractFromMix(
        { ...base, timelineContract: timeline },
        { durationSec: 10, expectedDurationSec: 15.83, mixIdentity: 'mix-short' },
        10,
    ), /timeline atual exige/);

    const invalidMaster = { ...masterAudioContract, durationSec: 10 };
    assert.equal(
        withCanonicalTimelineContract({ ...base, timelineContract: timeline, masterAudioContract: invalidMaster }, 10).masterAudioContract,
        undefined,
    );

    const edited = {
        ...base,
        audioConfig: audioConfig({
            narration: { trimEnd: 14.2 },
            background: { enabled: false },
        }),
        timelineContract: timeline,
        masterAudioContract,
    };
    assert.equal(canonicalProjectTimelineDuration(edited, 10), 14.2);
    assert.equal(masterAudioContractIsCurrent(edited, 10), false);
});

test('timeline sem áudio usa a soma visual sem permitir contrato antigo', () => {
    const adData = {
        videoModel: 'takes',
        narrationDuration: 0,
        narrationAudioUrl: null,
        narrationAudioPath: null,
        sharedNarrationAssetId: undefined,
        narrationIsolation: undefined,
        musicAudioUrl: null,
        sharedMusicAssetId: undefined,
        audioConfig: audioConfig({
            narration: { enabled: false, trimEnd: undefined },
            background: { enabled: false, trimEnd: undefined },
        }),
    };
    const first = deriveTimelineContract(adData, 10);
    assert.equal(first.durationSec, 10);
    assert.equal(first.source, 'takes');
    assert.equal(canonicalProjectTimelineDuration({ ...adData, timelineContract: first }, 15), 15);
});

test('música sem narração é limitada à timeline visual', () => {
    const adData = {
        videoModel: 'takes',
        narrationDuration: 0,
        musicAudioUrl: 'http://localhost:3301/system-music/batida-1.mp3',
        sharedMusicAssetId: undefined,
        audioConfig: audioConfig({
            narration: { enabled: false, trimEnd: undefined },
            background: { offsetSec: 0.5, trimStart: 2, trimEnd: undefined },
        }),
    };
    const configured = audioConfigForProjectTimeline(adData, 10);
    assert.equal(configured.background.trimEnd, 11.5);
    assert.equal(configuredBackgroundTimelineDuration({ ...adData, audioConfig: configured }), 10);
});
