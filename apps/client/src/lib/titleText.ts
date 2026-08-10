const words = (value: string) => value.trim().split(/\s+/).filter(Boolean);

export const titleWordCount = (value: string) => words(value).length;

/** Limita somente amostras e resultados da geração automática de títulos. */
export const limitTitleWords = (value: string, maxWords?: number) => {
    const limit = Math.max(1, Math.round(Number(maxWords) || 0));
    if (!maxWords || titleWordCount(value) <= limit) return value;
    return words(value).slice(0, limit).join(' ');
};
