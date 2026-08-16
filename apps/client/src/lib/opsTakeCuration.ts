// Curadoria de takes na biblioteca do Ops: quais vídeos já passaram pelo
// Editor de Cortes (lápis verde), a pasta de destino "TAKES APROVADOS" da
// empresa e a fila do fluxo "Confirmar e ir para o próximo".

import type { StorageLike } from './opsLibraryCache';

const TRIMMED_KEY = 'mileto_ops_trimmed_takes_v1';
const MAX_TRIMMED_ENTRIES = 2000;

export const APPROVED_TAKES_FOLDER_LABEL = 'TAKES APROVADOS';

const defaultStorage = (): StorageLike | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

const normalizeFolderName = (name: string) =>
    name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleUpperCase('pt-BR');

// Aceita as variações naturais do nome ("Takes Aprovados", "TAKE APROVADO"),
// mas nunca confunde com "TAKES GRAVADOS".
export const isApprovedTakesFolderName = (name: unknown): boolean =>
    typeof name === 'string' && /^TAKES? APROVADOS?$/.test(normalizeFolderName(name));

export const findApprovedTakesFolder = <T extends { name?: string | null }>(folders: T[]): T | null =>
    folders.find((folder) => isApprovedTakesFolderName(folder?.name)) ?? null;

const readTrimmedMap = (storage: StorageLike | null): Record<string, number> => {
    if (!storage) return {};
    try {
        const raw = storage.getItem(TRIMMED_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const map: Record<string, number> = {};
        for (const [assetId, markedAt] of Object.entries(parsed as Record<string, unknown>)) {
            const timestamp = Number(markedAt);
            if (assetId && Number.isFinite(timestamp)) map[assetId] = timestamp;
        }
        return map;
    } catch {
        return {};
    }
};

export const readTrimmedTakeIds = (storage: StorageLike | null = defaultStorage()): Set<string> =>
    new Set(Object.keys(readTrimmedMap(storage)));

export const markTakeTrimmed = (
    assetId: string,
    storage: StorageLike | null = defaultStorage(),
): Set<string> => {
    const map = readTrimmedMap(storage);
    map[assetId] = Date.now();
    // Mantém os registros mais recentes para o histórico nunca crescer sem limite.
    const entries = Object.entries(map)
        .sort((first, second) => second[1] - first[1])
        .slice(0, MAX_TRIMMED_ENTRIES);
    const next = Object.fromEntries(entries);
    try {
        storage?.setItem(TRIMMED_KEY, JSON.stringify(next));
    } catch {
        // Sem espaço: o lápis verde da sessão atual continua via estado em memória.
    }
    return new Set(Object.keys(next));
};

// ─── Carrinho de cortes persistente ───
// Os ajustes salvos ("Salvar e escolher o próximo") são gravados no disco:
// recarregamento do app, troca de aba, renovação de sessão ou reinício NUNCA
// perdem o trabalho de curadoria. Só o descarte explícito (ou o processamento
// bem-sucedido) limpa o carrinho.

const STAGED_KEY = 'mileto_ops_staged_trims_v1';
const STAGED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StagedTrimLike {
    trims?: unknown;
    savedAt?: unknown;
}

const validStagedTrims = (value: unknown): Array<{ start: number; end: number; kind: 'primary' | 'created' }> => {
    if (!Array.isArray(value)) return [];
    const trims: Array<{ start: number; end: number; kind: 'primary' | 'created' }> = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const start = Number((item as { start?: unknown }).start);
        const end = Number((item as { end?: unknown }).end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const kind = (item as { kind?: unknown }).kind === 'created' ? 'created' : 'primary';
        trims.push({ start, end, kind });
    }
    return trims;
};

export const readStagedTrims = <T>(storage: StorageLike | null = defaultStorage()): Map<string, T> => {
    const restored = new Map<string, T>();
    if (!storage) return restored;
    try {
        const raw = storage.getItem(STAGED_KEY);
        if (!raw) return restored;
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return restored;
        const now = Date.now();
        for (const [assetId, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!assetId || !value || typeof value !== 'object') continue;
            const entry = value as StagedTrimLike;
            const trims = validStagedTrims(entry.trims);
            if (!trims.length) continue;
            const savedAt = Number(entry.savedAt);
            if (Number.isFinite(savedAt) && now - savedAt > STAGED_MAX_AGE_MS) continue;
            restored.set(assetId, { ...(value as object), trims } as T);
        }
        return restored;
    } catch {
        return restored;
    }
};

export const writeStagedTrims = <T>(
    entries: ReadonlyMap<string, T>,
    storage: StorageLike | null = defaultStorage(),
): void => {
    if (!storage) return;
    try {
        if (!entries.size) {
            storage.removeItem(STAGED_KEY);
            return;
        }
        const now = Date.now();
        const payload: Record<string, unknown> = {};
        for (const [assetId, entry] of entries) {
            const savedAt = Number((entry as StagedTrimLike).savedAt);
            payload[assetId] = { ...(entry as object), savedAt: Number.isFinite(savedAt) ? savedAt : now };
        }
        storage.setItem(STAGED_KEY, JSON.stringify(payload));
    } catch {
        // Sem espaço: o carrinho da sessão atual continua via estado em memória.
    }
};

// Próximo take da fila ainda sem corte, varrendo para frente a partir do take
// atual e dando a volta na pasta. Takes já cortados (verdes) são pulados.
export const nextTakeToTrim = <T extends { id: string }>(
    queue: T[],
    currentId: string,
    trimmedIds: ReadonlySet<string>,
): T | null => {
    if (!queue.length) return null;
    const startIndex = queue.findIndex((item) => item.id === currentId);
    for (let offset = 1; offset <= queue.length; offset += 1) {
        const candidate = queue[(startIndex + offset + queue.length) % queue.length];
        if (candidate.id === currentId) continue;
        if (!trimmedIds.has(candidate.id)) return candidate;
    }
    return null;
};
