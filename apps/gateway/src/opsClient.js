import { config } from './config.js';
import { parseOpsOAuthError } from './opsOAuthError.js';

export class OpsHttpError extends Error {
    constructor(status, code, message, requestId = null) {
        super(message);
        this.name = 'OpsHttpError';
        this.status = Number(status) || 502;
        this.code = code || 'ops_request_failed';
        this.requestId = requestId;
    }
}

export const requireOpsConfig = () => {
    if (!config.ops.enabled) {
        throw new OpsHttpError(
            503,
            'ops_not_configured',
            'A integração com o Mileto Ops ainda não foi configurada neste servidor.'
        );
    }
};

const endpoint = (path) => {
    requireOpsConfig();
    const clean = String(path || '');
    if (!clean.startsWith('/') || clean.startsWith('//')) {
        throw new OpsHttpError(500, 'invalid_ops_path', 'Caminho interno do Mileto Ops inválido.');
    }
    return `${config.ops.baseUrl}/api/integrations/mileto-ai-video${clean}`;
};

const parse = async (response) => {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { error: { code: 'invalid_response', message: 'Resposta inválida do Mileto Ops.' } };
    }
};

const request = async (path, init = {}, timeoutMs = 30000) => {
    let response;
    const externalSignal = init.signal instanceof AbortSignal ? init.signal : null;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
    try {
        response = await fetch(endpoint(path), {
            ...init,
            headers: {
                Accept: 'application/json',
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                ...(init.headers || {}),
            },
            signal,
        });
    } catch (error) {
        const name = error?.name;
        if (externalSignal?.aborted) {
            throw new OpsHttpError(499, 'ops_request_cancelled', 'A requisição ao Mileto Ops foi cancelada.');
        }
        if (name === 'AbortError' || name === 'TimeoutError') {
            throw new OpsHttpError(504, 'ops_timeout', 'O Mileto Ops demorou demais para responder.');
        }
        throw new OpsHttpError(503, 'ops_unavailable', 'Não foi possível conectar ao Mileto Ops.');
    }

    const payload = await parse(response);
    if (!response.ok) {
        const error = payload?.error || payload || {};
        throw new OpsHttpError(
            response.status,
            error.code || 'ops_request_failed',
            error.message || `Mileto Ops respondeu ${response.status}.`,
            error.requestId || payload?.meta?.requestId || null
        );
    }
    return payload;
};

const tokenRequest = async (body) => {
    requireOpsConfig();
    let response;
    try {
        response = await fetch(endpoint('/oauth/token'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams(body),
            signal: AbortSignal.timeout(30000),
        });
    } catch (error) {
        const name = error?.name;
        if (name === 'AbortError' || name === 'TimeoutError') {
            throw new OpsHttpError(504, 'ops_timeout', 'A autenticação do Mileto Ops demorou demais para responder.');
        }
        throw new OpsHttpError(503, 'ops_unavailable', 'Não foi possível autenticar no Mileto Ops.');
    }
    const payload = await parse(response);
    if (!response.ok) {
        const error = parseOpsOAuthError(payload);
        throw new OpsHttpError(
            response.status,
            error.code,
            error.message,
            error.requestId || null
        );
    }
    const data = payload?.data || payload;
    const accessToken = data.accessToken || data.access_token;
    if (!accessToken) throw new OpsHttpError(502, 'ops_token_invalid', 'O Mileto Ops não devolveu access token.');
    return {
        accessToken,
        refreshToken: data.refreshToken || data.refresh_token || null,
        expiresIn: Math.max(30, Number(data.expiresIn || data.expires_in || 600)),
        scopes: String(data.scope || data.scopes || '').split(/[\s,]+/).filter(Boolean),
    };
};

export const exchangeAuthorizationCode = (code, codeVerifier) =>
    tokenRequest({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: config.ops.redirectUri,
        client_id: config.ops.clientId,
        client_secret: config.ops.clientSecret,
        code_verifier: String(codeVerifier),
    });

export const refreshAccessToken = (refreshToken) =>
    tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: String(refreshToken),
        client_id: config.ops.clientId,
        client_secret: config.ops.clientSecret,
    });

export const revokeToken = async (token) => {
    if (!token || !config.ops.enabled) return;
    await request('/oauth/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            token: String(token),
            client_id: config.ops.clientId,
            client_secret: config.ops.clientSecret,
        }),
    }).catch(() => undefined);
};

export const opsApi = async (accessToken, path, init = {}) => {
    const payload = await request(path, {
        ...init,
        headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
    });
    return payload;
};

export const unwrapOpsData = (payload) => (payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload);
