import { DEFAULT_FISH_MODEL, FishModel, isFishModel, TtsProvider } from './ttsTypes';
import { prepareSpokenTextPtBr } from './spokenTextPtBr';

export const FISH_DIRECTION_CONTRACT_VERSION = 'fish-s2.1-natural-v1';
export const LOCAL_NARRATION_DIALECT = 'fish-natural-v1';
export const OPS_NARRATION_DIALECT = 'mileto-ops-bracket-v1';
export type NarrationDirectionMode = 'automatic' | 'manual' | 'clean';
export type NarrationDialect = typeof LOCAL_NARRATION_DIALECT | typeof OPS_NARRATION_DIALECT;

// Referencia editorial interna. Ela documenta recursos conhecidos, mas nao e
// usada como allowlist: instrucoes naturais curtas, como
// [warm and reassuring], continuam validas.
export const DOCUMENTED_FISH_DIRECTIONS = Object.freeze({
    basicEmotions: ['happy', 'sad', 'angry', 'excited', 'calm', 'nervous', 'confident', 'surprised', 'satisfied', 'delighted', 'scared', 'worried', 'upset', 'frustrated', 'depressed', 'empathetic', 'embarrassed', 'disgusted', 'moved', 'proud', 'relaxed', 'grateful', 'curious', 'sarcastic'],
    advancedEmotions: ['disdainful', 'unhappy', 'anxious', 'hysterical', 'indifferent', 'uncertain', 'doubtful', 'confused', 'disappointed', 'regretful', 'guilty', 'ashamed', 'jealous', 'envious', 'hopeful', 'optimistic', 'pessimistic', 'nostalgic', 'lonely', 'bored', 'contemptuous', 'sympathetic', 'compassionate', 'determined', 'resigned'],
    delivery: ['in a hurry tone', 'shouting', 'screaming', 'whispering', 'soft tone', 'soft', 'breathy', 'emphasis'],
    humanSounds: ['laughing', 'chuckling', 'sobbing', 'crying loudly', 'sighing', 'groaning', 'panting', 'gasping', 'yawning', 'snoring', 'clear throat', 'moaning'],
    ambienceAndPauses: ['audience laughing', 'background laughter', 'crowd laughing', 'break', 'long-break', 'pause', 'long pause'],
    aliases: ['whisper', 'laugh', 'sigh', 'gasp', 'inhale', 'exhale'],
});

