export interface NarratorVoiceContextEntry {
    key: string;
    name: string;
    description: string;
    selected: boolean;
}

export interface NarratorVoiceContext {
    version: 1;
    voices: NarratorVoiceContextEntry[];
}

const MAX_ITEMS = 30;
const MAX_BYTES = 8 * 1024;
const SAFE_KEY = /^mv-(?:system|custom)-[a-z0-9-]{1,71}$/i;

const cleanText = (value: unknown, max: number): string => typeof value === 'string'
    ? value.normalize('NFC')
        .replace(/[\p{Cc}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

/** Segunda barreira antes do gateway. Campos desconhecidos e IDs sem prefixo opaco são descartados. */
export const normalizeNarratorVoiceContext = (raw: unknown): NarratorVoiceContext | undefined => {
    if (
        !raw
        || typeof raw !== 'object'
        || (raw as { version?: unknown }).version !== 1
        || !Array.isArray((raw as { voices?: unknown }).voices)
    ) return undefined;
    const voices: NarratorVoiceContextEntry[] = [];
    const seen = new Set<string>();
    for (const item of (raw as { voices: unknown[] }).voices.slice(0, MAX_ITEMS)) {
        if (!item || typeof item !== 'object') continue;
        const source = item as Record<string, unknown>;
        const key = cleanText(source.key, 80);
        const name = cleanText(source.name, 80);
        const description = cleanText(source.description, 240);
        if (!SAFE_KEY.test(key) || !name || !description || seen.has(key)) continue;
        const candidate = { key, name, description, selected: source.selected === true };
        const next = { version: 1 as const, voices: [...voices, candidate] };
        if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_BYTES) break;
        voices.push(candidate);
        seen.add(key);
    }
    return voices.length ? { version: 1, voices } : undefined;
};
