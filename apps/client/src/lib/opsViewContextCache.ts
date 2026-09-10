import type { OpsViewContext, OpsViewContexts } from './gateway';

const DEFAULT_TTL_MS = 60_000;
const MAX_SAFETY_MARGIN_MS = 30_000;
const MIN_SAFETY_MARGIN_MS = 1_000;

type OpsViewContextsResponse = { data: OpsViewContexts };
type OpsViewContextsFetcher = () => Promise<OpsViewContextsResponse>;

export interface OpsViewContextCache {
    get(): Promise<OpsViewContext[]>;
    invalidate(): void;
}

const orderedContexts = (response: OpsViewContextsResponse): OpsViewContext[] => {
    const contexts = Array.isArray(response.data?.contexts) ? response.data.contexts : [];
    return [
        ...contexts.filter((context) => context.contextId === response.data.defaultContextId),
        ...contexts.filter((context) => context.contextId !== response.data.defaultContextId),
    ];
};

const cacheLifetimeMs = (expiresIn: number): number => {
    const ttlMs = Number.isFinite(expiresIn) && expiresIn > 0
        ? expiresIn * 1_000
        : DEFAULT_TTL_MS;
    const safetyMarginMs = Math.min(
        MAX_SAFETY_MARGIN_MS,
        Math.max(MIN_SAFETY_MARGIN_MS, Math.floor(ttlMs / 10)),
    );
    return Math.max(MIN_SAFETY_MARGIN_MS, ttlMs - safetyMarginMs);
};

/**
 * Reutiliza o mesmo lote de contextos opacos ate perto do vencimento informado
 * pelo Ops. Uma renovacao por ciclo evita criar novos registros e tokens a cada
 * polling do executor, sem prolongar nem contornar a validade definida no Ops.
 */
export const createOpsViewContextCache = (
    fetchContexts: OpsViewContextsFetcher,
    now: () => number = Date.now,
): OpsViewContextCache => {
    let generation = 0;
    let cached: { contexts: OpsViewContext[]; refreshAt: number } | null = null;
    let inFlight: { generation: number; promise: Promise<OpsViewContext[]> } | null = null;

    const get = async (): Promise<OpsViewContext[]> => {
        const currentGeneration = generation;
        if (cached && now() < cached.refreshAt) return cached.contexts;
        if (inFlight?.generation === currentGeneration) return inFlight.promise;

        const promise = fetchContexts().then(async (response) => {
            // Uma troca de usuario ou uma revogacao pode invalidar a requisicao
            // enquanto ela esta em voo. Nesse caso, descarte-a e leia novamente.
            if (generation !== currentGeneration) return get();
            const contexts = orderedContexts(response);
            cached = {
                contexts,
                refreshAt: now() + cacheLifetimeMs(Number(response.data?.expiresIn)),
            };
            return contexts;
        }).finally(() => {
            if (inFlight?.promise === promise) inFlight = null;
        });

        inFlight = { generation: currentGeneration, promise };
        return promise;
    };

    return {
        get,
        invalidate: () => {
            generation += 1;
            cached = null;
            inFlight = null;
        },
    };
};
