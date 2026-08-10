const TEMPORARY_ERROR_PREFIX = 'temporary:';
const CONFIGURATION_ERROR_PREFIX = 'configuration:';

const CONFIGURATION_CODES = new Set([
    'invalid_client',
    'invalid_request',
    'unauthorized_client',
    'unsupported_grant_type',
]);

const TRANSIENT_CODES = new Set([
    'ops_unavailable',
    'ops_timeout',
    'ops_request_failed',
    'ops_token_invalid',
    'rate_limited',
    'slow_down',
    'server_error',
    'temporarily_unavailable',
    'invalid_client',
    'too_many_requests',
]);

const TERMINAL_CODES = new Set([
    'invalid_grant',
    'invalid_refresh_token',
    'refresh_token_invalid',
    'refresh_token_revoked',
    'token_revoked',
    'ops_reconnect_required',
    'ops_scope_missing',
    'invalid_scope',
    'insufficient_scope',
    'access_denied',
]);

const LEGACY_RECOVERABLE_CODES = new Set([
    ...TRANSIENT_CODES,
    'refresh_failed',
    'ops_token_failed',
]);

const normalizedCode = (value, fallback = 'refresh_failed') =>
    String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 120) || fallback;

const normalizedScopes = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];

export const opsRefreshConnectionState = ({ tokenScopes, storedScopes, requiredScopes }) => {
    const received = normalizedScopes(tokenScopes);
    const scopes = received.length ? received : normalizedScopes(storedScopes);
    const granted = new Set(scopes);
    const missingScopes = normalizedScopes(requiredScopes).filter((scope) => !granted.has(scope));
    return {
        scopes,
        missingScopes,
        status: missingScopes.length ? 'error' : 'active',
        lastError: missingScopes.length ? 'ops_scope_missing' : null,
    };
};

export const isTransientOpsRefreshError = (error) => {
    const code = normalizedCode(error?.code);
    const status = Number(error?.status || 0);
    // HTTP transitório prevalece sobre um código inconsistente do provedor. O
    // vínculo só vira terminal quando o Ops realmente confirma revogação,
    // token inválido ou necessidade de novas permissões.
    if (status === 429 || status >= 500) return true;
    if (TERMINAL_CODES.has(code)) return false;
    if (TRANSIENT_CODES.has(code)) return true;
    // An unknown failure must not silently revoke a durable authorization.
    return true;
};

export const storedOpsRefreshError = (error) => {
    const code = normalizedCode(error?.code);
    if (CONFIGURATION_CODES.has(code)) return `${CONFIGURATION_ERROR_PREFIX}${code}`;
    return isTransientOpsRefreshError(error) ? `${TEMPORARY_ERROR_PREFIX}${code}` : code;
};

export const publicOpsRefreshError = (value) => {
    const code = normalizedCode(value, '');
    if (code.startsWith(TEMPORARY_ERROR_PREFIX)) return code.slice(TEMPORARY_ERROR_PREFIX.length);
    if (code.startsWith(CONFIGURATION_ERROR_PREFIX)) return code.slice(CONFIGURATION_ERROR_PREFIX.length);
    return code || null;
};

export const storedOpsRefreshIssue = (value) => {
    const code = normalizedCode(value, '');
    if (code.startsWith(TEMPORARY_ERROR_PREFIX)) return 'temporary';
    if (code.startsWith(CONFIGURATION_ERROR_PREFIX)) return 'configuration';
    return null;
};

export const isRecoverableStoredOpsError = (value) => {
    const code = normalizedCode(value, '');
    if (!code) return false;
    if (code.startsWith(TEMPORARY_ERROR_PREFIX)) return true;
    if (code.startsWith(CONFIGURATION_ERROR_PREFIX)) return true;
    return LEGACY_RECOVERABLE_CODES.has(code);
};

// O refresh do Ops é rotativo e de uso único. Sem Idempotency-Key/replay no
// servidor, repetir a mesma credencial após uma resposta perdida pode ser
// interpretado como reutilização e revogar toda a família. Uma nova operação
// poderá tentar de novo; retries no mesmo token só voltam após o contrato Ops
// tornar a rotação idempotente.
export const refreshOpsTokenSafely = async (refresh) => refresh();
