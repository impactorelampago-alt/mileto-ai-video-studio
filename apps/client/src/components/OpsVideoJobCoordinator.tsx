import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, Film, LoaderCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { useExportJobs } from '../context/ExportJobsContext';
import { createDefaultAdData, DEFAULT_CAPTION_STYLE } from '../context/WizardContext';
import { gatewayApi, type OpsAsset, type OpsVideoJob, type OpsVideoJobStage, type OpsViewContext } from '../lib/gateway';
import { opsProjectCompanyName, opsViewContextIdentity } from '../lib/opsProjectBrand';
import { applyQuickEdit } from '../lib/quickEdit';
import { DEFAULT_SYSTEM_VOICE, SYSTEM_VOICES } from '../lib/systemVoices';
import { systemMusicTrackFor } from '../lib/systemMusic';
import {
    deterministicShuffle,
    generateAutomaticCaptions,
    generateAutomaticTitles,
    generateNarrationAndMix,
    loadAutomatedProject,
    materializeOpsTake,
    persistAutomatedProject,
    prepareOpsExportMetadata,
} from '../lib/videoAgentWorkflow';
import { API_BASE_URL } from '../lib/apiBase';
import type { AdData, MediaTake } from '../types';

const POLL_INTERVAL_MS = 12_000;
const EXPORT_TIMEOUT_MS = 60 * 60 * 1_000;

type QueuedJob = { job: OpsVideoJob; context: OpsViewContext };
type OpsExportEvent = { projectId?: string; assetId?: string; message?: string };
type JobDisplayState = {
    jobId: string;
    companyName: string;
    projectTitle: string;
    stage: OpsVideoJobStage;
    status: 'queued' | 'claimed' | 'running' | 'completed' | 'failed';
    percent: number;
    message: string;
    assetId?: string;
    errorCode?: string;
};

const STAGE_LABELS: Record<OpsVideoJobStage, string> = {
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

const technicalFileName = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'video_mileto';

const errorParts = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/^([a-z0-9_]+):\s*(.+)$/i);
    return match
        ? { code: match[1].slice(0, 120), message: match[2].slice(0, 2_000) }
        : { code: 'ai_video_failed', message: message.slice(0, 2_000) };
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

type PreparedJobCheckpoint = {
    version: 1;
    signature: string;
    preparedAt: string;
};

const preparedCheckpointKey = (projectId: string) => `mileto:ops-video-job:${projectId}`;

const jobSignature = (job: OpsVideoJob) => JSON.stringify({
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

const hasPreparedCheckpoint = (job: OpsVideoJob): boolean => {
    try {
        const raw = localStorage.getItem(preparedCheckpointKey(job.projectId));
        if (!raw) return false;
        const value = JSON.parse(raw) as PreparedJobCheckpoint;
        return value.version === 1 && value.signature === jobSignature(job);
    } catch {
        return false;
    }
};

const savePreparedCheckpoint = (job: OpsVideoJob) => {
    const value: PreparedJobCheckpoint = {
        version: 1,
        signature: jobSignature(job),
        preparedAt: new Date().toISOString(),
    };
    localStorage.setItem(preparedCheckpointKey(job.projectId), JSON.stringify(value));
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
        reject(new Error('ops_export_timeout: A exportação excedeu o tempo máximo de uma hora.'));
    }, EXPORT_TIMEOUT_MS);
});

const findQueuedJob = async (): Promise<QueuedJob | null> => {
    const response = await gatewayApi.opsViewContexts();
    const contexts = response.data?.contexts || [];
    const ordered = [
        ...contexts.filter((context) => context.contextId === response.data.defaultContextId),
        ...contexts.filter((context) => context.contextId !== response.data.defaultContextId),
    ];
    for (const context of ordered) {
        try {
            const job = await gatewayApi.nextOpsVideoJob(context.contextId);
            if (job) return { job, context };
        } catch {
            // Um contexto pode expirar ou deixar de estar autorizado enquanto a
            // lista é percorrida. Os demais contextos continuam válidos.
        }
    }
    return null;
};

