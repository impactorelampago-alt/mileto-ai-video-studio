import { gatewayUrl } from './apiBase';
import { authStorage } from './authStorage';

/** Erro do gateway com o status HTTP preservado (401 = sessão, 402 = saldo). */
export class GatewayError extends Error {
    status: number;
    code: string | null;
    requestId: string | null;
    constructor(status: number, message: string, code: string | null = null, requestId: string | null = null) {
        super(message);
        this.name = 'GatewayError';
        this.status = status;
        this.code = code;
        this.requestId = requestId;
    }
}

export interface MiletoUser {
    id: number;
    email: string;
    name: string | null;
    role: 'super_admin' | 'owner' | 'member';
    orgId: number | null;
    orgName?: string | null;
    orgPlan?: string | null;
    maxSeats?: number | null;
    seatsUsed?: number | null;
}

export interface UsageRow {
    provider: string;
    kind: string;
    units: number;
    charged: number;
    demo: boolean;
    created_at: string;
}

export interface TeamMember {
    id: number;
    email: string;
    name: string | null;
    role: string;
    status: string;
    created_at: string;
}

export interface SharedDraftSummary {
    id: string;
    title: string;
    updatedAt: string;
    createdAt: string;
    createdBy?: number | null;
    authorName?: string | null;
    authorEmail?: string | null;
}

export interface SharedAsset {
    id: string;
    name: string;
    publicUrl: string;
    assetCode?: string;
    type?: 'audio' | 'image' | 'video';
    durationSec?: number;
}

export interface OpsIntegrationStatus {
    enabled: boolean;
    connection: {
        id: string;
        status: 'pending' | 'active' | 'revoked' | 'error';
        accountId?: string | null;
        accountName?: string | null;
        scopes: string[];
        connectedAt?: string | null;
        revokedAt?: string | null;
        lastError?: string | null;
    } | null;
    userLink: {
        opsProfileId: string;
        status: string;
        confirmedAt?: string | null;
    } | null;
}

export interface OpsSyncSuggestion {
    id: string;
    runId: string;
    kind: 'unique_match' | 'ambiguous' | 'ops_only' | 'ai_only';
    aiUserId: number | null;
    aiName?: string | null;
    aiRole?: string | null;
    opsProfileId: string | null;
    opsName?: string | null;
    opsRole?: string | null;
    emailFingerprint?: string | null;
    detail?: {
        aiName?: string | null;
        aiRole?: string | null;
        opsName?: string | null;
        opsRole?: string | null;
    };
}

export interface OpsCompany {
    id: string;
    name?: string;
    nome?: string;
    status?: string;
    /** "archive" = Acervo da agência (mídia compartilhada, não é empresa). "company" = empresa real. */
    kind?: 'company' | 'archive' | string;
}

export interface OpsFolder {
    id: string;
    name: string;
    parentId?: string | null;
    companyId?: string;
    createdVia?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface OpsAsset {
    id: string;
    companyId: string;
    folderId: string | null;
    name: string;
    kind: 'video' | 'image' | 'audio' | string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    mid?: string | null;
    version?: string | null;
    checksum?: string | null;
    durationMs?: number | null;
    width?: number | null;
    height?: number | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    capabilities?: {
        thumbnail?: boolean;
        stream?: boolean;
        download?: boolean;
        range?: boolean | null;
    };
}

export interface OpsExternalReference {
    id: string;
    connectionId: string;
    accountId: string;
    companyId: string;
    folderId?: string | null;
    assetId: string;
    name: string;
    kind: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    mid?: string | null;
    version?: string | null;
    checksum?: string | null;
    opsUpdatedAt?: string | null;
    capabilities?: Record<string, unknown>;
}

export interface OpsMediaUrl {
    url: string;
    expiresAt?: string | null;
    delivery?: string;
    supportsRange?: boolean | null;
    requestId?: string;
}

export interface OpsViewContext {
    contextId: string;
    mode: 'self' | 'team' | 'profile';
    label: string;
    subtitle: string;
    relationship?: 'self' | 'subordinate';
    isDefault: boolean;
}

export interface OpsViewContexts {
    defaultContextId: string;
    expiresIn: number;
    capabilities: {
        canViewTeam: boolean;
        canViewProfiles: boolean;
    };
    contexts: OpsViewContext[];
}

const opsContextHeaders = (viewContextId?: string | null): HeadersInit =>
    viewContextId ? { 'X-Ops-View-Context': viewContextId } : {};

/**
 * fetch autenticado direto no gateway. Anexa o Bearer, serializa JSON e
 * transforma respostas de erro em GatewayError (com status) para a UI tratar
 * 401 (sessão) e 402 (saldo) de forma específica.
 */
export async function gatewayFetch<T = unknown>(
    path: string,
    init: RequestInit = {},
    timeoutMs = 30000
): Promise<T> {
    const token = await authStorage.get();
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    let res: Response;
    try {
        // Timeout para não pendurar login/conta num socket "aberto mas mudo".
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
        res = await fetch(gatewayUrl(path), { ...init, headers, signal });
    } catch (err) {
        const name = (err as Error)?.name;
        if (init.signal?.aborted) {
            const cancelled = new Error('Operação cancelada.');
            cancelled.name = 'AbortError';
            throw cancelled;
        }
        if (name === 'TimeoutError' || name === 'AbortError') {
            throw new GatewayError(0, 'O servidor Mileto demorou demais para responder. Tente de novo.');
        }
        throw new GatewayError(0, 'Sem conexão com o servidor Mileto. Verifique sua internet.');
    }

    let data: unknown = null;
    const text = await res.text();
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { message: text };
        }
    }

    if (!res.ok) {
        const errorData = data as { message?: string; code?: string; requestId?: string };
        const message = errorData?.message || `Erro ${res.status}`;
        throw new GatewayError(res.status, message, errorData?.code || null, errorData?.requestId || null);
    }
    return data as T;
}

