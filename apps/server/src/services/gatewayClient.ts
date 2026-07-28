import fetch from 'node-fetch';
import FormData from 'form-data';
import { Request } from 'express';

/**
 * Cliente do GATEWAY na nuvem (api.miletoaivideo.com.br).
 *
 * O servidor local NÃO fala mais direto com OpenAI/Fish/ElevenLabs — ele repassa
 * ao gateway, que guarda as chaves e mede o consumo por organização. O token do
 * usuário chega no header Authorization da requisição do app e é reenviado aqui.
 * Assim o cache em disco e as sessões continuam locais, mas o segredo fica no
 * servidor.
 */

const GATEWAY_URL = (process.env.GATEWAY_BASE_URL || 'https://api.miletoaivideo.com.br').replace(/\/+$/, '');

export class GatewayHttpError extends Error {
    status: number;
    code: string | null;
    constructor(status: number, message: string, code: string | null = null) {
        super(message);
        this.name = 'GatewayHttpError';
        this.status = status;
        this.code = code;
    }
}

/** Extrai o Bearer token que o app mandou para o servidor local. */
export const bearerFrom = (req: Request): string | null => {
    const header = (req.headers.authorization || '') as string;
    return header.startsWith('Bearer ') ? header.slice(7) : null;
};

/**
 * fetch com timeout. Sem isto, uma conexão "aberta mas muda" com o gateway nunca
 * resolve nem rejeita — narração/chat/legenda ficam presas para sempre e o usuário
 * precisa matar o app. O abort vira um erro tratável.
 */
const fetchWithTimeout = async (url: string, init: Record<string, unknown>, ms: number) => {
    const externalSignal = init.signal instanceof AbortSignal ? init.signal : null;
    const timeoutSignal = AbortSignal.timeout(ms);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await fetch(url, { ...init, signal } as any);
    } catch (e) {
        const name = (e as Error)?.name;
        if (externalSignal?.aborted) {
            throw new GatewayHttpError(499, 'Operação cancelada.');
        }
        if (name === 'AbortError' || name === 'TimeoutError') {
            throw new GatewayHttpError(504, 'O servidor Mileto demorou demais para responder. Tente de novo.');
        }
        throw new GatewayHttpError(0, 'Sem conexão com o servidor Mileto. Verifique sua internet.');
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseBody = async (res: { text: () => Promise<string> }): Promise<any> => {
    const text = await res.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
};

/**
 * Chamada JSON genérica ao gateway Mileto. É usada pelas integrações locais que
 * precisam do token AI do usuário, mas nunca devem conhecer credenciais do
 * provedor externo (por exemplo, o refresh token do Mileto Ops).
 */
export const gatewayJson = async <T = unknown>(
    token: string,
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
    timeoutMs = 120000
): Promise<T> => {
    if (!token) throw new GatewayHttpError(401, 'Sessão Mileto ausente ou expirada.');
    if (!String(path).startsWith('/') || String(path).startsWith('//')) {
        throw new GatewayHttpError(500, 'Caminho interno do gateway inválido.');
    }
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    const res = await fetchWithTimeout(
        `${GATEWAY_URL}${path}`,
        {
            method: init.method || 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...(init.headers || {}),
            },
            body,
            signal: init.signal,
        },
        timeoutMs
    );
    const data = await parseBody(res);
    if (!res.ok) {
        throw new GatewayHttpError(
            res.status,
            data.message || `Gateway ${res.status}`,
            typeof data.code === 'string' ? data.code : null
        );
    }
    return data as T;
};

export interface GatewayChatResult {
    text: string;
    demo: boolean;
    charged: number;
    balance: number | null;
    agent?: { id: string; label: string; version: number; tier: 'lite' | 'mileto' | 'ultra' };
}

export interface GatewayChatPayload {
    messages: { role: string; content: string }[];
    model?: string;
    reasoning?: string;
    locale?: string;
    system?: string;
    json?: boolean;
    agentId?: 'director' | 'prompt_sales' | 'image_director' | 'video_director';
}

