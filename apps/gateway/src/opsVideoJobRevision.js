const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const validationError = (code, message) => Object.assign(new Error(message), {
    status: 422,
    code,
});

/**
 * A chave nasce e permanece no cliente. O gateway somente valida e encaminha
 * o UUID recebido, para que um replay nunca se transforme em outra revisao.
 */
export const normalizeOpsIdempotencyKey = (value, { required = true } = {}) => {
    if (value == null || value === '') {
        if (!required) return null;
        throw validationError('invalid_idempotency_key', 'Idempotency-Key deve ser um UUID.');
    }
    if (Array.isArray(value)) {
        throw validationError('invalid_idempotency_key', 'Idempotency-Key deve ser um UUID.');
    }
    const key = String(value).trim().toLowerCase();
    if (!UUID_PATTERN.test(key)) {
        throw validationError('invalid_idempotency_key', 'Idempotency-Key deve ser um UUID.');
    }
    return key;
};

/** Espelha o videoJobRetrySchema publicado pelo Mileto Ops. */
export const normalizeVideoJobRetryInput = (rawBody) => {
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
        throw validationError('invalid_video_job_retry', 'Pedido de revisao do job invalido.');
    }

    const projectId = typeof rawBody.projectId === 'string' ? rawBody.projectId.trim() : '';
    const expectedRevision = rawBody.expectedRevision;
    const reason = rawBody.reason == null
        ? undefined
        : typeof rawBody.reason === 'string'
            ? rawBody.reason.trim()
            : null;
    const minimumAppVersion = rawBody.minimumAppVersion == null
        ? '1.4.27'
        : typeof rawBody.minimumAppVersion === 'string'
            ? rawBody.minimumAppVersion.trim()
            : '';

    if (
        !projectId
        || projectId.length > 200
        || !Number.isInteger(expectedRevision)
        || expectedRevision < 1
        || (reason !== undefined && (reason === null || !reason || reason.length > 500))
        || !minimumAppVersion
        || minimumAppVersion.length > 40
        || !APP_VERSION_PATTERN.test(minimumAppVersion)
    ) {
        throw validationError('invalid_video_job_retry', 'Pedido de revisao do job invalido.');
    }

    return {
        projectId,
        expectedRevision,
        ...(reason === undefined ? {} : { reason }),
        minimumAppVersion,
    };
};