export const gatewayApi = {
    async login(email: string, password: string): Promise<{ token: string; user: MiletoUser }> {
        return gatewayFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    },

    async me(): Promise<{ user: MiletoUser; balance: number | null }> {
        return gatewayFetch('/auth/me');
    },

    async logout(): Promise<void> {
        try {
            await gatewayFetch('/auth/logout', { method: 'POST' });
        } catch {
            /* logout local vale mesmo se o servidor não responder */
        }
    },

    async usage(): Promise<{ recent: UsageRow[]; last30: { credits: number; calls: number } }> {
        return gatewayFetch('/account/usage');
    },

    async team(): Promise<{ team: TeamMember[] }> {
        return gatewayFetch('/account/team');
    },

    async addMember(email: string, name: string, password: string): Promise<void> {
        await gatewayFetch('/account/team', {
            method: 'POST',
            body: JSON.stringify({ email, name, password }),
        });
    },

    async removeMember(userId: number): Promise<void> {
        await gatewayFetch(`/account/team/${userId}`, { method: 'DELETE' });
    },

    async opsConnection(): Promise<OpsIntegrationStatus> {
        return gatewayFetch('/v1/integrations/mileto-ops/connection');
    },

    async startOpsConnection(reconnect = false): Promise<{ attemptId: string; authorizationUrl: string; expiresAt: string }> {
        return gatewayFetch('/v1/integrations/mileto-ops/connections', {
            method: 'POST',
            body: JSON.stringify({ returnTo: 'mileto-ai-video://account', reconnect }),
        });
    },

    async disconnectOps(): Promise<void> {
        await gatewayFetch('/v1/integrations/mileto-ops/connection', { method: 'DELETE' });
    },

    async syncOpsUsers(): Promise<{
        runId: string;
        stats: Record<string, number>;
        suggestions: OpsSyncSuggestion[];
    }> {
        return gatewayFetch('/v1/integrations/mileto-ops/sync/users', { method: 'POST' });
    },

    async opsConflicts(): Promise<{ conflicts: OpsSyncSuggestion[] }> {
        return gatewayFetch('/v1/integrations/mileto-ops/sync/conflicts');
    },

    async confirmOpsUserLink(aiUserId: number, opsProfileId: string): Promise<void> {
        await gatewayFetch(`/v1/integrations/mileto-ops/user-links/${aiUserId}`, {
            method: 'PUT',
            body: JSON.stringify({ opsProfileId }),
        });
    },

    async removeOpsUserLink(aiUserId: number): Promise<void> {
        await gatewayFetch(`/v1/integrations/mileto-ops/user-links/${aiUserId}`, { method: 'DELETE' });
    },

    async opsViewContexts(): Promise<{ data: OpsViewContexts }> {
        return gatewayFetch('/v1/integrations/mileto-ops/view-contexts');
    },

    async opsCompanies(
        q = '',
        viewContextId?: string | null
    ): Promise<{ data: OpsCompany[]; meta?: { nextCursor?: string | null } }> {
        const companies: OpsCompany[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 100; page += 1) {
            const query = new URLSearchParams({ limit: '100' });
            if (q) query.set('q', q);
            if (cursor) query.set('cursor', cursor);
            const response = await gatewayFetch<{ data: OpsCompany[]; meta?: { nextCursor?: string | null } }>(
                `/v1/integrations/mileto-ops/companies?${query}`,
                { headers: opsContextHeaders(viewContextId) }
            );
            companies.push(...(Array.isArray(response.data) ? response.data : []));
            cursor = response.meta?.nextCursor || null;
            if (!cursor) break;
        }
        return { data: companies, meta: { nextCursor: cursor } };
    },

    async opsFolders(
        companyId: string,
        viewContextId?: string | null
    ): Promise<{ data: OpsFolder[]; meta?: { nextCursor?: string | null } }> {
        return gatewayFetch(
            `/v1/integrations/mileto-ops/companies/${encodeURIComponent(companyId)}/folders`,
            { headers: opsContextHeaders(viewContextId) }
        );
    },

    async opsAssets(
        companyId: string,
        options: { folderId?: string | null; q?: string; cursor?: string | null; viewContextId?: string | null } = {}
    ): Promise<{ data: OpsAsset[]; meta?: { nextCursor?: string | null } }> {
        const assets: OpsAsset[] = [];
        let cursor: string | null = options.cursor || null;
        for (let page = 0; page < 100; page += 1) {
            const query = new URLSearchParams({ limit: '100' });
            if (options.folderId) query.set('folderId', options.folderId);
            if (options.q) query.set('q', options.q);
            if (cursor) query.set('cursor', cursor);
            const response = await gatewayFetch<{ data: OpsAsset[]; meta?: { nextCursor?: string | null } }>(
                `/v1/integrations/mileto-ops/companies/${encodeURIComponent(companyId)}/assets?${query}`,
                { headers: opsContextHeaders(options.viewContextId) }
            );
            assets.push(...(Array.isArray(response.data) ? response.data : []));
            cursor = response.meta?.nextCursor || null;
            if (!cursor) break;
        }
        return { data: assets, meta: { nextCursor: cursor } };
    },

    async opsAssetUrl(
        assetId: string,
        kind: 'thumbnail' | 'stream' | 'download',
        viewContextId?: string | null
    ): Promise<OpsMediaUrl> {
        const response = await gatewayFetch<{ data: OpsMediaUrl }>(
            `/v1/integrations/mileto-ops/assets/${encodeURIComponent(assetId)}/${kind}-url`,
            { method: 'POST', headers: opsContextHeaders(viewContextId) },
            150000
        );
        return {
            ...response.data,
            url: /^https?:\/\//i.test(response.data.url) ? response.data.url : gatewayUrl(response.data.url),
        };
    },

    async createOpsReference(assetId: string, viewContextId?: string | null): Promise<OpsExternalReference> {
        const response = await gatewayFetch<{ reference: OpsExternalReference }>(
            '/v1/integrations/mileto-ops/references',
            {
                method: 'POST',
                headers: opsContextHeaders(viewContextId),
                body: JSON.stringify({ assetId }),
            }
        );
        return response.reference;
    },

    async sharedDrafts(): Promise<{ ok: boolean; drafts: SharedDraftSummary[] }> {
        return gatewayFetch('/shared/drafts');
    },

    async sharedAsset(id: string): Promise<SharedAsset> {
        const result = await gatewayFetch<{ ok: boolean; item: SharedAsset }>(
            `/shared/files/item/${encodeURIComponent(id)}`
        );
        return result.item;
    },

    async sharedDraft(id: string): Promise<{ ok: boolean; data: Record<string, unknown> }> {
        return gatewayFetch(`/shared/drafts/${encodeURIComponent(id)}`);
    },

    async saveSharedDraft(id: string, title: string, data: Record<string, unknown>): Promise<void> {
        await gatewayFetch(`/shared/drafts/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify({ title, data }),
        });
    },

    async deleteSharedDraft(id: string): Promise<void> {
        const encodedId = encodeURIComponent(id);
        try {
            await gatewayFetch(`/shared/drafts/${encodedId}/trash`, { method: 'POST' });
        } catch (error) {
            // Compatibilidade durante rollout: gateways anteriores conhecem
            // somente DELETE. Depois do deploy novo, o POST é o caminho padrão.
            if (!(error instanceof GatewayError) || ![404, 405].includes(error.status)) throw error;
            await gatewayFetch(`/shared/drafts/${encodedId}`, { method: 'DELETE' });
        }
    },
};
