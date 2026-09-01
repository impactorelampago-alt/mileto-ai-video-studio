import type { AdData, AudioConfig } from '../types';

export const MOLDURA_AUDIO_DURATION_TOLERANCE_SEC = 0.12;

const positiveDuration = (value: unknown): number => {
    const duration = Number(value);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
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
        && actualDuration > 0
        && actualDuration < expectedDuration - MOLDURA_AUDIO_DURATION_TOLERANCE_SEC;
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

export const previewTimelineDuration = (input: {
    videoModel?: AdData['videoModel'];
    narrationDuration: unknown;
    measuredMasterDuration: unknown;
    takesDuration: unknown;
    emptyFallbackDuration?: number;
}): number => {
    const narrationDuration = positiveDuration(input.narrationDuration);
    const masterDuration = positiveDuration(input.measuredMasterDuration);
    if (input.videoModel === 'moldura' && narrationDuration > 0) {
        return Math.max(narrationDuration, masterDuration);
    }
    if (masterDuration > 0) return masterDuration;
    if (narrationDuration > 0) return narrationDuration;
    return positiveDuration(input.takesDuration) || input.emptyFallbackDuration || 30;
};
