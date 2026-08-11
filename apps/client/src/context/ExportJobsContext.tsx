import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DOMCaptureEngine } from '../lib/export/DOMCaptureEngine';
import { API_BASE_URL } from '../lib/apiBase';
import type { AdData, CaptionStyle, CaptionTrack, MediaTake, TitleHook } from '../types';
import { VideoSequencePreview, type VideoSequencePreviewRef } from '../components/VideoSequencePreview';
import { useDownloadJobs } from './DownloadJobsContext';
import { useWizard } from './WizardContext';
import { localAuthHeaders } from '../lib/serverAuth';
import { resolveTakeEnhancement, resolveTakeSharpness } from '../lib/videoEnhancement';
import { narrationSourceKey } from '../lib/narrationState';
import { prepareOpsTakeForExport } from '../lib/opsMediaRecovery';
import {
    refreshSharedMasterAudioForExport,
    refreshSharedTakeForExport,
    safeExportMediaName,
} from '../lib/sharedMediaRecovery';
import { resolveTransitionPathForExport } from '../lib/transitionExportRecovery';
import {
    exportWarningSummary,
    titleOriginForExport,
    validateTitlesForExport,
    type ExportResultDiagnostics,
    type ServerRenderDiagnostics,
} from '../lib/exportIntegrity';

export interface OpsExportMetadata {
    title: string;
    description: string;
    narrationSummary: string;
    sourceProjectId: string;
    sourceProjectTitle: string;
}

export interface BackgroundExportRequest {
    fileName: string;
    outputFolder: string;
    fps: number;
    totalDuration: number;
    targetDims: { w: number; h: number };
    mediaTakes: MediaTake[];
    masterAudioUrl?: string;
    transitionPath?: string;
    transitionRotation?: 0 | 90 | 180 | 270;
    adData: AdData;
    captionStyle: CaptionStyle | null;
    projectId: string;
    /** Job de origem, quando a exportação pertence a um executor externo. */
    sourceJobId?: string;
    /** Revisão do mesmo job no Ops; não altera a identidade do projeto. */
    executionRevision?: number;
    /** Chave nova da revisão, persistida pelo worker e reutilizada apenas neste upload. */
    uploadIdempotencyKey?: string;
    opsMetadata?: OpsExportMetadata;
    destination: { kind: 'local' | 'shared' | 'ops'; folderPath?: string; companyId?: string; opsFolderId?: string | null; viewContextId?: string | null };
}

interface ExportJobsContextValue {
    isExporting: boolean;
    startExport: (_request: BackgroundExportRequest) => string | null;
}

interface ActiveExport extends BackgroundExportRequest {
    jobId: string;
    titleIntegrity: ReturnType<typeof validateTitlesForExport>;
}

const ExportJobsContext = createContext<ExportJobsContextValue | null>(null);

const overlayFrameKey = (
    time: number,
    frameIndex: number,
    captions: CaptionTrack | undefined,
    titles: TitleHook[],
    customOverlayUrl?: string,
    frameOverlayKey?: string
) => {
    const segmentIndex = captions?.enabled !== false
        ? captions?.segments?.findIndex((segment) => time >= segment.start && time <= segment.end) ?? -1
        : -1;
    let wordIndex = -1;
    if (segmentIndex >= 0 && captions?.segments) {
        const segment = captions.segments[segmentIndex];
        wordIndex = segment.words.findIndex((word, index) => {
            const nextStart = segment.words[index + 1]?.start ?? segment.end;
            return time >= word.start && time < nextStart;
        });
    }

    // Títulos premium podem pulsar ou mover elementos durante toda a exibição.
    // Enquanto um deles estiver ativo, cada frame continua sendo capturado.
    const activeTitleIds = titles
        .filter((title) => title.isActive && time >= title.startSec && time <= title.startSec + title.durationSec)
        .map((title) => title.id);
    const animatedFrame = activeTitleIds.length ? frameIndex : 'static';
    return `${segmentIndex}:${wordIndex}:${activeTitleIds.join(',')}:${animatedFrame}:${customOverlayUrl || ''}:${frameOverlayKey || ''}`;
};

