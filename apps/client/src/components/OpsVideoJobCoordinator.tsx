import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useExportJobs } from '../context/ExportJobsContext';
import { createDefaultAdData, DEFAULT_CAPTION_STYLE } from '../context/WizardContext';
import {
    GatewayError,
    gatewayApi,
    type OpsAsset,
    type OpsCompany,
    type OpsVideoJob,
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
    loadAutomatedProject,
    materializeOpsTake,
    persistAutomatedProject,
    prepareOpsExportMetadata,
} from '../lib/videoAgentWorkflow';
import { selectOpsTakesForNarration } from '../lib/opsTakeSelection';
import { API_BASE_URL } from '../lib/apiBase';
import {
    IDLE_OPS_EXECUTOR_ACTIVITY,
    publishOpsExecutorActivity,
    type OpsExecutorActivity,
} from '../lib/opsExecutorActivity';
import type { AdData, MediaTake } from '../types';

const POLL_INTERVAL_MS = 12_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const EXPORT_TIMEOUT_MS = 60 * 60 * 1_000;

type QueuedJob = { job: OpsVideoJob; context: OpsViewContext; resume?: PersistedOpsVideoWorkerJob | null };
type OpsExportEvent = { projectId?: string; assetId?: string; message?: string };
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
            || error.status === 429
            || error.status >= 500;
    }
    return [
        'export_busy',
        'ops_export_timeout',
        'worker_interrupted',
        'claim_unavailable',
        'gateway_unavailable',
    ].includes(code) || (error instanceof Error && error.name === 'AbortError');
};

