import {
    isSemanticallyCompleteTitle,
    resolveLiteralCaptionText,
    type SpokenTitleWord,
} from './titleGenerationRules';

export const TITLE_EDITORIAL_REVIEW_MODEL = 'gpt-4.1-nano';
export const TITLE_EDITORIAL_REVIEW_TIMEOUT_MS = 8_000;
export const TITLE_EDITORIAL_REVIEW_SYSTEM_PROMPT = `Voce e a revisora editorial final de titulos curtos de anuncios em video.

Recebera TODOS os titulos de uma geracao em um unico lote. Avalie o que sera realmente desenhado em renderedText, e nao apenas generatedText. sourceText contem as palavras faladas ao redor do titulo; evidenceText e a evidencia escolhida pelo gerador; omittedWords mostra o que o limite visual deixou de fora.

Para cada item:
1. Aprove quando renderedText funciona sozinho, preserva a informacao comercial importante e cabe nos limites informados.
2. Reprove se ficou uma frase pela metade, perdeu prazo/preco/beneficio/CTA essencial, ou se o corte mudou o sentido. Um texto gramaticalmente valido ainda deve ser reprovado quando omite a parte comercial decisiva; por exemplo, diante de "Essa promocao e valida so ate sabado", prefira "SO ATE SABADO" a "ESSA PROMOCAO E VALIDA".
3. Corrija somente itens reprovados. replacementText deve ser uma sequencia LITERAL, CONTINUA e completa de sourceText, com no maximo layout.maxWords. Nao invente, parafraseie nem misture trechos.
4. Preserve a funcao de triggerId. Se nao houver correcao literal segura que caiba, use verdict "approve" para manter o legado.
5. Esta e a unica rodada de revisao. Nao explique e nao solicite nova tentativa.

Responda exclusivamente em JSON valido, com uma decisao para cada id:
{"reviews":[{"id":"id recebido","verdict":"approve"},{"id":"outro id","verdict":"replace","replacementText":"TRECHO LITERAL CURTO"}]}`;

export type TitleEditorialStrategy = 'legacy-v4' | 'reviewed-v1';

export type LegacyGeneratedTitle = {
    id: string;
    text: string;
    sourceText?: string;
    triggerId?: string;
    startSec: number;
    durationSec: number;
    styleId?: string;
    maxWords?: number;
    textBoxWidthPct?: number;
    scale?: number;
    fontFamily?: string;
    [key: string]: unknown;
};

export type CaptionSourceSegment = {
    start?: number;
    end?: number;
    text?: string;
    words?: Array<{ text?: string; start?: number }>;
};

export type EditorialReviewItem = {
    id: string;
    triggerId: string;
    sourceText: string;
    evidenceText: string;
    generatedText: string;
    renderedText: string;
    omittedWords: string[];
    layout: {
        format: string;
        styleId: string;
        maxWords: number;
        textBoxWidthPct: number;
        scale: number;
        fontFamily: string;
    };
};

type EditorialReviewDecision = {
    id?: unknown;
    verdict?: unknown;
    replacementText?: unknown;
};

export type TitleEditorialReviewResult<T extends LegacyGeneratedTitle> = {
    titles: T[];
    strategy: TitleEditorialStrategy;
    attempted: boolean;
    reviewedCount: number;
    correctedCount: number;
    fallbackToLegacy: boolean;
};

export type AtomicTitleReflowResult<T extends LegacyGeneratedTitle> = {
    titles: T[];
    accepted: boolean;
};

type RunTitleEditorialReviewOptions<T extends LegacyGeneratedTitle> = {
    strategy: TitleEditorialStrategy;
    legacyFinalTitles: T[];
    generatedTextById: ReadonlyMap<string, string>;
    captionSegments: CaptionSourceSegment[];
    spokenWords: SpokenTitleWord[];
    format: string;
    requestBatch: (items: EditorialReviewItem[]) => Promise<unknown>;
};

const normalizedWords = (value: unknown) => String(value || '')
    .trim()
    .split(/\s+/)
    .map((word) => ({
        original: word.replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, ''),
        key: word
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('pt-BR')
            .replace(/[^a-z0-9%]+/g, ''),
    }))
    .filter((word) => word.key);

/** Palavras que o desenho real deixou de fora, na ordem em que foram faladas. */
export const omittedTitleWords = (sourceText: unknown, renderedText: unknown) => {
    const source = normalizedWords(sourceText);
    const rendered = normalizedWords(renderedText);
    let renderedIndex = 0;
    return source.flatMap((word) => {
        if (renderedIndex < rendered.length && word.key === rendered[renderedIndex].key) {
            renderedIndex += 1;
            return [];
        }
        return [word.original];
    });
};