// Technical directions are written in English and lowercase. Editorial
// brackets such as `[2026]` and `[Oferta]` remain spoken text.
const NATURAL_DIRECTION = /^[a-z][a-z' -]{0,63}$/;
const DIRECTION_PATTERN = /\[([a-z][a-z' -]{0,63})\]/g;
const ORPHAN_DIRECTION_TAIL = /(?:\s*\[[a-z][a-z' -]{0,63}\])+\s*([.!?,;:]*)\s*$/;
const OPS_DIRECTION_PATTERN = /\[[^\[\]\r\n]{1,240}\]/g;
const OPS_ORPHAN_DIRECTION_TAIL = /(?:\s*\[[^\[\]\r\n]{1,240}\])+\s*([.!?,;:]*)\s*$/;
const SPACE = /\s+/g;

export class NarrationContractError extends Error {
    readonly code: string;
    readonly status = 400;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'NarrationContractError';
        this.code = code;
    }
}

export interface NarrationContractInput {
    provider: TtsProvider;
    legacyText?: unknown;
    narrationPlainText?: unknown;
    narrationSynthesisText?: unknown;
    ttsModel?: unknown;
    voiceSettingsModel?: unknown;
    directionMode?: unknown;
    directionVersion?: unknown;
    narrationDialect?: unknown;
    protectedTerms?: unknown;
    structured?: boolean;
}

export interface PreparedNarrationContract {
    narrationPlainText: string;
    narrationSynthesisText: string;
    ttsModel: string;
    directionMode: NarrationDirectionMode;
    directionVersion: string;
    narrationDialect: NarrationDialect;
    directions: string[];
    protectedTerms: string[];
}

const safeText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
// A sintese persistida ja pode conter moeda, data e percentual por extenso.
// Normalizar os dois lados torna `Refazer sintese` idempotente sem permitir
// mudanca de conteudo falado.
const comparable = (value: string): string => prepareSpokenTextPtBr(value)
    .normalize('NFKC')
    .replace(SPACE, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
const displayText = (value: string): string => value
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const removeOrphanDirections = (value: string, dialect: NarrationDialect): string => String(value || '')
    .replace(
        dialect === OPS_NARRATION_DIALECT ? OPS_ORPHAN_DIRECTION_TAIL : ORPHAN_DIRECTION_TAIL,
        (_match, punctuation: string) => punctuation || '',
    )
    .trim();

const prepareSpokenTextPreservingEditorialBrackets = (value: string): string => {
    const bracket = /\[[^\]\r\n]*\]/g;
    let cursor = 0;
    let result = '';
    for (const match of value.matchAll(bracket)) {
        const index = match.index || 0;
        result += prepareSpokenTextPtBr(value.slice(cursor, index));
        result += match[0];
        cursor = index + match[0].length;
    }
    result += prepareSpokenTextPtBr(value.slice(cursor));
    return result;
};

const parseDirections = (
    value: string,
    dialect: NarrationDialect = LOCAL_NARRATION_DIALECT,
): Array<{ value: string; index: number; end: number; plainIndex: number }> => {
    const opsDialect = dialect === OPS_NARRATION_DIALECT;
    const result: Array<{ value: string; index: number; end: number; plainIndex: number }> = [];
    let depth = 0;
    let plainIndex = 0;
    let opening = -1;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char === '[' && depth === 0 && !opsDialect && !/\p{Ll}/u.test(value[index + 1] || '')) {
            plainIndex += 1;
            continue;
        }
        if (char === '[') {
            if (depth !== 0) throw new NarrationContractError('TTS_DIRECTIONS_UNBALANCED', 'As direções de voz possuem colchetes aninhados ou não balanceados.');
            depth = 1;
            opening = index;
            continue;
        }
        if (char === ']' && depth === 0) {
            plainIndex += 1;
            continue;
        }
        if (char === ']') {
            if (depth !== 1 || opening < 0) throw new NarrationContractError('TTS_DIRECTIONS_UNBALANCED', 'As direções de voz possuem colchetes não balanceados.');
            const direction = value.slice(opening + 1, index).trim();
            const validDirection = opsDialect
                ? direction.length >= 1 && direction.length <= 240 && !/[\[\]\r\n]/u.test(direction)
                : NATURAL_DIRECTION.test(direction);
            if (!validDirection) {
                throw new NarrationContractError('TTS_DIRECTION_INVALID', 'Use direções curtas em inglês, com letras, espaços e hífen, sempre entre colchetes.');
            }
            result.push({ value: direction, index: opening, end: index + 1, plainIndex });
            depth = 0;
            opening = -1;
            continue;
        }
        if (depth === 0) plainIndex += 1;
    }
    if (depth !== 0) throw new NarrationContractError('TTS_DIRECTIONS_UNBALANCED', 'As direções de voz possuem colchetes não balanceados.');
    for (const direction of result) {
        let following = value.slice(direction.end);
        // Permite uma pequena sequencia de instrucoes (ex.: pausa + emocao),
        // mas toda sequencia precisa controlar texto falavel imediatamente.
        const nextDirection = opsDialect
            ? /^\s*\[[^\[\]\r\n]{1,240}\]/u
            : /^\s*\[[a-z][a-z' -]{0,63}\]/;
        while (nextDirection.test(following)) {
            following = following.replace(nextDirection, '');
        }
        if (!/^[\s"'“”‘’(\-—]*[\p{L}\p{N}]/u.test(following)) {
            throw new NarrationContractError(
                'TTS_DIRECTION_WITHOUT_TARGET',
                'Toda direcao de voz deve aparecer imediatamente antes do trecho que controla.',
            );
        }
    }
    return result;
};

export const stripFishDirections = (
    value: string,
    dialect: NarrationDialect = LOCAL_NARRATION_DIALECT,
): string => String(value || '')
    .replace(dialect === OPS_NARRATION_DIALECT ? OPS_DIRECTION_PATTERN : DIRECTION_PATTERN, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const protectedRanges = (plainText: string, protectedTerms: string[]): Array<[number, number]> => {
    const ranges: Array<[number, number]> = [];
    const patterns = [
        /R\$\s*[\d.]+(?:,\d{1,2})?/giu,
        /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/g,
        /\b(?:Rua|Avenida|Av\.?|Alameda|Travessa|Rodovia|Estrada|Praça)(?:\s+[\p{L}\d.'-]+){1,8}(?:,?\s*\d+[\p{L}]?)?/giu,
    ];
    for (const pattern of patterns) {
        for (const match of plainText.matchAll(pattern)) ranges.push([match.index || 0, (match.index || 0) + match[0].length]);
    }
    for (const term of protectedTerms) {
        const words = term.trim().split(SPACE).filter(Boolean).map(escapeRegex);
        if (!words.length) continue;
        const pattern = new RegExp(words.join('\\s+'), 'giu');
        for (const match of plainText.matchAll(pattern)) ranges.push([match.index || 0, (match.index || 0) + match[0].length]);
    }
    return ranges;
};

const validateDirectionPlacement = (
    synthesisText: string,
    directions: ReturnType<typeof parseDirections>,
    terms: string[],
    dialect: NarrationDialect,
) => {
    const plainText = synthesisText.replace(
        dialect === OPS_NARRATION_DIALECT ? OPS_DIRECTION_PATTERN : DIRECTION_PATTERN,
        '',
    );
    const ranges = protectedRanges(plainText, terms);
    const invalid = directions.find((direction) => ranges.some(([start, end]) => direction.plainIndex > start && direction.plainIndex < end));
    if (invalid) {
        throw new NarrationContractError(
            'TTS_DIRECTION_INSIDE_PROTECTED_TEXT',
            'Uma direção de voz está dentro de um preço, telefone, nome ou endereço. Mova-a para antes do trecho completo.',
        );
    }

    // Nomes proprios sem um ID estruturado ainda precisam de uma barreira
    // conservadora. Ex.: `Otica [emphasis] Reis` nao pode ser fragmentado.
    const tag = dialect === OPS_NARRATION_DIALECT
        ? String.raw`\[[^\[\]\r\n]{1,240}\]`
        : String.raw`\[[a-z][a-z' -]{0,63}\]`;
    const directionInsideName = new RegExp(
        String.raw`\b\p{Lu}[\p{L}'-]+\s+${tag}\s+\p{Lu}[\p{L}'-]+`,
        'u',
    );
    if (directionInsideName.test(synthesisText)) {
        throw new NarrationContractError(
            'TTS_DIRECTION_INSIDE_PROTECTED_TEXT',
            'Uma direcao de voz esta dentro de um nome. Mova-a para antes do nome completo.',
        );
    }
    const directionImmediatelyInsideAddress = new RegExp(
        String.raw`\b(?:Rua|Avenida|Av\.?|Alameda|Travessa|Rodovia|Estrada|Praca)\s+${tag}`,
        'iu',
    );
    if (directionImmediatelyInsideAddress.test(synthesisText)) {
        throw new NarrationContractError(
            'TTS_DIRECTION_INSIDE_PROTECTED_TEXT',
            'Uma direcao de voz esta dentro de um endereco. Mova-a para antes do endereco completo.',
        );
    }
};

const addAutomaticDirections = (plainText: string): string => {
    const sentences = plainText.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [plainText];
    const content = sentences.map((sentence, index) => sentence.trim() ? index : -1).filter((index) => index >= 0);
    if (!content.length) return plainText;
    const inject = (index: number, direction: string) => {
        const leading = sentences[index].match(/^\s*/)?.[0] || '';
        sentences[index] = `${leading}[${direction}] ${sentences[index].slice(leading.length)}`;
    };
    const vocabulary = [
        'curious and inviting',
        'clear and informative',
        'confident',
        'warm and reassuring',
        'confident and inviting',
    ];
    const targetCount = Math.min(5, content.length);
    const selected = targetCount === 1
        ? [content[0]]
        : Array.from({ length: targetCount }, (_, slot) =>
            content[Math.round((slot * (content.length - 1)) / (targetCount - 1))]
        );
    selected.forEach((sentenceIndex, slot) => inject(sentenceIndex, vocabulary[slot]));
    return sentences.join('');
};

const resolveMode = (raw: unknown, structured: boolean): NarrationDirectionMode => {
    if (raw === 'automatic' || raw === 'manual' || raw === 'clean') return raw;
    if (raw !== undefined && raw !== null && raw !== '') {
        throw new NarrationContractError(
            'TTS_DIRECTION_MODE_INVALID',
            'O modo de direcao deve ser automatic, manual ou clean.',
        );
    }
    return structured ? 'automatic' : 'manual';
};

const resolveNarrationDialect = (raw: unknown): NarrationDialect => {
    if (raw === undefined || raw === null || raw === '' || raw === LOCAL_NARRATION_DIALECT) {
        return LOCAL_NARRATION_DIALECT;
    }
    if (raw === OPS_NARRATION_DIALECT) return OPS_NARRATION_DIALECT;
    throw new NarrationContractError(
        'TTS_NARRATION_DIALECT_INVALID',
        `O dialeto de narracao solicitado (${String(raw).slice(0, 64)}) nao e suportado.`,
    );
};

const resolveModel = (provider: TtsProvider, topLevel: unknown, settingsModel: unknown): string => {
    const hasTopLevel = topLevel !== undefined && topLevel !== null && topLevel !== '';
    const hasSettings = settingsModel !== undefined && settingsModel !== null && settingsModel !== '';
    if (provider === 'elevenLabs') {
        const expected = 'eleven_multilingual_v2';
        const requested = hasTopLevel ? topLevel : hasSettings ? settingsModel : expected;
        if (requested !== expected) {
            throw new NarrationContractError(
                'TTS_MODEL_UNAVAILABLE',
                `O modelo ElevenLabs solicitado (${String(requested).slice(0, 40)}) nao esta disponivel.`,
            );
        }
        if (hasTopLevel && hasSettings && topLevel !== settingsModel) {
            throw new NarrationContractError('TTS_MODEL_CONFLICT', 'O projeto enviou dois modelos de voz diferentes.');
        }
        return expected;
    }
    if (hasTopLevel && !isFishModel(topLevel)) {
        throw new NarrationContractError('TTS_MODEL_UNAVAILABLE', `O modelo Fish Audio solicitado (${String(topLevel).slice(0, 40)}) não está disponível.`);
    }
    if (hasSettings && !isFishModel(settingsModel)) {
        throw new NarrationContractError('TTS_MODEL_UNAVAILABLE', `O modelo Fish Audio solicitado (${String(settingsModel).slice(0, 40)}) não está disponível.`);
    }
    if (hasTopLevel && hasSettings && topLevel !== settingsModel) {
        throw new NarrationContractError('TTS_MODEL_CONFLICT', 'O projeto enviou dois modelos de voz diferentes. Selecione novamente o modelo antes de gerar.');
    }
    return (hasTopLevel ? topLevel : hasSettings ? settingsModel : DEFAULT_FISH_MODEL) as FishModel;
};

export const prepareNarrationContract = (input: NarrationContractInput): PreparedNarrationContract => {
    const legacyText = safeText(input.legacyText);
    const structured = input.structured === true
        || input.narrationPlainText !== undefined
        || input.narrationSynthesisText !== undefined
        || input.directionMode !== undefined;
    const model = resolveModel(input.provider, input.ttsModel, input.voiceSettingsModel);
    const narrationDialect = resolveNarrationDialect(input.narrationDialect);
    let mode = resolveMode(input.directionMode, structured);
    const rawSourceSynthesis = safeText(input.narrationSynthesisText) || legacyText || safeText(input.narrationPlainText);
    const sourceSynthesis = narrationDialect === OPS_NARRATION_DIALECT
        ? rawSourceSynthesis.normalize('NFKC')
        : rawSourceSynthesis;
    const requestedPlainText = safeText(input.narrationPlainText);
    let plainText = (narrationDialect === OPS_NARRATION_DIALECT
        ? requestedPlainText.normalize('NFKC')
        : requestedPlainText) || stripFishDirections(sourceSynthesis, narrationDialect);
    if (!plainText) throw new NarrationContractError('TTS_NARRATION_EMPTY', 'A narração está vazia ou contém apenas direções de voz.');

    let synthesisText = removeOrphanDirections(sourceSynthesis || plainText, narrationDialect);
    if (input.provider !== 'fishAudio' || model === 's1' || mode === 'clean') {
        // Provedores/modelos incompatíveis nunca recebem instrucoes Fish.
        mode = 'clean';
        synthesisText = stripFishDirections(synthesisText || plainText, narrationDialect);
    }

    const beforeDirections = parseDirections(synthesisText, narrationDialect);
    if (comparable(stripFishDirections(synthesisText, narrationDialect)) !== comparable(plainText)) {
        throw new NarrationContractError('TTS_TEXT_MISMATCH', 'O texto limpo e o texto de síntese não representam a mesma narração.');
    }
    // Alguns projetos S2.1 Pro foram persistidos como `manual` apesar de nao
    // terem nenhuma direcao manual. Normalize esse estado legado antes de
    // preparar a fala, sem alterar uma escolha explicita por `clean`.
    if (input.provider === 'fishAudio' && model === 's2.1-pro' && mode === 'manual' && !beforeDirections.length) {
        mode = 'automatic';
    }
    if (input.provider === 'fishAudio' && model === 's2.1-pro' && mode === 'automatic' && !beforeDirections.length) {
        synthesisText = addAutomaticDirections(plainText);
    }

    const directions = parseDirections(synthesisText, narrationDialect);
    if (input.provider === 'fishAudio' && model === 's2.1-pro' && mode === 'automatic' && !directions.length) {
        throw new NarrationContractError('TTS_AUTOMATIC_DIRECTION_MISSING', 'A direção automática não conseguiu preparar a interpretação da narração.');
    }
    if (!stripFishDirections(synthesisText, narrationDialect).match(/[\p{L}\p{N}]/u)) {
        throw new NarrationContractError('TTS_NARRATION_TAGS_ONLY', 'A narração não pode ser composta apenas por direções de voz.');
    }

    const terms = Array.isArray(input.protectedTerms)
        ? input.protectedTerms.filter((value): value is string => typeof value === 'string' && value.trim().length >= 2).slice(0, 20)
        : [];
    validateDirectionPlacement(synthesisText, directions, terms, narrationDialect);
    plainText = displayText(plainText);
    const finalSynthesis = input.provider === 'fishAudio'
        ? prepareSpokenTextPreservingEditorialBrackets(synthesisText).trim()
        : synthesisText.trim();

    const requestedVersion = safeText(input.directionVersion);
    if (requestedVersion && requestedVersion !== FISH_DIRECTION_CONTRACT_VERSION) {
        throw new NarrationContractError(
            'TTS_DIRECTION_VERSION_INVALID',
            `A versao do contrato de direcao (${requestedVersion.slice(0, 64)}) nao e suportada.`,
        );
    }
    const directionVersion = requestedVersion || FISH_DIRECTION_CONTRACT_VERSION;

    return {
        narrationPlainText: plainText,
        narrationSynthesisText: finalSynthesis,
        ttsModel: model,
        directionMode: mode,
        directionVersion,
        narrationDialect,
        directions: directions.map((direction) => direction.value),
        protectedTerms: terms,
    };
};
