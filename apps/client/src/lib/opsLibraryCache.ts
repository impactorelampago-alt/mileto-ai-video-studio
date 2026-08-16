// Cache local (stale-while-revalidate) das listagens da biblioteca do Ops.
// O app está instalado no PC do usuário, então a última listagem de cada
// pasta/empresa fica no localStorage: a navegação abre instantânea com o
// conteúdo conhecido e a busca ao servidor atualiza a tela em silêncio.

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    key(index: number): string | null;
    readonly length: number;
}

const PREFIX = 'mileto_ops_library_cache_v1';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const defaultStorage = (): StorageLike | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

interface CacheOptions {
    storage?: StorageLike | null;
    maxAgeMs?: number;
}

const resolveStorage = (options: CacheOptions) =>
    options.storage !== undefined ? options.storage : defaultStorage();

export const opsListingCacheKey = (...parts: Array<string | null | undefined>) =>
    `${PREFIX}:${parts.map((part) => String(part ?? '').trim()).join('|')}`;

export const readOpsListingCache = <T>(key: string, options: CacheOptions = {}): T | null => {
    const storage = resolveStorage(options);
    if (!storage) return null;
    try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { savedAt?: number; data?: T } | null;
        const savedAt = Number(parsed?.savedAt);
        const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
        if (!Number.isFinite(savedAt) || Date.now() - savedAt > maxAge) {
            storage.removeItem(key);
            return null;
        }
        return parsed?.data ?? null;
    } catch {
        return null;
    }
};

export const writeOpsListingCache = (key: string, data: unknown, options: CacheOptions = {}): void => {
    const storage = resolveStorage(options);
    if (!storage) return;
    let payload: string;
    try {
        payload = JSON.stringify({ savedAt: Date.now(), data });
    } catch {
        return;
    }
    try {
        storage.setItem(key, payload);
    } catch {
        // Cota do localStorage estourada: o cache inteiro é descartável por
        // definição (o servidor continua sendo a fonte da verdade).
        clearOpsListingCache(storage);
        try {
            storage.setItem(key, payload);
        } catch {
            // Sem espaço mesmo após a limpeza — segue sem cache.
        }
    }
};

export const removeOpsListingCache = (key: string, options: CacheOptions = {}): void => {
    const storage = resolveStorage(options);
    if (!storage) return;
    try {
        storage.removeItem(key);
    } catch {
        // Ignorado: cache é melhor esforço.
    }
};

export const clearOpsListingCache = (storage: StorageLike | null = defaultStorage()): void => {
    if (!storage) return;
    try {
        const doomed: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key && key.startsWith(PREFIX)) doomed.push(key);
        }
        doomed.forEach((key) => storage.removeItem(key));
    } catch {
        // Ignorado: cache é melhor esforço.
    }
};