const segmentText = (segment: CaptionSourceSegment) => {
    const fromWords = (segment.words || [])
        .map((word) => String(word?.text || '').trim())
        .filter(Boolean)
        .join(' ');
    return fromWords || String(segment.text || '').replace(/\s+/g, ' ').trim();
};

/**
 * Entrega ao revisor a frase falada ao redor do titulo, inclusive a continuacao
 * que pode ter sido perdida pelo limite visual. O texto continua vindo apenas
 * das legendas autorizadas.
 */
export const completeCaptionSourceForTitle = (
    segments: CaptionSourceSegment[],
    title: Pick<LegacyGeneratedTitle, 'startSec' | 'durationSec' | 'sourceText'>,
) => {
    const startSec = Math.max(0, Number(title.startSec) || 0);
    const endSec = startSec + Math.max(0, Number(title.durationSec) || 0);
    const timedWords = segments
        .flatMap((segment) => (segment.words || []).flatMap((word) => {
            const start = Number(word?.start);
            const text = String(word?.text || '').trim();
            return Number.isFinite(start) && text ? [{ start, text }] : [];
        }))
        .filter((word) => word.start >= startSec - 1.25 && word.start <= endSec + 0.75)
        .sort((left, right) => left.start - right.start)
        .map((word) => word.text);
    const nearby = segments
        .filter((segment) => {
            const start = Number(segment.start);
            const end = Number(segment.end);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
            return end >= startSec - 1.25 && start <= endSec + 0.75;
        })
        .map(segmentText)
        .filter(Boolean);
    const source = (timedWords.join(' ') || nearby.join(' ') || String(title.sourceText || ''))
        .replace(/\s+/g, ' ')
        .trim();
    return source.split(/\s+/).slice(0, 36).join(' ').slice(0, 360);
};

export const resolveTitleEditorialStrategy = (
    value: unknown = process.env.MILETO_TITLE_EDITORIAL_STRATEGY,
): TitleEditorialStrategy => ['legacy', 'legacy-v4'].includes(
    String(value || '').trim().toLocaleLowerCase('pt-BR'),
)
    ? 'legacy-v4'
    : 'reviewed-v1';

export const buildTitleEditorialReviewBatch = <T extends LegacyGeneratedTitle>(
    titles: T[],
    generatedTextById: ReadonlyMap<string, string>,
    captionSegments: CaptionSourceSegment[],
    format: string,
): EditorialReviewItem[] => titles.map((title) => {
    const sourceText = completeCaptionSourceForTitle(captionSegments, title);
    return {
        id: title.id,
        triggerId: String(title.triggerId || ''),
        sourceText,
        evidenceText: String(title.sourceText || ''),
        generatedText: generatedTextById.get(title.id) || title.text,
        // Este e o texto que o componente desenhara depois de maxWords/style/layout.
        renderedText: title.text,
        omittedWords: omittedTitleWords(sourceText, title.text),
        layout: {
            format: String(format || '9:16'),
            styleId: String(title.styleId || ''),
            maxWords: Math.max(1, Math.min(12, Math.round(Number(title.maxWords) || 4))),
            textBoxWidthPct: Math.max(1, Number(title.textBoxWidthPct) || 78),
            scale: Math.max(0.1, Number(title.scale) || 1),
            fontFamily: String(title.fontFamily || 'Inter'),
        },
    };
});

const reviewDecisions = (value: unknown): EditorialReviewDecision[] => {
    if (Array.isArray(value)) return value as EditorialReviewDecision[];
    if (!value || typeof value !== 'object') return [];
    const reviews = (value as { reviews?: unknown }).reviews;
    return Array.isArray(reviews) ? reviews as EditorialReviewDecision[] : [];
};

const normalizedReplacement = (value: unknown) => String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
    .trim();

const comparableText = (value: unknown) => normalizedWords(value).map((word) => word.key).join(' ');

