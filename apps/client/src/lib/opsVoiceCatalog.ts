// Sincronização do catálogo de vozes CUSTOM do usuário com o Mileto Ops.
// O Ops é um espelho: nós somos a fonte da verdade e empurramos (PUT) o snapshot.
// As 4 vozes de sistema NÃO entram (o Ops injeta as padrão sozinho); só vozes
// custom do Fish Audio, pois o Ops sintetiza pelo voiceId real do Fish.

import type { StorageLike } from './opsLibraryCache';

export interface OpsVoiceCatalogVoice {
    voiceId: string;
    name: string;
    isCustom: boolean;
    description?: string;
}

export interface VoiceCatalogHeartbeatResponse {
    inSync?: boolean;
    needsSnapshot?: boolean;
    storedVersion?: number | null;
    receivedVersion?: number;
}

interface SyncState {
    version: number;
    contentHash: string;
}

const SYNC_STATE_KEY = 'mileto_voice_catalog_sync_v1';
const CUSTOM_VOICES_KEY = 'mileto_custom_voices';
const MAX_VOICES = 1_000;

const defaultStorage = (): StorageLike | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

// Só vozes cujo `id` é o voiceId real de síntese do Fish Audio. Vozes de outro
// provedor (ElevenLabs) o Ops não sintetiza — ficam de fora. Vozes legadas sem
// `provider` são tratadas como Fish Audio (padrão histórico do app).
const isFishCustomVoice = (voice: { provider?: unknown }) =>
    voice?.provider === 'fishAudio' || voice?.provider === undefined || voice?.provider === null;

export const buildVoiceCatalogVoices = (customVoices: unknown): OpsVoiceCatalogVoice[] => {
    const source = Array.isArray(customVoices) ? customVoices : [];
    const seen = new Set<string>();
    const voices: OpsVoiceCatalogVoice[] = [];
    for (const raw of source) {
        const voice = raw as { id?: unknown; name?: unknown; description?: unknown; provider?: unknown };
        if (!isFishCustomVoice(voice)) continue;
        const voiceId = String(voice?.id ?? '').trim();
        const name = String(voice?.name ?? '').trim();
        if (!voiceId || !name || seen.has(voiceId)) continue;
        seen.add(voiceId);
        const entry: OpsVoiceCatalogVoice = { voiceId, name, isCustom: true };
        const description = String(voice?.description ?? '').trim();
        if (description) entry.description = description;
        voices.push(entry);
        if (voices.length >= MAX_VOICES) break;
    }
    return voices;
};

// Assinatura estável e independente de ordem: reordenar vozes não conta como
// mudança e não bumpa a versão à toa.
export const voiceCatalogContentHash = (voices: OpsVoiceCatalogVoice[]): string => {
    const canonical = JSON.stringify(
        [...voices].sort((a, b) => a.voiceId.localeCompare(b.voiceId)),
    );
    let hash = 2166136261;
    for (let index = 0; index < canonical.length; index += 1) {
        hash ^= canonical.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
};

const readSyncState = (storage: StorageLike | null): SyncState => {
    if (!storage) return { version: 0, contentHash: '' };
    try {
        const raw = storage.getItem(SYNC_STATE_KEY);
        if (!raw) return { version: 0, contentHash: '' };
        const parsed = JSON.parse(raw) as Partial<SyncState> | null;
        const version = Number(parsed?.version);
        return {
            version: Number.isSafeInteger(version) && version >= 0 ? version : 0,
            contentHash: typeof parsed?.contentHash === 'string' ? parsed.contentHash : '',
        };
    } catch {
        return { version: 0, contentHash: '' };
    }
};

const writeSyncState = (storage: StorageLike | null, state: SyncState): void => {
    try {
        storage?.setItem(SYNC_STATE_KEY, JSON.stringify(state));
    } catch {
        // Melhor esforço: sem persistência, a próxima abertura recalcula.
    }
};

export const readCustomVoicesFromStorage = (storage: StorageLike | null = defaultStorage()): unknown[] => {
    if (!storage) return [];
    try {
        const raw = storage.getItem(CUSTOM_VOICES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export interface VoiceCatalogSyncDeps {
    storage?: StorageLike | null;
    readCustomVoices: () => unknown[];
    heartbeat: (catalogVersion: number) => Promise<VoiceCatalogHeartbeatResponse>;
    put: (payload: { catalogVersion: number; voices: OpsVoiceCatalogVoice[] }) => Promise<unknown>;
    /** true quando o erro é "não conectado / não vinculado" — apenas ignoramos. */
    isSkippable: (error: unknown) => boolean;
    onLog?: (message: string) => void;
}

export type VoiceCatalogSyncOutcome = 'skipped' | 'in-sync' | 'pushed' | 'unavailable';

/**
 * Empurra o snapshot quando necessário. Versão = contador inteiro por conteúdo:
 * bump +1 quando as vozes mudam (fix idempotência do Ops). O heartbeat evita PUT
 * redundante; se o Ops estiver à frente (reinstalação/divergência), reconciliamos
 * a versão para o nosso PUT vencer — somos a fonte da verdade.
 */
export const syncOpsVoiceCatalog = async (deps: VoiceCatalogSyncDeps): Promise<VoiceCatalogSyncOutcome> => {
    const storage = deps.storage !== undefined ? deps.storage : defaultStorage();
    const voices = buildVoiceCatalogVoices(deps.readCustomVoices());
    const contentHash = voiceCatalogContentHash(voices);
    const stored = readSyncState(storage);
    let catalogVersion = contentHash === stored.contentHash ? stored.version : stored.version + 1;
    if (catalogVersion < 1) catalogVersion = 1;

    let heartbeat: VoiceCatalogHeartbeatResponse | null = null;
    try {
        heartbeat = await deps.heartbeat(catalogVersion);
    } catch (error) {
        if (deps.isSkippable(error)) return 'skipped';
        // Heartbeat indisponível (mas conectado): segue para o PUT direto, que é
        // idempotente por catalogVersion.
        heartbeat = null;
    }

    if (heartbeat?.inSync === true) {
        writeSyncState(storage, { version: catalogVersion, contentHash });
        return 'in-sync';
    }
    if (heartbeat && typeof heartbeat.storedVersion === 'number' && catalogVersion <= heartbeat.storedVersion) {
        catalogVersion = heartbeat.storedVersion + 1;
    }

    try {
        await deps.put({ catalogVersion, voices });
    } catch (error) {
        if (deps.isSkippable(error)) return 'skipped';
        deps.onLog?.(`voice-catalog PUT falhou: ${(error as Error)?.message || String(error)}`);
        return 'unavailable';
    }
    writeSyncState(storage, { version: catalogVersion, contentHash });
    return 'pushed';
};
