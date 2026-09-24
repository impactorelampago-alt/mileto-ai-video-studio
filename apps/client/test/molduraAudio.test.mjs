import assert from 'node:assert/strict';
import test from 'node:test';
import {
    audioConfigForProjectTimeline,
    canonicalProjectTimelineDuration,
    configuredBackgroundTimelineDuration,
    configuredNarrationTimelineDuration,
    createNarrationTimingContract,
    deriveTimelineContract,
    fullMolduraAudioConfig,
    isAudioSourceShortForTimeline,
    isAudioSourceInvalidForTimeline,
    isShortMolduraMaster,
    narrationAudioConfigForProject,
    masterAudioContractFromMix,
    masterAudioContractIsCurrent,
    molduraNarrationUsesFullSource,
    previewTimelineDuration,
    previewMasterIsUnverified,
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

test('modelo Takes migra trim legado curto para a narração integral', () => {
    const adData = {
        videoModel: 'takes',
        narrationDuration: 16.1,
        narrationText: 'Locução atual completa',
        narrationAudioUrl: 'http://localhost:3301/narrations/current.mp3',
        narrationAudioPath: null,
        audioConfig: audioConfig(),
    };
    const configuredDuration = configuredNarrationTimelineDuration(adData);
    assert.equal(configuredDuration, 16.1);
    const repaired = narrationAudioConfigForProject(adData);
    assert.equal(repaired.narration.offsetSec, 0);
    assert.equal(repaired.narration.trimStart, 0);
    assert.equal(repaired.narration.trimEnd, 16.1);
    assert.equal(projectAudioTimelineDuration({
        videoModel: 'takes',
        narrationDuration: 16.1,
        narrationTrackDuration: configuredDuration,
        backgroundTrackDuration: 20,
    }), 16.1);
    assert.equal(previewTimelineDuration({
        videoModel: 'takes',
        narrationDuration: 16.1,
        configuredAudioDuration: configuredDuration,
        measuredMasterDuration: 11.6,
        takesDuration: 16.1,
    }), 16.1);
});

test('modelo Takes só preserva corte autoral ligado à fonte atual', () => {
    const base = {
        videoModel: 'takes',
        narrationDuration: 16.1,
        narrationText: 'Locução atual completa',
        narrationAudioUrl: 'http://localhost:3301/narrations/current.mp3',
        narrationAudioPath: null,
        sharedNarrationAssetId: undefined,
        narrationIsolation: undefined,
        audioConfig: audioConfig(),
    };
    const edited = {
        ...base,
        narrationTimingContract: createNarrationTimingContract(base),
    };
    assert.equal(configuredNarrationTimelineDuration(edited), 11.6);

    const changedSource = {
        ...edited,
        narrationAudioUrl: 'http://localhost:3301/narrations/replaced.mp3',
    };
    assert.equal(configuredNarrationTimelineDuration(changedSource), 16.1);
    assert.equal(narrationAudioConfigForProject(changedSource).narration.trimEnd, 16.1);
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
    const explicitlyEdited = {
        ...edited,
        narrationTimingContract: createNarrationTimingContract(edited),
    };
    assert.equal(canonicalProjectTimelineDuration(explicitlyEdited, 10), 14.2);
    assert.equal(masterAudioContractIsCurrent(explicitlyEdited, 10), false);
});

test('hidratação limpa timeline e master herdados quando o trim não tem autoria', () => {
    const legacy = {
        videoModel: 'takes',
        narrationDuration: 15.83,
        narrationText: 'Narração que chega ao CTA',
        narrationAudioUrl: 'http://localhost:3301/narrations/current.mp3',
        narrationAudioPath: null,
        sharedNarrationAssetId: undefined,
        narrationIsolation: undefined,
        musicAudioUrl: null,
        sharedMusicAssetId: undefined,
        audioConfig: audioConfig({ narration: { trimEnd: 10.4 } }),
        audioTimeline: {
            durationSec: 10.4,
            tracks: [{ id: 'narration', clips: [{ outSec: 10.4 }] }],
        },
        masterAudioUrl: 'http://localhost:3301/mixes/old.mp3',
        masterAudioContract: {
            version: 1,
            durationSec: 10.4,
            expectedDurationSec: 10.4,
            mixIdentity: 'old',
            timelineFingerprint: 'old',
        },
    };
    const repaired = withCanonicalTimelineContract(legacy, 10.4);
    assert.equal(repaired.audioConfig.narration.trimEnd, 15.83);
    assert.equal(repaired.audioTimeline, undefined);
    assert.equal(repaired.timelineContract.durationSec, 15.83);
    assert.equal(repaired.masterAudioContract, undefined);
});

test('faixas com clips visíveis são reativadas e master silencioso é invalidado', () => {
    const source = {
        videoModel: 'takes',
        narrationDuration: 14,
        narrationAudioUrl: '/narrations/voice.mp3',
        narrationAudioPath: null,
        musicAudioUrl: '/music/track.mp3',
        audioConfig: audioConfig({
            narration: { enabled: false, trimEnd: 14 },
            background: { enabled: false, trimEnd: 14 },
        }),
        audioTimeline: { durationSec: 14, tracks: [
            { id: 'narration', enabled: false, muted: false, clips: [{ id: 'voice' }] },
            { id: 'bgm', enabled: false, muted: false, clips: [{ id: 'music' }] },
        ] },
        masterAudioUrl: '/mixes/without-voice.mp3',
        masterAudioContract: { version: 1, durationSec: 14, expectedDurationSec: 14,
            mixIdentity: 'old', timelineFingerprint: 'old' },
    };
    const repaired = withCanonicalTimelineContract(source, 14);
    assert.equal(repaired.audioConfig.narration.enabled, true);
    assert.equal(repaired.audioConfig.background.enabled, true);
    assert.equal(repaired.audioTimeline.tracks[0].enabled, true);
    assert.equal(repaired.audioTimeline.tracks[1].enabled, true);
    assert.equal(repaired.masterAudioUrl, undefined);
    assert.equal(repaired.masterAudioContract, undefined);
});

test('faixa sem clip ou explicitamente mutada não é reativada', () => {
    const source = {
        videoModel: 'takes', narrationDuration: 14,
        narrationAudioUrl: '/narrations/voice.mp3', musicAudioUrl: null,
        audioConfig: audioConfig({ narration: { enabled: false, trimEnd: 14 } }),
        audioTimeline: { durationSec: 14, tracks: [
            { id: 'narration', enabled: false, muted: true, clips: [{ id: 'voice' }] },
        ] },
    };
    const repaired = withCanonicalTimelineContract(source, 14);
    assert.equal(repaired.audioConfig.narration.enabled, false);
    assert.equal(repaired.audioTimeline.tracks[0].enabled, false);
});

test('prévia usa a narração se o master de áudio não tem contrato válido', () => {
    const source = {
        videoModel: 'takes', narrationDuration: 14,
        narrationAudioUrl: '/narrations/voice.mp3', musicAudioUrl: null,
        audioConfig: audioConfig({ narration: { trimEnd: 14 } }),
    };
    assert.equal(previewMasterIsUnverified(source, 14, '/mixes/legacy.mp3', source.narrationAudioUrl), true);
    assert.equal(previewMasterIsUnverified(source, 14, source.narrationAudioUrl, source.narrationAudioUrl), false);
    assert.equal(previewMasterIsUnverified(source, 14, '/mixes/music-only.mp3', null), false);
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
