import type { TitleColorRule, TitleTriggerRule } from './titleGeneratorConfig';

export type BrandPaletteInput = {
    primary?: string;
    secondary?: string;
    tertiary?: string;
    all?: string[];
} | null;

export type SpokenTitleWord = { text: string; start: number };

export type TimedTitle = {
    startSec: number;
    durationSec: number;
};

export const TITLE_TIMELINE_GAP_SEC = 0.12;
export const MIN_GENERATED_TITLE_DURATION_SEC = 0.25;

const roundTimelineSecond = (value: number) => Math.round(value * 1000) / 1000;

export const limitTitleWords = (value: unknown, maxWords = 3) => {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    const limit = Math.max(1, Math.min(12, Math.round(Number(maxWords) || 3)));
    return words.slice(0, limit).join(' ');
};

/**
 * Faz rodízio entre os modelos marcados. O índice da geração muda a cada clique
 * e o índice de atribuição alterna os modelos dentro da mesma resposta.
 */
export const rotatingTitleTypeIndex = (
    optionCount: number,
    generationIndex: number,
    assignmentIndex: number
) => {
    const count = Math.max(1, Math.floor(Number(optionCount) || 1));
    const generation = Math.max(0, Math.floor(Number(generationIndex) || 0));
    const assignment = Math.max(0, Math.floor(Number(assignmentIndex) || 0));
    return (generation + assignment) % count;
};

/**
 * Ordena os titulos gerados e encurta cada um antes do proximo comecar.
 * Candidatos praticamente simultaneos, que ficariam curtos demais, sao descartados.
 */
export const preventTitleOverlaps = <T extends TimedTitle>(
    titles: T[],
    gapSec = TITLE_TIMELINE_GAP_SEC
): T[] => {
    const safeGap = Math.max(0, Number(gapSec) || 0);
    const sorted = titles
        .map((title, originalIndex) => ({ title, originalIndex }))
        .sort((left, right) => {
            const startDifference = Number(left.title.startSec) - Number(right.title.startSec);
            return startDifference || left.originalIndex - right.originalIndex;
        })
        .map(({ title }) => title);

    return sorted
        .map((title, index) => {
            const startSec = Math.max(0, Number(title.startSec) || 0);
            const requestedDuration = Math.max(0, Number(title.durationSec) || 0);
            const nextTitle = sorted[index + 1];
            const nextStartSec = nextTitle
                ? Math.max(0, Number(nextTitle.startSec) || 0)
                : null;
            const availableDuration = nextStartSec === null
                ? requestedDuration
                : Math.max(0, nextStartSec - startSec - safeGap);

            return {
                ...title,
                startSec: roundTimelineSecond(startSec),
                durationSec: roundTimelineSecond(Math.min(requestedDuration, availableDuration)),
            };
        })
        .filter((title) => title.durationSec >= MIN_GENERATED_TITLE_DURATION_SEC);
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const normalizeHex = (value: unknown) =>
    HEX_COLOR.test(String(value || '').trim()) ? String(value).trim().toLowerCase() : null;

export const contrastColor = (background: string): '#000000' | '#ffffff' => {
    const color = normalizeHex(background);
    if (!color) return '#ffffff';
    const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4));
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
};

const distinctPaletteColors = (paletteInput: BrandPaletteInput) => {
    const candidates = [
        paletteInput?.primary,
        paletteInput?.secondary,
        paletteInput?.tertiary,
        ...(Array.isArray(paletteInput?.all) ? paletteInput.all : []),
    ].map(normalizeHex).filter((value): value is string => Boolean(value));
    return Array.from(new Set(candidates));
};

const paletteSlotColor = (
    paletteInput: BrandPaletteInput,
    slot: TitleColorRule['paletteSlot'],
    index: number
) => {
    if (slot !== 'rotate') return normalizeHex(paletteInput?.[slot]);
    const colors = distinctPaletteColors(paletteInput);
    return colors.length ? colors[index % colors.length] : null;
};

const secondaryPaletteSlot = (
    slot: TitleColorRule['paletteSlot']
): Exclude<TitleColorRule['paletteSlot'], 'rotate'> | 'rotate' => {
    if (slot === 'primary') return 'secondary';
    if (slot === 'secondary') return 'primary';
    if (slot === 'tertiary') return 'primary';
    return 'rotate';
};

