import type { CustomVoice } from '../types';
import type { SystemVoice } from './systemVoices';

export const NARRATOR_VOICE_CONTEXT_MAX_ITEMS = 30;
export const NARRATOR_VOICE_CONTEXT_MAX_BYTES = 8 * 1024;
export const NARRATOR_SELECTED_VOICE_STORAGE_KEY = 'mileto_narrator_selected_voice_v1';

const CUSTOM_KEY_PATTERN = /^mv-custom-[a-z0-9-]{8,64}$/i;
const SYSTEM_KEY_PATTERN = /^mv-system-[a-z0-9-]{1,32}$/i;
const GENERIC_DESCRIPTIONS = new Set([
    '',
    'personalizada',
    'voz personalizada',
    'custom voice',
]);

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

const normalizeText = (value: unknown, maxLength: number): string => String(value ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export const isRecommendableVoiceDescription = (value: unknown): boolean => {
    const normalized = normalizeText(value, 240);
    return normalized.length >= 8 && !GENERIC_DESCRIPTIONS.has(normalized.toLocaleLowerCase('pt-BR'));
};

export const createCustomVoiceCatalogKey = (): string => {
    const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    return `mv-custom-${uuid}`;
};

const validCustomKey = (value: unknown): value is string =>
    typeof value === 'string' && CUSTOM_KEY_PATTERN.test(value);

export const normalizeCustomVoiceForStorage = (
    voice: CustomVoice,
    keyFactory: () => string = createCustomVoiceCatalogKey,
): CustomVoice => {
    const description = normalizeText(voice.description, 240);
    const ready = isRecommendableVoiceDescription(description);
    return {
        ...voice,
        name: normalizeText(voice.name, 80),
        description,
        provider: voice.provider ?? 'fishAudio',
        catalogKey: validCustomKey(voice.catalogKey) ? voice.catalogKey : keyFactory(),
        recommendationStatus: ready ? 'ready' : 'description_required',
    };
};

export const migrateCustomVoices = (
    input: unknown,
    keyFactory: () => string = createCustomVoiceCatalogKey,
): { voices: CustomVoice[]; changed: boolean } => {
    if (!Array.isArray(input)) return { voices: [], changed: input !== undefined && input !== null };
    const voices = input.map((item) => normalizeCustomVoiceForStorage(
        item && typeof item === 'object' ? item as CustomVoice : { id: '', name: '' },
        keyFactory,
    ));
    return { voices, changed: JSON.stringify(voices) !== JSON.stringify(input) };
};

const pushWithinLimit = (
    target: NarratorVoiceContextEntry[],
    candidate: NarratorVoiceContextEntry,
): boolean => {
    if (target.length >= NARRATOR_VOICE_CONTEXT_MAX_ITEMS) return false;
    const next = { version: 1 as const, voices: [...target, candidate] };
    if (byteLength(JSON.stringify(next)) > NARRATOR_VOICE_CONTEXT_MAX_BYTES) return false;
    target.push(candidate);
    return true;
};

/**
 * Gera apenas metadados editoriais seguros. IDs de Fish/ElevenLabs, presets,
 * credenciais e trilhas nunca atravessam a fronteira do Chat.
 */
export const buildNarratorVoiceContext = (
    systemVoices: readonly SystemVoice[],
    customVoices: readonly CustomVoice[],
    selectedVoiceId?: string | null,
): NarratorVoiceContext => {
    const voices: NarratorVoiceContextEntry[] = [];
    const seenKeys = new Set<string>();
    const systemVoiceIds = new Set(systemVoices.map((voice) => voice.id));

    for (const voice of systemVoices) {
        const key = SYSTEM_KEY_PATTERN.test(voice.catalogKey) ? voice.catalogKey : '';
        const name = normalizeText(voice.name, 80);
        const description = normalizeText(voice.desc, 240);
        if (!key || !name || !description || seenKeys.has(key)) continue;
        if (!pushWithinLimit(voices, {
            key,
            name,
            description,
            selected: voice.id === selectedVoiceId,
        })) break;
        seenKeys.add(key);
    }

    for (const rawVoice of customVoices) {
        // Migrações antigas podiam deixar uma cópia local de uma voz que
        // depois passou a acompanhar o produto. O seletor já oculta essas cópias.
        if (systemVoiceIds.has(rawVoice.id)) continue;
        const voice = normalizeCustomVoiceForStorage(rawVoice);
        const key = voice.catalogKey || '';
        if (
            voice.recommendationStatus !== 'ready'
            || !validCustomKey(key)
            || !voice.name
            || !isRecommendableVoiceDescription(voice.description)
            || seenKeys.has(key)
        ) continue;
        if (!pushWithinLimit(voices, {
            key,
            name: normalizeText(voice.name, 80),
            description: normalizeText(voice.description, 240),
            selected: voice.id === selectedVoiceId,
        })) break;
        seenKeys.add(key);
    }

    return { version: 1, voices };
};

/** Lê um snapshot novo em todo envio; alterações no cadastro entram no Chat sem reiniciar a conversa. */
export const readNarratorVoiceContext = (
    systemVoices: readonly SystemVoice[],
): NarratorVoiceContext => {
    if (typeof localStorage === 'undefined') {
        return buildNarratorVoiceContext(systemVoices, [], null);
    }
    try {
        const raw = localStorage.getItem('mileto_custom_voices');
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        const migrated = migrateCustomVoices(parsed);
        if (migrated.changed) {
            localStorage.setItem('mileto_custom_voices', JSON.stringify(migrated.voices));
        }
        const selectedVoiceId = localStorage.getItem(NARRATOR_SELECTED_VOICE_STORAGE_KEY);
        return buildNarratorVoiceContext(systemVoices, migrated.voices, selectedVoiceId);
    } catch {
        return buildNarratorVoiceContext(systemVoices, [], null);
    }
};
