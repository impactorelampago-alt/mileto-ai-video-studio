export interface BackgroundTrimEndForNarrationInput {
    /** Ponto de entrada dentro do arquivo da música. */
    backgroundTrimStart?: number | null;
    /** Instante da timeline em que a música começa. */
    backgroundOffsetSec?: number | null;
    /** Duração efetivamente audível da narração, já descontados seus cortes. */
    narrationDurationSec: number | null | undefined;
    /** Instante da timeline em que a narração começa. */
    narrationOffsetSec?: number | null;
    /** Duração total da fonte musical, quando conhecida. */
    backgroundSourceDurationSec?: number | null;
}

const finiteNonNegative = (value: number | null | undefined): number =>
    Number.isFinite(value) ? Math.max(0, Number(value)) : 0;

/**
 * Calcula o ponto final, dentro da fonte musical, que coincide com o fim global
 * da narração. `undefined` indica que não existe sobreposição positiva e,
 * portanto, nenhum intervalo de corte válido pode ser produzido.
 */
export const backgroundTrimEndForNarration = ({
    backgroundTrimStart,
    backgroundOffsetSec,
    narrationDurationSec,
    narrationOffsetSec,
    backgroundSourceDurationSec,
}: BackgroundTrimEndForNarrationInput): number | undefined => {
    const trimStart = finiteNonNegative(backgroundTrimStart);
    const narrationDuration = finiteNonNegative(narrationDurationSec);
    if (narrationDuration <= 0) return undefined;

    const narrationEnd = finiteNonNegative(narrationOffsetSec) + narrationDuration;
    const availableMusicDuration = narrationEnd - finiteNonNegative(backgroundOffsetSec);
    if (availableMusicDuration <= 0) return undefined;

    const requestedTrimEnd = trimStart + availableMusicDuration;
    const hasSourceLimit = Number.isFinite(backgroundSourceDurationSec) && Number(backgroundSourceDurationSec) > 0;
    const trimEnd = hasSourceLimit
        ? Math.min(requestedTrimEnd, Number(backgroundSourceDurationSec))
        : requestedTrimEnd;

    return trimEnd > trimStart ? trimEnd : undefined;
};
