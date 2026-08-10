const TEMPORARY_ERROR_PREFIX = 'temporary:';

const TRANSIENT_CODES = new Set([
    'ops_unavailable',
    'ops_timeout',
    'ops_request_failed',
    'ops_token_invalid',
    'rate_limited',
    'too_many_requests',
]);

const TERMINAL_CODES = new Set([
    'invalid_grant',
    'invalid_refresh_token',
    'refresh_token_invalid',
    'refresh_token_revoked',
    'token_revoked',
    'ops_reconnect_required',
]);

const LEGACY_RECOVERABLE_CODES = new Set([
    ...TRANSIENT_CODES,
    'refresh_failed',
    'ops_token_failed',
]);

const normalizedCode = (value, fallback = 'refresh_failed') =>
    String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 120) || fallback;

export const isTransientOpsRefreshError = (error) => {
    const code = normalizedCode(error?.code);
    const status = Number(error?.status || 0);
    if (TERMINAL_CODES.has(code)) return false;
    if (TRANSIENT_CODES.has(code)) return true;
    if (status === 429 || status >= 500 || status === 0) return true;
    if ([400, 401, 403].includes(status)) return false;
    // An unknown failure must not silently revoke a durable authorization.
    return true;
};

export const storedOpsRefreshError = (error) => {
    const code = normalizedCode(error?.code);
    return isTransientOpsRefreshError(error) ? `${TEMPORARY_ERROR_PREFIX}${code}` : code;
};

export const publicOpsRefreshError = (value) => {
    const code = normalizedCode(value, '');
    return code.startsWith(TEMPORARY_ERROR_PREFIX) ? code.slice(TEMPORARY_ERROR_PREFIX.length) : code || null;
};

export const isRecoverableStoredOpsError = (value) => {
    const code = normalizedCode(value, '');
    if (!code) return false;
    if (code.startsWith(TEMPORARY_ERROR_PREFIX)) return true;
    return LEGACY_RECOVERABLE_CODES.has(code);
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const refreshOpsTokenWithRetry = async (
    refresh,
    { attempts = 3, wait = delay, initialDelayMs = 200 } = {}
) => {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await refresh();
        } catch (error) {
            lastError = error;
            if (!isTransientOpsRefreshError(error) || attempt === attempts - 1) throw error;
            await wait(initialDelayMs * 2 ** attempt);
        }
    }
    throw lastError;
};

