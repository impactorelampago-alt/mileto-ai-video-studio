import type {
    AdData,
    AudioConfig,
    MasterAudioContract,
    NarrationTimingContract,
    TimelineDurationContract,
} from '../types';
import { narrationSourceKey } from './narrationState.ts';

export const MOLDURA_AUDIO_DURATION_TOLERANCE_SEC = 0.12;
const NARRATION_TIMING_NORMALIZATION_EPSILON_SEC = 0.001;

const positiveDuration = (value: unknown): number => {
    const duration = Number(value);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
};

const roundDuration = (value: number): number => Number(value.toFixed(6));

const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
};

const fingerprint = (value: unknown): string => {
    const source = stableStringify(value);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `timeline-v1-${(hash >>> 0).toString(16)}`;
};

type NarrationTimingData = Pick<AdData, 'videoModel' | 'narrationDuration' | 'audioConfig'> & Partial<Pick<
    AdData,
    | 'narrationText'
    | 'narrationAudioUrl'
    | 'narrationAudioPath'
    | 'sharedNarrationAssetId'
    | 'narrationIsolation'
    | 'narrationTimingContract'
>>;

const currentNarrationTimingSourceKey = (adData: NarrationTimingData): string => narrationSourceKey({
    narrationText: adData.narrationText || '',
    narrationAudioUrl: adData.narrationAudioUrl ?? null,
    narrationAudioPath: adData.narrationAudioPath ?? null,
    sharedNarrationAssetId: adData.sharedNarrationAssetId,
    narrationIsolation: adData.narrationIsolation,
});

export const createNarrationTimingContract = (
    adData: NarrationTimingData,
): NarrationTimingContract => ({
    version: 1,
    mode: 'custom',
    sourceKey: currentNarrationTimingSourceKey(adData),
});

/**
 * Um trim só é autoral quando foi salvo pelo editor para esta fonte exata.
 * Drafts anteriores ao contrato não têm como provar essa intenção e voltam à
 * locução integral, impedindo que metadados herdados cortem o CTA.
 */
export const hasCurrentCustomNarrationTiming = (
    adData: NarrationTimingData,
): boolean => Boolean(
    adData.videoModel !== 'moldura'
    && positiveDuration(adData.narrationDuration) > 0
    && adData.narrationTimingContract?.version === 1
    && adData.narrationTimingContract.mode === 'custom'
    && adData.narrationTimingContract.sourceKey === currentNarrationTimingSourceKey(adData),
);

/** Normaliza o estado legado; não altera um corte autoral ligado à fonte atual. */
export const narrationAudioConfigForProject = (
    adData: NarrationTimingData,
): AudioConfig => {
    const duration = positiveDuration(adData.narrationDuration);
    if (!(duration > 0) || hasCurrentCustomNarrationTiming(adData)) return adData.audioConfig;

    const narration = adData.audioConfig.narration;
    const alreadyFull = Math.abs(Number(narration.offsetSec) || 0) <= NARRATION_TIMING_NORMALIZATION_EPSILON_SEC
        && Math.abs(Number(narration.trimStart) || 0) <= NARRATION_TIMING_NORMALIZATION_EPSILON_SEC
        && Math.abs(positiveDuration(narration.trimEnd) - duration) <= NARRATION_TIMING_NORMALIZATION_EPSILON_SEC;
    if (alreadyFull) return adData.audioConfig;

    return {
        ...adData.audioConfig,
        narration: {
            ...narration,
            offsetSec: 0,
            trimStart: 0,
            trimEnd: duration,
        },
    };
};

export const molduraNarrationDuration = (
    adData: Pick<AdData, 'videoModel' | 'narrationDuration'>,
): number => adData.videoModel === 'moldura'
    ? positiveDuration(adData.narrationDuration)
    : 0;

/**
 * A Moldura não possui uma etapa posterior capaz de revelar ou corrigir um
 * recorte antigo. Quando há locução, o contrato desse modelo é usar a voz
 * inteira como relógio do anúncio.
 */
export const fullMolduraAudioConfig = (
    adData: Pick<AdData, 'videoModel' | 'narrationDuration' | 'audioConfig'>,
): AudioConfig => {
    const duration = molduraNarrationDuration(adData);
    if (!(duration > 0)) return adData.audioConfig;
    return {
        ...adData.audioConfig,
        narration: {
            ...adData.audioConfig.narration,
            trimStart: 0,
            trimEnd: duration,
        },
    };
};

export const molduraNarrationUsesFullSource = (
    adData: Pick<AdData, 'videoModel' | 'narrationDuration' | 'audioConfig'>,
): boolean => {
    const duration = molduraNarrationDuration(adData);
    if (!(duration > 0)) return true;
    const start = Number(adData.audioConfig.narration.trimStart || 0);
    const end = positiveDuration(adData.audioConfig.narration.trimEnd);
    return Math.abs(start) <= MOLDURA_AUDIO_DURATION_TOLERANCE_SEC
        && Math.abs(end - duration) <= MOLDURA_AUDIO_DURATION_TOLERANCE_SEC;
};

