import type { OpsVideoJob, OpsVideoJobStage } from './gateway';
import type { ExportResultDiagnostics } from './exportIntegrity';

export const OPS_VIDEO_WORKER_APP_VERSION = '1.4.28';
export const OPS_VIDEO_WORKER_STATE_KEY = 'mileto:ops-video-worker:active:v1';

export type OpsVideoWorkerLocalStatus =
    | 'ready'
    | 'claimed'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed';

export interface OpsVideoWorkerResumeData {
    projectPrepared: boolean;
    renderStarted: boolean;
    exportJobId?: string | null;
    outputAssetId?: string | null;
    uploadIdempotencyKey?: string | null;
    renderResult?: ExportResultDiagnostics | null;
}

export interface PersistedOpsVideoWorkerJob {
    version: 1;
    jobId: string;
    projectId: string;
    companyId: string;
    executionRevision: number;
    requiresFreshRender: boolean;
    destinationFolderId: string | null;
    takeAssetIds: string[];
    viewContextId: string;
    stage: OpsVideoJobStage;
    progress: number;
    message: string;
    status: OpsVideoWorkerLocalStatus;
    jobSignature: string;
    preparedAt: string;
    updatedAt: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    resume: OpsVideoWorkerResumeData;
}

export const OPS_VIDEO_PROGRESS = Object.freeze({
    narration: { start: 5, end: 20 },
    takes: { start: 20, end: 35 },
    quick_edit: { start: 35, end: 60 },
    captions: { start: 60, end: 72 },
    titles: { start: 72, end: 82 },
    export: { start: 82, end: 99 },
    completed: { start: 100, end: 100 },
});

type WorkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserStorage = (): WorkerStorage | null => {
    try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    } catch {
        return null;
    }
};

const text = (value: unknown, max = 2_000) => String(value || '').trim().slice(0, max);

const versionParts = (value: string): [number, number, number] | null => {
    const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
};

export const opsWorkerSupportsMinimumVersion = (
    minimumVersion?: string | null,
    currentVersion = OPS_VIDEO_WORKER_APP_VERSION,
): boolean => {
    if (!minimumVersion) return true;
    const minimum = versionParts(minimumVersion);
    const current = versionParts(currentVersion);
    if (!minimum || !current) return false;
    for (let index = 0; index < minimum.length; index += 1) {
        if (current[index] > minimum[index]) return true;
        if (current[index] < minimum[index]) return false;
    }
    return true;
};

const opsVideoJobCoreIdentity = (job: OpsVideoJob) => ({
    jobId: job.id,
    workOrderId: job.workOrderId,
    companyId: job.companyId,
    projectId: job.projectId,
    projectTitle: job.projectTitle,
    objective: job.objective,
    narration: job.narration?.trim() || '',
    voicePresetId: job.voicePresetId || null,
    format: job.format,
    takeAssetIds: job.takeAssetIds,
    destinationFolderId: job.destinationFolderId || null,
    quickEdit: job.quickEdit,
    shuffleTakes: job.shuffleTakes,
    captions: job.captions,
    automaticTitles: job.automaticTitles,
    settings: job.settings,
});

const legacyOpsVideoJobSignature = (job: OpsVideoJob): string => JSON.stringify(opsVideoJobCoreIdentity(job));

export const opsVideoJobSignature = (job: OpsVideoJob): string => JSON.stringify({
    ...opsVideoJobCoreIdentity(job),
    execution: {
        revision: Math.max(1, Number(job.execution?.revision || 1)),
        intent: job.execution?.intent || 'initial',
        requiresFreshRender: job.execution?.requiresFreshRender === true,
        minimumAppVersion: job.execution?.minimumAppVersion || null,
        previousOutputAssetId: job.execution?.previousOutputAssetId || null,
    },
});

export const createPersistedOpsVideoJob = (
    job: OpsVideoJob,
    viewContextId: string,
): PersistedOpsVideoWorkerJob => {
    const now = new Date().toISOString();
    const executionRevision = Math.max(1, Number(job.execution?.revision || 1));
    const requiresFreshRender = job.execution?.requiresFreshRender === true;
    return {
        version: 1,
        jobId: job.id,
        projectId: job.projectId,
        companyId: job.companyId,
        executionRevision,
        requiresFreshRender,
        destinationFolderId: job.destinationFolderId || null,
        takeAssetIds: [...job.takeAssetIds],
        viewContextId,
        stage: job.stage || 'queued',
        progress: Math.max(0, Math.min(100, Number(job.progress?.percent || 0))),
        message: text(job.progress?.message || 'Preparando o trabalho recebido do Mileto Ops.'),
        status: 'ready',
        jobSignature: opsVideoJobSignature(job),
        preparedAt: now,
        updatedAt: now,
        resume: {
            projectPrepared: false,
            renderStarted: false,
            exportJobId: null,
            outputAssetId: requiresFreshRender ? null : (job.outputAssetId || null),
            uploadIdempotencyKey: null,
            renderResult: null,
        },
    };
};