export const gatewayChat = async (token: string, payload: GatewayChatPayload): Promise<GatewayChatResult> => {
    const res = await fetchWithTimeout(
        `${GATEWAY_URL}/v1/chat`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
        },
        60000
    );
    const data = await parseBody(res);
    if (!res.ok) throw new GatewayHttpError(res.status, data.message || `Gateway ${res.status}`);
    return data as GatewayChatResult;
};

export interface GatewayGenerationSpec extends Record<string, unknown> {
    prompt?: string;
    masterPrompt?: string;
    negativePrompt?: string;
    aspectRatio?: string;
    totalDurationSec?: number;
}

export const gatewayGenerateImage = async (
    token: string,
    payload: { tier: string; spec: GatewayGenerationSpec; imageSize?: string }
): Promise<{ bytes: Buffer; mimeType: string }> => {
    const res = await fetchWithTimeout(
        `${GATEWAY_URL}/v1/generations/image`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
        },
        240000
    );
    if (!res.ok) {
        const data = await parseBody(res);
        throw new GatewayHttpError(res.status, data.message || `Gateway ${res.status}`, data.code || null);
    }
    return {
        bytes: Buffer.from(await res.arrayBuffer()),
        mimeType: String(res.headers.get('content-type') || 'image/png').split(';')[0],
    };
};

export const gatewayCreateVideoGeneration = async (
    token: string,
    payload: { tier: string; spec: GatewayGenerationSpec; durationSec?: number; resolution?: string }
): Promise<{ job: { id: string; status: string; progress: number } }> =>
    gatewayJson(token, '/v1/generations/video', { method: 'POST', body: payload }, 90000);

export const gatewayVideoGenerationStatus = async (
    token: string,
    id: string
): Promise<{ job: { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; progress: number; error?: string | null } }> =>
    gatewayJson(token, `/v1/generations/video/${encodeURIComponent(id)}`, {}, 60000);

export const gatewayVideoGenerationContent = async (
    token: string,
    id: string
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string }> => {
    const res = await fetchWithTimeout(
        `${GATEWAY_URL}/v1/generations/video/${encodeURIComponent(id)}/content`,
        { headers: { Authorization: `Bearer ${token}` } },
        240000
    );
    if (!res.ok || !res.body) {
        const data = await parseBody(res);
        throw new GatewayHttpError(res.status, data.message || `Gateway ${res.status}`, data.code || null);
    }
    return {
        stream: res.body as unknown as NodeJS.ReadableStream,
        mimeType: String(res.headers.get('content-type') || 'video/mp4').split(';')[0],
    };
};

export interface GatewayTtsResult {
    audio: Buffer;
    demo: boolean;
    balance: number | null;
}

export const gatewayTts = async (
    token: string,
    payload: { text: string; voiceId: string; provider: string; voiceSettings?: unknown }
): Promise<GatewayTtsResult> => {
    const res = await fetchWithTimeout(
        `${GATEWAY_URL}/v1/tts`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
        },
        60000
    );
    if (!res.ok) {
        const data = await parseBody(res);
        throw new GatewayHttpError(res.status, data.message || `Gateway ${res.status}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    const balanceHeader = res.headers.get('x-mileto-balance');
    return {
        audio,
        demo: res.headers.get('x-mileto-demo') === 'true',
        balance: balanceHeader != null ? Number(balanceHeader) : null,
    };
};

export interface GatewaySttWord {
    word: string;
    start: number;
    end: number;
}

export interface GatewaySttResult {
    words: GatewaySttWord[];
    demo: boolean;
    charged: number;
    balance: number | null;
}

export const gatewayStt = async (
    token: string,
    audioBuffer: Buffer,
    filename: string,
    language = 'pt'
): Promise<GatewaySttResult> => {
    const form = new FormData();
    form.append('audio', audioBuffer, { filename: filename || 'audio.mp3', contentType: 'audio/mpeg' });
    form.append('language', language);
    const res = await fetchWithTimeout(
        `${GATEWAY_URL}/v1/stt`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
            body: form,
        },
        120000
    );
    const data = await parseBody(res);
    if (!res.ok) throw new GatewayHttpError(res.status, data.message || `Gateway ${res.status}`);
    return data as GatewaySttResult;
};