export const isShortMolduraMaster = (
    adData: Pick<AdData, 'videoModel' | 'narrationDuration'>,
    measuredDuration: unknown,
): boolean => {
    const expectedDuration = molduraNarrationDuration(adData);
    const actualDuration = positiveDuration(measuredDuration);
    return expectedDuration > 0
        && (actualDuration <= 0
            || actualDuration < expectedDuration - MOLDURA_AUDIO_DURATION_TOLERANCE_SEC);
};

export const projectAudioTimelineDuration = (input: {
    videoModel?: AdData['videoModel'];
    narrationDuration: unknown;
    narrationTrackDuration: unknown;
    backgroundTrackDuration: unknown;
}): number => {
    const narrationDuration = positiveDuration(input.narrationDuration);
    if (input.videoModel === 'moldura' && narrationDuration > 0) return narrationDuration;
    return positiveDuration(input.narrationTrackDuration)
        || narrationDuration
        || positiveDuration(input.backgroundTrackDuration);
};

/**
 * Duração que a faixa de narração deve ocupar na timeline. Diferente da duração
 * física do MP3 master, este valor preserva um corte intencional feito no editor
 * de áudio e também denuncia masters antigos que terminam antes do corte atual.
 */
export const configuredNarrationTimelineDuration = (
    adData: NarrationTimingData,
): number => {
    const narrationDuration = positiveDuration(adData.narrationDuration);

    const narration = adData.audioConfig?.narration;
    if (!narration || narration.enabled === false) return 0;
    const volume = Number(narration.volume);
    if (Number.isFinite(volume) && volume <= 0) return 0;

    if (narrationDuration > 0 && !hasCurrentCustomNarrationTiming(adData)) {
        return narrationDuration;
    }

    const trimStart = Math.max(0, Number(narration.trimStart) || 0);
    const configuredTrimEnd = positiveDuration(narration.trimEnd) || narrationDuration;
    const trimEnd = narrationDuration > 0
        ? Math.min(configuredTrimEnd, narrationDuration)
        : configuredTrimEnd;
    if (!(trimEnd > trimStart)) return 0;
    return Math.max(0, Number(narration.offsetSec) || 0) + (trimEnd - trimStart);
};

export const configuredBackgroundTimelineDuration = (
    adData: Pick<AdData, 'musicAudioUrl' | 'sharedMusicAssetId' | 'audioConfig'>,
): number => {
    const background = adData.audioConfig?.background;
    if (!background || background.enabled === false) return 0;
    const volume = Number(background.volume);
    if (Number.isFinite(volume) && volume <= 0) return 0;
    if (!adData.musicAudioUrl && !adData.sharedMusicAssetId) return 0;

    const trimStart = Math.max(0, Number(background.trimStart) || 0);
    const trimEnd = positiveDuration(background.trimEnd);
    if (!(trimEnd > trimStart)) return 0;
    return Math.max(0, Number(background.offsetSec) || 0) + (trimEnd - trimStart);
};

/**
 * Quando não há narração, uma música sem recorte explícito acompanha a linha
 * visual em vez de transformar a duração física inteira do arquivo no relógio
 * do projeto.
 */
export const audioConfigForProjectTimeline = (
    adData: NarrationTimingData & Pick<AdData, 'musicAudioUrl' | 'sharedMusicAssetId'>,
    takesDuration: unknown = 0,
): AudioConfig => {
    const normalizedAudioConfig = narrationAudioConfigForProject(adData);
    const normalizedAdData = { ...adData, audioConfig: normalizedAudioConfig };
    if (configuredNarrationTimelineDuration(normalizedAdData) > 0) return normalizedAudioConfig;
    if (configuredBackgroundTimelineDuration(normalizedAdData) > 0) return normalizedAudioConfig;

    const visualDuration = positiveDuration(takesDuration);
    const background = adData.audioConfig?.background;
    const volume = Number(background?.volume);
    if (
        !(visualDuration > 0)
        || !background
        || background.enabled === false
        || (Number.isFinite(volume) && volume <= 0)
        || (!adData.musicAudioUrl && !adData.sharedMusicAssetId)
    ) {
        return normalizedAudioConfig;
    }

    const offsetSec = Math.max(0, Number(background.offsetSec) || 0);
    const trimStart = Math.max(0, Number(background.trimStart) || 0);
    const playableDuration = visualDuration - offsetSec;
    if (!(playableDuration > 0)) return normalizedAudioConfig;
    return {
        ...normalizedAudioConfig,
        background: {
            ...background,
            trimEnd: roundDuration(trimStart + playableDuration),
        },
    };
};

