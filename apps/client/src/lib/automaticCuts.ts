import type { MediaTake } from '../types';

const TIMELINE_FILL_EPSILON_SECONDS = 0.001;
const LEGACY_TIMELINE_MAX_TAIL_GAP_SECONDS = 0.5;

const takeTrimDuration = (take: MediaTake) => {
    const start = Number(take.trim?.start);
    const end = Number(take.trim?.end);
    return Number.isFinite(start) && Number.isFinite(end)
        ? Math.max(0, end - start)
        : 0;
};

const timelineDuration = (takes: MediaTake[]) =>
    takes.reduce((total, take) => total + takeTrimDuration(take), 0);

export interface TimelineTailFillResult {
    takes: MediaTake[];
    filled: boolean;
    addedTakeCount: number;
    previousDurationSeconds: number;
    finalDurationSeconds: number;
}

/**
 * Completa somente a cauda ausente de uma timeline já editada.
 *
 * Diferente de `automaticCutTakes`, este reparo não redistribui os cortes nem
 * remove efeitos: ele acrescenta cópias curtas dos takes existentes até cobrir
 * o áudio. Isso permite retomar com segurança snapshots criados por versões
 * antigas que aceitavam uma lacuna de até meio segundo.
 */
export const fillTimelineTailPreservingCuts = (
    sourceTakes: MediaTake[],
    effectiveAudioDuration: number,
    idFactory: (_source: MediaTake, _index: number) => string = (source, index) =>
        `${source.id}-tail-${crypto.randomUUID()}-${index}`,
): TimelineTailFillResult => {
    if (!Number.isFinite(effectiveAudioDuration) || effectiveAudioDuration <= 0) {
        throw new Error('render_expected_duration_invalid: A narração precisa ter duração válida antes da exportação.');
    }

    const previousDurationSeconds = timelineDuration(sourceTakes);
    if (previousDurationSeconds + TIMELINE_FILL_EPSILON_SECONDS >= effectiveAudioDuration) {
        return {
            takes: sourceTakes,
            filled: false,
            addedTakeCount: 0,
            previousDurationSeconds,
            finalDurationSeconds: previousDurationSeconds,
        };
    }

    const missingDuration = effectiveAudioDuration - previousDurationSeconds;
    if (missingDuration > LEGACY_TIMELINE_MAX_TAIL_GAP_SECONDS + TIMELINE_FILL_EPSILON_SECONDS) {
        throw new Error(
            'render_visual_timeline_short: A sequência visual termina muito antes do áudio e exige revisão dos cortes.',
        );
    }

    const reusableTakes = sourceTakes.filter(
        (take) => takeTrimDuration(take) > TIMELINE_FILL_EPSILON_SECONDS,
    );
    if (!reusableTakes.length) {
        throw new Error(
            'render_visual_timeline_unfillable: A sequência visual termina antes do áudio e não possui um corte reutilizável.',
        );
    }

    const filledTakes = [...sourceTakes];
    let remainingDuration = missingDuration;
    let loopIndex = 0;

    while (
        remainingDuration > TIMELINE_FILL_EPSILON_SECONDS
        && filledTakes.length < 800
    ) {
        const source = reusableTakes[loopIndex % reusableTakes.length];
        const sourceStart = Number(source.trim.start);
        const availableDuration = takeTrimDuration(source);
        const duration = Math.min(availableDuration, remainingDuration);
        filledTakes.push({
            ...source,
            id: idFactory(source, loopIndex),
            trim: {
                start: sourceStart,
                end: sourceStart + duration,
            },
        });
        remainingDuration -= duration;
        loopIndex += 1;
    }

    if (remainingDuration > TIMELINE_FILL_EPSILON_SECONDS) {
        throw new Error(
            'render_visual_timeline_unfillable: Não foi possível completar a sequência visual dentro do limite seguro de cortes.',
        );
    }

    return {
        takes: filledTakes,
        filled: true,
        addedTakeCount: filledTakes.length - sourceTakes.length,
        previousDurationSeconds,
        finalDurationSeconds: timelineDuration(filledTakes),
    };
};

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
