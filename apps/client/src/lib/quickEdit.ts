import { API_BASE_URL } from './apiBase';
import type { MediaTake, TransitionAsset } from '../types';

export const QUICK_EDIT_SHARPNESS = 25;

export const isFilmBurnTransition = (transition?: TransitionAsset | null) => {
    if (!transition) return false;
    const identity = `${transition.id} ${transition.identityCode || ''} ${transition.originalName || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR');
    return identity.includes('film-burn') || identity.includes('film burn');
};

export const automaticCutTakes = (
    sourceTakes: MediaTake[],
    effectiveAudioDuration: number,
    idFactory: (_source: MediaTake, _index: number) => string = (source, index) =>
        `${source.id}-loop-${crypto.randomUUID()}-${index}`,
) => {
    if (!sourceTakes.length) throw new Error('Selecione ao menos um take antes da edição rápida.');
    if (!Number.isFinite(effectiveAudioDuration) || effectiveAudioDuration <= 0) {
        throw new Error('A narração precisa ter duração válida antes da edição rápida.');
    }

    let remainingAudioTime = effectiveAudioDuration;
    const finalDurations = new Map<string, number>();
    let activeTakes = [...sourceTakes];
    let attempts = 0;

    while (activeTakes.length > 0 && remainingAudioTime > 0.001 && attempts < 100) {
        attempts += 1;
        const slice = remainingAudioTime / activeTakes.length;
        const shortTakes = activeTakes.filter((take) => {
            const maximum = take.type === 'video' && take.originalDurationSeconds > 0
                ? take.originalDurationSeconds
                : Number.MAX_VALUE;
            return maximum < slice + 0.05;
        });

        if (shortTakes.length === 0) {
            activeTakes.forEach((take) => finalDurations.set(take.id, slice));
            remainingAudioTime = 0;
            break;
        }

        shortTakes.forEach((take) => {
            const maximum = take.type === 'video' && take.originalDurationSeconds > 0
                ? take.originalDurationSeconds
                : 0;
            finalDurations.set(take.id, maximum);
            remainingAudioTime -= maximum;
        });
        const lockedIds = new Set(shortTakes.map((take) => take.id));
        activeTakes = activeTakes.filter((take) => !lockedIds.has(take.id));
    }

    const adjustedTakes = sourceTakes.map((take) => ({
        ...take,
        trim: { start: 0, end: Math.max(0, finalDurations.get(take.id) || 0) },
        speedPresetId: 'normal' as const,
    }));

    if (remainingAudioTime <= 0.5) return { takes: adjustedTakes, looped: false };

    const loopedTakes = [...adjustedTakes];
    let loopIndex = 0;
    let timeToFill = remainingAudioTime;
    while (timeToFill > 0.5 && loopedTakes.length < 800) {
        const source = sourceTakes[loopIndex % sourceTakes.length];
        const sourceDuration = source.type === 'video' && source.originalDurationSeconds > 0
            ? source.originalDurationSeconds
            : timeToFill;
        const duration = Math.min(sourceDuration, timeToFill);
        loopedTakes.push({
            ...source,
            id: idFactory(source, loopIndex),
            trim: { start: 0, end: Math.max(0, duration) },
            speedPresetId: 'normal' as const,
        });
        timeToFill -= duration;
        loopIndex += 1;
    }
    return { takes: loopedTakes, looped: true };
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