const stableAudioIdentity = (adData: Pick<
    AdData,
    | 'narrationAudioUrl'
    | 'narrationAudioPath'
    | 'sharedNarrationAssetId'
    | 'narrationIsolation'
    | 'musicAudioUrl'
    | 'sharedMusicAssetId'
>) => ({
    narration: adData.narrationIsolation?.activeVariant === 'isolated'
        ? adData.narrationIsolation.isolatedAudioPath
            || adData.narrationIsolation.isolatedAudioUrl
            || null
        : adData.sharedNarrationAssetId || adData.narrationAudioPath || adData.narrationAudioUrl || null,
    music: adData.sharedMusicAssetId || adData.musicAudioUrl || null,
});

export const deriveTimelineContract = (
    adData: Pick<
        AdData,
        | 'videoModel'
        | 'narrationDuration'
        | 'narrationAudioUrl'
        | 'narrationAudioPath'
        | 'sharedNarrationAssetId'
        | 'narrationIsolation'
        | 'narrationText'
        | 'narrationTimingContract'
        | 'musicAudioUrl'
        | 'sharedMusicAssetId'
        | 'audioConfig'
    >,
    takesDuration: unknown = 0,
): TimelineDurationContract | undefined => {
    const normalizedAudioConfig = narrationAudioConfigForProject(adData);
    const normalizedAdData = { ...adData, audioConfig: normalizedAudioConfig };
    const narrationDuration = configuredNarrationTimelineDuration(normalizedAdData);
    const backgroundDuration = configuredBackgroundTimelineDuration(normalizedAdData);
    const visualDuration = positiveDuration(takesDuration);
    const source: TimelineDurationContract['source'] = narrationDuration > 0
        ? 'narration'
        : backgroundDuration > 0
            ? 'background'
            : 'takes';
    const durationSec = roundDuration(
        narrationDuration || backgroundDuration || visualDuration,
    );
    if (!(durationSec > 0)) return undefined;

    const input = {
        version: 1,
        source,
        durationSec,
        videoModel: adData.videoModel || 'takes',
        audio: stableAudioIdentity(adData),
        narrationDuration: positiveDuration(adData.narrationDuration),
        narration: normalizedAudioConfig.narration,
        background: normalizedAudioConfig.background,
        narrationTiming: hasCurrentCustomNarrationTiming(adData)
            ? adData.narrationTimingContract
            : null,
        ...(source === 'takes' ? { takesDuration: visualDuration } : {}),
    };
    return { version: 1, durationSec, source, fingerprint: fingerprint(input) };
};

export const projectTimelineContract = (
    adData: Pick<
        AdData,
        | 'videoModel'
        | 'narrationDuration'
        | 'narrationAudioUrl'
        | 'narrationAudioPath'
        | 'sharedNarrationAssetId'
        | 'narrationIsolation'
        | 'narrationText'
        | 'narrationTimingContract'
        | 'musicAudioUrl'
        | 'sharedMusicAssetId'
        | 'audioConfig'
        | 'timelineContract'
    >,
    takesDuration: unknown = 0,
): TimelineDurationContract | undefined => {
    const derived = deriveTimelineContract(adData, takesDuration);
    const stored = adData.timelineContract;
    if (
        derived
        && stored?.version === 1
        && stored.fingerprint === derived.fingerprint
        && stored.source === derived.source
        && Math.abs(stored.durationSec - derived.durationSec) <= 0.001
    ) {
        return stored;
    }
    return derived;
};

export const canonicalProjectTimelineDuration = (
    adData: Parameters<typeof projectTimelineContract>[0],
    takesDuration: unknown = 0,
): number => projectTimelineContract(adData, takesDuration)?.durationSec || 0;

const masterContractMatchesTimeline = (
    timeline: TimelineDurationContract | undefined,
    master: MasterAudioContract | undefined,
): boolean => Boolean(
    timeline
    && master?.version === 1
    && master.timelineFingerprint === timeline.fingerprint
    && typeof master.mixIdentity === 'string'
    && master.mixIdentity.trim()
    && positiveDuration(master.durationSec) > 0
    && positiveDuration(master.expectedDurationSec) > 0
    && Math.abs(master.durationSec - timeline.durationSec) <= MOLDURA_AUDIO_DURATION_TOLERANCE_SEC
    && Math.abs(master.expectedDurationSec - timeline.durationSec) <= MOLDURA_AUDIO_DURATION_TOLERANCE_SEC,
);