export const applyTitleEditorialDecisions = <T extends LegacyGeneratedTitle>(
    legacyFinalTitles: T[],
    decisionsValue: unknown,
    spokenWords: SpokenTitleWord[],
    allowedSourceTextById: ReadonlyMap<string, string> = new Map(),
) => {
    const titlesById = new Map(legacyFinalTitles.map((title) => [title.id, title]));
    const replacements = new Map<string, { text: string; startSec: number }>();

    const invalid = () => ({ titles: legacyFinalTitles, correctedCount: 0, valid: false as const });

    for (const decision of reviewDecisions(decisionsValue)) {
        const id = String(decision?.id || '');
        const title = titlesById.get(id);
        const verdict = String(decision?.verdict || '').toLocaleLowerCase('pt-BR');
        if (verdict !== 'replace') continue;
        if (!title) return invalid();
        if (typeof decision?.replacementText !== 'string') return invalid();
        const replacementText = normalizedReplacement(decision?.replacementText);
        const replacementWords = replacementText.split(/\s+/).filter(Boolean);
        const maxWords = Math.max(1, Math.min(12, Math.round(Number(title.maxWords) || 4)));
        // Nunca cortamos a resposta da revisora. Se ela nao couber, o legado fica intacto.
        if (
            !replacementText
            || replacementText.length > 90
            || replacementWords.length > maxWords
            || !isSemanticallyCompleteTitle(replacementText)
        ) {
            return invalid();
        }
        const allowedSource = comparableText(allowedSourceTextById.get(id));
        if (allowedSource && !(` ${allowedSource} `.includes(` ${comparableText(replacementText)} `))) {
            return invalid();
        }
        const literal = resolveLiteralCaptionText(
            spokenWords,
            replacementText,
            title.startSec,
            String(title.triggerId || ''),
        );
        if (!literal) return invalid();
        if (Math.abs(literal.startSec - title.startSec) > Math.max(0.75, title.durationSec + 0.75)) {
            return invalid();
        }
        if (comparableText(literal.text) === comparableText(title.text)) continue;
        replacements.set(id, { text: literal.text, startSec: literal.startSec });
    }

    if (!replacements.size) return { titles: legacyFinalTitles, correctedCount: 0, valid: true as const };
    return {
        titles: legacyFinalTitles.map((title) => {
            const replacement = replacements.get(title.id);
            if (!replacement) return title;
            return {
                ...title,
                text: replacement.text,
                sourceText: replacement.text,
                startSec: replacement.startSec,
            };
        }),
        correctedCount: replacements.size,
        valid: true as const,
    };
};

/**
 * A revisao e uma transacao: se o reflow remover qualquer titulo selecionado pelo
 * legado, nenhum ajuste editorial e publicado.
 */
export const preserveTitlesAcrossEditorialReflow = <T extends LegacyGeneratedTitle>(
    legacyFinalTitles: T[],
    reviewedFinalTitles: T[],
): AtomicTitleReflowResult<T> => {
    const legacyIds = new Set(legacyFinalTitles.map((title) => title.id));
    const reviewedIds = new Set(reviewedFinalTitles.map((title) => title.id));
    const sameIds = legacyIds.size === reviewedIds.size
        && [...legacyIds].every((id) => reviewedIds.has(id));
    return sameIds && legacyFinalTitles.length === reviewedFinalTitles.length
        ? { titles: reviewedFinalTitles, accepted: true }
        : { titles: legacyFinalTitles, accepted: false };
};

/**
 * Uma unica revisao em lote. Qualquer falha, timeout ou resposta invalida devolve
 * o mesmo array legado, permitindo rollback sem alterar o gerador comprovado.
 */
export const runTitleEditorialReview = async <T extends LegacyGeneratedTitle>(
    options: RunTitleEditorialReviewOptions<T>,
): Promise<TitleEditorialReviewResult<T>> => {
    const {
        strategy,
        legacyFinalTitles,
        generatedTextById,
        captionSegments,
        spokenWords,
        format,
        requestBatch,
    } = options;
    if (strategy === 'legacy-v4' || !legacyFinalTitles.length) {
        return {
            titles: legacyFinalTitles,
            strategy,
            attempted: false,
            reviewedCount: 0,
            correctedCount: 0,
            fallbackToLegacy: false,
        };
    }

    const batch = buildTitleEditorialReviewBatch(
        legacyFinalTitles,
        generatedTextById,
        captionSegments,
        format,
    );
    try {
        const response = await requestBatch(batch);
        const decisions = reviewDecisions(response);
        const reviewedIds = new Set(decisions.flatMap((decision) => {
            const id = String(decision?.id || '');
            const verdict = String(decision?.verdict || '').toLocaleLowerCase('pt-BR');
            return id && ['approve', 'replace'].includes(verdict) ? [id] : [];
        }));
        if (
            decisions.length !== batch.length
            || reviewedIds.size !== batch.length
            || batch.some((item) => !reviewedIds.has(item.id))
        ) {
            throw new Error('title_editorial_review_invalid');
        }
        const applied = applyTitleEditorialDecisions(
            legacyFinalTitles,
            decisions,
            spokenWords,
            new Map(batch.map((item) => [item.id, item.sourceText])),
        );
        if (!applied.valid) throw new Error('title_editorial_review_invalid_replacement');
        return {
            titles: applied.titles,
            strategy,
            attempted: true,
            reviewedCount: batch.length,
            correctedCount: applied.correctedCount,
            fallbackToLegacy: false,
        };
    } catch {
        return {
            titles: legacyFinalTitles,
            strategy: 'legacy-v4',
            attempted: true,
            reviewedCount: batch.length,
            correctedCount: 0,
            fallbackToLegacy: true,
        };
    }
};
