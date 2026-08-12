import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useExportJobs } from '../context/ExportJobsContext';
import { createDefaultAdData, DEFAULT_CAPTION_STYLE } from '../context/WizardContext';
import { normalizeHydratedCaptionStyle } from '../lib/captionStyleMigration';
import {
    GatewayError,
    gatewayApi,
    type OpsAsset,
    type OpsCompany,
    type OpsVideoJob,
    type OpsVideoJobUpdate,
    type OpsVideoJobStage,
    type OpsViewContext,
    type OpsVideoWorkerExecutionMode,
} from '../lib/gateway';
import { opsProjectCompanyName, opsViewContextIdentity } from '../lib/opsProjectBrand';
import {
    clearPersistedOpsVideoJob,
    createPersistedOpsVideoJob,
    isPersistedJobCompatible,
    loadPersistedOpsVideoJob,
    OPS_VIDEO_PROGRESS,
    OPS_VIDEO_WORKER_APP_VERSION,
    opsVideoJobSignature,
    opsWorkerSupportsMinimumVersion,
    progressWithinStage,
    rebindPersistedOpsVideoJobContext,
    savePersistedOpsVideoJob,
    updatePersistedOpsVideoJob,
    type OpsVideoWorkerLocalStatus,
    type PersistedOpsVideoWorkerJob,
} from '../lib/opsVideoWorkerState';
import { applyQuickEdit } from '../lib/quickEdit';
import { canonicalSystemVoiceId, DEFAULT_SYSTEM_VOICE, SYSTEM_VOICES } from '../lib/systemVoices';
import { systemMusicTrackFor } from '../lib/systemMusic';
import {
    AUTOMATIC_TITLES_UNAVAILABLE_WARNING,
    generateAutomaticCaptions,
    generateAutomaticTitlesResilient,
    generateNarrationAndMix,
    isTitleGenerationAbortError,
    loadAutomatedProject,
    materializeOpsTake,
    persistAutomatedProject,
    prepareOpsExportMetadata,
} from '../lib/videoAgentWorkflow';
import { selectOpsTakesForNarration } from '../lib/opsTakeSelection';
import { API_BASE_URL } from '../lib/apiBase';
import {
    createOpsExecutorHeartbeatQueue,
    IDLE_OPS_EXECUTOR_ACTIVITY,
    publishOpsExecutorActivity,
    transitionOpsExecutorMonitor,
    type OpsExecutorActivity,
} from '../lib/opsExecutorActivity';
import type { AdData, MediaTake } from '../types';
import {
    exportWarningSummary,
    type ExportResultDiagnostics,
} from '../lib/exportIntegrity';

const POLL_INTERVAL_MS = 12_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const EXPORT_TIMEOUT_MS = 60 * 60 * 1_000;

type QueuedJob = { job: OpsVideoJob; context: OpsViewContext; resume?: PersistedOpsVideoWorkerJob | null };
type OpsExportEvent = {
    projectId?: string;
    exportJobId?: string;
    assetId?: string;
    message?: string;
    renderResult?: ExportResultDiagnostics;
};
type CompletedOpsExport = {
    assetId: string;
    renderResult?: ExportResultDiagnostics;
    sourceJobId?: string;
    executionRevision?: number;
};
type JobDisplayState = OpsExecutorActivity;

type ElectronIpc = {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, listener: (...args: unknown[]) => void) => void;
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
};

type PreparedJob = {
    company: OpsCompany;
    assetById: Map<string, OpsAsset>;
    eligibleAssets: OpsAsset[];
    frameAsset: OpsAsset | null;
    initialAdData: AdData;
    musicId: string | null;
};

const IDLE_DISPLAY = IDLE_OPS_EXECUTOR_ACTIVITY;

const electronIpc = (): ElectronIpc | null => {
    try {
        const runtime = (window as unknown as { require?: (name: string) => { ipcRenderer?: ElectronIpc } }).require?.('electron');
        return runtime?.ipcRenderer || null;
    } catch {
        return null;
    }
};

const technicalFileName = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'video_mileto';

const errorParts = (error: unknown) => {
    if (error instanceof GatewayError) {
        return {
            code: String(error.code || (error.status ? `http_${error.status}` : 'gateway_unavailable')).slice(0, 120),
            message: error.message.slice(0, 2_000),
        };
    }
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/^([a-z0-9_]+):\s*(.+)$/i);
    return match
        ? { code: match[1].slice(0, 120), message: match[2].slice(0, 2_000) }
        : { code: 'ai_video_failed', message: message.slice(0, 2_000) };
};

const isRecoverableInterruption = (error: unknown, code: string) => {
    if (error instanceof GatewayError) {
        return error.status === 0
            || error.status === 401
            || error.status === 408
            || error.status === 409
            || error.status === 423
            || error.status === 426
            || error.status === 429
            || error.status >= 500;
    }
    return [
        'export_busy',
        'ops_export_timeout',
        'worker_interrupted',
        'claim_unavailable',
        'gateway_unavailable',
        'video_worker_upgrade_required',
        'video_job_revision_changed',
    ].includes(code) || (error instanceof Error && error.name === 'AbortError');
};

const isPersistedResolutionFailure = (code: string) => [
    'job_resume_mismatch',
    'view_context_expired',
    'worker_state_unavailable',
].includes(code);

const completedExportFor = (job: OpsVideoJob): CompletedOpsExport | null => {
    if (job.execution?.requiresFreshRender === true) return null;
    try {
        const raw = localStorage.getItem(`mileto:ops-export:${job.projectId}`);
        if (!raw) return null;
        const value = JSON.parse(raw) as {
            assetId?: string;
            companyId?: string;
            folderId?: string | null;
            renderResult?: ExportResultDiagnostics;
            sourceJobId?: string;
            executionRevision?: number;
        };
        if (!value.assetId || value.companyId !== job.companyId) return null;
        if ((value.folderId || null) !== (job.destinationFolderId || null)) return null;
        if (value.sourceJobId && value.sourceJobId !== job.id) return null;
        const revision = Math.max(1, Number(job.execution?.revision || 1));
        if (value.executionRevision && value.executionRevision !== revision) return null;
        return {
            assetId: value.assetId,
            renderResult: value.renderResult,
            sourceJobId: value.sourceJobId,
            executionRevision: value.executionRevision,
        };
    } catch {
        return null;
    }
};