export const OpsVideoJobCoordinator = () => {
    const { isExporting, startExport } = useExportJobs();
    const runningRef = useRef(false);
    const exportingRef = useRef(isExporting);
    const [display, setDisplay] = useState<JobDisplayState | null>(null);

    useEffect(() => { exportingRef.current = isExporting; }, [isExporting]);

    const execute = useCallback(async (queued: QueuedJob) => {
        const claim = await gatewayApi.claimOpsVideoJob(queued.job.id, queued.context.contextId);
        const job = claim.job;
        setDisplay((current) => ({
            jobId: job.id,
            companyName: current?.jobId === job.id ? current.companyName : job.companyId,
            projectTitle: job.projectTitle,
            stage: job.stage,
            status: 'claimed',
            percent: Number(job.progress?.percent || 0),
            message: 'Tarefa assumida com segurança pelo Mileto AI Video.',
        }));
        const showLocalProgress = (stage: OpsVideoJobStage, percent: number, message: string) => {
            setDisplay((current) => current?.jobId === job.id ? {
                ...current,
                stage,
                status: 'running',
                percent,
                message,
            } : current);
        };
        const patch = async (
            stage: Exclude<OpsVideoJobStage, 'queued'>,
            percent: number,
            message: string,
            extra: { status?: 'running' | 'completed' | 'failed'; outputAssetId?: string; errorCode?: string; errorMessage?: string } = {},
        ) => {
            const status = extra.status || 'running';
            setDisplay((current) => ({
                jobId: job.id,
                companyName: current?.jobId === job.id ? current.companyName : job.companyId,
                projectTitle: job.projectTitle,
                stage,
                status,
                percent,
                message,
                assetId: extra.outputAssetId || current?.assetId,
                errorCode: extra.errorCode,
            }));
            return gatewayApi.updateOpsVideoJob(job.id, claim.claimToken, {
                status,
                stage,
                percent,
                message,
                outputAssetId: extra.outputAssetId,
                errorCode: extra.errorCode,
                errorMessage: extra.errorMessage,
            }, queued.context.contextId);
        };

        const previousAssetId = completedExportFor(job);
        if (previousAssetId) {
            await patch('completed', 100, 'Vídeo já concluído e confirmado no Mileto Ops.', {
                status: 'completed',
                outputAssetId: previousAssetId,
            });
            toast.success(`Vídeo “${job.projectTitle}” confirmado no Mileto Ops.`);
            return;
        }

        try {
            await patch('narration', 4, 'Preparando voz, música e narração.');
            const companyResponse = await gatewayApi.opsCompany(job.companyId, queued.context.contextId);
            const company = companyResponse.data;
            setDisplay((current) => current?.jobId === job.id ? {
                ...current,
                companyName: opsProjectCompanyName(company),
            } : current);
            const voice = job.voicePresetId
                ? SYSTEM_VOICES.find((candidate) => candidate.id === job.voicePresetId)
                : DEFAULT_SYSTEM_VOICE;
            if (!voice) {
                throw new Error(`voice_preset_not_found: A voz solicitada (${job.voicePresetId}) nao existe neste Mileto AI Video.`);
            }
            const music = systemMusicTrackFor(voice.preset.musicTrackId) || systemMusicTrackFor(DEFAULT_SYSTEM_VOICE.preset.musicTrackId);
            const opsCompany = {
                id: company.id,
                name: opsProjectCompanyName(company),
                viewContextIdentity: opsViewContextIdentity(queued.context),
                viewContextLabel: queued.context.label,
            };
            let adData: AdData = createDefaultAdData({
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
                opsCompany,
                brandPalette: company.palette || null,
                brandPaletteUpdatedAt: company.paletteUpdatedAt || null,
            });
            const assets = (await gatewayApi.opsAssets(job.companyId, {
                viewContextId: queued.context.contextId,
            })).data;
            const assetById = new Map(assets.map((asset) => [asset.id, asset]));
            const missing = job.takeAssetIds.filter((id) => !assetById.has(id));
            if (missing.length) {
                throw new Error(`ops_take_missing: ${missing.length} take(s) selecionado(s) não estão mais disponíveis na empresa.`);
            }
            const selectedAssets = job.takeAssetIds.map((id) => assetById.get(id)!);
            const crossCompany = selectedAssets.filter((asset) => asset.companyId !== job.companyId);
            if (crossCompany.length) {
                throw new Error('ops_take_company_mismatch: O Ops devolveu um take que nao pertence a empresa do job.');
            }
            let finalTakes: MediaTake[];
            let captionStyle = { ...DEFAULT_CAPTION_STYLE };
            let selectedMusicId = music?.id || null;
            const savedProject = hasPreparedCheckpoint(job)
                ? await loadAutomatedProject(job.projectId)
                : null;
            const canResume = Boolean(
                savedProject
                && savedProject.title === job.projectTitle.trim()
                && savedProject.adData.opsCompany?.id === job.companyId
                && savedProject.adData.narrationText.trim() === (job.narration?.trim() || '')
                && savedProject.adData.format === job.format
                && savedProject.mediaTakes.length > 0
            );

            if (canResume && savedProject) {
                showLocalProgress('takes', 34, 'Retomando o projeto salvo e renovando as midias do Ops.');
                adData = savedProject.adData;
                captionStyle = savedProject.captionStyle;
                selectedMusicId = savedProject.selectedMusicId;
                finalTakes = await hydratePreparedTakes(
                    savedProject.mediaTakes,
                    assetById,
                    queued.context,
                    new Set(job.takeAssetIds),
                );
                showLocalProgress('export', 76, 'Projeto retomado do ultimo checkpoint. Preparando a exportacao.');
            } else {
                adData = await generateNarrationAndMix(adData);
                await patch('takes', 22, 'Narracao pronta. Importando os takes autorizados da empresa.');
                const orderedAssets = job.shuffleTakes
                    ? deterministicShuffle(selectedAssets, `${job.id}:${job.projectId}`)
                    : selectedAssets;
                const takes: MediaTake[] = [];
                for (let index = 0; index < orderedAssets.length; index += 1) {
                    takes.push(await materializeOpsTake(
                        orderedAssets[index],
                        queued.context,
                        `${job.projectId}-take-${index + 1}-${orderedAssets[index].id}`,
                    ));
                    showLocalProgress('takes', 22 + Math.round(((index + 1) / orderedAssets.length) * 16),
                        `Importando takes: ${index + 1} de ${orderedAssets.length}.`);
                }
                await patch('takes', 38, `${takes.length} take(s) importado(s) e validados na empresa.`);

                finalTakes = takes;
                if (job.quickEdit) {
                    await patch('quick_edit', 40, 'Aplicando Edicao Rapida aos takes.');
                    const quickEdit = await applyQuickEdit(
                        finalTakes,
                        Number(adData.narrationDuration || 0),
                        adData.globalTransition,
                        (source, index) => `${job.projectId}-loop-${index + 1}-${source.id}`,
                    );
                    finalTakes = quickEdit.takes;
                    adData = { ...adData, globalTransition: quickEdit.transition };
                }

                if (job.captions) {
                    await patch('captions', 54, 'Gerando e revisando as legendas automaticas.');
                    adData = await generateAutomaticCaptions(adData);
                }
                if (job.automaticTitles) {
                    await patch('titles', 68, 'Aplicando gatilhos, modelos e paleta da empresa.');
                    adData = await generateAutomaticTitles(adData);
                }

                await persistAutomatedProject({
                    projectId: job.projectId,
                    title: job.projectTitle,
                    adData,
                    mediaTakes: finalTakes,
                    captionStyle,
                    selectedMusicId,
                    exported: false,
                });
                savePreparedCheckpoint(job);
            }

            await patch('export', 78, 'Renderizando a versão final e preparando o envio ao Ops.');
            const metadata = await prepareOpsExportMetadata(job.projectId, adData, finalTakes.length);
            const exportJobId = startExport({
                fileName: technicalFileName(job.projectTitle),
                outputFolder: `Mileto Ops › ${opsProjectCompanyName(company)}`,
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
            if (!exportJobId) {
                throw new Error('export_busy: Já existe outra exportação em andamento neste Mileto AI Video.');
            }
            const exportResult = waitForOpsExport(job.projectId);
            const assetId = await exportResult;
            await persistAutomatedProject({
                projectId: job.projectId,
                title: job.projectTitle,
                adData,
                mediaTakes: finalTakes,
                captionStyle,
                selectedMusicId,
                exported: true,
            });
            await patch('completed', 100, 'Vídeo criado e entregue na pasta da empresa.', {
                status: 'completed',
                outputAssetId: assetId,
            });
            toast.success(`O agente concluiu “${job.projectTitle}” e enviou ao Mileto Ops.`, { duration: 10_000 });
        } catch (error) {
            const parsed = errorParts(error);
            try {
                await patch('failed', 0, parsed.message, {
                    status: 'failed',
                    errorCode: parsed.code,
                    errorMessage: parsed.message,
                });
            } catch {
                // O erro original continua visível localmente mesmo se a conexão
                // cair antes de registrar a falha no Ops.
            }
            toast.error(`O agente não concluiu “${job.projectTitle}”: ${parsed.message}`, { duration: 14_000 });
        }
    }, [startExport]);

    const poll = useCallback(async () => {
        if (runningRef.current || exportingRef.current) return;
        runningRef.current = true;
        try {
            const queued = await findQueuedJob();
            if (queued) {
                setDisplay({
                    jobId: queued.job.id,
                    companyName: queued.job.companyId,
                    projectTitle: queued.job.projectTitle,
                    stage: 'queued',
                    status: 'queued',
                    percent: 0,
                    message: 'Tarefa recebida do Mileto Ops. Aguardando claim seguro.',
                });
                toast.info(`O agente Video Maker iniciou “${queued.job.projectTitle}”.`, { duration: 6_000 });
                await execute(queued);
            }
        } catch (error) {
            const parsed = errorParts(error);
            setDisplay((current) => current ? {
                ...current,
                stage: 'failed',
                status: 'failed',
                percent: 0,
                message: parsed.message,
                errorCode: parsed.code,
            } : current);
            // Ausência de integração, sessão ou tarefa é estado normal no polling.
        } finally {
            runningRef.current = false;
        }
    }, [execute]);

    useEffect(() => {
        void poll();
        const timer = window.setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [poll]);

    if (!display) return null;

    const terminal = display.status === 'completed' || display.status === 'failed';
    const failed = display.status === 'failed';
    const completed = display.status === 'completed';
    const Icon = failed ? AlertTriangle : completed ? CheckCircle2 : LoaderCircle;
    const statusLabel = display.status === 'queued'
        ? 'Aguardando'
        : display.stage === 'export' && !completed
          ? 'Exportando'
          : completed
            ? 'Concluido'
            : failed
              ? 'Falhou'
              : 'Em producao';

    return (
        <aside
            aria-live="polite"
            className={`fixed bottom-20 right-5 z-[9998] w-[min(390px,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border bg-[#0b1212]/95 shadow-2xl backdrop-blur-xl ${
                failed ? 'border-red-400/30' : completed ? 'border-emerald-400/30' : 'border-emerald-400/20'
            }`}
        >
            <div className="flex items-start gap-3 px-4 pb-3 pt-4">
                <span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                    failed ? 'bg-red-400/10 text-red-300' : 'bg-emerald-400/10 text-emerald-300'
                }`}>
                    <Icon className={`h-5 w-5 ${!terminal ? 'animate-spin' : ''}`} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Film className="h-3.5 w-3.5 text-emerald-400" />
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">
                            Agente Video Maker · {statusLabel} · {STAGE_LABELS[display.stage]}
                        </p>
                    </div>
                    <h3 className="mt-1 truncate text-sm font-black text-white">{display.projectTitle}</h3>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-white/55">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {display.companyName}
                    </p>
                </div>
                {terminal && (
                    <button
                        type="button"
                        aria-label="Fechar andamento do agente"
                        onClick={() => setDisplay(null)}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/45 transition hover:bg-white/5 hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>
            <div className="px-4 pb-4">
                <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-white/45">
                    <span>{display.message}</span>
                    <span className={failed ? 'text-red-300' : 'text-emerald-300'}>{display.percent}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                    <div
                        className={`h-full rounded-full transition-[width] duration-500 ${failed ? 'bg-red-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.max(0, Math.min(100, display.percent))}%` }}
                    />
                </div>
                {display.errorCode && (
                    <p className="mt-2 font-mono text-[10px] text-red-300/80">{display.errorCode}</p>
                )}
                {display.assetId && (
                    <p className="mt-2 truncate font-mono text-[10px] text-white/45">Asset Ops: {display.assetId}</p>
                )}
            </div>
        </aside>
    );
};