export const loadPersistedOpsVideoJob = (
    storage: WorkerStorage | null = browserStorage(),
): PersistedOpsVideoWorkerJob | null => {
    if (!storage) return null;
    try {
        const parsed = JSON.parse(storage.getItem(OPS_VIDEO_WORKER_STATE_KEY) || 'null') as PersistedOpsVideoWorkerJob | null;
        if (!parsed || parsed.version !== 1) return null;
        if (!text(parsed.jobId, 200) || !text(parsed.projectId, 200) || !text(parsed.companyId, 200)) return null;
        if (!text(parsed.viewContextId, 300) || !Array.isArray(parsed.takeAssetIds)) return null;
        // O token de claim nunca faz parte desta estrutura. Um estado antigo ou
        // adulterado que contenha esse segredo e descartado por inteiro.
        if ('claimToken' in (parsed as unknown as Record<string, unknown>)) return null;
        const executionRevision = Math.max(1, Number(parsed.executionRevision || 1));
        const requiresFreshRender = parsed.requiresFreshRender === true;
        return {
            ...parsed,
            executionRevision,
            requiresFreshRender,
            resume: {
                projectPrepared: parsed.resume?.projectPrepared === true,
                renderStarted: parsed.resume?.renderStarted === true,
                exportJobId: parsed.resume?.exportJobId || null,
                outputAssetId: requiresFreshRender && !parsed.executionRevision
                    ? null
                    : (parsed.resume?.outputAssetId || null),
                uploadIdempotencyKey: parsed.resume?.uploadIdempotencyKey || null,
                renderResult: parsed.resume?.renderResult || null,
            },
        };
    } catch {
        return null;
    }
};

export const savePersistedOpsVideoJob = (
    state: PersistedOpsVideoWorkerJob,
    storage: WorkerStorage | null = browserStorage(),
): PersistedOpsVideoWorkerJob => {
    const next = { ...state, updatedAt: new Date().toISOString() };
    if (!storage) throw new Error('worker_state_unavailable: Nao foi possivel persistir o estado do executor local.');
    storage.setItem(OPS_VIDEO_WORKER_STATE_KEY, JSON.stringify(next));
    return next;
};

export const updatePersistedOpsVideoJob = (
    changes: Omit<Partial<PersistedOpsVideoWorkerJob>, 'resume'> & { resume?: Partial<OpsVideoWorkerResumeData> },
    storage: WorkerStorage | null = browserStorage(),
): PersistedOpsVideoWorkerJob | null => {
    const current = loadPersistedOpsVideoJob(storage);
    if (!current) return null;
    return savePersistedOpsVideoJob({
        ...current,
        ...changes,
        jobId: current.jobId,
        projectId: current.projectId,
        companyId: current.companyId,
        executionRevision: current.executionRevision,
        requiresFreshRender: current.requiresFreshRender,
        viewContextId: current.viewContextId,
        jobSignature: current.jobSignature,
        resume: { ...current.resume, ...(changes.resume || {}) },
    }, storage);
};

/**
 * Renova apenas a credencial temporaria de contexto usada para acessar o job.
 * A identidade e a assinatura do trabalho permanecem imutaveis; o chamador so
 * deve usar esta funcao depois de confirmar o mesmo job pelo novo contexto.
 */
export const rebindPersistedOpsVideoJobContext = (
    nextViewContextId: string,
    storage: WorkerStorage | null = browserStorage(),
): PersistedOpsVideoWorkerJob | null => {
    const current = loadPersistedOpsVideoJob(storage);
    const normalizedContextId = text(nextViewContextId, 300);
    if (!current || !normalizedContextId) return null;
    return savePersistedOpsVideoJob({
        ...current,
        viewContextId: normalizedContextId,
        status: current.status === 'failed' || current.status === 'completed' ? current.status : 'paused',
        message: 'Contexto delegado renovado. Retomando o mesmo trabalho com seguranca.',
        errorCode: null,
        errorMessage: null,
    }, storage);
};

export const clearPersistedOpsVideoJob = (storage: WorkerStorage | null = browserStorage()) => {
    storage?.removeItem(OPS_VIDEO_WORKER_STATE_KEY);
};

export const isPersistedJobCompatible = (
    state: PersistedOpsVideoWorkerJob,
    job: OpsVideoJob,
): boolean => {
    const jobRevision = Math.max(1, Number(job.execution?.revision || 1));
    const freshRender = job.execution?.requiresFreshRender === true;
    const signatureMatches = state.jobSignature === opsVideoJobSignature(job)
        || (
            state.jobSignature === legacyOpsVideoJobSignature(job)
            && jobRevision === 1
            && !freshRender
        );
    return state.jobId === job.id
        && state.projectId === job.projectId
        && state.companyId === job.companyId
        && state.executionRevision === jobRevision
        && state.requiresFreshRender === freshRender
        && state.destinationFolderId === (job.destinationFolderId || null)
        && signatureMatches;
};

export const progressWithinStage = (stage: keyof typeof OPS_VIDEO_PROGRESS, fraction: number): number => {
    const band = OPS_VIDEO_PROGRESS[stage];
    const normalized = Math.max(0, Math.min(1, Number(fraction) || 0));
    return Math.round(band.start + ((band.end - band.start) * normalized));
};
