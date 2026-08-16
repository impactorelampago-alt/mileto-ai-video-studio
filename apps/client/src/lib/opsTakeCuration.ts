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