const hydratePreparedTakes = async (
    savedTakes: MediaTake[],
    assetsById: Map<string, OpsAsset>,
    context: OpsViewContext,
    allowedAssetIds: Set<string>,
): Promise<MediaTake[]> => {
    const materialized = new Map<string, MediaTake>();
    const result: MediaTake[] = [];
    for (const saved of savedTakes) {
        const assetId = saved.externalMedia?.assetId;
        if (!assetId || !allowedAssetIds.has(assetId)) {
            throw new Error('agent_resume_take_mismatch: O projeto salvo possui um take fora da ordem de servico atual.');
        }
        const asset = assetsById.get(assetId);
        if (!asset) throw new Error('agent_resume_take_missing: Um take do projeto salvo nao esta mais disponivel no Ops.');
        let local = materialized.get(assetId);
        if (!local) {
            local = await materializeOpsTake(asset, context, saved.id);
            materialized.set(assetId, local);
        }
        result.push({
            ...local,
            ...saved,
            id: saved.id,
            url: local.url,
            fileUrl: local.fileUrl,
            proxyUrl: local.proxyUrl,
            backendPath: local.backendPath,
            externalMedia: local.externalMedia,
        });
    }
    return result;
};

const waitForOpsExport = (projectId: string, exportJobId: string): Promise<CompletedOpsExport> => new Promise((resolve, reject) => {
    let timeout = 0;
    const cleanup = () => {
        window.removeEventListener('mileto:ops-export-complete', onComplete as EventListener);
        window.removeEventListener('mileto:ops-export-failed', onFailed as EventListener);
        if (timeout) window.clearTimeout(timeout);
    };
    const onComplete = (event: Event) => {
        const detail = (event as CustomEvent<OpsExportEvent>).detail || {};
        if (detail.projectId !== projectId || detail.exportJobId !== exportJobId || !detail.assetId) return;
        cleanup();
        resolve({ assetId: detail.assetId, renderResult: detail.renderResult });
    };
    const onFailed = (event: Event) => {
        const detail = (event as CustomEvent<OpsExportEvent>).detail || {};
        if (detail.projectId !== projectId) return;
        cleanup();
        reject(new Error(detail.message || 'ops_export_failed: O envio ao Mileto Ops falhou.'));
    };
    window.addEventListener('mileto:ops-export-complete', onComplete as EventListener);
    window.addEventListener('mileto:ops-export-failed', onFailed as EventListener);
    timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('ops_export_timeout: A exportacao excedeu o tempo maximo de uma hora.'));
    }, EXPORT_TIMEOUT_MS);
});

const orderedContexts = async (): Promise<OpsViewContext[]> => {
    const response = await gatewayApi.opsViewContexts();
    const contexts = response.data?.contexts || [];
    return [
        ...contexts.filter((context) => context.contextId === response.data.defaultContextId),
        ...contexts.filter((context) => context.contextId !== response.data.defaultContextId),
    ];
};

const findQueuedJob = async (): Promise<QueuedJob | null> => {
    let successfulLookups = 0;
    let lastAccessError: unknown = null;
    let transientLookupError: unknown = null;
    for (const context of await orderedContexts()) {
        try {
            const job = await gatewayApi.nextOpsVideoJob(context.contextId);
            successfulLookups += 1;
            if (job) return { job, context };
        } catch (error) {
            // Um contexto pode expirar enquanto os demais continuam validos.
            if (error instanceof GatewayError && [401, 403, 404].includes(error.status)) {
                lastAccessError = error;
            } else {
                transientLookupError = error;
            }
        }
    }
    // Nao afirmar que a fila esta vazia se algum contexto acessivel sofreu
    // timeout/5xx. Erros de acesso isolados podem ser ignorados quando outro
    // contexto respondeu normalmente.
    if (transientLookupError) throw transientLookupError;
    if (successfulLookups === 0 && lastAccessError) throw lastAccessError;
    return null;
};

const resolvePersistedJob = async (state: PersistedOpsVideoWorkerJob): Promise<QueuedJob | null> => {
    const contexts = await orderedContexts();
    const preferred = contexts.find((candidate) => candidate.contextId === state.viewContextId);
    const candidates = preferred
        ? [preferred, ...contexts.filter((candidate) => candidate.contextId !== preferred.contextId)]
        : contexts;

    for (const context of candidates) {
        try {
            const job = await gatewayApi.getOpsVideoJob(state.jobId, context.contextId);
            if (job.status !== 'completed' && job.status !== 'failed' && !isPersistedJobCompatible(state, job)) {
                const latestRevision = Math.max(1, Number(job.execution?.revision || 1));
                const sameJobAdvancedRevision = job.id === state.jobId
                    && job.projectId === state.projectId
                    && job.companyId === state.companyId
                    && latestRevision > state.executionRevision;
                if (sameJobAdvancedRevision) {
                    clearPersistedOpsVideoJob();
                    return { job, context };
                }
                throw new Error('job_resume_mismatch: O trabalho mudou no Ops e nao pode ser retomado com o estado local anterior.');
            }
            const resume = context.contextId === state.viewContextId
                ? state
                : rebindPersistedOpsVideoJobContext(context.contextId);
            if (!resume) throw new Error('worker_state_unavailable: Nao foi possivel renovar o contexto do executor local.');
            return { job, context, resume };
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('job_resume_mismatch:')) throw error;
            if (error instanceof GatewayError && [401, 403, 404].includes(error.status)) continue;
            throw error;
        }
    }
    throw new Error('view_context_expired: O contexto delegado do trabalho expirou. Reconecte o Mileto Ops para renovar o acesso e retomar automaticamente.');
};

