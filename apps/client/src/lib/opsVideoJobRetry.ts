import type { OpsVideoJobRetryInput } from './gateway';

export const TEMPORAL_INTEGRITY_RETRY_REASON = 'integrity_temporal_1_4_27';
export const TEMPORAL_INTEGRITY_MINIMUM_APP_VERSION = '1.4.27';

export type RetryStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface TemporalIntegrityRetryRequest {
    jobId: string;
    projectId: string;
    expectedRevision?: number;
    viewContextId?: string | null;
    storage?: RetryStorage | null;
}

export type OpsVideoJobRetrySender<TResult> = (
    jobId: string,
    idempotencyKey: string,
    input: OpsVideoJobRetryInput,
    viewContextId?: string | null,
) => Promise<TResult>;

interface PersistedRetryRequest {
    version: 1;
    jobId: string;
    input: OpsVideoJobRetryInput;
    idempotencyKey: string;
    createdAt: string;
}

const browserStorage = (): RetryStorage | null => {
    try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    } catch {
        return null;
    }
};

const retryStorageKey = (jobId: string, input: OpsVideoJobRetryInput) => {
    const identity = JSON.stringify([
        jobId,
        input.projectId,
        input.expectedRevision,
        input.reason,
        input.minimumAppVersion,
    ]);
    return `mileto:ops-video-job-retry:v1:${encodeURIComponent(identity)}`;
};

const sameInput = (left: OpsVideoJobRetryInput, right: OpsVideoJobRetryInput) => (
    left.projectId === right.projectId
    && left.expectedRevision === right.expectedRevision
    && left.reason === right.reason
    && left.minimumAppVersion === right.minimumAppVersion
);

export const persistentRetryIdempotencyKey = (
    jobId: string,
    input: OpsVideoJobRetryInput,
    storage: RetryStorage | null = browserStorage(),
    createUuid: () => string = () => crypto.randomUUID(),
): string => {
    if (!storage) {
        throw new Error('retry_state_unavailable: Não foi possível persistir a solicitação de revisão.');
    }
    const key = retryStorageKey(jobId, input);
    try {
        const stored = JSON.parse(storage.getItem(key) || 'null') as PersistedRetryRequest | null;
        if (
            stored?.version === 1
            && stored.jobId === jobId
            && sameInput(stored.input, input)
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored.idempotencyKey)
        ) {
            return stored.idempotencyKey;
        }
    } catch {
        // Um registro local corrompido nunca é enviado ao Ops.
    }

    const idempotencyKey = createUuid();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        throw new Error('retry_idempotency_key_invalid: Não foi possível gerar a chave idempotente da revisão.');
    }
    const record: PersistedRetryRequest = {
        version: 1,
        jobId,
        input,
        idempotencyKey,
        createdAt: new Date().toISOString(),
    };
    storage.setItem(key, JSON.stringify(record));
    return idempotencyKey;
};

export const requestTemporalIntegrityRetry = async <TResult>(
    input: TemporalIntegrityRetryRequest,
    sendRetry: OpsVideoJobRetrySender<TResult>,
): Promise<TResult> => {
    const retryInput: OpsVideoJobRetryInput = {
        projectId: input.projectId,
        expectedRevision: Math.max(1, Math.trunc(input.expectedRevision || 1)),
        reason: TEMPORAL_INTEGRITY_RETRY_REASON,
        minimumAppVersion: TEMPORAL_INTEGRITY_MINIMUM_APP_VERSION,
    };
    const idempotencyKey = persistentRetryIdempotencyKey(
        input.jobId,
        retryInput,
        input.storage === undefined ? browserStorage() : input.storage,
    );
    return sendRetry(
        input.jobId,
        idempotencyKey,
        retryInput,
        input.viewContextId,
    );
};
