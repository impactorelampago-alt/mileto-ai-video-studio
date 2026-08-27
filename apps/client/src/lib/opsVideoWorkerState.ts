import type { OpsVideoJob, OpsVideoJobStage } from './gateway';
import type { ExportResultDiagnostics } from './exportIntegrity';

// Injetada pelo Vite a partir do package.json. O heartbeat precisa anunciar a
// versao real do executavel; um literal manual fica obsoleto a cada release e
// faz o Ops preservar jobs compatíveis na fila como se o app fosse antigo.
export const OPS_VIDEO_WORKER_APP_VERSION = typeof __MILETO_APP_VERSION__ === 'string'
    ? __MILETO_APP_VERSION__
    : '0.0.0';
export const OPS_VIDEO_WORKER_STATE_KEY = 'mileto:ops-video-worker:active:v1';

export type OpsVideoWorkerLocalStatus =
    | 'ready'
    | 'claimed'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed';

export type OpsVideoExecutionDisposition =
    | 'revision_possible'
    | 'new_execution'
    | 'project_original_missing'
    | 'new_execution_required'
    | 'temporarily_unavailable';

export interface OpsVideoWorkerDiagnostic {
    code: string;
    message: string;
    stage: OpsVideoJobStage;
    retryable: boolean;
    phase?: string;
    requestId?: string;
}

export type OpsVideoWorkerCompanySource =
    | 'mileto_ops_company'
    | 'legacy_job_company_id'
    | 'unresolved';

export interface OpsVideoClaimIdentityDecision {
    action: 'continue' | 'rebase' | 'reject';
    code?: 'ops_claim_job_mismatch' | 'ops_claim_revision_regressed';
    message: string;
    retryable: boolean;
    queuedRevision: number;
    claimedRevision: number;
}

export interface OpsVideoExecutionDispositionInput {
    isRevisionExecution: boolean;
    requiresFreshRender: boolean;
    hasCompatibleProject: boolean;
    hasPreviousExecutionEvidence: boolean;
    hasCompletePayload: boolean;
    projectLookupUnavailable?: boolean;
}

export interface OpsVideoExecutionDispositionDecision {
    disposition: OpsVideoExecutionDisposition;
    canExecute: boolean;
    code?: 'project_original_missing' | 'new_execution_required' | 'temporarily_unavailable';
    message: string;
    retryable: boolean;
    phase: 'project_preflight';
}

/**
 * Decide se uma solicitacao do Ops pode revisar o projeto original ou precisa
 * ser tratada como uma execucao realmente nova. Evidencia de uma renderizacao
 * anterior nunca autoriza recriar um projeto ausente a partir de um payload
 * parcial: nesse caso o executor para antes de gerar ou cobrar.
 */
export const resolveOpsVideoExecutionDisposition = (
    input: OpsVideoExecutionDispositionInput,
): OpsVideoExecutionDispositionDecision => {
    if (input.projectLookupUnavailable) {
        return {
            disposition: 'temporarily_unavailable',
            canExecute: false,
            code: 'temporarily_unavailable',
            message: 'O projeto local nao pode ser consultado agora. O executor tentara novamente sem criar outro projeto.',
            retryable: true,
            phase: 'project_preflight',
        };
    }
    if (input.hasCompatibleProject) {
        return {
            disposition: 'revision_possible',
            canExecute: true,
            message: 'Projeto original completo encontrado; a revisao pode continuar com seguranca.',
            retryable: false,
            phase: 'project_preflight',
        };
    }
    if (input.isRevisionExecution && input.requiresFreshRender && input.hasCompletePayload) {
        return {
            disposition: 'new_execution',
            canExecute: true,
            message: 'O projeto local completo nao esta disponivel; o payload integral sera executado como uma nova renderizacao no projectId solicitado pelo Ops.',
            retryable: false,
            phase: 'project_preflight',
        };
    }
    if (input.isRevisionExecution && input.hasPreviousExecutionEvidence) {
        return {
            disposition: 'project_original_missing',
            canExecute: false,
            code: 'project_original_missing',
            message: 'Existe evidencia da execucao anterior, mas o projeto original completo e o payload integral nao estao disponiveis neste computador. Nenhum projeto substituto foi criado.',
            retryable: false,
            phase: 'project_preflight',
        };
    }
    if (input.isRevisionExecution) {
        return {
            disposition: 'new_execution_required',
            canExecute: false,
            code: 'new_execution_required',
            message: 'Nao ha projeto original nem payload integral suficiente para executar com seguranca. O Ops precisa reenfileirar uma nova execucao completa.',
            retryable: false,
            phase: 'project_preflight',
        };
    }
    return {
        disposition: 'new_execution',
        canExecute: true,
        message: 'Execucao inicial validada com o payload recebido do Ops.',
        retryable: false,
        phase: 'project_preflight',
    };
};

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
    companySource: OpsVideoWorkerCompanySource;
    companyFallbackUsed: boolean;
    companyFallbackReason?: string | null;
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
    executionDisposition?: OpsVideoExecutionDisposition;
    diagnostic?: OpsVideoWorkerDiagnostic | null;
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

