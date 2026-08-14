// Preparacao deterministica do texto efetivamente enviado ao TTS. Esta copia
// local evita que o gateway transforme o texto depois que o aplicativo ja
// mostrou ao usuario a versao de sintese.
const SMALL = 'zero|um|dois|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze'.split('|');
SMALL.push('dezesseis', 'dezessete', 'dezoito', 'dezenove');
const TENS = '||vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa'.split('|');
const HUNDREDS = '||duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos'.split('|');
HUNDREDS.push('oitocentos', 'novecentos');
const DIGITS = 'zero|um|dois|três|quatro|cinco|seis|sete|oito|nove'.split('|');
const MONTHS = 'janeiro|fevereiro|março|abril|maio|junho|julho|agosto'.split('|');
MONTHS.push('setembro', 'outubro', 'novembro', 'dezembro');

const underThousand = (value: number): string => {
    if (value < 20) return SMALL[value];
    if (value < 100) {
        const unit = value % 10;
        return TENS[Math.floor(value / 10)] + (unit ? ` e ${SMALL[unit]}` : '');
    }
    if (value === 100) return 'cem';
    const remainder = value % 100;
    return (value < 200 ? 'cento' : HUNDREDS[Math.floor(value / 100)])
        + (remainder ? ` e ${underThousand(remainder)}` : '');
};

const integerToWords = (raw: number): string => {
    const value = Math.trunc(Number(raw));
    if (!Number.isSafeInteger(value) || value < 0) return String(raw);
    if (value < 1000) return underThousand(value);
    if (value < 1_000_000) {
        const scale = Math.floor(value / 1000);
        const prefix = scale === 1 ? 'mil' : `${integerToWords(scale)} mil`;
        const remainder = value % 1000;
        return remainder
            ? `${prefix}${remainder < 100 || remainder % 100 === 0 ? ' e ' : ' '}${integerToWords(remainder)}`
            : prefix;
    }
    if (value < 1_000_000_000) {
        const scale = Math.floor(value / 1_000_000);
        const prefix = scale === 1 ? 'um milhão' : `${integerToWords(scale)} milhões`;
        const remainder = value % 1_000_000;
        return remainder
            ? `${prefix}${remainder < 100 || remainder % 100 === 0 ? ' e ' : ' '}${integerToWords(remainder)}`
            : prefix;
    }
    return String(value).split('').map((digit) => DIGITS[Number(digit)]).join(' ');
};

const digitsToWords = (value: string): string =>
    String(value).split('').map((digit) => DIGITS[Number(digit)]).join(' ');

const rawIntegerToWords = (raw: string): string => {
    const normalized = String(raw).replace(/\./g, '');
    return /^0\d/.test(normalized) || normalized.length >= 7
        ? digitsToWords(normalized)
        : integerToWords(Number(normalized));
};

export const normalizeSpokenNumbersPtBr = (value: string): string => {
    if (typeof value !== 'string' || !/\d/.test(value)) return value;
    return value
        .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, (original, dayRaw, monthRaw, yearRaw) => {
            const day = Number(dayRaw);
            const month = Number(monthRaw);
            const year = Number(yearRaw);
            if (day < 1 || day > 31 || month < 1 || month > 12) return original;
            return `${integerToWords(day)} de ${MONTHS[month - 1]} de ${integerToWords(year)}`;
        })
        .replace(/R\$\s*(\d+(?:\.\d{3})*)(?:,(\d{1,2}))?/gi, (_match, majorRaw, centsRaw) => {
            const major = Number(String(majorRaw).replace(/\./g, ''));
            const cents = centsRaw ? Number(String(centsRaw).padEnd(2, '0')) : 0;
            const majorWords = `${integerToWords(major)} ${major === 1 ? 'real' : 'reais'}`;
            return cents
                ? `${majorWords} e ${integerToWords(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`
                : majorWords;
        })
        .replace(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/gi, (_match, hourRaw, minuteRaw) => {
            const hour = Number(hourRaw);
            const minute = Number(minuteRaw);
            const hours = `${integerToWords(hour)} ${hour === 1 ? 'hora' : 'horas'}`;
            return minute ? `${hours} e ${integerToWords(minute)} minutos` : hours;
        })
        .replace(/\b(\d+(?:,\d+)?)\s*%/g, (_match, numberRaw) => {
            const spoken = String(numberRaw).includes(',')
                ? String(numberRaw).replace(/^(\d+),(\d+)$/, (_all, integer, fraction) => `${rawIntegerToWords(integer)} vírgula ${digitsToWords(fraction)}`)
                : rawIntegerToWords(numberRaw);
            return `${spoken} por cento`;
        })
        .replace(/\b(\d+),(\d+)\b/g, (_match, integer, fraction) => `${rawIntegerToWords(integer)} vírgula ${digitsToWords(fraction)}`)
        .replace(/\b\d{1,3}(?:\.\d{3})+\b/g, rawIntegerToWords)
        .replace(/\b\d+\b/g, rawIntegerToWords);
};

const PT_BR_PRONUNCIATION_RULES = [
    { pattern: /\bAraçariguama\b/giu, replacement: 'Araçari-guama' },
];

export const normalizeSpokenPronunciationPtBr = (value: string): string =>
    PT_BR_PRONUNCIATION_RULES.reduce((text, rule) => text.replace(rule.pattern, rule.replacement), value);

export const prepareSpokenTextPtBr = (value: string): string =>
    normalizeSpokenPronunciationPtBr(normalizeSpokenNumbersPtBr(value));