export const withCanonicalTimelineContract = <T extends AdData>(
    adData: T,
    takesDuration: unknown = 0,
): T => {
    const customTimingIsCurrent = hasCurrentCustomNarrationTiming(adData);
    const normalizedAudioConfig = narrationAudioConfigForProject(adData);
    const timingStateWasReset = normalizedAudioConfig !== adData.audioConfig
        || Boolean(adData.narrationTimingContract && !customTimingIsCurrent);
    const normalizedAdData = {
        ...adData,
        audioConfig: normalizedAudioConfig,
        ...(!customTimingIsCurrent ? { narrationTimingContract: undefined } : {}),
        ...(timingStateWasReset ? { audioTimeline: undefined } : {}),
    } as T;
    const nextContract = deriveTimelineContract(normalizedAdData, takesDuration);
    if (!nextContract) {
        const { timelineContract: _timeline, masterAudioContract: _master, ...rest } = normalizedAdData;
        void _timeline;
        void _master;
        return rest as T;
    }
    const masterIsCurrent = masterContractMatchesTimeline(nextContract, adData.masterAudioContract);
    return {
        ...normalizedAdData,
        timelineContract: nextContract,
        ...(masterIsCurrent ? {} : { masterAudioContract: undefined }),
    };
};

export const masterAudioContractIsCurrent = (
    adData: Parameters<typeof projectTimelineContract>[0] & Pick<AdData, 'masterAudioContract'>,
    takesDuration: unknown = 0,
): boolean => {
    const timeline = projectTimelineContract(adData, takesDuration);
    return masterContractMatchesTimeline(timeline, adData.masterAudioContract);
};

export const masterAudioContractFromMix = (
    adData: Parameters<typeof projectTimelineContract>[0],
    response: { durationSec?: unknown; expectedDurationSec?: unknown; mixIdentity?: unknown },
    takesDuration: unknown = 0,
): MasterAudioContract => {
    const timeline = projectTimelineContract(adData, takesDuration);
    const durationSec = positiveDuration(response.durationSec);
    const expectedDurationSec = positiveDuration(response.expectedDurationSec);
    const mixIdentity = typeof response.mixIdentity === 'string' ? response.mixIdentity.trim() : '';
    if (!timeline || !durationSec || !expectedDurationSec || !mixIdentity) {
        throw new Error('A mixagem terminou sem um contrato de duração verificável.');
    }
    if (
        Math.abs(durationSec - timeline.durationSec) > MOLDURA_AUDIO_DURATION_TOLERANCE_SEC
        || Math.abs(expectedDurationSec - timeline.durationSec) > MOLDURA_AUDIO_DURATION_TOLERANCE_SEC
    ) {
        throw new Error(
            `A mixagem mede ${durationSec.toFixed(2)}s, mas a timeline atual exige ${timeline.durationSec.toFixed(2)}s.`,
        );
    }
    return {
        version: 1,
        durationSec,
        expectedDurationSec,
        mixIdentity,
        timelineFingerprint: timeline.fingerprint,
    };
};

export const isAudioSourceShortForTimeline = (
    expectedDuration: unknown,
    measuredDuration: unknown,
): boolean => {
    const expected = positiveDuration(expectedDuration);
    const measured = positiveDuration(measuredDuration);
    return expected > 0
        && (measured <= 0 || measured < expected - MOLDURA_AUDIO_DURATION_TOLERANCE_SEC);
};

export const isAudioSourceInvalidForTimeline = (
    expectedDuration: unknown,
    measuredDuration: unknown,
): boolean => {
    const expected = positiveDuration(expectedDuration);
    const measured = positiveDuration(measuredDuration);
    return expected > 0
        && (measured <= 0
            || Math.abs(measured - expected) > MOLDURA_AUDIO_DURATION_TOLERANCE_SEC);
};

export const previewTimelineDuration = (input: {
    videoModel?: AdData['videoModel'];
    narrationDuration: unknown;
    configuredAudioDuration?: unknown;
    measuredMasterDuration: unknown;
    takesDuration: unknown;
    emptyFallbackDuration?: number;
}): number => {
    const narrationDuration = positiveDuration(input.narrationDuration);
    const configuredAudioDuration = positiveDuration(input.configuredAudioDuration);
    const masterDuration = positiveDuration(input.measuredMasterDuration);
    if (input.videoModel === 'moldura' && narrationDuration > 0) {
        return Math.max(narrationDuration, configuredAudioDuration, masterDuration);
    }
    // A configuração atual é o contrato do editor. Um MP3 master medido com
    // duração menor pode pertencer a uma mixagem anterior e não deve encurtar o
    // monitor; um corte intencional continua preservado porque já está refletido
    // em configuredAudioDuration.
    if (configuredAudioDuration > 0) return configuredAudioDuration;
    if (masterDuration > 0) return masterDuration;
    if (narrationDuration > 0) return narrationDuration;
    return positiveDuration(input.takesDuration) || input.emptyFallbackDuration || 30;
};
