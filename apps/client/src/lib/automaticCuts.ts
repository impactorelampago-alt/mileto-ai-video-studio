import type { MediaTake } from '../types';

const TIMELINE_FILL_EPSILON_SECONDS = 0.001;

/**
 * Distribui a duração contratada entre os takes e reutiliza fontes quando o
 * acervo original não alcança o fim do áudio. O resultado nunca pode deixar a
 * cauda subentendida: o preflight do render exige a timeline visual completa.
 */
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

    while (
        activeTakes.length > 0
        && remainingAudioTime > TIMELINE_FILL_EPSILON_SECONDS
        && attempts < 100
    ) {
        attempts += 1;
        const slice = remainingAudioTime / activeTakes.length;
        const shortTakes = activeTakes.filter((take) => {
            const maximum = take.type === 'video' && take.originalDurationSeconds > 0
                ? take.originalDurationSeconds
                : Number.MAX_VALUE;
            return maximum + TIMELINE_FILL_EPSILON_SECONDS < slice;
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

    if (remainingAudioTime <= TIMELINE_FILL_EPSILON_SECONDS) {
        return { takes: adjustedTakes, looped: false };
    }

    const loopedTakes = [...adjustedTakes];
    let loopIndex = 0;
    let timeToFill = remainingAudioTime;
    while (timeToFill > TIMELINE_FILL_EPSILON_SECONDS && loopedTakes.length < 800) {
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

    if (timeToFill > TIMELINE_FILL_EPSILON_SECONDS) {
        throw new Error('Não foi possível preencher toda a duração da narração com os takes disponíveis.');
    }
    return { takes: loopedTakes, looped: true };
};
