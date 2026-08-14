import type { OpsVideoJobStage, OpsVideoWorkerExecutionMode } from './gateway';
import type { OpsVideoExecutionDisposition } from './opsVideoWorkerState';

export type OpsExecutorActivityStatus =
    | 'idle'
    | 'queued'
    | 'claimed'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed';

export type OpsExecutorMonitorSource = 'poll' | 'heartbeat';

export type OpsExecutorMonitorError = {
    source: OpsExecutorMonitorSource;
    code: string;
    message: string;
    phase?: string;
    requestId?: string;
    retryable?: boolean;
};

export type OpsExecutorMonitorExplanation = {
    statusLabel: string;
    title: string;
    detail: string;
    action?: string;
};

export type OpsExecutorActivity = {
    jobId?: string;
    companyName?: string;
    projectTitle?: string;
    stage: OpsVideoJobStage;
    status: OpsExecutorActivityStatus;
    percent: number;
    message: string;
    assetId?: string;
    errorCode?: string;
    errorStage?: OpsVideoJobStage;
    errorPhase?: string;
    errorRequestId?: string;
    errorRetryable?: boolean;
    executionDisposition?: OpsVideoExecutionDisposition;
    monitorErrors?: Partial<Record<OpsExecutorMonitorSource, OpsExecutorMonitorError>>;
    mode: OpsVideoWorkerExecutionMode;
    heartbeat: 'pending' | 'online' | 'unsupported' | 'offline';
};

export type OpsExecutorMonitorEvent =
    | {
        type: 'monitor-failed';
        source: OpsExecutorMonitorSource;
        code: string;
        message: string;
        phase?: string;
        requestId?: string;
        retryable?: boolean;
    }
    | {
        type: 'monitor-recovered';
        source: OpsExecutorMonitorSource;
        heartbeat?: OpsExecutorActivity['heartbeat'];
    }
    | { type: 'queue-empty' };

export type OpsExecutorHeartbeatOverride = 'idle' | 'busy' | 'offline';

export type OpsExecutorHeartbeatQueue = {
    request: (stateOverride?: OpsExecutorHeartbeatOverride) => Promise<void>;
};

export const IDLE_OPS_EXECUTOR_ACTIVITY: OpsExecutorActivity = {
    stage: 'queued',
    status: 'idle',
    percent: 0,
    message: 'Executor pronto para receber trabalhos do Mileto Ops.',
    mode: 'foreground',
    heartbeat: 'pending',
};

/**
 * Mantem a saude do monitor separada do resultado do job. Uma falha de
 * heartbeat/polling nunca pode transformar um video concluido em falha.
 */
export const transitionOpsExecutorMonitor = (
    activity: OpsExecutorActivity,
    event: OpsExecutorMonitorEvent,
): OpsExecutorActivity => {
    if (event.type === 'monitor-failed') {
        return {
            ...activity,
            ...(event.source === 'heartbeat' ? { heartbeat: 'offline' as const } : {}),
            monitorErrors: {
                ...(activity.monitorErrors || {}),
                [event.source]: {
                    source: event.source,
                    code: String(event.code || 'monitor_unavailable').slice(0, 120),
                    message: String(event.message || 'Monitor temporariamente indisponivel.').slice(0, 2_000),
                    phase: event.phase,
                    requestId: event.requestId,
                    retryable: event.retryable,
                },
            },
        };
    }

    if (event.type === 'monitor-recovered') {
        const monitorErrors = { ...(activity.monitorErrors || {}) };
        delete monitorErrors[event.source];
        return {
            ...activity,
            ...(event.source === 'heartbeat' && event.heartbeat ? { heartbeat: event.heartbeat } : {}),
            monitorErrors: Object.keys(monitorErrors).length ? monitorErrors : undefined,
        };
    }

    const heartbeatError = activity.monitorErrors?.heartbeat;
    return {
        ...IDLE_OPS_EXECUTOR_ACTIVITY,
        mode: activity.mode,
        heartbeat: activity.heartbeat,
        monitorErrors: heartbeatError ? { heartbeat: heartbeatError } : undefined,
    };
};

/**
 * Serializa heartbeats e reserva o ultimo envio para `offline` no shutdown.
 * Abortar apenas o fetch local nao cancela uma requisicao que ja chegou ao
 * gateway; a fila evita que um `busy` antigo seja gravado depois do `offline`.
 */
export const createOpsExecutorHeartbeatQueue = (
    send: (stateOverride?: OpsExecutorHeartbeatOverride) => Promise<void>,
): OpsExecutorHeartbeatQueue => {
    let active: Promise<void> | null = null;
    let offline: Promise<void> | null = null;
    let shutdownRequested = false;

    const run = (stateOverride?: OpsExecutorHeartbeatOverride) => {
        const tracked = Promise.resolve()
            .then(() => send(stateOverride))
            .finally(() => {
                if (active === tracked) active = null;
            });
        active = tracked;
        return tracked;
    };

    return {
        request(stateOverride) {
            if (stateOverride === 'offline') {
                shutdownRequested = true;
                if (offline) return offline;
                const previous = active || Promise.resolve();
                const queued = previous
                    .catch(() => undefined)
                    .then(() => run('offline'))
                    .finally(() => {
                        if (offline === queued) offline = null;
                    });
                offline = queued;
                return queued;
            }
            if (shutdownRequested) return Promise.resolve();
            return active || run(stateOverride);
        },
    };
};