const EXECUTION_DISPOSITIONS = new Set<OpsVideoExecutionDisposition>([
    'revision_possible',
    'new_execution',
    'project_original_missing',
    'new_execution_required',
    'temporarily_unavailable',
]);

const normalizeExecutionDisposition = (value: unknown): OpsVideoExecutionDisposition =>
    EXECUTION_DISPOSITIONS.has(value as OpsVideoExecutionDisposition)
        ? value as OpsVideoExecutionDisposition
        : 'new_execution';

const normalizeDiagnostic = (value: unknown): OpsVideoWorkerDiagnostic | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Partial<OpsVideoWorkerDiagnostic>;
    const code = text(source.code, 120).replace(/[^a-z0-9_.:-]+/gi, '_');
    const message = text(source.message);
    const stage = source.stage;
    if (!code || !message || !stage || !(stage in OPS_VIDEO_PROGRESS || stage === 'failed')) return null;
    return {
        code,
        message,
        stage,
        retryable: source.retryable === true,
        phase: text(source.phase, 120) || undefined,
        requestId: text(source.requestId, 120).replace(/[^a-z0-9_.:-]+/gi, '_') || undefined,
    };
};

const normalizeCompanySource = (value: unknown): OpsVideoWorkerCompanySource => (
    value === 'mileto_ops_company' || value === 'legacy_job_company_id'
        ? value
        : 'unresolved'
);

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
    frameAssetId: job.frameAssetId || null,
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

/**
 * Confere novamente a identidade depois do claim. A resposta do claim e a
 * fonte autoritativa, mas nunca pode apontar para outro job nem regredir a
 * revisao que acabou de ser lida da fila. Mudancas validas de revisao ou
 * payload exigem um checkpoint novo, sem reaproveitar artefatos anteriores.
 */
export const resolveOpsVideoClaimIdentity = (
    queued: OpsVideoJob,
    claimed: OpsVideoJob,
): OpsVideoClaimIdentityDecision => {
    const queuedRevision = Math.max(1, Number(queued.execution?.revision || 1));
    const claimedRevision = Math.max(1, Number(claimed.execution?.revision || 1));
    if (claimed.id !== queued.id) {
        return {
            action: 'reject',
            code: 'ops_claim_job_mismatch',
            message: 'O claim devolveu outro job. Nenhum projeto ou render foi iniciado.',
            retryable: false,
            queuedRevision,
            claimedRevision,
        };
    }
    if (claimedRevision < queuedRevision) {
        return {
            action: 'reject',
            code: 'ops_claim_revision_regressed',
            message: 'O claim devolveu uma revisao anterior a que estava na fila. O executor aguardara o Ops sincronizar o job.',
            retryable: true,
            queuedRevision,
            claimedRevision,
        };
    }
    const sameProject = claimed.projectId === queued.projectId;
    const samePayload = opsVideoJobSignature(claimed) === opsVideoJobSignature(queued);
    if (sameProject && claimedRevision === queuedRevision && samePayload) {
        return {
            action: 'continue',
            message: 'A identidade recebida no claim corresponde ao job lido da fila.',
            retryable: false,
            queuedRevision,
            claimedRevision,
        };
    }
    return {
        action: 'rebase',
        message: 'O claim trouxe uma revisao ou payload mais novo. O checkpoint anterior foi descartado e recriado a partir da identidade reclamada.',
        retryable: false,
        queuedRevision,
        claimedRevision,
    };
};

export const createPersistedOpsVideoJob = (
    job: OpsVideoJob,
    viewContextId: string,
): PersistedOpsVideoWorkerJob => {
    const now = new Date().toISOString();
    const executionRevision = Math.max(1, Number(job.execution?.revision || 1));
    const requiresFreshRender = job.execution?.requiresFreshRender === true;
    const companyResolution = job.projectCompanyResolution;
    return {
        version: 1,
        jobId: job.id,
        projectId: job.projectId,
        companyId: job.companyId,
        companySource: companyResolution?.source || 'unresolved',
        companyFallbackUsed: companyResolution?.fallbackUsed === true,
        companyFallbackReason: companyResolution?.fallbackReason || null,
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
        executionDisposition: 'new_execution',
        diagnostic: null,
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
            companySource: normalizeCompanySource(parsed.companySource),
            companyFallbackUsed: parsed.companyFallbackUsed === true,
            companyFallbackReason: text(parsed.companyFallbackReason, 160) || null,
            executionDisposition: normalizeExecutionDisposition(parsed.executionDisposition),
            diagnostic: normalizeDiagnostic(parsed.diagnostic),
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
        diagnostic: null,
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
