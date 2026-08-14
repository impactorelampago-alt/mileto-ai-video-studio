const OPS_DIRECTION_PATTERN = /\[[^\[\]]*\]/gu;
const OPS_BRACKET_PATTERN = /[\[\]]/u;
const OPS_WHITESPACE_PATTERN = /[\p{White_Space}\u200B\u200C\u200D\u2060\uFEFF]+/gu;
const EXCERPT_CONTEXT_BEFORE = 24;
const EXCERPT_CONTEXT_AFTER = 48;

export const OPS_NARRATION_DIALECT = 'mileto-ops-bracket-v1' as const;

/**
 * O contrato do Ops considera todo conteudo entre colchetes uma instrucao de
 * interpretacao do Fish Audio. Esta regra e propositalmente mais ampla que a
 * usada pelo editor local: no payload do Ops, colchetes nunca representam fala.
 */
export const stripOpsNarrationDirections = (value: string): string => String(value || '')
    .normalize('NFKC')
    .replace(OPS_DIRECTION_PATTERN, ' ');

export const hasOpsNarrationDirections = (value: string): boolean => {
    OPS_DIRECTION_PATTERN.lastIndex = 0;
    return OPS_DIRECTION_PATTERN.test(String(value || '').normalize('NFKC'));
};

/** Normalizacao aplicada somente ao conteudo efetivamente falado. */
export const normalizeOpsSpokenText = (value: string): string => stripOpsNarrationDirections(
    String(value || '').normalize('NFKC'),
)
    .replace(/\r\n?/g, '\n')
    .replace(OPS_WHITESPACE_PATTERN, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

const fallbackHash = (value: string): string => {
    // Electron e navegadores atuais sempre oferecem Web Crypto. O fallback
    // mantem um diagnostico deterministico em runtimes legados, sem bloquear o job.
    let hash = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(value)) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

const normalizedTextHash = async (value: string): Promise<string> => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return fallbackHash(value);
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
    const hexadecimal = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `sha256:${hexadecimal}`;
};

const firstDifferentIndex = (left: string, right: string): number => {
    const length = Math.min(left.length, right.length);
    let index = 0;
    while (index < length && left[index] === right[index]) index += 1;
    return index;
};

const boundedExcerpt = (value: string, differenceAt: number): string => {
    if (!value) return '(vazio)';
    const start = Math.max(0, differenceAt - EXCERPT_CONTEXT_BEFORE);
    const end = Math.min(value.length, differenceAt + EXCERPT_CONTEXT_AFTER);
    return `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
};

export interface OpsNarrationComparisonDiagnostic {
    matches: boolean;
    narrationHash: string;
    plainTextHash: string;
    firstDifference?: {
        index: number;
        narrationExcerpt: string;
        plainTextExcerpt: string;
    };
}

export const compareOpsNarration = async (
    narration: string,
    plainText: string,
): Promise<OpsNarrationComparisonDiagnostic> => {
    const normalizedBrackets = String(narration || '').normalize('NFKC');
    const narrationWithoutDirections = stripOpsNarrationDirections(normalizedBrackets);
    if (OPS_BRACKET_PATTERN.test(narrationWithoutDirections)) {
        const malformedHash = await normalizedTextHash(normalizeOpsSpokenText(narrationWithoutDirections));
        throw new OpsNarrationDirectionsError(malformedHash);
    }
    const normalizedNarration = normalizeOpsSpokenText(narration);
    const normalizedPlainText = normalizeOpsSpokenText(plainText);
    const [narrationHash, plainTextHash] = await Promise.all([
        normalizedTextHash(normalizedNarration),
        normalizedTextHash(normalizedPlainText),
    ]);

    if (normalizedNarration === normalizedPlainText) {
        return { matches: true, narrationHash, plainTextHash };
    }

    const index = firstDifferentIndex(normalizedNarration, normalizedPlainText);
    return {
        matches: false,
        narrationHash,
        plainTextHash,
        firstDifference: {
            index,
            narrationExcerpt: boundedExcerpt(normalizedNarration, index),
            plainTextExcerpt: boundedExcerpt(normalizedPlainText, index),
        },
    };
};

export class OpsNarrationDirectionsError extends Error {
    readonly code = 'ops_narration_directions_invalid';
    readonly phase = 'narration_contract';
    readonly retryable = false;

    constructor(normalizedHash: string) {
        super(
            'A narracao enviada pelo Mileto Ops possui colchetes de direcao desbalanceados. '
            + `Hash normalizado: narration=${normalizedHash}.`,
        );
        this.name = 'OpsNarrationDirectionsError';
    }
}

export class OpsNarrationContractError extends Error {
    readonly code = 'ops_narration_text_mismatch';
    readonly phase = 'narration_contract';
    readonly retryable = false;
    readonly diagnostic: OpsNarrationComparisonDiagnostic;

    constructor(diagnostic: OpsNarrationComparisonDiagnostic) {
        const difference = diagnostic.firstDifference;
        const detail = difference
            ? `Primeiro trecho diferente no caractere ${difference.index}: narration=${JSON.stringify(difference.narrationExcerpt)}; plainText=${JSON.stringify(difference.plainTextExcerpt)}.`
            : 'O conteudo falado normalizado e diferente.';
        super(
            `A narracao enviada pelo Mileto Ops nao corresponde ao texto falado de referencia. ${detail} `
            + `Hashes normalizados: narration=${diagnostic.narrationHash}; plainText=${diagnostic.plainTextHash}.`,
        );
        this.name = 'OpsNarrationContractError';
        this.diagnostic = diagnostic;
    }
}

export const assertOpsNarrationMatchesPlainText = async (
    narration: string,
    plainText: string,
): Promise<OpsNarrationComparisonDiagnostic> => {
    const diagnostic = await compareOpsNarration(narration, plainText);
    if (!diagnostic.matches) throw new OpsNarrationContractError(diagnostic);
    return diagnostic;
};