export const ExportJobsProvider = ({ children }: { children: React.ReactNode }) => {
    const { registerClientJob, updateClientJob } = useDownloadJobs();
    const { projectId, saveProject } = useWizard();
    const [activeExport, setActiveExport] = useState<ActiveExport | null>(null);
    const activeRef = useRef<ActiveExport | null>(null);
    const previewRef = useRef<VideoSequencePreviewRef>(null);
    const runningJobRef = useRef<string | null>(null);
    const currentProjectIdRef = useRef(projectId);

    useEffect(() => {
        currentProjectIdRef.current = projectId;
    }, [projectId]);

    const startExport = useCallback(
        (request: BackgroundExportRequest) => {
            if (activeRef.current) return null;
            const safeName = request.fileName.trim() || 'MeuVideo_Mileto';
            const jobId = registerClientJob({
                mode: 'video',
                title: `${safeName}.mp4`,
                destination: request.outputFolder,
                source: 'export',
                statusText: 'Preparando exportação',
            });
            const currentTitleSourceKey = narrationSourceKey(request.adData);
            const titleSourceIsStale = Boolean(
                request.adData.dynamicTitlesSourceKey
                && request.adData.dynamicTitlesSourceKey !== currentTitleSourceKey
            );
            const titleIntegrity = validateTitlesForExport(
                titleSourceIsStale ? [] : request.adData.dynamicTitles,
                request.totalDuration,
                titleSourceIsStale ? undefined : request.adData.titleGenerationSummary,
            );
            if (titleSourceIsStale) {
                titleIntegrity.warnings.unshift({
                    code: 'title_source_stale',
                    message: 'Os títulos pertenciam a uma narração anterior e foram removidos desta exportação.',
                    stage: 'titles',
                });
            }
            const titleWarning = exportWarningSummary(titleIntegrity.warnings);
            if (titleWarning) {
                toast.warning('O vídeo será exportado normalmente.', {
                    description: `Sugestão opcional de títulos: ${titleWarning}`,
                    duration: 8_000,
                });
            }
            const active = {
                ...request,
                fileName: safeName,
                jobId,
                titleIntegrity,
                adData: {
                    ...request.adData,
                    dynamicTitles: titleIntegrity.titles,
                    ...(titleSourceIsStale ? {
                        dynamicTitlesSourceKey: undefined,
                        titleGenerationSummary: undefined,
                    } : {}),
                },
            };
            activeRef.current = active;
            setActiveExport(active);
            return jobId;
        },
        [registerClientJob]
    );

    useEffect(() => {
        if (!activeExport || runningJobRef.current === activeExport.jobId) return;
        runningJobRef.current = activeExport.jobId;
        let temporaryExportPaths: string[] = [];

        const updateProgress = (percent: number, statusText: string) => {
            updateClientJob(activeExport.jobId, {
                percent: Math.max(0, Math.min(99, percent)),
                stepPercent: Math.max(0, Math.min(99, percent)),
                statusText,
            });
        };

        const run = async () => {
            let engine: DOMCaptureEngine | null = null;
            try {
                for (let attempt = 0; attempt < 100 && !previewRef.current; attempt++) {
                    await new Promise((resolve) => window.setTimeout(resolve, 25));
                }
                if (!previewRef.current) throw new Error('O renderizador em segundo plano não ficou pronto.');

                const totalFrames = Math.max(1, Math.ceil(activeExport.totalDuration * activeExport.fps));
                engine = new DOMCaptureEngine(
                    activeExport.targetDims.w,
                    activeExport.targetDims.h,
                    activeExport.fps,
                    true
                );
                await engine.start();
                updateProgress(2, 'Preparando títulos e legendas');

                let lastKey: string | null = null;
                let repeatedFrames = 0;
                const titles = (activeExport.adData.dynamicTitles || []).filter((title) => title.isActive);

                const flushRepeatedFrames = async () => {
                    if (!repeatedFrames) return;
                    await engine!.repeatLastFrame(repeatedFrames);
                    repeatedFrames = 0;
                };

                for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
                    const time = frameIndex / activeExport.fps;
                    const frameKey = overlayFrameKey(
                        time,
                        frameIndex,
                        activeExport.adData.captions,
                        titles,
                        activeExport.adData.customOverlayUrl,
                        activeExport.adData.frameOverlay?.id || activeExport.adData.frameOverlay?.url
                    );

                    if (lastKey !== null && frameKey === lastKey) {
                        repeatedFrames += 1;
                    } else {
                        await flushRepeatedFrames();
                        const canvas = await previewRef.current.extractFrameSync(
                            time,
                            true,
                            activeExport.targetDims.w,
                            activeExport.targetDims.h
                        );
                        if (!canvas) throw new Error('Não foi possível capturar a camada visual da exportação.');
                        await engine.captureFrame(canvas);
                        lastKey = frameKey;
                    }

                    if (frameIndex % Math.max(10, activeExport.fps) === 0 || frameIndex === totalFrames - 1) {
                        const captureProgress = (frameIndex + 1) / totalFrames;
                        updateProgress(
                            3 + captureProgress * 62,
                            `Preparando quadro ${frameIndex + 1} de ${totalFrames}`
                        );
                        await new Promise((resolve) => window.setTimeout(resolve, 0));
                    }
                }
                await flushRepeatedFrames();

                updateProgress(67, 'Preparando áudio e montagem final');
                const hasConfiguredBackgroundAudio = Boolean(
                    activeExport.adData.musicAudioUrl || activeExport.adData.sharedMusicAssetId,
                );
                const hasPreparedMasterAudio = Boolean(
                    activeExport.adData.masterAudioUrl || activeExport.adData.sharedMasterAssetId,
                );
                if (hasConfiguredBackgroundAudio && !hasPreparedMasterAudio) {
                    throw new Error(
                        'export_audio_mix_required: A música de fundo ainda não foi mixada. Volte à etapa de áudio e prepare a trilha antes de exportar.',
                    );
                }
                const sharedExportAudioAssetId = activeExport.adData.sharedMasterAssetId
                    || (!activeExport.adData.masterAudioUrl
                        ? activeExport.adData.sharedNarrationAssetId
                        : undefined);
                const exportMasterAudioUrl = sharedExportAudioAssetId
                    ? await refreshSharedMasterAudioForExport(sharedExportAudioAssetId)
                    : activeExport.masterAudioUrl;
                const finishResult = (await engine.finish(
                    `${API_BASE_URL}/api`,
                    exportMasterAudioUrl,
                    `${activeExport.fileName}_overlay`,
                    ''
                )) as { videoPath: string; audioPath: string };
                if (!finishResult.videoPath || !finishResult.audioPath) {
                    throw new Error('Os arquivos temporários da exportação não foram criados.');
                }

                updateProgress(68, 'Revalidando mídias da exportação');
                const preparedMediaTakes: MediaTake[] = [];
                // Usa o snapshot do início do job para preservar cortes e efeitos.
                // A preparação sequencial também evita duas materializações
                // concorrentes quando o mesmo ativo aparece mais de uma vez.
                for (const take of activeExport.mediaTakes) {
                    if (take.sharedAssetId) {
                        preparedMediaTakes.push(await refreshSharedTakeForExport(take));
                        continue;
                    }
                    if (take.externalMedia?.source !== 'mileto_ops') {
                        preparedMediaTakes.push(take);
                        continue;
                    }
                    try {
                        const prepared = await prepareOpsTakeForExport(take);
                        if (!prepared.backendPath) {
                            throw new Error('A cópia local não foi criada.');
                        }
                        preparedMediaTakes.push(prepared);
                    } catch (error) {
                        const reason = error instanceof Error ? error.message : String(error);
                        throw new Error(
                            `ops_export_take_unavailable: ${safeExportMediaName(take.fileName, 'take_ops')}: ${reason}`,
                        );
                    }
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const os = (window as any).require('os');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const path = (window as any).require('path');
                const safeName = activeExport.fileName.replace(/[\\/:*?"<>|]/g, '_');
                const tempFinalPath = path.join(os.tmpdir(), `mileto-final-${Date.now()}-${crypto.randomUUID()}.mp4`);
                temporaryExportPaths = [finishResult.videoPath, finishResult.audioPath, tempFinalPath];

                updateProgress(70, 'Montando takes, efeitos e áudio');
                const resolvedTransitionPath = await resolveTransitionPathForExport(
                    activeExport.adData.globalTransition,
                );
                const response = await fetch(`${API_BASE_URL}/api/video/export-hybrid`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        takes: preparedMediaTakes.map((take) => ({
                            id: take.id,
                            type: take.type,
                            file_path: take.sharedAssetId
                                ? take.fileUrl
                                : take.externalMedia?.source === 'mileto_ops'
                                    ? take.backendPath
                                    : take.backendPath || take.fileUrl,
                            start: take.trim.start,
                            end: take.trim.end,
                            speed: take.speedPresetId && take.speedPresetId !== 'normal' ? take.speedPresetId : 1,
                            objectFit: take.objectFit || 'cover',
                            motionEffect: take.motionEffect,
                            enhancement: {
                                ...resolveTakeEnhancement(take, activeExport.adData.videoEnhancement),
                                sharpness: resolveTakeSharpness(take, activeExport.adData.videoEnhancement),
                            },
                        })),
                        transitionPath: resolvedTransitionPath,
                        transitionRotation: activeExport.transitionRotation,
                        audioPath: finishResult.audioPath,
                        overlayPath: finishResult.videoPath,
                        finalPath: tempFinalPath,
                        duration: activeExport.totalDuration,
                        format: activeExport.adData.format,
                        targetW: activeExport.targetDims.w,
                        targetH: activeExport.targetDims.h,
                        outputFps: activeExport.fps,
                    }),
                });
                const result = await response.json() as {
                    ok?: boolean;
                    code?: string;
                    message?: string;
                    finalPath?: string;
                    outputPath?: string;
                    renderDiagnostics?: ServerRenderDiagnostics;
                    diagnostics?: ServerRenderDiagnostics;
                };
                if (!response.ok || !result.ok) {
                    if (result.diagnostics) {
                        updateClientJob(activeExport.jobId, { renderDiagnostics: result.diagnostics });
                    }
                    throw new Error(`${result.code || 'render_failed'}: ${result.message || 'Falha ao montar o vídeo final.'}`);
                }
                const renderDiagnostics = result.renderDiagnostics;
                if (renderDiagnostics?.status !== 'passed') {
                    throw new Error('render_integrity_report_missing: O servidor não comprovou a integridade do MP4.');
                }
                const actualVideoDurationSec = Number(renderDiagnostics.actualVideoDurationSec);
                const actualAudioDurationSec = Number(renderDiagnostics.actualAudioDurationSec);
                if (!(actualVideoDurationSec > 0) || !(actualAudioDurationSec > 0)) {
                    throw new Error('render_integrity_duration_missing: O relatório não contém as durações reais das streams.');
                }
                const exportResult: ExportResultDiagnostics = {
                    status: 'validated',
                    exportJobId: activeExport.jobId,
                    sourceJobId: activeExport.sourceJobId,
                    projectId: activeExport.projectId,
                    expectedDurationSec: Number(renderDiagnostics.expectedDurationSec),
                    actualVideoDurationSec,
                    actualAudioDurationSec,
                    containerDurationSec: renderDiagnostics.containerDurationSec,
                    outputFps: renderDiagnostics.expectedFps,
                    actualVideoFps: renderDiagnostics.actualVideoFps,
                    videoFrameCount: renderDiagnostics.actualVideoFrameCount,
                    durationToleranceSec: renderDiagnostics.durationToleranceSec,
                    videoDurationToleranceSec: renderDiagnostics.videoDurationToleranceSec,
                    titleCount: activeExport.titleIntegrity.titles.length,
                    titleOrigin: titleOriginForExport(
                        activeExport.adData.titleGenerationSummary,
                        activeExport.titleIntegrity.titles.length,
                    ),
                    titleCoverage: activeExport.titleIntegrity.coverage,
                    warnings: activeExport.titleIntegrity.warnings,
                    validatedAt: new Date().toISOString(),
                };
                try {
                    const resultIdentity = activeExport.sourceJobId || activeExport.jobId;
                    localStorage.setItem(`mileto:render-result:${resultIdentity}`, JSON.stringify(exportResult));
                } catch {
                    // O resultado continua no job em memória; falha de armazenamento
                    // local não libera um MP4 sem validação nem muda o destino.
                }
                updateClientJob(activeExport.jobId, {
                    renderDiagnostics,
                    result: exportResult,
                    statusText: exportWarningSummary(exportResult.warnings)
                        ? `Integridade validada com advertências: ${exportWarningSummary(exportResult.warnings)}`
                        : 'Integridade de vídeo e áudio validada',
                });

                updateProgress(96, 'Enviando o MP4 ao destino escolhido');
                const sourcePath = result.finalPath || result.outputPath || tempFinalPath;
                const fileName = `${safeName}.mp4`;
                let outputPath = activeExport.outputFolder;
                let assetId: string | undefined;
                if (activeExport.destination.kind === 'local') {
                    const response = await fetch(`${API_BASE_URL}/api/files/import-export`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sourcePath, parent: activeExport.destination.folderPath || 'Vídeos', name: fileName }),
                    });
                    const data = await response.json();
                    if (!response.ok || !data.ok) throw new Error(data.message || 'Não foi possível salvar na biblioteca local.');
                    outputPath = `Biblioteca local › ${activeExport.destination.folderPath || 'Vídeos'}`;
                } else if (activeExport.destination.kind === 'shared') {
                    const response = await fetch(`${API_BASE_URL}/api/shared/files/import-local`, {
                        method: 'POST',
                        headers: { ...(await localAuthHeaders()), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ backendPath: sourcePath, name: fileName, parent: activeExport.destination.folderPath || 'Vídeos' }),
                    });
                    const data = await response.json();
                    if (!response.ok || !data.ok) throw new Error(data.message || 'Não foi possível enviar ao ambiente compartilhado.');
                    outputPath = `Compartilhado › ${activeExport.destination.folderPath || 'Vídeos'}`;
                } else {
                    if (!activeExport.opsMetadata) {
                        throw new Error('ops_export_metadata_missing: Revise o título e a descrição antes de enviar ao Mileto Ops.');
                    }
                    const response = await fetch(`${API_BASE_URL}/api/ops/exports/upload`, {
                        method: 'POST',
                        headers: { ...(await localAuthHeaders()), 'Content-Type': 'application/json', ...(activeExport.destination.viewContextId ? { 'X-Ops-View-Context': activeExport.destination.viewContextId } : {}) },
                        body: JSON.stringify({
                            sourcePath,
                            fileName,
                            companyId: activeExport.destination.companyId,
                            folderId: activeExport.destination.opsFolderId || '',
                            ...(activeExport.uploadIdempotencyKey
                                ? { idempotencyKey: activeExport.uploadIdempotencyKey }
                                : {}),
                            ...activeExport.opsMetadata,
                        }),
                    });
                    const responseText = await response.text();
                    let data: { ok?: boolean; code?: string; message?: string; data?: { assetId?: string } };
                    try {
                        data = responseText ? JSON.parse(responseText) : {};
                    } catch {
                        throw new Error(`ops_invalid_response: ${responseText.slice(0, 240) || 'O servidor local devolveu uma resposta vazia.'}`);
                    }
                    if (!response.ok || !data.ok) {
                        throw new Error(`${data.code || `HTTP_${response.status}`}: ${data.message || 'Não foi possível enviar ao Mileto Ops.'}`);
                    }
                    assetId = String(data.data?.assetId || '').trim() || undefined;
                    if (!assetId) {
                        throw new Error('ops_asset_id_missing: O Mileto Ops concluiu o envio sem devolver o assetId do vídeo.');
                    }
                    outputPath = 'Mileto Ops';
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { ipcRenderer } = (window as any).require('electron');
                await ipcRenderer.invoke('export-cleanup', { paths: temporaryExportPaths });
                temporaryExportPaths = [];
                updateClientJob(activeExport.jobId, {
                    phase: 'done',
                    percent: 100,
                    stepPercent: 100,
                    completedAt: Date.now(),
                    statusText: exportWarningSummary(exportResult.warnings)
                        ? `Vídeo exportado com advertências: ${exportWarningSummary(exportResult.warnings)}`
                        : 'Vídeo exportado e salvo',
                    outputPath,
                    assetId,
                    renderDiagnostics,
                    result: exportResult,
                });

                if (assetId) {
                    try {
                        localStorage.setItem(`mileto:ops-export:${activeExport.projectId}`, JSON.stringify({
                            assetId,
                            companyId: activeExport.destination.kind === 'ops' ? activeExport.destination.companyId : undefined,
                            folderId: activeExport.destination.kind === 'ops' ? (activeExport.destination.opsFolderId || null) : null,
                            sourceJobId: activeExport.sourceJobId,
                            executionRevision: activeExport.executionRevision,
                            uploadIdempotencyKey: activeExport.uploadIdempotencyKey,
                            exportedAt: new Date().toISOString(),
                            renderResult: exportResult,
                        }));
                    } catch {
                        // O assetId continua disponível no job e no evento mesmo se o
                        // armazenamento local estiver desabilitado pelo sistema.
                    }
                    window.dispatchEvent(new CustomEvent('mileto:ops-export-complete', {
                        detail: {
                            assetId,
                            projectId: activeExport.projectId,
                            exportJobId: activeExport.jobId,
                            renderResult: exportResult,
                        },
                    }));
                }

                if (currentProjectIdRef.current === activeExport.projectId) {
                    await saveProject({ exported: true });
                }
            } catch (error) {
                engine?.abort();
                const message = error instanceof Error ? error.message : String(error);
                if (temporaryExportPaths.length) {
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const { ipcRenderer } = (window as any).require('electron');
                        await ipcRenderer.invoke('export-cleanup', { paths: temporaryExportPaths });
                    } catch {
                        // A pasta temporária também é limpa pelo sistema operacional.
                    }
                }
                updateClientJob(activeExport.jobId, {
                    phase: 'error',
                    completedAt: Date.now(),
                    error: message,
                });
                if (activeExport.destination.kind === 'ops') {
                    window.dispatchEvent(new CustomEvent('mileto:ops-export-failed', {
                        detail: {
                            projectId: activeExport.projectId,
                            exportJobId: activeExport.jobId,
                            message,
                        },
                    }));
                }
            } finally {
                runningJobRef.current = null;
                activeRef.current = null;
                setActiveExport(null);
            }
        };

        void run();
    }, [activeExport, saveProject, updateClientJob]);

    const value = useMemo<ExportJobsContextValue>(
        () => ({
            isExporting: !!activeExport,
            startExport,
        }),
        [activeExport, startExport]
    );

    return (
        <ExportJobsContext.Provider value={value}>
            {children}
            {activeExport && (
                <div
                    aria-hidden="true"
                    className="pointer-events-none fixed -left-[10000px] top-0"
                    style={{
                        width: 360,
                        aspectRatio: activeExport.adData.format === '1:1' ? '1 / 1' : '9 / 16',
                    }}
                >
                    <VideoSequencePreview
                        ref={previewRef}
                        takes={activeExport.mediaTakes}
                        masterAudioUrl={activeExport.masterAudioUrl}
                        captions={activeExport.adData.captions}
                        dynamicTitles={(activeExport.adData.dynamicTitles || []).filter((title) => title.isActive)}
                        hideControls
                        isHybridMode
                        onMuteToggle={() => {}}
                        onMuteAll={() => {}}
                        adDataOverride={activeExport.adData}
                        captionStyleOverride={activeExport.captionStyle}
                        debugModeOverride={false}
                    />
                </div>
            )}
        </ExportJobsContext.Provider>
    );
};

export const useExportJobs = () => {
    const context = useContext(ExportJobsContext);
    if (!context) throw new Error('useExportJobs deve ser usado dentro de ExportJobsProvider.');
    return context;
};
