import type { OpsVideoJobStage, OpsVideoWorkerExecutionMode } from './gateway';

export type OpsExecutorActivityStatus =
    | 'idle'
    | 'queued'
    | 'claimed'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'offline';

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
    mode: OpsVideoWorkerExecutionMode;
    heartbeat: 'pending' | 'online' | 'unsupported' | 'offline';
};

export const IDLE_OPS_EXECUTOR_ACTIVITY: OpsExecutorActivity = {
    stage: 'queued',
    status: 'idle',
    percent: 0,
    message: 'Executor pronto para receber trabalhos do Mileto Ops.',
    mode: 'foreground',
    heartbeat: 'pending',
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
    activity.heartbeat === 'online' && activity.status !== 'offline';

export const opsExecutorIsWorking = (activity: OpsExecutorActivity) =>
    activity.status === 'queued' || activity.status === 'claimed' || activity.status === 'running';

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
