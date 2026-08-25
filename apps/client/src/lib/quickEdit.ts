import { API_BASE_URL } from './apiBase';
import type { MediaTake, TransitionAsset } from '../types';
import { automaticCutTakes } from './automaticCuts';

export const QUICK_EDIT_SHARPNESS = 25;

export const isFilmBurnTransition = (transition?: TransitionAsset | null) => {
    if (!transition) return false;
    const identity = `${transition.id} ${transition.identityCode || ''} ${transition.originalName || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR');
    return identity.includes('film-burn') || identity.includes('film burn');
};

const resolveFilmBurn = async (current?: TransitionAsset | null) => {
    if (isFilmBurnTransition(current)) return current!;
    const response = await fetch(`${API_BASE_URL}/api/transitions/list`);
    const data = await response.json() as { ok?: boolean; transitions?: TransitionAsset[]; message?: string };
    if (!response.ok || !data.ok) throw new Error(data.message || 'Não foi possível carregar os efeitos.');
    const transition = (data.transitions || []).find(isFilmBurnTransition) || null;
    if (!transition) throw new Error('O efeito Film Burn do sistema não foi encontrado.');
    return transition;
};

export const applyQuickEdit = async (
    sourceTakes: MediaTake[],
    effectiveAudioDuration: number,
    currentTransition?: TransitionAsset | null,
    idFactory?: (_source: MediaTake, _index: number) => string,
) => {
    const transition = await resolveFilmBurn(currentTransition);
    const cutResult = automaticCutTakes(sourceTakes, effectiveAudioDuration, idFactory);
    const takes: MediaTake[] = cutResult.takes.map((take) => ({
        ...take,
        transition: undefined,
        muteOriginalAudio: true,
        audio: { mode: 'off', volume: 1 },
        objectFit: 'cover',
        sharpness: { mode: 'custom', amount: QUICK_EDIT_SHARPNESS },
        motionEffect: {
            type: 'zoom-in-out',
            intensity: 0.12,
            focalX: 50,
            focalY: 50,
            easing: 'smooth',
        },
    }));
    return { takes, transition, looped: cutResult.looped };
};
