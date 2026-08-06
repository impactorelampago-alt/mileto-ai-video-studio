import type { ExternalMediaReference, MediaTake } from '../types';
import {
    gatewayApi,
    GatewayError,
    type OpsMediaUrl,
    type OpsViewContext,
} from './gateway';
import { API_BASE_URL } from './apiBase';
import { localAuthHeaders } from './serverAuth';

export type OpsViewContextHint = Pick<OpsViewContext, 'mode' | 'label' | 'subtitle'>;

interface ResolvedOpsViewContext {
    contextId: string;
    hint: OpsViewContextHint;
}

interface RestoredOpsCacheSource {
    url?: string | null;
    proxyUrl?: string | null;
    path?: string | null;
    duration?: number | null;
    cacheId?: string | null;
    externalMedia?: Partial<ExternalMediaReference> | null;
}

interface CachedCompanyContext extends ResolvedOpsViewContext {
    expiresAt: number;
}

const companyContextCache = new Map<string, CachedCompanyContext>();
const companyContextRequests = new Map<string, Promise<ResolvedOpsViewContext>>();

const contextIdentity = (context: OpsViewContextHint) =>
    `${context.mode}:${context.label.trim().toLocaleLowerCase('pt-BR')}:${context.subtitle.trim().toLocaleLowerCase('pt-BR')}`;

const contextHint = (context: OpsViewContext): OpsViewContextHint => ({
    mode: context.mode,
    label: context.label,
    subtitle: context.subtitle,
});

const canTryAnotherContext = (error: unknown) =>
    error instanceof GatewayError &&
    (
        [403, 404].includes(error.status) ||
        ['view_context_forbidden', 'ops_view_context_invalid', 'ops_view_contexts_invalid'].includes(error.code || '')
    );

const cacheKeyFor = (companyId: string, hint?: OpsViewContextHint | null) =>
    `${companyId}:${hint ? contextIdentity(hint) : 'auto'}`;

export const invalidateOpsCompanyContext = (companyId: string) => {
    for (const key of companyContextCache.keys()) {
        if (key.startsWith(`${companyId}:`)) companyContextCache.delete(key);
    }
};

/**
 * Os contextIds do Ops expiram em poucos minutos e, por isso, nunca podem ser
 * persistidos no projeto. Guardamos somente uma dica sem credenciais e, ao
 * restaurar, encontramos um contexto novo que ainda alcance a mesma empresa.
 */
export const resolveOpsCompanyContext = async (
    companyId: string,
    preferredHint?: OpsViewContextHint | null,
    forceRefresh = false
): Promise<ResolvedOpsViewContext> => {
    const normalizedCompanyId = String(companyId || '').trim();
    if (!normalizedCompanyId) throw new Error('A referência do Mileto Ops não informa a empresa da mídia.');

    const cacheKey = cacheKeyFor(normalizedCompanyId, preferredHint);
    const cached = companyContextCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now() + 15_000) {
        return { contextId: cached.contextId, hint: cached.hint };
    }
    const pending = companyContextRequests.get(cacheKey);
    if (!forceRefresh && pending) return pending;

    const request = (async () => {
        const response = await gatewayApi.opsViewContexts();
        const contexts = Array.isArray(response.data?.contexts) ? response.data.contexts : [];
        if (!contexts.length) throw new Error('O Mileto Ops não devolveu uma visualização autorizada.');

        const preferredIdentity = preferredHint ? contextIdentity(preferredHint) : null;
        const defaultContextId = response.data.defaultContextId;
        const candidates = [...contexts].sort((left, right) => {
            const score = (context: OpsViewContext) => {
                if (preferredIdentity && contextIdentity(context) === preferredIdentity) return 0;
                if (context.contextId === defaultContextId || context.isDefault) return 1;
                if (context.mode === 'self') return 2;
                return 3;
            };
            return score(left) - score(right);
        });

        let lastScopeError: unknown = null;
        for (const candidate of candidates) {
            try {
                await gatewayApi.opsCompany(normalizedCompanyId, candidate.contextId);
                const resolved = { contextId: candidate.contextId, hint: contextHint(candidate) };
                const ttlSeconds = Math.max(60, Number(response.data.expiresIn) || 600);
                companyContextCache.set(cacheKey, {
                    ...resolved,
                    expiresAt: Date.now() + Math.max(30, ttlSeconds - 45) * 1000,
                });
                return resolved;
            } catch (error) {
                if (!canTryAnotherContext(error)) throw error;
                lastScopeError = error;
            }
        }

        if (lastScopeError instanceof Error) throw lastScopeError;
        throw new Error('Seu acesso atual ao Mileto Ops não alcança mais a empresa desta mídia.');
    })();

    companyContextRequests.set(cacheKey, request);
    try {
        return await request;
    } finally {
        if (companyContextRequests.get(cacheKey) === request) companyContextRequests.delete(cacheKey);
    }
};

