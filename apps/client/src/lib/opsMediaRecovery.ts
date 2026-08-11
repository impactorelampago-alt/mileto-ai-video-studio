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

export interface RestoredOpsCacheSource {
    type?: MediaTake['type'] | null;
    fileName?: string | null;
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

const OPS_SOURCE_DURATION_TOLERANCE_SECONDS = 0.05;

const validateRecoveredOpsSource = (take: MediaTake, source: RestoredOpsCacheSource) => {
    const recoveredType = String(source.type || '').trim();
    if (recoveredType && recoveredType !== take.type) {
        throw new GatewayError(
            422,
            `O arquivo recuperado pelo Mileto Ops mudou de tipo (${recoveredType}).`,
            'ops_source_type_mismatch',
        );
    }

    if (take.type !== 'video') return;
    const recoveredDuration = Number(source.duration);
    const trimEnd = Number(take.trim?.end);
    if (!Number.isFinite(recoveredDuration) || recoveredDuration <= 0) {
        throw new GatewayError(
            422,
            'O Mileto Ops não informou uma duração válida para o vídeo recuperado.',
            'ops_source_duration_invalid',
        );
    }
    if (
        Number.isFinite(trimEnd) &&
        trimEnd > recoveredDuration + OPS_SOURCE_DURATION_TOLERANCE_SECONDS
    ) {
        throw new GatewayError(
            422,
            'O vídeo recuperado pelo Mileto Ops não cobre mais o corte salvo neste projeto.',
            'ops_source_trim_out_of_bounds',
        );
    }
};

export const mergeOpsTakeWithCacheSource = (
    take: MediaTake,
    source: RestoredOpsCacheSource,
    reference: ExternalMediaReference,
    context?: ResolvedOpsViewContext | null,
): MediaTake => {
    const url = absoluteLocalUrl(source.url);
    const proxyUrl = absoluteLocalUrl(source.proxyUrl) || url;
    if (!url) throw new Error('O cache local devolveu uma fonte vazia para este take.');
    validateRecoveredOpsSource(take, source);
    const nextReference: ExternalMediaReference = {
        ...reference,
        ...(source.externalMedia || {}),
        source: 'mileto_ops',
        cacheId: source.cacheId || source.externalMedia?.cacheId || reference.cacheId || null,
    };

    return {
        ...take,
        url,
        fileUrl: url,
        proxyUrl,
        backendPath: source.path || undefined,
        externalMedia: context ? withResolvedOpsContext(nextReference, context) : nextReference,
    };
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

    return mergeOpsTakeWithCacheSource(take, result.source, reference);
};

const materializeOpsReference = async (
    take: MediaTake,
    reference: ExternalMediaReference,
    context: ResolvedOpsViewContext,
): Promise<MediaTake> => {
    let response: Response;
    try {
        response = await fetch(`${API_BASE_URL}/api/ops/cache/materialize`, {
            method: 'POST',
            headers: {
                ...(await localAuthHeaders()),
                'Content-Type': 'application/json',
                'X-Ops-View-Context': context.contextId,
            },
            body: JSON.stringify({ referenceId: reference.referenceId }),
        });
    } catch {
        throw new GatewayError(0, 'Sem conexão com o servidor local durante a recuperação do take.');
    }
    const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        code?: string;
        message?: string;
        source?: RestoredOpsCacheSource;
    };
    if (!response.ok || !result.ok || !result.source) {
        throw new GatewayError(
            response.status,
            result.message || 'Não foi possível preparar este take para a exportação.',
            result.code || null,
        );
    }
    const materialized = mergeOpsTakeWithCacheSource(take, result.source, reference, context);
    if (!materialized.backendPath) {
        throw new Error('O Mileto Ops não devolveu uma cópia local para este take.');
    }
    return materialized;
};

const referenceFromFreshOpsReference = (
    current: ExternalMediaReference,
    fresh: Awaited<ReturnType<typeof gatewayApi.createOpsReference>>,
): ExternalMediaReference => ({
    ...current,
    referenceId: fresh.id,
    connectionId: fresh.connectionId,
    accountId: fresh.accountId,
    companyId: fresh.companyId,
    folderId: fresh.folderId,
    assetId: fresh.assetId,
    mid: fresh.mid,
    version: fresh.version,
    checksum: fresh.checksum,
    opsUpdatedAt: fresh.opsUpdatedAt,
    cacheId: null,
});

type OpsExportPreparationState = 'resolve_context' | 'materialize' | 'renew_reference';

const MAX_OPS_EXPORT_STATE_ATTEMPTS = 5;
const MAX_OPS_CONTEXT_REFRESHES = 2;
const TRANSIENT_MATERIALIZATION_422_CODES = new Set([
    'ops_materialization_incomplete',
    'ops_download_incomplete',
    'ops_download_size_mismatch',
    'ops_download_checksum_mismatch',
    'ops_delivery_size_mismatch',
    'ops_delivery_checksum_mismatch',
]);

const gatewayStatus = (error: unknown) => error instanceof GatewayError ? error.status : null;

const isStaleOpsReferenceError = (error: unknown) => {
    if (!(error instanceof GatewayError)) return false;
    return [404, 410].includes(error.status)
        || ['ops_reference_not_found', 'ops_reference_stale'].includes(String(error.code || ''));
};

const isTransientOpsGatewayError = (error: unknown) => {
    if (!(error instanceof GatewayError)) return false;
    return error.status === 0
        || [408, 409, 425, 429].includes(error.status)
        || error.status >= 500;
};

