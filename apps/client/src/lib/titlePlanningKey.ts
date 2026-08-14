/** Stable signature of the plain narration used by title planning. */
export const titlePlanningNarrationKey = (value: string): string => {
    const source = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `title-plan-v1-${(hash >>> 0).toString(16)}`;
};