const validateBeforeClaim = async (job: OpsVideoJob, context: OpsViewContext): Promise<PreparedJob> => {
    if (
        job.execution?.requiresFreshRender === true
        && (
            !Number.isInteger(job.execution.revision)
            || job.execution.revision < 1
        )
    ) {
        throw new Error('video_job_revision_invalid: O Ops não forneceu uma revisão válida para o fresh render seguro.');
    }
    const minimumAppVersion = job.execution?.minimumAppVersion || null;
    if (!opsWorkerSupportsMinimumVersion(minimumAppVersion)) {
        throw new Error(
            `video_worker_upgrade_required: Este trabalho exige o Mileto AI Video ${minimumAppVersion} ou superior. Atualize o aplicativo antes de continuar.`,
        );
    }
    const company = (await gatewayApi.opsCompany(job.companyId, context.contextId)).data;
    const voice = job.voicePresetId
        ? SYSTEM_VOICES.find((candidate) => candidate.id === canonicalSystemVoiceId(job.voicePresetId))
        : DEFAULT_SYSTEM_VOICE;
    if (!voice) throw new Error(`voice_preset_not_found: A voz solicitada (${job.voicePresetId}) nao existe neste Mileto AI Video.`);
    const music = systemMusicTrackFor(voice.preset.musicTrackId) || systemMusicTrackFor(DEFAULT_SYSTEM_VOICE.preset.musicTrackId);
    const assets = (await gatewayApi.opsAssets(job.companyId, { viewContextId: context.contextId })).data;
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const missing = job.takeAssetIds.filter((id) => !assetById.has(id));
    if (missing.length) throw new Error(`ops_take_missing: ${missing.length} take(s) selecionado(s) nao estao mais disponiveis na empresa.`);
    const eligibleAssets = job.takeAssetIds.map((id) => assetById.get(id)!);
    if (eligibleAssets.some((asset) => asset.companyId !== job.companyId)) {
        throw new Error('ops_take_company_mismatch: O Ops devolveu um take que nao pertence a empresa do job.');
    }
    const settingsFrameId = typeof job.settings?.frameOverlayAssetId === 'string'
        ? job.settings.frameOverlayAssetId
        : null;
    const frameAssetId = job.frameAssetId || settingsFrameId;
    const frameAsset = frameAssetId ? assetById.get(frameAssetId) || null : null;
    if (frameAssetId && !frameAsset) {
        throw new Error('ops_frame_missing: A moldura PNG solicitada nao esta mais disponivel na empresa.');
    }
    if (frameAsset && (
        frameAsset.companyId !== job.companyId
        || frameAsset.kind !== 'image'
        || frameAsset.mimeType?.toLowerCase() !== 'image/png'
    )) {
        throw new Error('ops_frame_invalid: A moldura precisa ser um PNG autorizado da empresa do job.');
    }
    const initialAdData = createDefaultAdData({
        title: job.projectTitle,
        format: job.format,
        narrationText: job.narration?.trim() || '',
        selectedVoiceId: voice.id,
        selectedVoiceProvider: voice.provider,
        voiceSettings: { ...voice.preset.voiceSettings },
        musicAudioUrl: music ? `${API_BASE_URL}${music.publicUrl}` : null,
        audioConfig: {
            narration: { ...voice.preset.audioConfig.narration },
            background: { ...voice.preset.audioConfig.background },
        },
        opsCompany: {
            id: company.id,
            name: opsProjectCompanyName(company),
            viewContextIdentity: opsViewContextIdentity(context),
            viewContextLabel: context.label,
        },
        brandPalette: company.palette || null,
        brandPaletteUpdatedAt: company.paletteUpdatedAt || null,
    });
    return { company, assetById, eligibleAssets, frameAsset, initialAdData, musicId: music?.id || null };
};

