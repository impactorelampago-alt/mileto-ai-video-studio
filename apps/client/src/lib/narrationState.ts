import type { AdData } from '../types';

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