const isTransientMaterialization422 = (error: unknown) => {
    if (!(error instanceof GatewayError) || error.status !== 422) return false;
    if (TRANSIENT_MATERIALIZATION_422_CODES.has(String(error.code || ''))) return true;

    // Compatibilidade com servidores locais anteriores aos códigos explícitos.
    const message = String(error.message || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR');
    return message.includes('arquivo local ficou incompleto')
        || message.includes('tamanho baixado nao confere')
        || message.includes('checksum baixado nao confere');
};

const waitForOpsRetry = async (attempt: number) => {
    const delayMs = Math.min(7_200, 900 * (2 ** Math.max(0, attempt - 1)));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const tryRestoreAfterConcurrentMaterialization = async (
    take: MediaTake,
    reference: ExternalMediaReference,
) => {
    try {
        const restored = await restoreCachedOpsTake({ ...take, externalMedia: reference });
        return restored.backendPath ? restored : null;
    } catch (error) {
        if (
            error instanceof GatewayError &&
            (error.status === 401 || [400, 413, 422].includes(error.status))
        ) {
            throw error;
        }
        return null;
    }
};

/**
 * Fecha a janela entre abrir um projeto e iniciar o FFmpeg. O cache do Ops pode
 * ter sido limpo nesse intervalo; por isso a exportação revalida a cópia local
 * no último instante e, se necessário, baixa novamente o mesmo ativo.
 */
export const prepareOpsTakeForExport = async (take: MediaTake): Promise<MediaTake> => {
    const initialReference = take.externalMedia;
    if (initialReference?.source !== 'mileto_ops') return take;

    try {
        const restored = await restoreCachedOpsTake(take);
        if (restored.backendPath) return restored;
    } catch (error) {
        if (
            error instanceof GatewayError &&
            (error.status === 401 || [400, 413, 422].includes(error.status))
        ) {
            throw error;
        }
    }

    let context: ResolvedOpsViewContext | null = null;
    let reference = initialReference;
    let state: OpsExportPreparationState = 'resolve_context';
    let resumeAfterContext: Exclude<OpsExportPreparationState, 'resolve_context'> = 'materialize';
    let forceContextRefresh = false;
    let renewedReference = false;
    let contextRefreshes = 0;
    let transientMaterialization422Retries = 0;
    const stateAttempts: Record<OpsExportPreparationState, number> = {
        resolve_context: 0,
        materialize: 0,
        renew_reference: 0,
    };

    while (true) {
        const currentState: OpsExportPreparationState = state;
        stateAttempts[currentState] += 1;
        try {
            if (currentState === 'resolve_context') {
                context = await resolveOpsCompanyContext(
                    reference.companyId,
                    reference.viewContext,
                    forceContextRefresh,
                );
                reference = withResolvedOpsContext(reference, context);
                forceContextRefresh = false;
                stateAttempts.resolve_context = 0;
                state = resumeAfterContext;
                continue;
            }

            if (!context) {
                resumeAfterContext = currentState;
                state = 'resolve_context';
                continue;
            }

            if (currentState === 'renew_reference') {
                if (!reference.assetId) {
                    throw new GatewayError(
                        422,
                        'A referência do Mileto Ops não informa qual ativo deve ser recuperado.',
                        'ops_reference_asset_missing',
                    );
                }
                const fresh = await gatewayApi.createOpsReference(reference.assetId, context.contextId);
                reference = withResolvedOpsContext(referenceFromFreshOpsReference(reference, fresh), context);
                renewedReference = true;
                stateAttempts.renew_reference = 0;
                state = 'materialize';
                continue;
            }

            return await materializeOpsReference(
                { ...take, externalMedia: reference },
                reference,
                context,
            );
        } catch (error) {
            const status = gatewayStatus(error);
            if (status === 401 || status === 400 || status === 413) throw error;

            if (currentState === 'resolve_context') {
                if (
                    isTransientOpsGatewayError(error) &&
                    stateAttempts.resolve_context < MAX_OPS_EXPORT_STATE_ATTEMPTS
                ) {
                    await waitForOpsRetry(stateAttempts.resolve_context);
                    continue;
                }
                throw error;
            }

            if (status === 403 && contextRefreshes < MAX_OPS_CONTEXT_REFRESHES) {
                invalidateOpsCompanyContext(reference.companyId);
                context = null;
                contextRefreshes += 1;
                forceContextRefresh = true;
                resumeAfterContext = currentState;
                stateAttempts.resolve_context = 0;
                state = 'resolve_context';
                continue;
            }

            if (currentState === 'materialize' && isStaleOpsReferenceError(error)) {
                if (renewedReference || !reference.assetId) throw error;
                stateAttempts.renew_reference = 0;
                state = 'renew_reference';
                continue;
            }

            if (currentState === 'materialize' && isTransientMaterialization422(error)) {
                if (transientMaterialization422Retries >= 1) throw error;
                transientMaterialization422Retries += 1;
                await waitForOpsRetry(stateAttempts.materialize);
                const restored = await tryRestoreAfterConcurrentMaterialization(take, reference);
                if (restored) return restored;
                continue;
            }

            if (status === 422) throw error;

            if (
                isTransientOpsGatewayError(error) &&
                stateAttempts[currentState] < MAX_OPS_EXPORT_STATE_ATTEMPTS
            ) {
                await waitForOpsRetry(stateAttempts[currentState]);
                if (currentState === 'materialize') {
                    const restored = await tryRestoreAfterConcurrentMaterialization(take, reference);
                    if (restored) return restored;
                }
                continue;
            }
            throw error;
        }
    }
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