/** Resolve as duas cores visuais do modelo sem substituir a segunda cor da marca por preto/branco. */
export const resolveTitleColors = (rule: TitleColorRule, paletteInput: BrandPaletteInput, index: number) => {
    const fixedPrimary = normalizeHex(rule.primary) || '#00e676';
    const fixedSecondary = normalizeHex(rule.secondary) || contrastColor(fixedPrimary);

    if (rule.mode !== 'brand') {
        return { primaryColor: fixedPrimary, secondaryColor: fixedSecondary };
    }

    const colors = distinctPaletteColors(paletteInput);
    const selected = paletteSlotColor(paletteInput, rule.paletteSlot, index) || colors[0] || fixedPrimary;
    const nextSlot = secondaryPaletteSlot(rule.paletteSlot);
    const selectedSecondary = paletteSlotColor(
        paletteInput,
        nextSlot,
        nextSlot === 'rotate' ? index + 1 : index
    ) || colors.find((color) => color !== selected) || fixedSecondary;

    return {
        primaryColor: selected,
        secondaryColor: selectedSecondary === selected ? contrastColor(selected) : selectedSecondary,
        colorBinding: {
            mode: 'brand' as const,
            paletteSlot: rule.paletteSlot,
            secondaryPaletteSlot: nextSlot,
            rotationIndex: index,
            fallbackPrimary: rule.primary,
            fallbackSecondary: rule.secondary,
        },
    };
};

export const normalizeTriggerKey = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const STANDARD_TRIGGER_ALIASES: Record<string, string[]> = {
    scarcity: ['scarcity', 'urgencia', 'urgency', 'escassez', 'escassez-e-urgencia'],
    region: ['region', 'regiao', 'local', 'location', 'localizacao', 'geografia', 'geografico'],
    cta: ['cta', 'call-to-action', 'chamada-para-acao', 'acao'],
    price: ['price', 'preco', 'valor', 'oferta', 'offer', 'desconto', 'condicao'],
    benefit: ['benefit', 'beneficio', 'bonus', 'beneficio-bonus', 'diferencial'],
};

export const triggerMapWithAliases = (triggers: TitleTriggerRule[]) => {
    const map = new Map<string, TitleTriggerRule>();
    for (const trigger of triggers) {
        map.set(normalizeTriggerKey(trigger.id), trigger);
        map.set(normalizeTriggerKey(trigger.name), trigger);
        for (const alias of STANDARD_TRIGGER_ALIASES[normalizeTriggerKey(trigger.id)] || []) {
            map.set(normalizeTriggerKey(alias), trigger);
        }
    }
    return map;
};

const normalizeLiteralPhrase = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    // `R$ 199`, `R$ 199,00` e o legado fragmentado `R 199 00` precisam ser equivalentes.
    .replace(/\br\s*\$?\s*(\d[\d.]*)\s*(?:[,.]\s*|\s+)(\d{2})\b/g, (_match, major: string, cents: string) =>
        `rs${major.replace(/\D/g, '')}${cents === '00' ? '' : cents}`
    )
    .replace(/\br\s*\$?\s*(\d[\d.]*)\b/g, (_match, major: string) => `rs${major.replace(/\D/g, '')}`)
    .replace(/[^a-z0-9%]+/g, '');

