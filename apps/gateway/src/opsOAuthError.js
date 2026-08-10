const asRecord = (value) => (value && typeof value === 'object' ? value : {});

export const parseOpsOAuthError = (payload) => {
    const root = asRecord(payload);
    const nested = root.error;
    const detail = asRecord(nested);
    const code = typeof nested === 'string'
        ? nested
        : detail.code || detail.error || root.code || 'ops_token_failed';
    const message = detail.message
        || detail.error_description
        || root.error_description
        || root.message
        || 'O Mileto Ops recusou a autenticação.';
    return {
        code: String(code || 'ops_token_failed'),
        message: String(message),
        requestId: detail.requestId || detail.request_id || root.requestId || root.request_id || null,
    };
};
