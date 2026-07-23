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
    constructor(status: number, message: string) {
        super(message);
        this.name = 'GatewayHttpError';
        this.status = status;
    }
}

/** Extrai o Bearer token que o app mandou para o servidor local. */
export const bearerFrom = (req: Request): string | null => {
    const header = (req.headers.authorization || '') as string;
    return header.startsWith('Bearer ') ? header.slice(7) : null;
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

export interface GatewayChatResult {
    text: string;
    demo: boolean;
    charged: number;
    balance: number | null;
}

export interface GatewayChatPayload {
    messages: { role: string; content: string }[];
    model?: string;
    reasoning?: string;
    locale?: string;
    system?: string;
    json?: boolean;
}

export const gatewayChat = async (token: string, payload: GatewayChatPayload): Promise<GatewayChatResult> => {
    const res = await fetch(`${GATEWAY_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    const data = await parseBody(res);
    if (!res.ok) throw new GatewayHttpError(res.status, data.message || `Gateway ${res.status}`);
    return data as GatewayChatResult;
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
    const res = await fetch(`${GATEWAY_URL}/v1/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
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
    const res = await fetch(`${GATEWAY_URL}/v1/stt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: form as any,
    });
    const data = await parseBody(res);
    if (!res.ok) throw new GatewayHttpError(res.status, data.message || `Gateway ${res.status}`);
    return data as GatewaySttResult;
};
