import { normalizeSpokenNumbersPtBr } from './spokenNumbers.js';
import { normalizeSpokenPronunciationPtBr } from './spokenPronunciation.js';
import { resolveTtsModelFromPayload } from './ttsModels.js';

export const DIRECTION_MODES = new Set(['automatic', 'manual', 'clean']);
export const LEGACY_DIRECTION_VERSION = 'legacy-v1';
export const FISH_DIRECTION_CONTRACT_VERSION = 'fish-s2.1-natural-v1';
export const LOCAL_NARRATION_DIALECT = 'fish-natural-v1';
export const OPS_NARRATION_DIALECT = 'mileto-ops-bracket-v1';
// Technical directions are written in English and lowercase. Editorial
// brackets such as `[2026]` and `[Oferta]` remain spoken text.
const NATURAL_DIRECTION_TOKEN_GLOBAL = /\[[a-z][a-z '-]{0,63}\]/g;
const ORPHAN_DIRECTION_TAIL = /(?:\s*\[[a-z][a-z' -]{0,63}\])+\s*([.!?,;:]*)\s*$/;
const OPS_DIRECTION_TOKEN_GLOBAL = /\[[^\[\]\r\n]{1,240}\]/g;
const OPS_ORPHAN_DIRECTION_TAIL = /(?:\s*\[[^\[\]\r\n]{1,240}\])+\s*([.!?,;:]*)\s*$/;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export class NarrationTtsContractError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'NarrationTtsContractError';
        this.code = code;
        this.status = 400;
    }
}

/** Mantém apenas um identificador curto e seguro para header/log técnico. */
export const sanitizeDirectionVersion = (value) => {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9._-]/g, '')
        .replace(/-{2,}/g, '-')
        .slice(0, 64);
};

const stripNaturalDirections = (value) => String(value || '')
    .replace(NATURAL_DIRECTION_TOKEN_GLOBAL, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();

const stripDirections = (value, narrationDialect = LOCAL_NARRATION_DIALECT) =>
    narrationDialect === OPS_NARRATION_DIALECT
        ? String(value || '')
            .replace(OPS_DIRECTION_TOKEN_GLOBAL, ' ')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/ *\n */g, '\n')
            .trim()
        : stripNaturalDirections(value);

const removeOrphanDirections = (value, narrationDialect = LOCAL_NARRATION_DIALECT) => {
    const source = String(value || '');
    const cleaned = source
        .replace(
            narrationDialect === OPS_NARRATION_DIALECT ? OPS_ORPHAN_DIRECTION_TAIL : ORPHAN_DIRECTION_TAIL,
            (_match, punctuation) => punctuation || ''
        )
        .trim();
    // Um payload composto apenas por tags continua intacto para que a validação
    // específica o rejeite; a recuperação só se aplica quando existe fala real.
    return /[\p{L}\p{N}]/u.test(stripDirections(cleaned, narrationDialect)) ? cleaned : source;
};

const addAutomaticDirections = (value) => {
    const sentences = String(value || '').match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [String(value || '')];
    const content = sentences
        .map((sentence, index) => sentence.trim() ? index : -1)
        .filter((index) => index >= 0);
    if (!content.length) return String(value || '');
    const vocabulary = [
        'curious and inviting',
        'clear and informative',
        'confident',
        'warm and reassuring',
        'confident and inviting',
    ];
    const targetCount = Math.min(vocabulary.length, content.length);
    const selected = targetCount === 1
        ? [content[0]]
        : Array.from({ length: targetCount }, (_, slot) =>
            content[Math.round((slot * (content.length - 1)) / (targetCount - 1))]
        );
    selected.forEach((sentenceIndex, slot) => {
        const leading = sentences[sentenceIndex].match(/^\s*/)?.[0] || '';
        sentences[sentenceIndex] = `${leading}[${vocabulary[slot]}] ${sentences[sentenceIndex].slice(leading.length)}`;
    });
    return sentences.join('');
};

const extractDirections = (
    text,
    narrationDialect = LOCAL_NARRATION_DIALECT,
    validateTargets = true
) => {
    const opsDialect = narrationDialect === OPS_NARRATION_DIALECT;
    const directions = [];
    let openAt = -1;
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === '[' && openAt === -1 && !opsDialect && !/\p{Ll}/u.test(text[index + 1] || '')) {
            continue;
        }
        if (text[index] === '[') {
            if (openAt !== -1) {
                throw new NarrationTtsContractError(
                    'narration_directions_invalid',
                    'A narração possui colchetes de direção aninhados ou desbalanceados.'
                );
            }
            openAt = index;
        } else if (text[index] === ']' && openAt === -1) {
            continue;
        } else if (text[index] === ']') {
            if (openAt === -1) {
                throw new NarrationTtsContractError(
                    'narration_directions_invalid',
                    'A narração possui colchetes de direção desbalanceados.'
                );
            }
            const value = text.slice(openAt + 1, index).trim();
            const validDirection = opsDialect
                ? value.length >= 1 && value.length <= 240 && !/[\[\]\r\n]/u.test(value)
                : /^[a-z][a-z '-]{0,63}$/.test(value);
            if (!validDirection) {
                throw new NarrationTtsContractError(
                    'narration_direction_invalid',
                    'As direções de voz devem ser descrições curtas em inglês entre colchetes.'
                );
            }
            directions.push({ value, start: openAt, end: index + 1 });
            openAt = -1;
        }
    }
    if (openAt !== -1) {
        throw new NarrationTtsContractError(
            'narration_directions_invalid',
            'A narração possui colchetes de direção desbalanceados.'
        );
    }
    for (const direction of validateTargets ? directions : []) {
        let following = text.slice(direction.end);
        const nextDirection = opsDialect
            ? /^\s*\[[^\[\]\r\n]{1,240}\]/u
            : /^\s*\[[a-z][a-z '-]{0,63}\]/;
        while (nextDirection.test(following)) {
            following = following.replace(nextDirection, '');
        }
        if (!/^[\s"'“”‘’(\-—]*[\p{L}\p{N}]/u.test(following)) {
            throw new NarrationTtsContractError(
                'narration_direction_without_target',
                'Toda direção de voz deve aparecer imediatamente antes do trecho que controla.'
            );
        }
    }
    return directions;
};

const directionHasImmediateTarget = (text, end, narrationDialect) => {
    let following = text.slice(end);
    const nextDirection = narrationDialect === OPS_NARRATION_DIALECT
        ? /^\s*\[[^\[\]\r\n]{1,240}\]/u
        : /^\s*\[[a-z][a-z '-]{0,63}\]/;
    while (nextDirection.test(following)) following = following.replace(nextDirection, '');
    return /^[\s"'“”‘’(\-—]*[\p{L}\p{N}]/u.test(following);
};

/** Recover only automatic directions without spoken targets; manual remains strict. */
const repairAutomaticDirectionsWithoutTarget = (text, narrationDialect) => {
    if (!/[\p{L}\p{N}]/u.test(stripDirections(text, narrationDialect))) return text;
    const invalid = extractDirections(text, narrationDialect, false)
        .filter((direction) => !directionHasImmediateTarget(text, direction.end, narrationDialect));
    if (!invalid.length) return text;

    return invalid
        .sort((left, right) => right.start - left.start)
        .reduce(
            (result, direction) => result.slice(0, direction.start) + result.slice(direction.end),
            text
        );
};

const assertDirectionsOutsideProtectedValues = (
    text,
    directions,
    protectedTerms = [],
    plainText = '',
    narrationDialect = LOCAL_NARRATION_DIALECT
) => {
    const tag = narrationDialect === OPS_NARRATION_DIALECT
        ? String.raw`\[[^\[\]\r\n]{1,240}\]`
        : String.raw`\[[a-z][a-z '-]{0,63}\]`;
    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`R\\$\\s*${tag}\\s*\\d`, 'iu'),
        new RegExp(`\\d\\s*${tag}\\s*\\d`, 'u'),
        new RegExp(`\\b(?:rua|avenida|av\\.?|rodovia|travessa|alameda|praça)\\s+${tag}`, 'iu'),
        new RegExp(`\\b\\p{Lu}[\\p{L}'-]+\\s+${tag}\\s+\\p{Lu}[\\p{L}'-]+`, 'u'),
    ];
    if (patterns.some((pattern) => pattern.test(text))) {
        throw new NarrationTtsContractError(
            'narration_direction_inside_protected_value',
            'Uma direção de voz foi inserida dentro de um preço, telefone, nome ou endereço.'
        );
    }

    // No payload estruturado, preços em algarismos no texto humano chegam por
    // extenso ao Fish. Reconstruímos cada preço normalizado permitindo tags
    // entre suas palavras: uma ocorrência com tag significa que o valor foi
    // fragmentado (ex.: `noventa e nove [emphasis] reais`).
    const plainPrices = String(plainText).match(/R\$\s*\d+(?:\.\d{3})*(?:,\d{1,2})?/giu) || [];
    for (const price of plainPrices) {
        const spokenPrice = normalizeSpokenPronunciationPtBr(normalizeSpokenNumbersPtBr(price));
        const words = spokenPrice.trim().split(/\s+/).filter(Boolean).map(escapeRegex);
        if (words.length < 2) continue;
        const spokenPriceWithOptionalDirections = new RegExp(
            words.join(`(?:\\s+|\\s*${tag}\\s*)+`),
            'iu'
        );
        const match = text.match(spokenPriceWithOptionalDirections)?.[0] || '';
        if (/\[[^\]\r\n]+\]/.test(match)) {
            throw new NarrationTtsContractError(
                'narration_direction_inside_protected_value',
                'Uma direção de voz foi inserida dentro de um preço por extenso.'
            );
        }
    }

    const safeTerms = Array.isArray(protectedTerms)
        ? protectedTerms
            .filter((term) => typeof term === 'string' && term.trim().length >= 2 && term.trim().length <= 160)
            .map((term) => term.trim())
            .slice(0, 20)
        : [];

    // A borda recebe o texto de sintese ja normalizado por extenso. Para que
    // telefone, endereco, data e percentual continuem atomicos, reconstruimos
    // a forma falada dos fragmentos protegidos do texto humano e procuramos
    // direcoes inseridas entre suas palavras.
    const protectedFragments = [...safeTerms];
    const protectedSourcePatterns = [
        /R\$\s*\d+(?:\.\d{3})*(?:,\d{1,2})?/giu,
        /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/g,
        /\b(?:Rua|Avenida|Av\.?|Alameda|Travessa|Rodovia|Estrada|Pra\u00E7a)(?:\s+[\p{L}\d.'-]+){1,8}(?:,?\s*\d+[\p{L}]?)?/giu,
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
        /\b\d+(?:,\d+)?\s*%/g,
    ];
    for (const pattern of protectedSourcePatterns) {
        for (const match of String(plainText).matchAll(pattern)) protectedFragments.push(match[0]);
    }
    for (const fragment of new Set(protectedFragments)) {
        const spoken = normalizeSpokenPronunciationPtBr(normalizeSpokenNumbersPtBr(fragment));
        const words = spoken.match(/[\p{L}\p{N}]+/gu)?.map(escapeRegex) || [];
        if (words.length < 2) continue;
        const protectedSpokenPattern = new RegExp(
            words.join(`(?:\\s+|\\s*${tag}\\s*)+`),
            'iu'
        );
        const match = text.match(protectedSpokenPattern)?.[0] || '';
        if (new RegExp(tag, 'u').test(match)) {
            throw new NarrationTtsContractError(
                'narration_direction_inside_protected_value',
                'Uma direcao de voz foi inserida dentro de um valor ou termo protegido.'
            );
        }
    }

    if (!safeTerms.length || !directions.length) return;

    // Detecta uma tag ocupando o separador entre palavras de um termo protegido,
    // inclusive `Ótica [emphasis] Reis`.
    for (const term of safeTerms) {
        const words = term.split(/\s+/).filter(Boolean).map(escapeRegex);
        if (words.length === 1) {
            const rawWord = term.trim();
            const splitInsideWord = Array.from({ length: rawWord.length - 1 }, (_, index) => index + 1)
                .some((splitAt) => new RegExp(
                    `${escapeRegex(rawWord.slice(0, splitAt))}\\s*\\[[^\\]\\r\\n]+\\]\\s*${escapeRegex(rawWord.slice(splitAt))}`,
                    'iu'
                ).test(text));
            if (splitInsideWord) {
                throw new NarrationTtsContractError(
                    'narration_direction_inside_protected_value',
                    'Uma direção de voz foi inserida dentro de um termo protegido do projeto.'
                );
            }
            continue;
        }
        const protectedPattern = new RegExp(
            words.join('(?:\\s|\\[[^\\]\\r\\n]+\\])+'),
            'iu'
        );
        const match = text.match(protectedPattern)?.[0] || '';
        if (/\[[^\]\r\n]+\]/.test(match)) {
            throw new NarrationTtsContractError(
                'narration_direction_inside_protected_value',
                'Uma direção de voz foi inserida dentro de um termo protegido do projeto.'
            );
        }
    }
};

const assertStructuredNarration = ({
    plainText,
    synthesisText,
    directionMode,
    provider,
    model,
    protectedTerms,
    narrationDialect,
}) => {
    if (typeof plainText !== 'string' || !plainText.trim()) {
        throw new NarrationTtsContractError(
            'narration_plain_text_required',
            'O payload estruturado deve informar narrationPlainText.'
        );
    }
    if (typeof synthesisText !== 'string' || !synthesisText.trim()) {
        throw new NarrationTtsContractError(
            'narration_synthesis_text_required',
            'O payload estruturado deve informar narrationSynthesisText.'
        );
    }

    if (extractDirections(plainText, narrationDialect).length) {
        throw new NarrationTtsContractError(
            'narration_plain_text_contains_directions',
            'narrationPlainText deve permanecer sem direções de voz.'
        );
    }
    const directions = extractDirections(synthesisText, narrationDialect);
    const spokenContent = stripDirections(synthesisText, narrationDialect);
    if (!/[\p{L}\p{N}]/u.test(spokenContent)) {
        throw new NarrationTtsContractError(
            'narration_tags_only',
            'A narração não pode ser composta apenas por direções de voz.'
        );
    }
    const directionsUnsupported = provider !== 'fishAudio' || model === 's1';
    if (directionsUnsupported && directionMode !== 'clean') {
        throw new NarrationTtsContractError(
            'narration_direction_mode_incompatible',
            `O provedor/modelo ${model} exige directionMode clean e não aceita direções Fish Audio.`
        );
    }
    if (directionsUnsupported && directions.length) {
        throw new NarrationTtsContractError(
            'narration_directions_unsupported',
            `O provedor/modelo ${model} não aceita direções Fish Audio entre colchetes.`
        );
    }
    if (directionMode === 'clean' && directions.length) {
        throw new NarrationTtsContractError(
            'narration_clean_contains_directions',
            'A narração foi marcada como clean, mas ainda possui direções entre colchetes.'
        );
    }
    if (directionMode === 'automatic' && model === 's2.1-pro' && !directions.length) {
        throw new NarrationTtsContractError(
            'narration_automatic_direction_missing',
            'A narração automática para s2.1-pro não possui direção de voz. Use directionMode clean para interpretação neutra.'
        );
    }
    assertDirectionsOutsideProtectedValues(
        synthesisText,
        directions,
        protectedTerms,
        plainText,
        narrationDialect
    );
    const comparable = (value) => normalizeSpokenPronunciationPtBr(normalizeSpokenNumbersPtBr(value))
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('pt-BR');
    if (comparable(plainText) !== comparable(spokenContent)) {
        throw new NarrationTtsContractError(
            'narration_text_mismatch',
            'narrationSynthesisText deve conter a mesma narração de narrationPlainText, alterando apenas direções e normalização de fala.'
        );
    }
};

/**
 * Prepara e valida tudo que precisa estar decidido antes de consultar chave,
 * reservar créditos ou chamar o fornecedor.
 */
export const prepareTtsRequest = (payload = {}) => {
    const provider = payload.provider || 'fishAudio';
    const model = resolveTtsModelFromPayload(provider, payload);
    const contractFields = [
        'narrationPlainText',
        'narrationSynthesisText',
        'directionMode',
        'directionVersion',
        'narrationDialect',
        'protectedTerms',
    ];
    const structured = contractFields.some((field) => own(payload, field));

    if (structured) {
        if (!DIRECTION_MODES.has(payload.directionMode)) {
            throw new NarrationTtsContractError(
                'narration_direction_mode_invalid',
                'O payload estruturado deve informar directionMode como automatic, manual ou clean.'
            );
        }
        const directionVersion = sanitizeDirectionVersion(payload.directionVersion);
        if (directionVersion !== FISH_DIRECTION_CONTRACT_VERSION) {
            throw new NarrationTtsContractError(
                'narration_direction_version_invalid',
                `O payload estruturado deve usar directionVersion ${FISH_DIRECTION_CONTRACT_VERSION}.`
            );
        }
        const narrationDialect = payload.narrationDialect === undefined
            || payload.narrationDialect === null
            || payload.narrationDialect === ''
            || payload.narrationDialect === LOCAL_NARRATION_DIALECT
            ? LOCAL_NARRATION_DIALECT
            : payload.narrationDialect === OPS_NARRATION_DIALECT
                ? OPS_NARRATION_DIALECT
                : null;
        if (!narrationDialect) {
            throw new NarrationTtsContractError(
                'narration_dialect_invalid',
                `O dialeto de narracao solicitado (${String(payload.narrationDialect).slice(0, 64)}) nao e suportado.`
            );
        }
        const narrationPlainText = narrationDialect === OPS_NARRATION_DIALECT
            && typeof payload.narrationPlainText === 'string'
            ? payload.narrationPlainText.normalize('NFKC')
            : payload.narrationPlainText;
        let directionMode = payload.directionMode;
        let synthesisText = typeof payload.narrationSynthesisText === 'string'
            ? removeOrphanDirections(
                narrationDialect === OPS_NARRATION_DIALECT
                    ? payload.narrationSynthesisText.normalize('NFKC')
                    : payload.narrationSynthesisText,
                narrationDialect
            )
            : payload.narrationSynthesisText;
        if (
            directionMode === 'automatic'
            && narrationDialect === LOCAL_NARRATION_DIALECT
            && typeof synthesisText === 'string'
        ) {
            synthesisText = repairAutomaticDirectionsWithoutTarget(synthesisText, narrationDialect);
        }
        if (
            provider === 'fishAudio'
            && model === 's2.1-pro'
            && (directionMode === 'automatic' || directionMode === 'manual')
            && typeof synthesisText === 'string'
            && !extractDirections(synthesisText, narrationDialect).length
        ) {
            // Defesa de borda para clientes antigos: manual sem direcao nunca
            // deve chegar neutro ao S2.1 Pro pago. O texto continua identico;
            // apenas instrucoes naturais de interpretacao sao acrescentadas.
            directionMode = 'automatic';
            synthesisText = addAutomaticDirections(synthesisText);
        }
        assertStructuredNarration({
            plainText: narrationPlainText,
            synthesisText,
            directionMode,
            provider,
            model,
            protectedTerms: payload.protectedTerms,
            narrationDialect,
        });
        return {
            provider,
            model,
            spokenText: synthesisText,
            narrationPlainText,
            directionMode,
            directionVersion,
            narrationDialect,
            structured: true,
        };
    }

    if (typeof payload.text !== 'string' || !payload.text.trim()) {
        throw new NarrationTtsContractError('narration_text_required', 'Falta o texto da narração.');
    }
    // Mesmo o payload legado respeita invariantes estruturais antes de cobrar.
    // Colchetes que nao formam uma direcao natural continuam literais.
    const safeLegacyText = removeOrphanDirections(payload.text);
    extractDirections(safeLegacyText);
    const directionsUnsupported = provider !== 'fishAudio' || model === 's1';
    const legacyText = directionsUnsupported ? stripNaturalDirections(safeLegacyText) : safeLegacyText;
    if (!legacyText || !/[\p{L}\p{N}]/u.test(legacyText)) {
        throw new NarrationTtsContractError(
            'narration_text_required',
            'A narração legada ficou vazia após remover direções incompatíveis.'
        );
    }
    return {
        provider,
        model,
        spokenText: provider === 'fishAudio'
            ? normalizeSpokenPronunciationPtBr(normalizeSpokenNumbersPtBr(legacyText))
            : legacyText,
        narrationPlainText: legacyText,
        directionMode: directionsUnsupported ? 'clean' : 'manual',
        directionVersion: LEGACY_DIRECTION_VERSION,
        narrationDialect: LOCAL_NARRATION_DIALECT,
        structured: false,
    };
};
