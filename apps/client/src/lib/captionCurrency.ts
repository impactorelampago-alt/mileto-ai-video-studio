import type { CaptionSegment, CaptionWord } from '../types';

const normalize = (value: string) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '');

const formatCurrency = (majorRaw: string, centsRaw = '') => {
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

const repairWords = (words: CaptionWord[]): { words: CaptionWord[]; changed: boolean } => {
    const repaired: CaptionWord[] = [];
    let changed = false;

    for (let index = 0; index < words.length;) {
        const marker = normalize(words[index].text);
        const nextText = words[index + 1]?.text?.trim() || '';
        if ((marker === 'r' || marker === 'rs') && /^\d[\d.,]*$/.test(nextText)) {
            const embeddedCents = nextText.match(/[,.](\d{1,2})$/)?.[1] || '';
            const majorParts = [nextText.replace(/[,.]\d{1,2}$/, '')];
            let lastIndex = index + 1;
            let centsRaw = embeddedCents;

            if (!embeddedCents) {
                let cursor = index + 2;
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

            const currency = formatCurrency(majorParts.join(''), centsRaw);
            if (currency) {
                repaired.push({
                    text: currency,
                    start: words[index].start,
                    end: words[lastIndex].end,
                });
                changed = true;
                index = lastIndex + 1;
                continue;
            }
        }

        repaired.push(words[index]);
        index++;
    }

    return { words: repaired, changed };
};

/** Corrige projetos gerados antes da reconciliação monetária sem refazer o STT. */
export const repairCaptionCurrencySegments = (segments: CaptionSegment[]): CaptionSegment[] => {
    let changed = false;
    const repaired = segments.map((segment) => {
        const result = repairWords(segment.words || []);
        if (!result.changed) return segment;
        changed = true;
        return {
            ...segment,
            text: result.words.map((word) => word.text).join(' '),
            words: result.words,
        };
    });
    return changed ? repaired : segments;
};
