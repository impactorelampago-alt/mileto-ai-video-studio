const FINAL_NARRATION_PATTERN = /(===\s*ROTEIRO\s*===\s*)([\s\S]*?)(\s*===\s*FIM\s*===)/i;
const FISH_AUDIO_TAG_PATTERN = /\[(?:angry|sad|embarrassed|emphasis|whispering|soft|breathy|excited|laughing|chuckling|moaning|clear throat|sobbing|crying loudly|sighing|panting|groaning|pause|long pause)\]/i;
const CLEAN_NARRATION_REQUEST = /(?:sem\s+tags?|texto\s+limpo|fish\s*audio\s*s1|modelo\s*s1)/i;

const normalizeSupportedAliases = (narration) =>
    narration
        .replace(/\[soft tone\]/gi, '[soft]')
        .replace(/\[long-break\]/gi, '[long pause]')
        .replace(/\[break\]/gi, '[pause]');

const prefixSegment = (segment, tag) => {
    const leadingWhitespace = segment.match(/^\s*/)?.[0] || '';
    return `${leadingWhitespace}${tag} ${segment.slice(leadingWhitespace.length)}`;
};

const addFallbackDirection = (narration) => {
    const segments = narration.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [narration];
    const contentIndexes = segments
        .map((segment, index) => (segment.trim() ? index : -1))
        .filter((index) => index >= 0);

    if (!contentIndexes.length) return narration;

    const first = contentIndexes[0];
    const middle = contentIndexes[Math.floor(contentIndexes.length / 2)];
    const last = contentIndexes[contentIndexes.length - 1];
    segments[first] = prefixSegment(segments[first], '[excited]');
    if (middle !== first) segments[middle] = prefixSegment(segments[middle], '[emphasis]');
    if (last !== first && last !== middle) segments[last] = prefixSegment(segments[last], '[pause]');
    return segments.join('');
};

export const userRequestedCleanNarration = (messages = []) => {
    const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
    return CLEAN_NARRATION_REQUEST.test(String(latestUserMessage?.content || ''));
};

/**
 * Proteção final do produto: o prompt continua responsável pela direção criativa,
 * mas um roteiro S2 nunca chega ao usuário completamente sem marcação por uma
 * eventual desobediência do modelo.
 */
export const ensureNarrationSalesVoiceDirection = (text, { allowClean = false } = {}) => {
    if (allowClean || typeof text !== 'string') return text;
    return text.replace(FINAL_NARRATION_PATTERN, (_match, opening, rawNarration, closing) => {
        const narration = normalizeSupportedAliases(rawNarration.trim());
        const directed = FISH_AUDIO_TAG_PATTERN.test(narration)
            ? narration
            : addFallbackDirection(narration);
        return `${opening}${directed}${closing}`;
    });
};
