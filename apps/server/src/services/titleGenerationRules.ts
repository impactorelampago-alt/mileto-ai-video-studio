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
export const MIN_GENERATED_TITLE_DURATION_SEC = 0.75;

export type TitleSemanticRole = 'hook' | 'offer_or_benefit' | 'cta';

export type SemanticTimedTitle = TimedTitle & {
    triggerId?: string;
    semanticRoles?: TitleSemanticRole[];
};

export type TitleSemanticCoverage = {
    required: TitleSemanticRole[];
    covered: TitleSemanticRole[];
    missing: TitleSemanticRole[];
};

const roundTimelineSecond = (value: number) => Math.round(value * 1000) / 1000;

const DANGLING_TITLE_ENDINGS = new Set([
    'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas',
    'de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'com', 'sem', 'por', 'para',
    'em', 'na', 'no', 'nas', 'nos', 'ao', 'aos',
    'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas',
    'nosso', 'nossa', 'nossos', 'nossas', 'este', 'esta', 'esse', 'essa',
]);

const normalizedLastWord = (value: unknown) => {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    return (words[words.length - 1] || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .replace(/[^a-z0-9]+/g, '');
};

export const isSemanticallyCompleteTitle = (value: unknown) => {
    const title = String(value || '').replace(/\s+/g, ' ').trim();
    if (!title || DANGLING_TITLE_ENDINGS.has(normalizedLastWord(title))) return false;
    if (/\bR\s*\$\s*$/iu.test(title)) return false;
    const normalized = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    return !/(?:\ba partir|\bpor apenas|\bsomente por|\bso por)\s*$/.test(normalized);
};

/** O limite é uma preferência visual; pode avançar para preservar uma unidade de sentido. */
export const limitTitleWords = (value: unknown, maxWords = 3) => {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    const limit = Math.max(1, Math.min(12, Math.round(Number(maxWords) || 3)));
    if (words.length <= limit) return words.join(' ');

    const softOverflowLimit = Math.min(12, limit + 3);
    for (let length = limit; length <= Math.min(words.length, softOverflowLimit); length += 1) {
        const candidate = words.slice(0, length).join(' ');
        if (isSemanticallyCompleteTitle(candidate)) return candidate;
    }
    return words.slice(0, 12).join(' ');
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

const OFFER_OR_BENEFIT_TRIGGERS = new Set([
    'price', 'benefit', 'product', 'differentiator', 'scarcity',
]);

const HOOK_ELIGIBLE_TRIGGERS = new Set([
    'audience', 'product', 'benefit', 'differentiator', 'price', 'scarcity',
]);

export const semanticRolesForTitle = (
    triggerId: unknown,
    startSec: unknown,
    timelineDurationSec: unknown,
): TitleSemanticRole[] => {
    const trigger = normalizeTriggerKey(triggerId);
    const start = Math.max(0, Number(startSec) || 0);
    const timelineDuration = Math.max(0, Number(timelineDurationSec) || 0);
    const hookWindow = Math.min(5, Math.max(2.5, timelineDuration * 0.25));
    const roles: TitleSemanticRole[] = [];

    if (HOOK_ELIGIBLE_TRIGGERS.has(trigger) && start <= hookWindow) roles.push('hook');
    if (OFFER_OR_BENEFIT_TRIGGERS.has(trigger)) roles.push('offer_or_benefit');
    if (trigger === 'cta') roles.push('cta');
    return roles;
};

/**
 * Recorta o último título no limite real e descarta qualquer candidato que
 * começaria fora da timeline ou sobreviveria como um lampejo invisível.
 */
export const fitTitlesToTimeline = <T extends TimedTitle>(
    titles: T[],
    timelineDurationSec: unknown,
): T[] => {
    const timelineDuration = Math.max(0, Number(timelineDurationSec) || 0);
    if (!(timelineDuration > 0)) return [];

    return titles.flatMap((title) => {
        const startSec = Math.max(0, Number(title.startSec) || 0);
        if (startSec >= timelineDuration) return [];
        const durationSec = Math.min(
            Math.max(0, Number(title.durationSec) || 0),
            timelineDuration - startSec,
        );
        if (durationSec < MIN_GENERATED_TITLE_DURATION_SEC) return [];
        return [{
            ...title,
            startSec: roundTimelineSecond(startSec),
            durationSec: roundTimelineSecond(durationSec),
        }];
    });
};

const SEMANTIC_ROLE_ORDER: TitleSemanticRole[] = ['hook', 'offer_or_benefit', 'cta'];

export const semanticCoverageForTitles = <T extends SemanticTimedTitle>(
    requiredFrom: T[],
    selected: T[],
): TitleSemanticCoverage => {
    const required = SEMANTIC_ROLE_ORDER.filter((role) =>
        requiredFrom.some((title) => title.semanticRoles?.includes(role))
    );
    const covered = required.filter((role) =>
        selected.some((title) => title.semanticRoles?.includes(role))
    );
    return {
        required,
        covered,
        missing: required.filter((role) => !covered.includes(role)),
    };
};

/**
 * A quantidade deixa de ser o único critério. Reservamos vagas para gancho,
 * oferta/benefício e CTA sempre que candidatos válidos comprovam esses
 * elementos; depois completamos com os demais títulos em ordem temporal.
 */
export const selectTitlesForSemanticCoverage = <T extends SemanticTimedTitle>(
    candidates: T[],
    configuredMaxTitles: unknown,
): { titles: T[]; coverage: TitleSemanticCoverage } => {
    const ordered = candidates
        .map((title, index) => ({ title, index }))
        .sort((left, right) => left.title.startSec - right.title.startSec || left.index - right.index)
        .map(({ title }) => title);
    const initialCoverage = semanticCoverageForTitles(ordered, []);
    const requestedLimit = Math.max(1, Math.min(20, Math.floor(Number(configuredMaxTitles) || 1)));
    const selected: T[] = [];

    for (const role of initialCoverage.required) {
        if (selected.some((title) => title.semanticRoles?.includes(role))) continue;
        const matching = ordered.filter((title) =>
            title.semanticRoles?.includes(role) && !selected.includes(title)
        );
        const preferred = role === 'cta' ? matching.at(-1) : matching[0];
        if (preferred) selected.push(preferred);
    }

    // Um mesmo título pode cobrir mais de uma função semântica. A capacidade
    // mínima precisa acompanhar os títulos efetivamente reservados, não a
    // quantidade bruta de papéis, para não inserir conteúdo editorial extra.
    const effectiveLimit = Math.max(requestedLimit, selected.length);
    for (const title of ordered) {
        if (selected.length >= effectiveLimit) break;
        if (!selected.includes(title)) selected.push(title);
    }

    selected.sort((left, right) => left.startSec - right.startSec);
    return {
        titles: selected,
        coverage: semanticCoverageForTitles(ordered, selected),
    };
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
    price: ['price', 'preco', 'valor', 'desconto', 'condicao', 'pagamento'],
    benefit: ['benefit', 'beneficio', 'bonus', 'beneficio-bonus'],
    product: ['product', 'produto', 'servico', 'oferta', 'offer'],
    differentiator: ['differentiator', 'diferencial', 'prova', 'qualidade', 'mecanismo'],
    audience: ['audience', 'publico', 'publico-alvo', 'necessidade', 'problema'],
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

export type CompactTitleText = {
    /** Trecho literal usado para auditoria e sincronizacao. */
    sourceText: string;
    /** Etiqueta curta que sera desenhada no video. */
    text: string;
    /** Condicao comercial preservada fora da etiqueta principal. */
    qualifierText?: string;
};

const normalizeDisplayPhrase = (value: unknown) => String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
    .trim();

const stripLeadingDisplayWords = (value: string, words: string[]) => {
    const alternatives = words
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    return value.replace(new RegExp(`^(?:(?:${alternatives})\\s+)+`, 'iu'), '').trim();
};

const DISPLAY_LEADING_WORDS = [
    'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
    'seu', 'sua', 'seus', 'suas',
];

const LEADING_COMMERCIAL_ACTION = /^(?:monte|monta|escolha|escolhe|conhe[c\u00e7]a|descubra|encontre|tenha|garanta|aproveite|personalize|experimente)\s+/iu;
const COMMERCIAL_PREDICATE_BOUNDARY = /\s+(?:sai|saem|fica|ficam|custa|custam|tem|t[e\u00ea]m|oferece|oferecem|garante|garantem|inclui|incluem|leva|levam|vira|viram|\u00e9|s[a\u00e3]o|est[a\u00e1]|est[a\u00e3]o)\b.*$/iu;
const PERSONALIZATION_SUFFIX = /\s+(?:do|da|dos|das)\s+(seu|sua|seus|suas)\s+jeito\b.*$/iu;

/** Converte uma frase comercial em rotulo nominal sem inventar palavras. */
const compactNominalDisplayPhrase = (value: string, trigger: string) => {
    let compact = stripLeadingDisplayWords(value, DISPLAY_LEADING_WORDS);
    const personalization = compact.match(PERSONALIZATION_SUFFIX);
    if (personalization && ['benefit', 'differentiator'].includes(trigger)) {
        return personalization[1] + ' JEITO';
    }

    compact = compact.replace(LEADING_COMMERCIAL_ACTION, '');
    compact = stripLeadingDisplayWords(compact, DISPLAY_LEADING_WORDS);
    if (trigger === 'product') compact = compact.replace(PERSONALIZATION_SUFFIX, '');
    compact = compact.replace(COMMERCIAL_PREDICATE_BOUNDARY, '');
    return normalizeDisplayPhrase(compact);
};

const TITLE_TYPE_WORD_CAPACITY: Record<string, number> = {
    'premium-benefit-badge': 3,
    'premium-product-launch': 4,
    'premium-creator-caption': 4,
    'premium-kinetic-punch': 3,
    'premium-sticker-pop': 3,
    'premium-marker-swipe': 3,
    'premium-split-block': 4,
    'premium-outline-echo': 3,
    'premium-sale-spotlight': 3,
    'premium-price-tag': 3,
    'premium-urgency-pulse': 3,
    'premium-coupon-ticket': 3,
    'loc-pin-viagem': 3,
    'loc-minimal-urbano': 3,
    'loc-tag-geo': 3,
    'loc-boarding-pass': 3,
    'loc-glass-radar': 3,
    'loc-editorial-atlas': 3,
    'loc-neon-marker': 3,
    'cta-whatsapp': 3,
    'cta-tap': 3,
};

/** Limite editorial do desenho, independente do limite de cada gatilho. */
export const titleTypeWordCapacity = (styleId: unknown, configuredMaxWords?: unknown) => {
    const configured = Number(configuredMaxWords);
    if (Number.isFinite(configured) && configured > 0) {
        return Math.max(1, Math.min(12, Math.round(configured)));
    }
    return TITLE_TYPE_WORD_CAPACITY[String(styleId || '').trim()] || 4;
};

const isConnectorOnlyTitle = (value: string) => {
    const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    return new Set([
        'a partir', 'a partir de', 'por apenas', 'somente por', 'so por',
        'por conta', 'por conta de', 'o exame', 'a oferta', 'sua', 'seu',
    ]).has(normalized);
};

const REGION_BUSINESS_LEADS = new Set([
    'otica', 'loja', 'empresa', 'clinica', 'consultorio', 'agencia',
    'restaurante', 'mercado', 'academia', 'studio', 'estudio', 'salao',
    'hospital', 'farmacia',
]);

const normalizeRegionDisplayText = (value: unknown) => {
    const text = normalizeDisplayPhrase(value)
        .replace(/^(?:aten[cç][aã]o|al[oô])\s*[,!:\-]?\s*/iu, '')
        .replace(/^(?:(?:se\s+)?voc[eê]\s+mora|mora|atendemos|estamos|ficamos)\s+(?:aqui\s+)?(?:em|na|no)\s+/iu, '')
        .replace(/^(?:na\s+cidade|no\s+bairro|na\s+regi[aã]o)\s+de\s+/iu, '')
        .replace(/^(?:em|na|no)\s+/iu, '')
        .trim();

    if (!text) return null;

    const firstWord = normalizeTriggerKey(text.split(/\s+/)[0]);
    if (REGION_BUSINESS_LEADS.has(firstWord)) return null;

    const normalized = normalizeTriggerKey(text);
    if ([...REGION_BUSINESS_LEADS].some((lead) => normalized === lead || normalized.startsWith(`${lead}-`))) {
        return null;
    }

    return text;
};

/**
 * Separa o trecho falado da etiqueta visual. A evidencia continua literal,
 * enquanto o texto desenhado vira o nucleo semantico curto de cada gatilho.
 */
export const compactTitleDisplayText = (
    value: unknown,
    triggerId: unknown,
    maxWords = 3
): CompactTitleText | null => {
    const sourceText = normalizeDisplayPhrase(value);
    if (!sourceText) return null;

    const trigger = normalizeTriggerKey(triggerId);
    let text = sourceText;
    let qualifierText: string | undefined;

    if (trigger === 'price') {
        const currency = sourceText.match(/R\s*\$\s*\d+(?:\.\d{3})*(?:,\d{1,2})?/iu)?.[0];
        const normalizedSource = normalizeTriggerKey(sourceText);
        if (normalizedSource.includes('a-partir-de')) qualifierText = 'A PARTIR DE';
        else if (normalizedSource.includes('por-apenas')) qualifierText = 'POR APENAS';
        else if (normalizedSource.includes('somente-por') || normalizedSource.includes('so-por')) {
            qualifierText = 'SOMENTE POR';
        }
        if (currency) text = formatPriceText(currency);
    } else if (trigger === 'region') {
        const regionText = normalizeRegionDisplayText(text);
        if (!regionText) return null;
        text = regionText;
    } else if (trigger === 'scarcity') {
        text = text.replace(/^(?:somente|s[oó])\s+(?=at[eé](?:\s|$))/iu, '').trim();
    } else if (['benefit', 'product', 'differentiator', 'audience'].includes(trigger)) {
        text = compactNominalDisplayPhrase(text, trigger);
    } else if (trigger === 'cta') {
        text = stripLeadingDisplayWords(text, ['e', 'então']);
    }

    text = normalizeDisplayPhrase(text);
    if (!text || isConnectorOnlyTitle(text)) return null;

    const fittedText = limitTitleWords(text, maxWords);
    if (!isSemanticallyCompleteTitle(fittedText) || isConnectorOnlyTitle(fittedText)) return null;
    if (trigger === 'price' && !/(?:R\s*\$|\d+\s*%|\d+\s*x\b)/iu.test(fittedText)) return null;

    return {
        sourceText,
        text: fittedText,
        ...(qualifierText ? { qualifierText } : {}),
    };
};

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

    const locationCues: string[] = [];
    const explicitLocationPatterns = [
        /\b(?:(?:se\s+)?voc[eê]\s+mora|mora|atendemos|estamos|ficamos)\s+(?:aqui\s+)?(?:em|na|no)\s+([^,.!?;\n]{2,60})/giu,
        /\b(?:cidade|bairro|regi[aã]o)\s+(?:de|do|da)\s+([^,.!?;\n]{2,60})/giu,
    ];
    for (const pattern of explicitLocationPatterns) {
        for (const match of clean.matchAll(pattern)) {
            if (match[1]) locationCues.push(match[1].trim());
        }
    }

    const attentionLocation = clean.match(/\b(?:aten[cç][aã]o|al[oô])\s*[,!:-]?\s*([^,.!?;\n]{2,60})/iu)?.[1]?.trim();
    if (attentionLocation) locationCues.push(attentionLocation);

    const commercialWords = new Set(['so', 'somente', 'compre', 'aproveite', 'garanta', 'clique', 'chame']);
    const seenRegions = new Set<string>();
    for (const locationCue of locationCues) {
        const normalizedCue = normalizeRegionDisplayText(locationCue);
        if (!normalizedCue) continue;
        const words = normalizedCue.split(/\s+/).slice(0, 5);
        if (!words.length || commercialWords.has(normalizeTriggerKey(words[0]))) continue;
        const region = words.join(' ');
        const key = normalizeTriggerKey(region);
        if (!key || seenRegions.has(key)) continue;
        seenRegions.add(key);
        candidates.push({ text: region, kind: 'region' });
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

/** Recupera preços já normalizados pelas legendas, mesmo com números por extenso no roteiro. */
export const deterministicCaptionTitleCandidates = (spokenWords: SpokenTitleWord[]) => {
    const candidates: { text: string; kind: string; startSec: number }[] = [];
    for (let index = 0; index < spokenWords.length; index += 1) {
        const word = spokenWords[index];
        if (!/^R\s*\$/iu.test(word.text.trim())) continue;
        const previous = spokenWords.slice(Math.max(0, index - 3), index);
        const previousKey = previous.map((item) => normalizeTriggerKey(item.text)).join(' ');
        const shortKey = previous.slice(-2).map((item) => normalizeTriggerKey(item.text)).join(' ');
        const prefixLength = previousKey.endsWith('a partir de')
            ? 3
            : ['por apenas', 'somente por', 'so por'].includes(shortKey)
              ? 2
              : 0;
        const phrase = [...spokenWords.slice(index - prefixLength, index), word];
        candidates.push({
            text: phrase.map((item) => item.text).join(' '),
            kind: 'price',
            startSec: phrase[0].start,
        });
    }
    return candidates;
};