let currentActivity = IDLE_OPS_EXECUTOR_ACTIVITY;
const listeners = new Set<() => void>();

export const publishOpsExecutorActivity = (activity: OpsExecutorActivity) => {
    currentActivity = activity;
    listeners.forEach((listener) => listener());
};

export const subscribeOpsExecutorActivity = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const getOpsExecutorActivity = () => currentActivity;

export const opsExecutorIsOnline = (activity: OpsExecutorActivity) =>
    activity.heartbeat === 'online';

export const opsExecutorIsWorking = (activity: OpsExecutorActivity) =>
    activity.status === 'queued' || activity.status === 'claimed' || activity.status === 'running';

export const opsExecutorVisibleJobError = (activity: OpsExecutorActivity) =>
    activity.status === 'paused' || activity.status === 'failed'
        ? activity.errorCode
        : undefined;

export const opsExecutorCurrentMonitorError = (activity: OpsExecutorActivity) =>
    activity.monitorErrors?.heartbeat || activity.monitorErrors?.poll;

const normalizeMonitorCode = (value: unknown) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, '_')
    .slice(0, 120);

const OPS_TEMPORARILY_UNAVAILABLE_CODES = new Set([
    'invalid_response',
    'ops_request_failed',
    'ops_timeout',
    'ops_token_failed',
    'ops_token_invalid',
    'ops_unavailable',
    'rate_limited',
    'server_error',
    'slow_down',
    'temporarily_unavailable',
    'too_many_requests',
]);

const OPS_RECONNECT_CODES = new Set([
    'access_denied',
    'connection_revoked',
    'invalid_grant',
    'invalid_refresh_token',
    'invalid_scope',
    'ops_not_connected',
    'ops_reconnect_required',
    'ops_scope_missing',
    'refresh_token_invalid',
    'refresh_token_revoked',
    'token_revoked',
]);

const OPS_ACCESS_CODES = new Set([
    'actor_missing',
    'actor_unavailable',
    'linked_profile_unavailable',
    'ops_user_not_linked',
    'view_context_expired',
    'view_context_forbidden',
]);

/**
 * Traduz o diagnostico tecnico do monitor para uma explicacao que diferencia
 * falha do Ops, autorizacao expirada e indisponibilidade do app local.
 */
export const describeOpsExecutorMonitorError = (
    error?: OpsExecutorMonitorError,
): OpsExecutorMonitorExplanation | null => {
    if (!error) return null;
    const code = normalizeMonitorCode(error.code);

    if (OPS_TEMPORARILY_UNAVAILABLE_CODES.has(code)) {
        return {
            statusLabel: 'Ops indisponível',
            title: 'Mileto Ops temporariamente indisponível',
            detail: code === 'ops_token_failed' || code === 'ops_token_invalid'
                ? 'O serviço do Ops não conseguiu renovar a autenticação. O executor deste computador continua funcionando e tentará novamente automaticamente.'
                : 'O serviço do Ops não respondeu corretamente. O executor deste computador continua funcionando e tentará novamente automaticamente.',
        };
    }

    if (OPS_RECONNECT_CODES.has(code)) {
        return {
            statusLabel: 'Reconectar Ops',
            title: 'Reconexão com o Mileto Ops necessária',
            detail: 'A autorização do Ops expirou, foi revogada ou perdeu uma permissão necessária.',
            action: 'Abra Integrações e conecte novamente a conta do Mileto Ops.',
        };
    }

    if (OPS_ACCESS_CODES.has(code)) {
        return {
            statusLabel: 'Atualizar acesso',
            title: 'Acesso ao Mileto Ops precisa ser atualizado',
            detail: 'O usuário ou o contexto de visualização atual não está mais autorizado no Ops.',
            action: 'Abra Integrações para renovar o vínculo e o acesso.',
        };
    }

    if (code === 'ops_not_configured') {
        return {
            statusLabel: 'Configurar Ops',
            title: 'Integração com o Mileto Ops não configurada',
            detail: 'O executor local está aberto, mas o servidor ainda não possui a configuração necessária para falar com o Ops.',
        };
    }

    const technicalMessage = String(error.message || '').trim();
    return {
        statusLabel: 'Falha de conexão',
        title: 'Não foi possível confirmar a conexão com o Mileto Ops',
        detail: technicalMessage
            ? `${technicalMessage} O Mileto tentará novamente automaticamente.`
            : 'O motivo ainda não foi identificado. O Mileto tentará novamente automaticamente.',
    };
};

export const OPS_EXECUTOR_STAGE_LABELS: Record<OpsVideoJobStage, string> = {
    queued: 'Na fila',
    narration: 'Narração',
    takes: 'Takes',
    quick_edit: 'Edição rápida',
    captions: 'Legendas',
    titles: 'Títulos',
    export: 'Exportação',
    completed: 'Concluído',
    failed: 'Falha',
};
