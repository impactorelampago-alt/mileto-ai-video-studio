import type { OpsVideoJobStage, OpsVideoWorkerExecutionMode } from './gateway';

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
