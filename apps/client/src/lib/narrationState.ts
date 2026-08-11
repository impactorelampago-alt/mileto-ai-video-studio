import type { AdData } from '../types';

type NarrationGenerationInput = Pick<
    AdData,
    'narrationText' | 'selectedVoiceId' | 'selectedVoiceProvider' | 'voiceSettings'
>;

/**
 * Identifica somente os campos enviados para a síntese. Música e mixagem ficam
 * deliberadamente de fora para que uma troca de trilha durante a TTS não descarte
 * uma narração ainda válida.
 */
export const narrationGenerationInputFingerprint = (adData: NarrationGenerationInput): string => JSON.stringify([
    adData.narrationText,
    adData.selectedVoiceId || '',
    adData.selectedVoiceProvider || 'fishAudio',
    {
        speed: adData.voiceSettings?.speed ?? null,
        volume: adData.voiceSettings?.volume ?? null,
        stability: adData.voiceSettings?.stability ?? null,
        similarityBoost: adData.voiceSettings?.similarityBoost ?? null,
        fishModel: adData.voiceSettings?.fishModel ?? null,
    },
]);

/**
 * Identifica a fonte exata usada para criar legendas e títulos.
 *
 * O áudio pode mudar sem que a tela seja recarregada (nova síntese, gravação ou
 * troca de roteiro). Guardar uma assinatura leve evita reaproveitar legendas e
 * títulos pertencentes à locução anterior.
 */
export const narrationSourceKey = (adData: Pick<AdData, 'narrationText' | 'narrationAudioUrl' | 'narrationAudioPath' | 'sharedNarrationAssetId'>) => {
    const audioIdentity = adData.sharedNarrationAssetId || adData.narrationAudioPath || adData.narrationAudioUrl || '';
    const source = `${audioIdentity}\u0000${adData.narrationText.trim()}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `narration-v1-${(hash >>> 0).toString(16)}`;
};

/** Tudo abaixo depende do áudio atual e precisa ser refeito ao trocar a voz. */
export const invalidatedNarrationDerivatives = (): Partial<AdData> => ({
    narrationSource: undefined,
    captions: undefined,
    dynamicTitles: [],
    dynamicTitlesSourceKey: undefined,
    titleGenerationSummary: undefined,
    masterAudioUrl: undefined,
    sharedMasterAssetId: undefined,
});
