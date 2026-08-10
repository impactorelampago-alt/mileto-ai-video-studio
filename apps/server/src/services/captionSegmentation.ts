import type { CaptionWord } from './captionReconciliation';

export type CaptionSegment = {
    start: number;
    end: number;
    text: string;
    words: CaptionWord[];
};

const normalizeWord = (value: string) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9$%]+/g, '');

const DANGLING_ENDINGS = new Set([
    'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas',
    'de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'com', 'sem', 'por', 'para',
    'em', 'na', 'no', 'nas', 'nos', 'ao', 'aos',
    'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas',
    'nosso', 'nossa', 'nossos', 'nossas', 'este', 'esta', 'esse', 'essa',
]);

const ARTICLE_STARTS = new Set(['a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas']);

const isCurrency = (value: string) => /^r\s*\$|^r\$|^rs\d/i.test(String(value || '').replace(/\s+/g, ''));

/**
 * Cria blocos de legenda por sentido. O alvo continua curto, mas expressões
 * indivisíveis (por exemplo, "a partir de R$ 39,90") nunca são cortadas no meio.
 */
export const segmentCaptionWords = (
    input: CaptionWord[],
    options: { targetWords?: number; hardMaxWords?: number; pauseSec?: number } = {}
): CaptionSegment[] => {
    const words = input.filter((word) => String(word.text || '').trim() && Number.isFinite(word.start) && Number.isFinite(word.end));
    if (!words.length) return [];

    const targetWords = Math.max(3, Math.min(6, Math.round(options.targetWords || 4)));
    const hardMaxWords = Math.max(targetWords + 1, Math.min(9, Math.round(options.hardMaxWords || 7)));
    const pauseSec = Math.max(0.25, Number(options.pauseSec) || 0.48);

    // Limites internos protegidos. Um índice N representa o espaço entre N-1 e N.
    const protectedBoundaries = new Set<number>();
    words.forEach((word, index) => {
        if (!isCurrency(word.text)) return;
        const previous = words.slice(Math.max(0, index - 3), index).map((item) => normalizeWord(item.text));
        const atomicPrefix = previous.slice(-3).join(' ');
        const shortPrefix = previous.slice(-2).join(' ');
        const start = atomicPrefix === 'a partir de'
            ? index - 3
            : ['por apenas', 'somente por', 'so por'].includes(shortPrefix)
              ? index - 2
              : index;
        for (let boundary = Math.max(1, start + 1); boundary <= index; boundary += 1) {
            protectedBoundaries.add(boundary);
        }
    });

    const segments: CaptionSegment[] = [];
    let current: CaptionWord[] = [];
    let segmentStartIndex = 0;

    const flush = () => {
        if (!current.length) return;
        segments.push({
            start: Number(current[0].start.toFixed(2)),
            end: Number(current[current.length - 1].end.toFixed(2)),
            text: current.map((word) => word.text).join(' '),
            words: current.map((word) => ({ ...word })),
        });
        current = [];
    };

    for (let index = 0; index < words.length; index += 1) {
        if (!current.length) segmentStartIndex = index;
        const word = words[index];
        current.push(word);

        const next = words[index + 1];
        if (!next) {
            flush();
            break;
        }

        const boundary = index + 1;
        const insideAtomicPhrase = protectedBoundaries.has(boundary);
        const longPause = next.start - word.end >= pauseSec;
        const currentEnding = normalizeWord(word.text);
        const nextWord = normalizeWord(next.text);
        const danglingEnding = DANGLING_ENDINGS.has(currentEnding);
        const nextStartsNewClause = ARTICLE_STARTS.has(nextWord) && current.length >= 3 && !danglingEnding;
        const reachedTarget = current.length >= targetWords && !danglingEnding;
        const reachedHardLimit = current.length >= hardMaxWords;

        if (!insideAtomicPhrase && (longPause || nextStartsNewClause || reachedTarget || reachedHardLimit)) {
            flush();
        } else if (index - segmentStartIndex + 1 >= hardMaxWords + 2) {
            // Proteção final para dados de STT malformados, sem laços ou blocos gigantes.
            flush();
        }
    }

    return segments;
};
