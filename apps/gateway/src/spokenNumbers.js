// Conversão determinística de números para texto falável em português do Brasil.
const SMALL = 'zero|um|dois|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze'.split('|');
SMALL.push('dezesseis', 'dezessete', 'dezoito', 'dezenove');
const TENS = '||vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa'.split('|');
const HUNDREDS = '||duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos'.split('|');
HUNDREDS.push('oitocentos', 'novecentos');
const DIGITS = 'zero|um|dois|três|quatro|cinco|seis|sete|oito|nove'.split('|');
const MONTHS = 'janeiro|fevereiro|março|abril|maio|junho|julho|agosto'.split('|');
MONTHS.push('setembro', 'outubro', 'novembro', 'dezembro');

const underThousand = (value) => {
    if (value < 20) return SMALL[value];
    if (value < 100) {
        const unit = value % 10;
        return TENS[Math.floor(value / 10)] + (unit ? ' e ' + SMALL[unit] : '');
    }
    if (value === 100) return 'cem';
    const remainder = value % 100;
    return (value < 200 ? 'cento' : HUNDREDS[Math.floor(value / 100)])
        + (remainder ? ' e ' + underThousand(remainder) : '');
};

const joinScale = (prefix, remainder) => {
    if (!remainder) return prefix;
    const connector = remainder < 100 || remainder % 100 === 0 ? ' e ' : ' ';
    return prefix + connector + integerToWords(remainder);
};

const integerToWords = (value) => {
    const number = Math.trunc(Number(value));
    if (!Number.isSafeInteger(number) || number < 0) return String(value);
    if (number < 1000) return underThousand(number);
    if (number < 1000000) {
        const scale = Math.floor(number / 1000);
        const prefix = scale === 1 ? 'mil' : integerToWords(scale) + ' mil';
        return joinScale(prefix, number % 1000);
    }
    if (number < 1000000000) {
        const scale = Math.floor(number / 1000000);
        const prefix = scale === 1 ? 'um milhão' : integerToWords(scale) + ' milhões';
        return joinScale(prefix, number % 1000000);
    }
    return String(number).split('').map((digit) => DIGITS[Number(digit)]).join(' ');
};

const digitsToWords = (value) => String(value).split('').map((digit) => DIGITS[Number(digit)]).join(' ');
const rawIntegerToWords = (raw) => {
    const normalized = String(raw).replace(/\./g, '');
    if (/^0\d/.test(normalized) || normalized.length >= 7) return digitsToWords(normalized);
    return integerToWords(Number(normalized));
};

const currencyToWords = (_match, majorRaw, centsRaw) => {
    const major = Number(String(majorRaw).replace(/\./g, ''));
    const cents = centsRaw ? Number(String(centsRaw).padEnd(2, '0')) : 0;
    const majorWords = integerToWords(major) + (major === 1 ? ' real' : ' reais');
    if (!cents) return majorWords;
    return majorWords + ' e ' + integerToWords(cents) + (cents === 1 ? ' centavo' : ' centavos');
};

const decimalToWords = (_match, integerRaw, fractionRaw) => {
    return rawIntegerToWords(integerRaw) + ' vírgula ' + digitsToWords(fractionRaw);
};

const dateToWords = (original, dayRaw, monthRaw, yearRaw) => {
    const day = Number(dayRaw);
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    if (day < 1 || day > 31 || month < 1 || month > 12) return original;
    return integerToWords(day) + ' de ' + MONTHS[month - 1] + ' de ' + integerToWords(year);
};

export const normalizeSpokenNumbersPtBr = (value) => {
    if (typeof value !== 'string' || !/\d/.test(value)) return value;
    return value
        .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, dateToWords)
        .replace(/R\$\s*(\d+(?:\.\d{3})*)(?:,(\d{1,2}))?/gi, currencyToWords)
        .replace(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/gi, (_match, hourRaw, minuteRaw) => {
            const hour = Number(hourRaw);
            const minute = Number(minuteRaw);
            const hours = integerToWords(hour) + (hour === 1 ? ' hora' : ' horas');
            return minute ? hours + ' e ' + integerToWords(minute) + ' minutos' : hours;
        })
        .replace(/\b(\d+(?:,\d+)?)\s*%/g, (_match, numberRaw) => {
            const spoken = String(numberRaw).includes(',')
                ? String(numberRaw).replace(/^(\d+),(\d+)$/, decimalToWords)
                : rawIntegerToWords(numberRaw);
            return spoken + ' por cento';
        })
        .replace(/\b(\d+),(\d+)\b/g, decimalToWords)
        .replace(/\b\d{1,3}(?:\.\d{3})+\b/g, rawIntegerToWords)
        .replace(/\b\d+\b/g, rawIntegerToWords);
};

export { integerToWords };
