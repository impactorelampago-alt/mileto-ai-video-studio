import type { AdData, MediaTake } from '../types';
import { narrationSourceKey } from './narrationState.ts';

const unique = (items: string[]) => [...new Set(items)];

export const missingInStep = (step: number, adData: AdData, mediaTakes: MediaTake[]): string[] => {
    if (step === 1) {
        const missing: string[] = [];
        if (!adData.title?.trim()) missing.push('título do projeto');
        if (!adData.narrationText?.trim()) missing.push('texto da narração');
        if (!adData.narrationAudioUrl && !adData.masterAudioUrl) missing.push('narração ou gravação de voz');
        return missing;
    }
    if (step === 2) return mediaTakes.length ? [] : ['takes visuais'];
    if (step === 3) {
        const currentSourceKey = narrationSourceKey(adData);
        const captionsAreCurrent = adData.captions?.sourceKey === currentSourceKey
            && Boolean(adData.captions.segments?.length);
        return captionsAreCurrent ? [] : ['legendas'];
    }
    if (step === 4) {
        const currentSourceKey = narrationSourceKey(adData);
        const titlesAreCurrent = adData.dynamicTitlesSourceKey === currentSourceKey
            && Boolean(adData.dynamicTitles?.some((title) => title.isActive));
        return titlesAreCurrent ? [] : ['títulos ou chamadas visuais'];
    }
    return [];
};

/** Pendências das etapas que o usuário está deixando para trás. */
export const missingBeforeStep = (targetStep: number, adData: AdData, mediaTakes: MediaTake[]): string[] => {
    const missing: string[] = [];
    for (let step = 1; step < Math.max(1, Math.min(4, targetStep)); step += 1) {
        missing.push(...missingInStep(step, adData, mediaTakes));
    }
    return unique(missing);
};

export const missingForCompletion = (adData: AdData, mediaTakes: MediaTake[]): string[] =>
    unique([1, 2, 3, 4].flatMap((step) => missingInStep(step, adData, mediaTakes)));

export const pendingWarningText = (missing: string[]): string =>
    `Você pode continuar, mas ainda falta: ${missing.join(', ')}.`;
