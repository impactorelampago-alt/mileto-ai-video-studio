import { gatewayUrl } from './apiBase';
import { authStorage } from './authStorage';

/** Erro do gateway com o status HTTP preservado (401 = sessão, 402 = saldo). */
export class GatewayError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = 'GatewayError';
        this.status = status;
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

/**
 * fetch autenticado direto no gateway. Anexa o Bearer, serializa JSON e
 * transforma respostas de erro em GatewayError (com status) para a UI tratar
 * 401 (sessão) e 402 (saldo) de forma específica.
 */
export async function gatewayFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await authStorage.get();
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    let res: Response;
    try {
        // Timeout para não pendurar login/conta num socket "aberto mas mudo".
        res = await fetch(gatewayUrl(path), { ...init, headers, signal: AbortSignal.timeout(30000) });
    } catch (err) {
        const name = (err as Error)?.name;
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
        const message = (data as { message?: string })?.message || `Erro ${res.status}`;
        throw new GatewayError(res.status, message);
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
};