const completedExportFor = (job: OpsVideoJob): string | null => {
    try {
        const raw = localStorage.getItem(`mileto:ops-export:${job.projectId}`);
        if (!raw) return null;
        const value = JSON.parse(raw) as { assetId?: string; companyId?: string; folderId?: string | null };
        if (!value.assetId || value.companyId !== job.companyId) return null;
        if ((value.folderId || null) !== (job.destinationFolderId || null)) return null;
        return value.assetId;
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

const waitForOpsExport = (projectId: string): Promise<string> => new Promise((resolve, reject) => {
    let timeout = 0;
    const cleanup = () => {
        window.removeEventListener('mileto:ops-export-complete', onComplete as EventListener);
        window.removeEventListener('mileto:ops-export-failed', onFailed as EventListener);
        if (timeout) window.clearTimeout(timeout);
    };
    const onComplete = (event: Event) => {
        const detail = (event as CustomEvent<OpsExportEvent>).detail || {};
        if (detail.projectId !== projectId || !detail.assetId) return;
        cleanup();
        resolve(detail.assetId);
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
    for (const context of await orderedContexts()) {
        try {
            const job = await gatewayApi.nextOpsVideoJob(context.contextId);
            if (job) return { job, context };
        } catch {
            // Um contexto pode expirar enquanto os demais continuam validos.
        }
    }
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
    return { company, assetById, eligibleAssets, initialAdData, musicId: music?.id || null };
};

export const OpsVideoJobCoordinator = () => {
    const { isExporting, startExport } = useExportJobs();
    const runningRef = useRef(false);
    const exportingRef = useRef(isExporting);
    const currentJobRef = useRef<string | null>(loadPersistedOpsVideoJob()?.jobId || null);
    const heartbeatContextRef = useRef<string | null>(loadPersistedOpsVideoJob()?.viewContextId || null);
    const modeRef = useRef<OpsVideoWorkerExecutionMode>('foreground');
    const [display, setDisplay] = useState<JobDisplayState>(() => {
        const persisted = loadPersistedOpsVideoJob();
        return persisted ? {
            jobId: persisted.jobId,
            companyName: persisted.companyId,
            projectTitle: persisted.projectId,
            stage: persisted.stage,
            status: persisted.status === 'paused' ? 'paused' : 'queued',
            percent: persisted.progress,
            message: persisted.message,
            assetId: persisted.resume.outputAssetId || undefined,
            errorCode: persisted.errorCode || undefined,
            mode: 'foreground',
            heartbeat: 'pending',
        } : IDLE_DISPLAY;
    });

    useEffect(() => { exportingRef.current = isExporting; }, [isExporting]);

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

    const heartbeat = useCallback(async (stateOverride?: 'idle' | 'busy' | 'offline') => {
        let contextId = heartbeatContextRef.current;
        if (!contextId) {
            try {
                const activeJobId = currentJobRef.current;
                const persisted = activeJobId ? loadPersistedOpsVideoJob() : null;
                if (activeJobId && persisted?.jobId === activeJobId) {
                    const resolved = await resolvePersistedJob(persisted);
                    contextId = resolved?.context.contextId || null;
                } else if (!activeJobId) {
                    contextId = (await orderedContexts())[0]?.contextId || null;
                }
                heartbeatContextRef.current = contextId;
            } catch {
                setDisplay((current) => ({ ...current, heartbeat: 'offline' }));
                return;
            }
        }
        if (!contextId) {
            setDisplay((current) => ({ ...current, heartbeat: 'unsupported' }));
            return;
        }
        try {
            const result = await gatewayApi.heartbeatOpsVideoWorker({
                appVersion: OPS_VIDEO_WORKER_APP_VERSION,
                mode: modeRef.current,
                state: stateOverride || (currentJobRef.current ? 'busy' : 'idle'),
                currentJobId: currentJobRef.current,
            }, contextId);
            setDisplay((current) => ({ ...current, heartbeat: result.supported ? 'online' : 'unsupported' }));
        } catch (error) {
            if (error instanceof GatewayError && [401, 403, 404].includes(error.status)) {
                heartbeatContextRef.current = null;
            }
            setDisplay((current) => ({ ...current, heartbeat: 'offline' }));
        }
    }, []);

    useEffect(() => {
        void heartbeat();
        const timer = window.setInterval(() => { void heartbeat(); }, HEARTBEAT_INTERVAL_MS);
        const ipc = electronIpc();
        const shutdown = () => {
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
            ...current,
            jobId: queued.job.id,
            companyName,
            projectTitle: queued.job.projectTitle,
            stage: persisted.stage,
            status: queued.resume ? 'paused' : 'queued',
            percent: persisted.progress,
            message: queued.resume ? 'Retomando o mesmo projeto apos a interrupcao.' : 'Validacoes concluidas. Assumindo o trabalho com seguranca.',
            errorCode: undefined,
        }));

        const claim = await gatewayApi.claimOpsVideoJob(queued.job.id, queued.context.contextId);
        const job = claim.job;
        const resume = Boolean(queued.resume);
        persisted = updatePersistedOpsVideoJob({ status: 'claimed', message: 'Trabalho assumido pelo executor local.' }) || persisted;

        const patch = async (
            stage: Exclude<OpsVideoJobStage, 'queued'>,
            percent: number,
            message: string,
            extra: { status?: 'running' | 'completed' | 'failed'; outputAssetId?: string; errorCode?: string; errorMessage?: string } = {},
        ) => {
            const localStatus: OpsVideoWorkerLocalStatus = extra.status || 'running';
            persisted = updatePersistedOpsVideoJob({
                stage,
                progress: percent,
                message,
                status: localStatus,
                errorCode: extra.errorCode || null,
                errorMessage: extra.errorMessage || null,
                resume: extra.outputAssetId ? { outputAssetId: extra.outputAssetId } : undefined,
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
            return gatewayApi.updateOpsVideoJob(job.id, claim.claimToken, {
                status: extra.status || 'running',
                stage,
                percent,
                message,
                outputAssetId: extra.outputAssetId,
                errorCode: extra.errorCode,
                errorMessage: extra.errorMessage,
            }, queued.context.contextId);
        };

        const showLocalProgress = (stage: OpsVideoJobStage, percent: number, message: string) => {
            persisted = updatePersistedOpsVideoJob({ stage, progress: percent, message, status: 'running' }) || persisted;
            setDisplay((current) => ({ ...current, stage, status: 'running', percent, message }));
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

            const previousAssetId = job.outputAssetId || completedExportFor(job) || persisted.resume.outputAssetId;
            if (previousAssetId) {
                await patch('completed', 100, 'Video ja concluido e confirmado no Mileto Ops.', {
                    status: 'completed',
                    outputAssetId: previousAssetId,
                });
                clearPersistedOpsVideoJob();
                currentJobRef.current = null;
                return;
            }

            let adData = readiness.initialAdData;
            let titleWarning: string | null = null;
            let finalTakes: MediaTake[] = [];
            let captionStyle = { ...DEFAULT_CAPTION_STYLE };
            let selectedMusicId = readiness.musicId;
            const savedProject = persisted.resume.projectPrepared
                ? await loadAutomatedProject(job.projectId)
                : null;
            const canResumeProject = Boolean(
                savedProject
                && savedProject.title === job.projectTitle.trim()
                && savedProject.adData.opsCompany?.id === job.companyId
                && savedProject.adData.narrationText.trim() === (job.narration?.trim() || '')
                && savedProject.adData.format === job.format
                && savedProject.mediaTakes.length > 0,
            );

            if (canResumeProject && savedProject) {
                showLocalProgress('titles', OPS_VIDEO_PROGRESS.titles.end, 'Restaurando o projeto salvo e renovando as URLs dos takes.');
                adData = savedProject.adData;
                captionStyle = savedProject.captionStyle;
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
                    try {
                        const titleResult = await generateAutomaticTitlesResilient(adData);
                        adData = titleResult.adData;
                        titleWarning = titleResult.warning || null;
                    } catch {
                        // Títulos são um enriquecimento opcional. Uma falha inesperada não pode
                        // invalidar narração, takes, legendas ou o projeto já montado.
                        adData = { ...adData, dynamicTitles: [] };
                        titleWarning = AUTOMATIC_TITLES_UNAVAILABLE_WARNING;
                        console.warn('[title-generation]', {
                            event: 'coordinator_degraded',
                            code: 'automatic_titles_unavailable',
                            stage: 'titles',
                        });
                    }
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

            await patch('export', OPS_VIDEO_PROGRESS.export.start, 'Renderizando a versao final e preparando o envio ao Ops.');
            const metadata = await prepareOpsExportMetadata(job.projectId, adData, finalTakes.length);
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
            const assetId = await waitForOpsExport(job.projectId);
            persisted = updatePersistedOpsVideoJob({ resume: { outputAssetId: assetId } }) || persisted;
            await patch('export', OPS_VIDEO_PROGRESS.export.end, 'Upload concluido; confirmando o asset no Mileto Ops.', { outputAssetId: assetId });
            await persistAutomatedProject({
                projectId: job.projectId,
                title: job.projectTitle,
                adData,
                mediaTakes: finalTakes,
                captionStyle,
                selectedMusicId,
                exported: true,
            });
            await patch('completed', 100, titleWarning
                ? `${titleWarning}; vídeo criado e entregue na pasta da empresa.`
                : 'Video criado e entregue na pasta da empresa.', {
                status: 'completed',
                outputAssetId: assetId,
            });
            clearPersistedOpsVideoJob();
            currentJobRef.current = null;
            toast.success(`O agente concluiu "${job.projectTitle}" e enviou ao Mileto Ops.`, { duration: 10_000 });
        } catch (error) {
            const parsed = errorParts(error);
            const current = loadPersistedOpsVideoJob() || persisted;
            if (isRecoverableInterruption(error, parsed.code)) {
                updatePersistedOpsVideoJob({
                    status: 'paused',
                    message: parsed.message,
                    errorCode: parsed.code,
                    errorMessage: parsed.message,
                });
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
        try {
            const persisted = loadPersistedOpsVideoJob();
            const queued = persisted ? await resolvePersistedJob(persisted) : await findQueuedJob();
            if (!queued) return;
            heartbeatContextRef.current = queued.context.contextId;
            if (queued.job.status === 'completed' || queued.job.status === 'failed') {
                setDisplay((current) => ({
                    ...current,
                    jobId: queued.job.id,
                    projectTitle: queued.job.projectTitle,
                    companyName: queued.job.companyId,
                    stage: queued.job.stage,
                    status: queued.job.status,
                    percent: Number(queued.job.progress?.percent || (queued.job.status === 'completed' ? 100 : 0)),
                    message: queued.job.progress?.message || (queued.job.status === 'completed' ? 'Trabalho concluido no Ops.' : 'Trabalho encerrado com falha no Ops.'),
                    assetId: queued.job.outputAssetId || undefined,
                    errorCode: queued.job.error?.code || undefined,
                }));
                clearPersistedOpsVideoJob();
                currentJobRef.current = null;
                return;
            }
            currentJobRef.current = queued.job.id;
            toast.info(queued.resume
                ? `Retomando "${queued.job.projectTitle}" no mesmo projeto.`
                : `O agente Video Maker iniciou "${queued.job.projectTitle}".`, { duration: 6_000 });
            await execute(queued);
        } catch (error) {
            const parsed = errorParts(error);
            const persisted = loadPersistedOpsVideoJob();
            if (persisted) updatePersistedOpsVideoJob({ status: 'paused', message: parsed.message, errorCode: parsed.code, errorMessage: parsed.message });
            setDisplay((current) => ({
                ...current,
                status: persisted ? 'paused' : 'offline',
                message: parsed.message,
                errorCode: parsed.code,
                heartbeat: current.heartbeat === 'unsupported' ? 'unsupported' : 'offline',
            }));
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