const formatPriceText = (value: string) => value.replace(
    /\bR\s*\$?\s*(\d[\d.]*)\s*(?:[,.]\s*|\s+)(\d{2})\b/giu,
    (_match, major: string, cents: string) => {
        const amount = Number(`${major.replace(/\D/g, '')}.${cents}`);
        return Number.isFinite(amount)
            ? `R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : _match;
    }
);

export const resolveLiteralCaptionText = (
    spokenWords: SpokenTitleWord[],
    candidate: unknown,
    requestedStart: unknown,
    triggerId?: string
) => {
    const candidateText = String(candidate || '').trim();
    const candidateWordCount = candidateText.split(/\s+/).filter(Boolean).length;
    const candidateKey = normalizeLiteralPhrase(candidateText);
    if (!candidateKey || candidateWordCount > 12) return null;

    const matches: { text: string; startSec: number }[] = [];
    for (let start = 0; start < spokenWords.length; start += 1) {
        for (let length = 1; length <= Math.min(12, spokenWords.length - start); length += 1) {
            const words = spokenWords.slice(start, start + length);
            const text = words.map((word) => word.text).join(' ');
            if (normalizeLiteralPhrase(text) !== candidateKey) continue;
            matches.push({
                text: normalizeTriggerKey(triggerId) === 'price' ? formatPriceText(text) : text,
                startSec: words[0].start,
            });
        }
    }

    if (!matches.length) return null;
    const requested = Number(requestedStart);
    if (!Number.isFinite(requested)) return matches[0];
    return matches.reduce((closest, match) =>
        Math.abs(match.startSec - requested) < Math.abs(closest.startSec - requested) ? match : closest
    );
};

/** Casos de alto sinal não dependem da IA: preço, localização e CTA explicitamente pronunciados. */
export const deterministicTitleCandidates = (script: string) => {
    const clean = String(script || '').replace(/\[[^\]]+\]/g, ' ');
    const candidates: { text: string; kind: string }[] = [];
    const prices = clean.match(/(?:a\s+partir\s+de\s+|por\s+|apenas\s+|s[oó]\s+)?R\$\s*\d+(?:\.\d{3})*(?:,\d{1,2})?/giu) || [];
    for (const price of prices) candidates.push({ text: price.trim(), kind: 'price' });

    const locationCue = clean.match(/\b(?:aten[cç][aã]o|al[oô])\s*[,!:-]?\s*([^,.!?;\n]{2,60})/iu)?.[1]?.trim();
    if (locationCue) {
        const words = locationCue.split(/\s+/).slice(0, 4);
        // Uma frase comercial logo após o chamado não deve virar região por engano.
        const commercialWords = new Set(['so', 'somente', 'compre', 'aproveite', 'garanta', 'clique', 'chame']);
        if (words.length && !commercialWords.has(normalizeTriggerKey(words[0]))) {
            candidates.push({ text: words.join(' '), kind: 'region' });
        }
    }

    // A IA tende a reconhecer bem ordens diretas como “clique”, mas pode deixar
    // passar chamadas igualmente explícitas no infinitivo, como “aproveitar essa
    // oferta”. A captura continua literal e para antes de uma nova oração.
    const ctaPattern = /\b(?:clique|clicar|chame|chamar|mande|mandar|fale|falar|agende|agendar|compre|comprar|garanta|garantir|aproveite|aproveitar|visite|visitar|venha|peça|pedir|acesse|acessar|saiba|confira|reserve|reservar)\b(?:\s+(?!(?:e|mas|porque|porém|então)\b)[\p{L}\p{N}$%@-]+){0,5}/giu;
    const directCtaVerbs = new Set([
        'clique', 'clicar', 'chame', 'chamar', 'mande', 'mandar', 'fale', 'falar',
        'agende', 'agendar', 'acesse', 'acessar', 'peca', 'pedir',
    ]);
    const transactionalCtaVerbs = new Set([
        'compre', 'comprar', 'garanta', 'garantir', 'visite', 'visitar', 'venha',
        'confira', 'reserve', 'reservar', 'saiba',
    ]);
    const ctaCandidates: { text: string; kind: string; priority: number; index: number }[] = [];
    for (const match of clean.matchAll(ctaPattern)) {
        const text = String(match[0] || '').replace(/[\s,.;:!?-]+$/g, '').trim();
        if (!text) continue;
        const verb = normalizeTriggerKey(text.split(/\s+/)[0]);
        ctaCandidates.push({
            text,
            kind: 'cta',
            priority: directCtaVerbs.has(verb) ? 3 : transactionalCtaVerbs.has(verb) ? 2 : 1,
            index: Number(match.index) || 0,
        });
    }
    ctaCandidates
        .sort((left, right) => right.priority - left.priority || left.index - right.index)
        .forEach(({ text, kind }) => candidates.push({ text, kind }));
    return candidates;
};