export const refreshOpsTakeUrl = async (
    take: MediaTake
): Promise<{ media: OpsMediaUrl; context: ResolvedOpsViewContext }> => {
    const reference = take.externalMedia;
    if (reference?.source !== 'mileto_ops' || !reference.assetId || !reference.companyId) {
        throw new Error('Este take não possui uma referência recuperável do Mileto Ops.');
    }

    const preferredHint = reference.viewContext || null;
    let context = await resolveOpsCompanyContext(reference.companyId, preferredHint);
    try {
        const media = await gatewayApi.opsAssetUrl(
            reference.assetId,
            take.type === 'image' ? 'download' : 'stream',
            context.contextId
        );
        return { media, context };
    } catch (error) {
        if (!canTryAnotherContext(error) && !(error instanceof GatewayError && [401, 403].includes(error.status))) {
            throw error;
        }
        invalidateOpsCompanyContext(reference.companyId);
        context = await resolveOpsCompanyContext(reference.companyId, preferredHint, true);
        const media = await gatewayApi.opsAssetUrl(
            reference.assetId,
            take.type === 'image' ? 'download' : 'stream',
            context.contextId
        );
        return { media, context };
    }
};

const absoluteLocalUrl = (url?: string | null) => {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
};

/**
 * Restaura primeiro a cópia persistente deste computador. Não consulta o Ops,
 * não depende de URL assinada e preserva cortes/efeitos do take original.
 */
export const restoreCachedOpsTake = async (take: MediaTake): Promise<MediaTake> => {
    const reference = take.externalMedia;
    if (reference?.source !== 'mileto_ops') {
        throw new Error('Este take não pertence ao Mileto Ops.');
    }

    const response = await fetch(`${API_BASE_URL}/api/ops/cache/restore`, {
        method: 'POST',
        headers: {
            ...(await localAuthHeaders()),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            referenceId: reference.referenceId,
            assetId: reference.assetId,
            cacheId: reference.cacheId || null,
        }),
    });
    const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        message?: string;
        code?: string;
        source?: RestoredOpsCacheSource;
    };
    if (!response.ok || !result.ok || !result.source) {
        const error = new GatewayError(
            response.status,
            result.message || 'A cópia local deste take não foi encontrada.',
            result.code || null
        );
        throw error;
    }

    const source = result.source;
    const url = absoluteLocalUrl(source.url);
    const proxyUrl = absoluteLocalUrl(source.proxyUrl) || url;
    if (!url) throw new Error('O cache local devolveu uma fonte vazia para este take.');
    const duration = Number(source.duration || take.originalDurationSeconds || 0);
    const previousDuration = Number(take.originalDurationSeconds || 0);
    const followedFullDuration =
        Number(take.trim?.end || 0) <= 0 ||
        (previousDuration > 0 && Math.abs(Number(take.trim?.end || 0) - previousDuration) < 0.05);
    const nextEnd = duration > 0
        ? (followedFullDuration ? duration : Math.min(Math.max(0, Number(take.trim?.end || 0)), duration))
        : Number(take.trim?.end || 0);

    return {
        ...take,
        url,
        fileUrl: url,
        proxyUrl,
        backendPath: source.path || undefined,
        originalDurationSeconds: duration || previousDuration,
        trim: duration > 0 ? {
            start: Math.min(Math.max(0, Number(take.trim?.start || 0)), Math.max(0, nextEnd - 0.05)),
            end: nextEnd,
        } : take.trim,
        externalMedia: {
            ...reference,
            ...(source.externalMedia || {}),
            source: 'mileto_ops',
            cacheId: source.cacheId || source.externalMedia?.cacheId || reference.cacheId || null,
        },
    };
};

/** Cache local primeiro; stream assinado do Ops somente como último recurso. */
export const recoverOpsTakeSource = async (take: MediaTake): Promise<MediaTake> => {
    try {
        return await restoreCachedOpsTake(take);
    } catch (cacheError) {
        if (cacheError instanceof GatewayError && cacheError.status === 401) throw cacheError;
        const refreshed = await refreshOpsTakeUrl(take);
        return {
            ...take,
            url: refreshed.media.url,
            fileUrl: refreshed.media.url,
            proxyUrl: refreshed.media.url,
            backendPath: undefined,
            externalMedia: take.externalMedia
                ? withResolvedOpsContext(take.externalMedia, refreshed.context)
                : take.externalMedia,
        };
    }
};

export const withResolvedOpsContext = (
    reference: ExternalMediaReference,
    context: ResolvedOpsViewContext
): ExternalMediaReference => ({
    ...reference,
    viewContext: context.hint,
});
