export type StructuredChatResult = Record<string, unknown>;

export interface ChatNarrationDelivery {
    title: string;
    narration: string;
    before: string;
    after: string;
    format: 'markers' | 'structured';
}

const FINAL_NARRATION_PATTERN = /===\s*ROTEIRO\s*===\s*([\s\S]*?)\s*===\s*FIM\s*===/gi;
const TITLE_BEFORE_NARRATION_PATTERN = /===\s*T[ÍI]TULO\s*===\s*([\s\S]*?)\s*$/i;

// Direções naturais do Fish Audio começam por uma palavra em inglês. Essa
// restrição evita apresentar conteúdos como [2026] como direção de voz.
const FISH_DIRECTION_PATTERN = /\[[a-z][a-z ' -]{0,63}\]/g;

export const parseStructuredChatResult = (content: string): StructuredChatResult | null => {
    const trimmed = String(content || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
    if (!trimmed.startsWith('{')) return null;

    try {
        const value = JSON.parse(trimmed);
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value as StructuredChatResult
            : null;
    } catch {
        return null;
    }
};

export const formatChatNarrationParagraphs = (narration: string): string => String(narration || '')
    .replace(/(\S)[ \t]*(\[(?:pause|long pause|break|long-break)\])[ \t]*/gi, '$1 $2\n\n')
    .replace(/^[ \t]*(\[(?:pause|long pause|break|long-break)\])[ \t]*/gim, '$1\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const extractFishDirectionTags = (narration: string): string[] =>
    String(narration || '').match(FISH_DIRECTION_PATTERN) || [];

export const uniqueFishDirectionTags = (narration: string): string[] => {
    const seen = new Set<string>();
    return extractFishDirectionTags(narration).filter((tag) => {
        const key = tag.toLocaleLowerCase('en');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const fallbackProjectTitle = (narration: string): string => {
    const cleanNarration = String(narration || '')
        .replace(FISH_DIRECTION_PATTERN, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleanNarration) return 'Novo projeto Mileto';

    const firstSentence = cleanNarration.split(/[.!?]/, 1)[0].trim();
    const shortTitle = (firstSentence || cleanNarration).split(' ').slice(0, 8).join(' ');
    return shortTitle.slice(0, 60).trim() || 'Novo projeto Mileto';
};

/**
 * Reconhece apenas entregas finais explícitas. Conversa, briefing, exemplos e
 * rascunhos sem o envelope do produto continuam sendo mensagens comuns.
 */
export const parseChatNarrationDelivery = (content: string): ChatNarrationDelivery | null => {
    const structured = parseStructuredChatResult(content);
    const structuredNarration = typeof structured?.narration === 'string'
        ? formatChatNarrationParagraphs(structured.narration)
        : '';
    if (structuredNarration) {
        const structuredTitle = typeof structured?.title === 'string'
            ? structured.title.replace(/\s+/g, ' ').trim().slice(0, 60)
            : '';
        return {
            title: structuredTitle || fallbackProjectTitle(structuredNarration),
            narration: structuredNarration,
            before: '',
            after: '',
            format: 'structured',
        };
    }

    const source = String(content || '');
    const matches = [...source.matchAll(FINAL_NARRATION_PATTERN)]
        .filter((match) => typeof match.index === 'number' && match[1]?.trim());
    if (!matches.length) return null;

    const firstMatch = matches[0];
    const lastMatch = matches[matches.length - 1];
    const firstIndex = firstMatch.index || 0;
    const lastEnd = (lastMatch.index || 0) + lastMatch[0].length;
    const prefix = source.slice(0, firstIndex).trim();
    const titleMatch = prefix.match(TITLE_BEFORE_NARRATION_PATTERN);
    const narration = formatChatNarrationParagraphs(
        matches.map((match) => match[1].trim()).join('\n\n')
    );
    const explicitTitle = titleMatch?.[1].replace(/\s+/g, ' ').trim().slice(0, 60) || '';

    return {
        title: explicitTitle || fallbackProjectTitle(narration),
        narration,
        before: titleMatch && typeof titleMatch.index === 'number'
            ? prefix.slice(0, titleMatch.index).trim()
            : prefix,
        after: source.slice(lastEnd).trim(),
        format: 'markers',
    };
};

export const hasChatNarrationDelivery = (content: string): boolean =>
    parseChatNarrationDelivery(content) !== null;

export const stripChatNarrationMarkers = (content: string): string => String(content || '')
    .replace(/^[ \t]*===\s*T[ÍI]TULO\s*===[ \t]*$/gim, 'Título do projeto:')
    .replace(/^[ \t]*===\s*(?:ROTEIRO|FIM)\s*===[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Extrai exatamente o texto aplicado ao projeto. O fallback mantém respostas
 * históricas legíveis, mas não as transforma por si só em uma entrega final.
 */
export const extractChatNarration = (content: string): string => {
    const finalDelivery = parseChatNarrationDelivery(content);
    if (finalDelivery) return finalDelivery.narration;

    let text = String(content || '').trim();
    text = text.replace(
        /\n\s*(?:[*_>#\s]|⚠️)*(?:aviso|obs\.?|observa[çc]|nota|importante)\b[\s\S]*$/i,
        ''
    ).trim();
    const blocks = text
        .split(/^\s*---\s*$/m)
        .map((block) => block.trim())
        .filter(Boolean);
    if (blocks.length >= 2) {
        const tagged = blocks.find((block) => /\[[a-zA-Z]/.test(block));
        return (tagged || blocks[0]).replace(/^\s*---\s*$/gm, '').trim();
    }

    const lines = text.split('\n');
    const firstTag = lines.findIndex((line) => /^\s*\[[a-zA-Z]/.test(line));
    if (firstTag > 0) return lines.slice(firstTag).join('\n').trim();
    if (/:\s*$/.test(lines[0] || '')) return lines.slice(1).join('\n').trim();
    return text;
};

export const extractChatNarrationTitle = (content: string): string => {
    const finalDelivery = parseChatNarrationDelivery(content);
    if (finalDelivery) return finalDelivery.title;
    return fallbackProjectTitle(extractChatNarration(content));
};