export const OpsVideoJobCoordinator = () => {
    const { isExporting, startExport } = useExportJobs();
    const runningRef = useRef(false);
    const exportingRef = useRef(isExporting);
    const [initialPersistedJob] = useState(() => loadPersistedOpsVideoJob());
    const currentJobRef = useRef<string | null>(
        initialPersistedJob && initialPersistedJob.status !== 'completed' && initialPersistedJob.status !== 'failed'
            ? initialPersistedJob.jobId
            : null,
    );
    const heartbeatContextRef = useRef<string | null>(initialPersistedJob?.viewContextId || null);
    const heartbeatGenerationRef = useRef(0);
    const heartbeatAbortRef = useRef<AbortController | null>(null);
    const titleGenerationAbortRef = useRef<AbortController | null>(null);
    const modeRef = useRef<OpsVideoWorkerExecutionMode>('foreground');
    const [display, setDisplay] = useState<JobDisplayState>(() => {
        const persisted = initialPersistedJob;
        return persisted ? {
            jobId: persisted.jobId,
            companyName: persisted.companyId,
            projectTitle: persisted.projectId,
            stage: persisted.stage,
            status: persisted.status === 'paused' || persisted.status === 'completed' || persisted.status === 'failed'
                ? persisted.status
                : 'queued',
            percent: persisted.progress,
            message: persisted.message,
            assetId: persisted.resume.outputAssetId || undefined,
            errorCode: persisted.errorCode || undefined,
            mode: 'foreground',
            heartbeat: 'pending',
        } : IDLE_DISPLAY;
    });

    useEffect(() => { exportingRef.current = isExporting; }, [isExporting]);
    useEffect(() => () => {
        titleGenerationAbortRef.current?.abort();
        heartbeatGenerationRef.current += 1;
        heartbeatAbortRef.current?.abort();
    }, []);

    useEffect(() => {
        publishOpsExecutorActivity(display);
    }, [display]);

    const setMode = useCallback((mode: OpsVideoWorkerExecutionMode) => {
        modeRef.current = mode;
        setDisplay((current) => ({ ...current, mode }));
    }, []);

    useEffect(() => {
        const ipc = electronIpc();
        const visibility = () => setMode(document.hidden ? 'background' : 'foreground');
        const modeChanged = (_event: unknown, payload: unknown) => {
            const mode = (payload as { executionMode?: string })?.executionMode;
            if (mode === 'foreground' || mode === 'background') setMode(mode);
        };
        document.addEventListener('visibilitychange', visibility);
        if (ipc) {
            ipc.on('executor:mode-changed', modeChanged);
            void ipc.invoke('executor:get-runtime').then((payload) => modeChanged(null, payload)).catch(() => undefined);
        } else {
            visibility();
        }
        return () => {
            document.removeEventListener('visibilitychange', visibility);
            ipc?.removeListener('executor:mode-changed', modeChanged);
        };
    }, [setMode]);

    const performHeartbeat = useCallback(async (stateOverride?: 'idle' | 'busy' | 'offline') => {
        const generation = heartbeatGenerationRef.current + 1;
        heartbeatGenerationRef.current = generation;
        const controller = new AbortController();
        heartbeatAbortRef.current = controller;
        const isLatest = () => generation === heartbeatGenerationRef.current && !controller.signal.aborted;
        let contextId = heartbeatContextRef.current;
        try {
            if (!contextId) {
                const activeJobId = currentJobRef.current;
                const persisted = activeJobId ? loadPersistedOpsVideoJob() : null;
                if (activeJobId && persisted?.jobId === activeJobId) {
                    const resolved = await resolvePersistedJob(persisted);
                    contextId = resolved?.context.contextId || null;
                } else if (!activeJobId) {
                    contextId = (await orderedContexts())[0]?.contextId || null;
                }
                heartbeatContextRef.current = contextId;
            }
            if (!isLatest()) return;
            if (!contextId) {
                setDisplay((current) => transitionOpsExecutorMonitor(current, {
                    type: 'monitor-recovered',
                    source: 'heartbeat',
                    heartbeat: 'unsupported',
                }));
                return;
            }
            const result = await gatewayApi.heartbeatOpsVideoWorker({
                appVersion: OPS_VIDEO_WORKER_APP_VERSION,
                mode: modeRef.current,
                state: stateOverride || (currentJobRef.current ? 'busy' : 'idle'),
                currentJobId: currentJobRef.current,
            }, contextId, controller.signal);
            if (!isLatest()) return;
            setDisplay((current) => transitionOpsExecutorMonitor(current, {
                type: 'monitor-recovered',
                source: 'heartbeat',
                heartbeat: stateOverride === 'offline'
                    ? 'offline'
                    : (result.supported ? 'online' : 'unsupported'),
            }));
        } catch (error) {
            if (!isLatest()) return;
            if (error instanceof GatewayError && [401, 403, 404].includes(error.status)) {
                heartbeatContextRef.current = null;
            }
            const parsed = errorParts(error);
            setDisplay((current) => transitionOpsExecutorMonitor(current, {
                type: 'monitor-failed',
                source: 'heartbeat',
                code: parsed.code,
                message: parsed.message,
            }));
        } finally {
            if (heartbeatAbortRef.current === controller) {
                heartbeatAbortRef.current = null;
            }
        }
    }, []);

    const heartbeatQueueRef = useRef<ReturnType<typeof createOpsExecutorHeartbeatQueue> | null>(null);
    if (!heartbeatQueueRef.current) {
        heartbeatQueueRef.current = createOpsExecutorHeartbeatQueue(performHeartbeat);
    }
    const heartbeat = useCallback(
        (stateOverride?: 'idle' | 'busy' | 'offline') => heartbeatQueueRef.current!.request(stateOverride),
        [],
    );

    useEffect(() => {
        void heartbeat();
        const timer = window.setInterval(() => { void heartbeat(); }, HEARTBEAT_INTERVAL_MS);
        const ipc = electronIpc();
        const shutdown = () => {
            titleGenerationAbortRef.current?.abort();
            const active = loadPersistedOpsVideoJob();
            if (active && active.status !== 'completed' && active.status !== 'failed') {
                const paused = updatePersistedOpsVideoJob({
                    status: 'paused',
                    message: 'Aplicativo encerrado. O mesmo trabalho sera retomado na proxima abertura.',
                });
                if (paused) {
                    setDisplay((current) => ({
                        ...current,
                        status: 'paused',
                        stage: paused.stage,
                        percent: paused.progress,
                        message: paused.message,
                    }));
                }
            }
            void heartbeat('offline').finally(() => {
                void ipc?.invoke('executor:shutdown-complete').catch(() => undefined);
            });
        };
        ipc?.on('executor:shutdown', shutdown);
        return () => {
            window.clearInterval(timer);
            ipc?.removeListener('executor:shutdown', shutdown);
        };
    }, [heartbeat]);

    const execute = useCallback(async (queued: QueuedJob) => {
        const readiness = await validateBeforeClaim(queued.job, queued.context);
        let persisted = queued.resume && isPersistedJobCompatible(queued.resume, queued.job)
            ? queued.resume
            : createPersistedOpsVideoJob(queued.job, queued.context.contextId);
        if (!queued.resume) persisted = savePersistedOpsVideoJob(persisted);
        currentJobRef.current = queued.job.id;
        heartbeatContextRef.current = queued.context.contextId;
        const companyName = opsProjectCompanyName(readiness.company);
        setDisplay((current) => ({
            ...transitionOpsExecutorMonitor(current, { type: 'monitor-recovered', source: 'poll' }),
            jobId: queued.job.id,
            companyName,
            projectTitle: queued.job.projectTitle,
            stage: persisted.stage,
            status: queued.resume ? 'paused' : 'queued',
            percent: persisted.progress,
            message: queued.resume ? 'Retomando o mesmo projeto apos a interrupcao.' : 'Validacoes concluidas. Assumindo o trabalho com seguranca.',
            errorCode: undefined,
        }));

        let activeClaim = await gatewayApi.claimOpsVideoJob(queued.job.id, queued.context.contextId);
        const job = activeClaim.job;
        const resume = Boolean(queued.resume);
        persisted = updatePersistedOpsVideoJob({ status: 'claimed', message: 'Trabalho assumido pelo executor local.' }) || persisted;
        toast.info(resume
            ? `Retomando "${job.projectTitle}" no mesmo projeto.`
            : `O agente Video Maker iniciou "${job.projectTitle}".`, { duration: 6_000 });

        const patch = async (
            stage: Exclude<OpsVideoJobStage, 'queued'>,
            percent: number,
            message: string,
            extra: {
                status?: 'running' | 'completed' | 'failed';
                revision?: number;
                outputAssetId?: string;
                renderResult?: ExportResultDiagnostics;
                errorCode?: string;
                errorMessage?: string;
            } = {},
        ) => {
            const localStatus: OpsVideoWorkerLocalStatus = extra.status || 'running';
            const completing = extra.status === 'completed';
            const applyLocalPatch = () => {
                persisted = updatePersistedOpsVideoJob({
                    stage,
                    progress: percent,
                    message,
                    status: localStatus,
                    errorCode: extra.errorCode || null,
                    errorMessage: extra.errorMessage || null,
                    resume: extra.outputAssetId || extra.renderResult
                        ? { outputAssetId: extra.outputAssetId, renderResult: extra.renderResult }
                        : undefined,
                }) || persisted;
                setDisplay((current) => ({
                    ...current,
                    jobId: job.id,
                    companyName,
                    projectTitle: job.projectTitle,
                    stage,
                    status: extra.status || 'running',
                    percent,
                    message,
                    assetId: extra.outputAssetId || current.assetId,
                    errorCode: extra.errorCode,
                }));
            };
            // A conclusão só vira estado local terminal depois que o Ops confirma
            // atomicamente revisão, claim, novo asset e renderResult.
            if (!completing) applyLocalPatch();
            const update: OpsVideoJobUpdate = {
                status: extra.status || 'running',
                stage,
                percent,
                message,
                revision: extra.revision ?? job.execution?.revision,
                outputAssetId: extra.outputAssetId,
                renderResult: extra.renderResult,
                errorCode: extra.errorCode,
                errorMessage: extra.errorMessage,
            };
            const sendUpdate = () => gatewayApi.updateOpsVideoJob(
                job.id,
                activeClaim.claimToken,
                update,
                queued.context.contextId,
            );
            let updatedJob: OpsVideoJob;
            try {
                updatedJob = await sendUpdate();
            } catch (error) {
                const revisionConflict = error instanceof GatewayError
                    && error.status === 409
                    && ['video_job_revision_mismatch', 'video_job_not_claimed'].includes(String(error.code || ''));
                if (!revisionConflict) throw error;

                const latest = await gatewayApi.getOpsVideoJob(job.id, queued.context.contextId);
                const currentRevision = Math.max(1, Number(job.execution?.revision || 1));
                const latestRevision = Math.max(1, Number(latest.execution?.revision || 1));
                if (
                    latestRevision !== currentRevision
                    || latest.projectId !== job.projectId
                    || latest.companyId !== job.companyId
                ) {
                    clearPersistedOpsVideoJob();
                    throw new Error('video_job_revision_changed: O Ops abriu uma revisão mais nova. O executor descartou o estado anterior e fará um novo claim do mesmo job.');
                }
                if (
                    latest.status === 'completed'
                    && extra.status === 'completed'
                    && latest.outputAssetId === extra.outputAssetId
                ) {
                    updatedJob = latest;
                } else if (opsVideoJobSignature(latest) !== opsVideoJobSignature(job)) {
                    clearPersistedOpsVideoJob();
                    throw new Error('video_job_revision_changed: O conteúdo da revisão mudou no Ops. O executor descartou o estado anterior e fará um novo claim do mesmo job.');
                } else {
                    activeClaim = await gatewayApi.claimOpsVideoJob(job.id, queued.context.contextId);
                    updatedJob = await sendUpdate();
                }
            }
            if (completing) applyLocalPatch();
            setDisplay((current) => transitionOpsExecutorMonitor(current, {
                type: 'monitor-recovered',
                source: 'poll',
            }));
            return updatedJob;
        };

        const showLocalProgress = (stage: OpsVideoJobStage, percent: number, message: string) => {
            persisted = updatePersistedOpsVideoJob({ stage, progress: percent, message, status: 'running' }) || persisted;
            setDisplay((current) => ({
                ...current,
                stage,
                status: 'running',
                percent,
                message,
                errorCode: undefined,
            }));
        };

        try {
            if (resume) {
                const stage = persisted.stage === 'queued' ? 'narration' : persisted.stage;
                const percent = Math.max(5, persisted.progress);
                await patch(stage as Exclude<OpsVideoJobStage, 'queued'>, percent, `Retomando: ${persisted.message}`);
            } else {
                // O primeiro progresso remoto acontece imediatamente depois do claim.
                await patch('narration', OPS_VIDEO_PROGRESS.narration.start, 'Preparando a narração.');
            }

            const executionRevision = Math.max(1, Number(job.execution?.revision || 1));
            const requiresFreshRender = job.execution?.requiresFreshRender === true;
            const isRevisionExecution = job.execution?.intent === 'revision' || executionRevision > 1;
            const revisionResume = requiresFreshRender
                && persisted.executionRevision === executionRevision
                && persisted.resume.outputAssetId
                && persisted.resume.renderResult
                && persisted.resume.renderResult.sourceJobId === job.id
                && persisted.resume.renderResult.projectId === job.projectId
                ? {
                    assetId: persisted.resume.outputAssetId,
                    renderResult: persisted.resume.renderResult,
                }
                : null;
            const previousExport = completedExportFor(job);
            const previousAssetId = requiresFreshRender
                ? revisionResume?.assetId
                : (job.outputAssetId || previousExport?.assetId || persisted.resume.outputAssetId);
            const previousRenderResult = requiresFreshRender
                ? revisionResume?.renderResult
                : previousExport?.renderResult;
            if (previousAssetId) {
                if (requiresFreshRender && previousAssetId === job.execution?.previousOutputAssetId) {
                    throw new Error('output_asset_not_fresh: A revisão tentou reutilizar o asset anterior e foi bloqueada antes da conclusão.');
                }
                if (requiresFreshRender && !previousRenderResult) {
                    throw new Error('render_integrity_report_missing: A revisão não pode concluir sem o diagnóstico do novo MP4.');
                }
                const previousWarning = previousRenderResult
                    ? exportWarningSummary(previousRenderResult.warnings)
                    : undefined;
                await patch('completed', 100, previousWarning
                    ? `${previousWarning}; vídeo já concluído e confirmado no Mileto Ops.`
                    : 'Video ja concluido e confirmado no Mileto Ops.', {
                    status: 'completed',
                    revision: job.execution?.revision,
                    outputAssetId: previousAssetId,
                    renderResult: previousRenderResult,
                });
                clearPersistedOpsVideoJob();
                currentJobRef.current = null;
                return;
            }

            let frameOverlay: MediaTake | undefined;
            if (readiness.frameAsset) {
                const materializedFrame = await materializeOpsTake(
                    readiness.frameAsset,
                    queued.context,
                    `${job.projectId}-frame-${readiness.frameAsset.id}`,
                );
                if (materializedFrame.type !== 'image') {
                    throw new Error('ops_frame_invalid: O ativo materializado nao e uma imagem PNG.');
                }
                frameOverlay = { ...materializedFrame, objectFit: 'contain' };
            }

            let adData: AdData = { ...readiness.initialAdData, frameOverlay };
            let titleWarning: string | null = null;
            let finalTakes: MediaTake[] = [];
            let captionStyle = { ...DEFAULT_CAPTION_STYLE };
            let selectedMusicId = readiness.musicId;
            const savedProject = (persisted.resume.projectPrepared || isRevisionExecution)
                ? await loadAutomatedProject(job.projectId)
                : null;
            const canResumeProject = Boolean(
                savedProject
                && savedProject.title === job.projectTitle.trim()
                && savedProject.adData.opsCompany?.id === job.companyId
                && savedProject.adData.narrationText.trim() === (job.narration?.trim() || '')
                && savedProject.adData.format === job.format
                && (savedProject.adData.frameOverlay?.externalMedia?.assetId || null) === (readiness.frameAsset?.id || null)
                && savedProject.mediaTakes.length > 0,
            );

            if (isRevisionExecution && !canResumeProject) {
                throw new Error('fresh_render_project_unavailable: A revisão exige o projeto original completo neste computador. Nenhum job ou projeto substituto foi criado.');
            }

            if (canResumeProject && savedProject) {
                showLocalProgress('titles', OPS_VIDEO_PROGRESS.titles.end, 'Restaurando o projeto salvo e renovando as URLs dos takes.');
                adData = { ...savedProject.adData, frameOverlay };
                titleWarning = savedProject.adData.titleGenerationSummary?.warning || null;
                captionStyle = normalizeHydratedCaptionStyle(savedProject.captionStyle);
                selectedMusicId = savedProject.selectedMusicId;
                finalTakes = await hydratePreparedTakes(
                    savedProject.mediaTakes,
                    readiness.assetById,
                    queued.context,
                    new Set(job.takeAssetIds),
                );
            } else {
                showLocalProgress('narration', 8, 'Gerando a narracao e preparando a trilha de fundo.');
                adData = await generateNarrationAndMix(adData);
                await patch('narration', OPS_VIDEO_PROGRESS.narration.end, 'Narracao final pronta e validada.');
                const selection = selectOpsTakesForNarration(
                    readiness.eligibleAssets,
                    Number(adData.narrationDuration || 0),
                    job,
                );
                const orderedAssets = selection.takes;
                await patch(
                    'takes',
                    OPS_VIDEO_PROGRESS.takes.start,
                    `Selecionando ${selection.targetCount} ${selection.targetCount === 1 ? 'corte recente' : 'cortes recentes'} da pasta TAKES, com alvo de ${selection.targetSeconds.toFixed(1)} segundos.`,
                );
                const materializedByAssetId = new Map<string, MediaTake>();
                for (let index = 0; index < orderedAssets.length; index += 1) {
                    const asset = orderedAssets[index];
                    const takeId = `${job.projectId}-take-${index + 1}-${asset.id}`;
                    let materialized = materializedByAssetId.get(asset.id);
                    if (!materialized) {
                        materialized = await materializeOpsTake(asset, queued.context, takeId);
                        materializedByAssetId.set(asset.id, materialized);
                    }
                    finalTakes.push(materialized.id === takeId ? materialized : { ...materialized, id: takeId });
                    showLocalProgress(
                        'takes',
                        progressWithinStage('takes', (index + 1) / Math.max(1, orderedAssets.length + 1)),
                        `Importando takes: ${index + 1} de ${orderedAssets.length}.`,
                    );
                }
                const reuseMessage = selection.reusedCount > 0
                    ? ` ${selection.reusedCount} ${selection.reusedCount === 1 ? 'repetição foi necessária' : 'repetições foram necessárias'} porque o acervo recente era menor que a duração do áudio.`
                    : '';
                await patch(
                    'takes',
                    OPS_VIDEO_PROGRESS.takes.end,
                    `${finalTakes.length} ${finalTakes.length === 1 ? 'corte montado' : 'cortes montados'} com ${selection.uniqueAssetCount} ${selection.uniqueAssetCount === 1 ? 'take importado e validado' : 'takes importados e validados'}.${reuseMessage}`,
                );

                await patch('quick_edit', OPS_VIDEO_PROGRESS.quick_edit.start, job.quickEdit
                    ? 'Aplicando a Edicao Rapida aos takes.'
                    : 'Edicao Rapida nao solicitada; preservando os cortes.');
                if (job.quickEdit) {
                    const quickEdit = await applyQuickEdit(
                        finalTakes,
                        Number(adData.narrationDuration || 0),
                        adData.globalTransition,
                        (source, index) => `${job.projectId}-loop-${index + 1}-${source.id}`,
                    );
                    finalTakes = quickEdit.takes;
                    adData = { ...adData, globalTransition: quickEdit.transition };
                }
                await patch('quick_edit', OPS_VIDEO_PROGRESS.quick_edit.end, 'Cortes e acabamento dos takes concluidos.');

                await patch('captions', OPS_VIDEO_PROGRESS.captions.start, job.captions
                    ? 'Gerando e revisando as legendas automaticas.'
                    : 'Legendas automaticas nao solicitadas.');
                if (job.captions) adData = await generateAutomaticCaptions(adData);
                await patch('captions', OPS_VIDEO_PROGRESS.captions.end, job.captions ? 'Legendas automaticas prontas.' : 'Etapa de legendas ignorada.');

                await patch('titles', OPS_VIDEO_PROGRESS.titles.start, job.automaticTitles
                    ? 'Aplicando gatilhos, modelos e paleta da empresa.'
                    : 'Titulos automaticos nao solicitados.');
                if (job.automaticTitles) {
                    const titleController = new AbortController();
                    titleGenerationAbortRef.current = titleController;
                    try {
                        const titleResult = await generateAutomaticTitlesResilient(adData, {
                            signal: titleController.signal,
                            resolvedBrand: {
                                required: true,
                                company: readiness.company,
                                context: queued.context,
                                // A validação feita antes do claim é a fonte fresca.
                                // Um projeto retomado pode conter uma paleta antiga.
                                palette: readiness.initialAdData.brandPalette || null,
                                paletteUpdatedAt: readiness.initialAdData.brandPaletteUpdatedAt || null,
                            },
                            onProgress: (progress) => {
                                const fraction = progress.phase === 'brand'
                                    ? 0.1
                                    : progress.phase === 'ai'
                                      ? 0.35
                                      : progress.phase === 'fallback'
                                        ? 0.75
                                        : 0.95;
                                showLocalProgress('titles', progressWithinStage('titles', fraction), progress.message);
                            },
                        });
                        adData = titleResult.adData;
                        titleWarning = titleResult.warning || null;
                    } catch (error) {
                        if (isTitleGenerationAbortError(error)) throw error;
                        // Títulos são um enriquecimento opcional. Uma falha inesperada não pode
                        // invalidar narração, takes, legendas ou o projeto já montado.
                        adData = {
                            ...adData,
                            dynamicTitles: [],
                            titleGenerationSummary: {
                                requested: true,
                                outcome: 'none',
                                titleCount: 0,
                                warning: AUTOMATIC_TITLES_UNAVAILABLE_WARNING,
                                warnings: [{
                                    code: 'automatic_titles_unavailable',
                                    message: AUTOMATIC_TITLES_UNAVAILABLE_WARNING,
                                }],
                                diagnostic: { code: 'automatic_titles_unavailable', phase: 'titles' },
                                generatedAt: new Date().toISOString(),
                            },
                        };
                        titleWarning = AUTOMATIC_TITLES_UNAVAILABLE_WARNING;
                        console.warn('[title-generation]', {
                            event: 'coordinator_degraded',
                            code: 'automatic_titles_unavailable',
                            stage: 'titles',
                        });
                    } finally {
                        if (titleGenerationAbortRef.current === titleController) {
                            titleGenerationAbortRef.current = null;
                        }
                    }
                } else {
                    adData = {
                        ...adData,
                        dynamicTitles: [],
                        titleGenerationSummary: {
                            requested: false,
                            outcome: 'skipped',
                            titleCount: 0,
                            generatedAt: new Date().toISOString(),
                        },
                    };
                }
                await patch('titles', OPS_VIDEO_PROGRESS.titles.end, job.automaticTitles
                    ? titleWarning || 'Titulos automaticos prontos.'
                    : 'Etapa de titulos ignorada.');

                await persistAutomatedProject({
                    projectId: job.projectId,
                    title: job.projectTitle,
                    adData,
                    mediaTakes: finalTakes,
                    captionStyle,
                    selectedMusicId,
                    exported: false,
                });
                persisted = updatePersistedOpsVideoJob({ resume: { projectPrepared: true } }) || persisted;
            }

            // Projetos retomados podem guardar a identidade de um contexto já expirado
            // ou anterior. O job atual acabou de ser autorizado em `queued.context`;
            // mantenha a empresa e a identidade desse contexto fresco no snapshot exportado.
            adData = {
                ...adData,
                opsCompany: readiness.initialAdData.opsCompany,
            };

            await patch('export', OPS_VIDEO_PROGRESS.export.start, 'Renderizando a versao final e preparando o envio ao Ops.');
            const metadata = await prepareOpsExportMetadata(job.projectId, adData, finalTakes.length);
            let uploadIdempotencyKey = requiresFreshRender
                ? String(persisted.resume.uploadIdempotencyKey || '').trim()
                : '';
            if (requiresFreshRender && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadIdempotencyKey)) {
                uploadIdempotencyKey = crypto.randomUUID();
                persisted = updatePersistedOpsVideoJob({ resume: { uploadIdempotencyKey } }) || persisted;
            }
            const exportJobId = startExport({
                fileName: technicalFileName(job.projectTitle),
                outputFolder: `Mileto Ops > ${companyName}`,
                fps: 30,
                totalDuration: Number(adData.narrationDuration || 0),
                targetDims: job.format === '1:1' ? { w: 1080, h: 1080 } : { w: 1080, h: 1920 },
                mediaTakes: finalTakes,
                masterAudioUrl: adData.masterAudioUrl,
                transitionPath: adData.globalTransition?.filePath,
                transitionRotation: adData.transitionRotation || 0,
                adData,
                captionStyle,
                projectId: job.projectId,
                sourceJobId: job.id,
                executionRevision,
                uploadIdempotencyKey: uploadIdempotencyKey || undefined,
                opsMetadata: metadata,
                destination: {
                    kind: 'ops',
                    companyId: job.companyId,
                    opsFolderId: job.destinationFolderId || null,
                    viewContextId: queued.context.contextId,
                },
            });
            if (!exportJobId) throw new Error('export_busy: Ja existe outra exportacao em andamento neste Mileto AI Video.');
            persisted = updatePersistedOpsVideoJob({ resume: { renderStarted: true, exportJobId } }) || persisted;
            await patch('export', 90, 'Render em andamento. O executor continuara ativo em segundo plano.');
            const completedExport = await waitForOpsExport(job.projectId, exportJobId);
            const assetId = completedExport.assetId;
            if (!completedExport.renderResult) {
                throw new Error('render_integrity_report_missing: O novo MP4 não possui o diagnóstico obrigatório da versão 1.4.27.');
            }
            if (requiresFreshRender && assetId === job.execution?.previousOutputAssetId) {
                throw new Error('output_asset_not_fresh: O Ops devolveu o asset anterior para uma revisão que exige um novo upload.');
            }
            const exportWarning = completedExport.renderResult
                ? exportWarningSummary(completedExport.renderResult.warnings)
                : undefined;
            persisted = updatePersistedOpsVideoJob({
                resume: {
                    outputAssetId: assetId,
                    renderResult: completedExport.renderResult,
                },
            }) || persisted;
            await patch('export', OPS_VIDEO_PROGRESS.export.end, 'Upload concluido; validando a revisão no Mileto Ops.');
            await persistAutomatedProject({
                projectId: job.projectId,
                title: job.projectTitle,
                adData,
                mediaTakes: finalTakes,
                captionStyle,
                selectedMusicId,
                exported: true,
            });
            // O relatório final já incorpora os avisos estruturados da geração de
            // títulos. Preferi-lo evita repetir fallback/cobertura no mesmo texto.
            const completionWarning = (exportWarning || titleWarning || '').slice(0, 1_500);
            await patch('completed', 100, completionWarning
                ? `${completionWarning}; vídeo criado e entregue na pasta da empresa.`
                : 'Video criado e entregue na pasta da empresa.', {
                status: 'completed',
                revision: job.execution?.revision,
                outputAssetId: assetId,
                renderResult: completedExport.renderResult,
            });
            clearPersistedOpsVideoJob();
            currentJobRef.current = null;
            if (completionWarning) {
                toast.warning(`O agente concluiu "${job.projectTitle}" com advertências.`, {
                    description: completionWarning,
                    duration: 12_000,
                });
            } else {
                toast.success(`O agente concluiu "${job.projectTitle}" e enviou ao Mileto Ops.`, { duration: 10_000 });
            }
        } catch (error) {
            const parsed = errorParts(error);
            const current = loadPersistedOpsVideoJob() || persisted;
            if (parsed.code === 'output_asset_not_fresh') {
                const message = 'O Ops recusou o asset anterior. O executor descartou somente o checkpoint de upload e fará outro render desta revisão com uma nova chave.';
                updatePersistedOpsVideoJob({
                    status: 'paused',
                    stage: 'export',
                    progress: OPS_VIDEO_PROGRESS.export.start,
                    message,
                    errorCode: parsed.code,
                    errorMessage: message,
                    resume: {
                        renderStarted: false,
                        exportJobId: null,
                        outputAssetId: null,
                        uploadIdempotencyKey: null,
                        renderResult: null,
                    },
                });
                currentJobRef.current = null;
                setDisplay((value) => ({ ...value, status: 'paused', message, errorCode: parsed.code, assetId: undefined }));
                toast.warning(`A revisão de "${job.projectTitle}" será renderizada novamente com um upload novo.`, { duration: 12_000 });
                return;
            }
            if (isRecoverableInterruption(error, parsed.code)) {
                updatePersistedOpsVideoJob({
                    status: 'paused',
                    message: parsed.message,
                    errorCode: parsed.code,
                    errorMessage: parsed.message,
                });
                currentJobRef.current = null;
                setDisplay((value) => ({ ...value, status: 'paused', message: parsed.message, errorCode: parsed.code }));
                toast.warning(`O trabalho "${job.projectTitle}" foi pausado e sera retomado: ${parsed.message}`, { duration: 12_000 });
                return;
            }
            const failureStage = current.stage === 'queued' ? 'narration' : current.stage;
            const failurePercent = Math.max(5, current.progress);
            try {
                await patch(failureStage as Exclude<OpsVideoJobStage, 'queued'>, failurePercent, parsed.message, {
                    status: 'failed',
                    errorCode: parsed.code,
                    errorMessage: parsed.message,
                });
            } catch {
                updatePersistedOpsVideoJob({ status: 'failed', errorCode: parsed.code, errorMessage: parsed.message });
            }
            currentJobRef.current = null;
            toast.error(`O agente nao concluiu "${job.projectTitle}": ${parsed.message}`, { duration: 14_000 });
        }
    }, [startExport]);

    const poll = useCallback(async () => {
        if (runningRef.current || exportingRef.current) return;
        runningRef.current = true;
        let queued: QueuedJob | null = null;
        try {
            const persisted = loadPersistedOpsVideoJob();
            try {
                queued = persisted ? await resolvePersistedJob(persisted) : await findQueuedJob();
            } catch (error) {
                const parsed = errorParts(error);
                if (persisted && isPersistedResolutionFailure(parsed.code)) {
                    const paused = updatePersistedOpsVideoJob({
                        status: 'paused',
                        message: parsed.message,
                        errorCode: parsed.code,
                        errorMessage: parsed.message,
                    }) || persisted;
                    currentJobRef.current = null;
                    setDisplay((current) => ({
                        ...transitionOpsExecutorMonitor(current, { type: 'monitor-recovered', source: 'poll' }),
                        jobId: paused.jobId,
                        projectTitle: paused.projectId,
                        companyName: paused.companyId,
                        stage: paused.stage,
                        status: 'paused',
                        percent: paused.progress,
                        message: parsed.message,
                        errorCode: parsed.code,
                    }));
                } else {
                    setDisplay((current) => transitionOpsExecutorMonitor(current, {
                        type: 'monitor-failed',
                        source: 'poll',
                        code: parsed.code,
                        message: parsed.message,
                    }));
                }
                return;
            }
            if (!queued) {
                currentJobRef.current = null;
                setDisplay((current) => transitionOpsExecutorMonitor(current, { type: 'queue-empty' }));
                return;
            }
            const activeQueued = queued;
            heartbeatContextRef.current = activeQueued.context.contextId;
            if (activeQueued.job.status === 'completed' || activeQueued.job.status === 'failed') {
                setDisplay((current) => ({
                    ...transitionOpsExecutorMonitor(current, { type: 'monitor-recovered', source: 'poll' }),
                    jobId: activeQueued.job.id,
                    projectTitle: activeQueued.job.projectTitle,
                    companyName: activeQueued.job.companyId,
                    stage: activeQueued.job.stage,
                    status: activeQueued.job.status,
                    percent: Number(activeQueued.job.progress?.percent || (activeQueued.job.status === 'completed' ? 100 : 0)),
                    message: activeQueued.job.progress?.message || (activeQueued.job.status === 'completed' ? 'Trabalho concluido no Ops.' : 'Trabalho encerrado com falha no Ops.'),
                    assetId: activeQueued.job.outputAssetId || undefined,
                    errorCode: activeQueued.job.status === 'failed' ? (activeQueued.job.error?.code || undefined) : undefined,
                }));
                clearPersistedOpsVideoJob();
                currentJobRef.current = null;
                return;
            }
            await execute(activeQueued);
        } catch (error) {
            const parsed = errorParts(error);
            const persisted = loadPersistedOpsVideoJob();
            if (persisted) updatePersistedOpsVideoJob({ status: 'paused', message: parsed.message, errorCode: parsed.code, errorMessage: parsed.message });
            const updateRequired = parsed.code === 'video_worker_upgrade_required';
            const blockedBeforeClaim = Boolean(queued)
                && (updateRequired || !isRecoverableInterruption(error, parsed.code));
            if (persisted) {
                currentJobRef.current = null;
                setDisplay((current) => ({
                    ...current,
                    status: 'paused',
                    message: parsed.message,
                    errorCode: parsed.code,
                }));
            } else if (blockedBeforeClaim && queued) {
                const blockedJob = queued.job;
                setDisplay((current) => ({
                    ...transitionOpsExecutorMonitor(current, { type: 'monitor-recovered', source: 'poll' }),
                    jobId: blockedJob.id,
                    projectTitle: blockedJob.projectTitle,
                    companyName: blockedJob.companyId,
                    stage: blockedJob.stage,
                    status: 'paused',
                    percent: Number(blockedJob.progress?.percent || 0),
                    message: parsed.message,
                    assetId: undefined,
                    errorCode: parsed.code,
                }));
            } else {
                setDisplay((current) => transitionOpsExecutorMonitor(current, {
                    type: 'monitor-failed',
                    source: 'poll',
                    code: parsed.code,
                    message: parsed.message,
                }));
            }
        } finally {
            runningRef.current = false;
        }
    }, [execute]);

    useEffect(() => {
        void poll();
        const timer = window.setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [poll]);

    return null;
};
