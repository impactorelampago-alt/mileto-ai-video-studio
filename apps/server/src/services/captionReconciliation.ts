export type TranscriptWord = {
    word: string;
    start: number;
    end: number;
};

export type CaptionWord = {
    text: string;
    start: number;
    end: number;
};

export type CaptionReview = {
    sourceApplied: boolean;
    correctedWords: number;
    formattedValues: number;
};

export type CaptionReconciliationResult = {
    words: CaptionWord[];
    review: CaptionReview;
};

const NUMBER_WORDS: Record<string, number> = {
    zero: 0,
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
    treze: 13,
    quatorze: 14,
    catorze: 14,
    quinze: 15,
    dezesseis: 16,
    dezassete: 17,
    dezessete: 17,
    dezoito: 18,
    dezenove: 19,
    vinte: 20,
    trinta: 30,
    quarenta: 40,
    cinquenta: 50,
    sessenta: 60,
    setenta: 70,
    oitenta: 80,
    noventa: 90,
    cem: 100,
    cento: 100,
    duzentos: 200,
    duzentas: 200,
    trezentos: 300,
    trezentas: 300,
    quatrocentos: 400,
    quatrocentas: 400,
    quinhentos: 500,
    quinhentas: 500,
    seiscentos: 600,
    seiscentas: 600,
    setecentos: 700,
    setecentas: 700,
    oitocentos: 800,
    oitocentas: 800,
    novecentos: 900,
    novecentas: 900,
};

const normalize = (value: string): string =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

// S2.1 Pro aceita instrucoes naturais em ingles, nao apenas uma allowlist.
// Legendas e titulos usam sempre o texto humano, portanto toda direcao natural
// valida deve ser retirada antes da reconciliacao (sem remover colchetes comuns
// que nao tenham o formato de uma direcao Fish).
const stripFishAudioTags = (value: string): string =>
    String(value || '').replace(/\[[a-z][a-z' -]{0,63}\]/g, ' ');

const sourceTokensFromNarration = (narrationText: string): string[] =>
    // Símbolos precisam vir antes da alternativa genérica de letras. Caso
    // contrário, `R$ 199,00` é tokenizado como `R`, `199,00` e perdemos o `$`.
    stripFishAudioTags(narrationText).match(/R\$|%|[\p{L}\p{N}]+(?:[.,][\p{N}]+)?/gu) || [];

const formatPtBrCurrency = (majorRaw: string, centsRaw = ''): string | null => {
    const majorDigits = String(majorRaw).replace(/\D/g, '');
    if (!majorDigits) return null;
    const major = Number(majorDigits);
    const cents = centsRaw ? Number(String(centsRaw).replace(/\D/g, '').padEnd(2, '0').slice(0, 2)) : 0;
    if (!Number.isSafeInteger(major) || !Number.isInteger(cents)) return null;
    return `R$ ${(major + cents / 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
};

const currencyValuesFromNarration = (narrationText: string): string[] =>
    Array.from(stripFishAudioTags(narrationText).matchAll(/R\$\s*(\d+(?:\.\d{3})*)(?:,(\d{1,2}))?/giu))
        .map((match) => formatPtBrCurrency(match[1], match[2]))
        .filter((value): value is string => Boolean(value));

const currencyLiteral = (value: string): string | null => {
    const match = String(value || '').trim().match(/^R\s*\$?\s*(\d+(?:\.\d{3})*)(?:,(\d{1,2}))?$/iu);
    return match ? formatPtBrCurrency(match[1], match[2]) : null;
};

const levenshteinDistance = (left: string, right: string): number => {
    if (left === right) return 0;
    if (!left) return right.length;
    if (!right) return left.length;

    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
            );
        }
        previous = current;
    }
    return previous[right.length];
};

const similarity = (left: string, right: string): number => {
    const a = normalize(left);
    const b = normalize(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    return 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length);
};

const findSourceToken = (transcriptWord: string, tokens: string[], startIndex: number) => {
    const transcriptKey = normalize(transcriptWord);
    if (!transcriptKey) return null;

    let best: { index: number; score: number } | null = null;
    const endIndex = Math.min(tokens.length, startIndex + 12);

    for (let index = startIndex; index < endIndex; index++) {
        const tokenKey = normalize(tokens[index]);
        if (!tokenKey) continue;
        const score = similarity(transcriptKey, tokenKey);
        if (score === 1) return { index, score };
        if (!best || score > best.score) best = { index, score };
    }

    if (!best) return null;
    // Nomes de cidade costumam sofrer trocas fonéticas no STT (ex.:
    // "Terasikaba" -> "Piracicaba"). Para palavras longas, o próprio
    // alinhamento sequencial do roteiro permite uma tolerância maior.
    const minScore = transcriptKey.length >= 8 ? 0.58 : transcriptKey.length >= 5 ? 0.64 : 0.78;
    return best.score >= minScore ? best : null;
};

const parseNumberWords = (keys: string[]): number | null => {
    const meaningful = keys.filter((key) => key !== 'e');
    if (!meaningful.length || meaningful.some((key) => key !== 'mil' && NUMBER_WORDS[key] === undefined)) {
        return null;
    }

    let total = 0;
    let current = 0;
    for (const key of meaningful) {
        if (key === 'mil') {
            total += (current || 1) * 1000;
            current = 0;
        } else {
            current += NUMBER_WORDS[key];
        }
    }
    return total + current;
};

const formatCurrencyAndPercentages = (words: CaptionWord[], narrationText = '') => {
    const result: CaptionWord[] = [];
    const keys = words.map((word) => normalize(word.text));
    const sourceCurrencies = currencyValuesFromNarration(narrationText);
    let formattedValues = 0;
    let currencyIndex = 0;

    for (let index = 0; index < words.length; ) {
        // Alguns retornos do STT preservam o preço em um único token.
        const literal = currencyLiteral(words[index].text);
        if (literal) {
            result.push({
                text: sourceCurrencies[currencyIndex] || literal,
                start: words[index].start,
                end: words[index].end,
            });
            formattedValues++;
            currencyIndex++;
            index++;
            continue;
        }

        // Outros separam `R$ 199,00` em `R`, `199`, `00`. Reconstruímos um
        // único CaptionWord para que o valor não seja quebrado visualmente nem
        // perca o símbolo, mantendo o intervalo completo dos tokens originais.
        if ((keys[index] === 'r' || keys[index] === 'rs') && /^\d[\d.,]*$/.test(words[index + 1]?.text?.trim() || '')) {
            const firstNumericToken = words[index + 1].text.trim();
            const embeddedCents = firstNumericToken.match(/[,.](\d{1,2})$/)?.[1] || '';
            const majorParts = [firstNumericToken.replace(/[,.]\d{1,2}$/, '')];
            let lastIndex = index + 1;
            let centsRaw = embeddedCents;
            if (!embeddedCents) {
                let cursor = index + 2;
                // Também cobre milhares fragmentados pelo STT: `R`, `1`,
                // `999`, `90` deve resultar em `R$ 1.999,90`.
                while (/^\d{3}$/.test(words[cursor]?.text?.trim() || '')) {
                    majorParts.push(words[cursor].text.trim());
                    lastIndex = cursor;
                    cursor++;
                }
                if (/^\d{1,2}$/.test(words[cursor]?.text?.trim() || '')) {
                    centsRaw = words[cursor].text;
                    lastIndex = cursor;
                }
            }
            const reconstructed = formatPtBrCurrency(majorParts.join(''), centsRaw);
            if (reconstructed) {
                result.push({
                    text: sourceCurrencies[currencyIndex] || reconstructed,
                    start: words[index].start,
                    end: words[lastIndex].end,
                });
                formattedValues++;
                currencyIndex++;
                index = lastIndex + 1;
                continue;
            }
        }

        let currencyEnd = -1;
        const searchEnd = Math.min(words.length, index + 10);
        for (let candidate = index + 1; candidate < searchEnd; candidate++) {
            if (keys[candidate] === 'real' || keys[candidate] === 'reais') {
                currencyEnd = candidate;
                break;
            }
        }

        if (currencyEnd > index) {
            const whole = parseNumberWords(keys.slice(index, currencyEnd));
            if (whole !== null) {
                let lastIndex = currencyEnd;
                let cents = 0;
                const centsStart = currencyEnd + 1;
                if (keys[centsStart] === 'e') {
                    const centsEnd = Math.min(words.length, centsStart + 5);
                    let consumed = centsStart + 1;
                    while (
                        consumed < centsEnd &&
                        (keys[consumed] === 'centavo' ||
                            keys[consumed] === 'centavos' ||
                            keys[consumed] === 'e' ||
                            NUMBER_WORDS[keys[consumed]] !== undefined)
                    ) {
                        consumed++;
                    }
                    const centsTokens = keys.slice(centsStart + 1, consumed);
                    const hasCentsMarker = centsTokens.includes('centavo') || centsTokens.includes('centavos');
                    const parsedCents = parseNumberWords(centsTokens.filter((key) => key !== 'centavo' && key !== 'centavos'));
                    if (hasCentsMarker && parsedCents !== null && parsedCents >= 0 && parsedCents <= 99) {
                        cents = parsedCents;
                        lastIndex = consumed - 1;
                    }
                }

                const formattedCurrency = `R$ ${(whole + cents / 100).toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    })}`;
                result.push({
                    text: sourceCurrencies[currencyIndex] || formattedCurrency,
                    start: words[index].start,
                    end: words[lastIndex].end,
                });
                formattedValues++;
                currencyIndex++;
                index = lastIndex + 1;
                continue;
            }
        }

        if (keys[index + 1] === 'por' && keys[index + 2] === 'cento') {
            const value = parseNumberWords([keys[index]]);
            if (value !== null) {
                result.push({ text: `${value}%`, start: words[index].start, end: words[index + 2].end });
                formattedValues++;
                index += 3;
                continue;
            }
        }

        result.push(words[index]);
        index++;
    }

    return { words: result, formattedValues };
};

/** Keeps STT timestamps, but reconciles spelling with the narration approved in step 1. */
export const reconcileCaptionWords = (transcriptWords: TranscriptWord[], narrationText?: string): CaptionReconciliationResult => {
    const sourceTokens = sourceTokensFromNarration(narrationText || '');
    let sourceIndex = 0;
    let correctedWords = 0;

    const repairedWords = transcriptWords
        .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.word?.trim())
        .map((word) => {
            // Preserve um preço que o STT já devolveu inteiro. O alinhador é
            // palavra-a-palavra e poderia aproximar `R$199,00` apenas do token
            // `199,00` do roteiro, removendo novamente o símbolo.
            const transcriptCurrency = currencyLiteral(word.word);
            const sourceMatch = sourceTokens.length ? findSourceToken(word.word, sourceTokens, sourceIndex) : null;
            const sourceText = sourceMatch ? sourceTokens[sourceMatch.index] : null;
            if (sourceMatch) sourceIndex = sourceMatch.index + 1;
            if (sourceText && normalize(sourceText) !== normalize(word.word)) correctedWords++;

            return {
                text: (transcriptCurrency || sourceText || word.word).trim().toUpperCase(),
                start: Number(word.start.toFixed(2)),
                end: Number(word.end.toFixed(2)),
            };
        });

    const formatted = formatCurrencyAndPercentages(repairedWords, narrationText || '');
    return {
        words: formatted.words,
        review: {
            sourceApplied: sourceTokens.length > 0,
            correctedWords,
            formattedValues: formatted.formattedValues,
        },
    };
};
