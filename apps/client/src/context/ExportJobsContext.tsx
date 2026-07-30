import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DOMCaptureEngine } from '../lib/export/DOMCaptureEngine';
import { API_BASE_URL } from '../lib/apiBase';
import type { AdData, CaptionStyle, CaptionTrack, MediaTake, TitleHook } from '../types';
import { VideoSequencePreview, type VideoSequencePreviewRef } from '../components/VideoSequencePreview';
import { useDownloadJobs } from './DownloadJobsContext';
import { useWizard } from './WizardContext';
import { localAuthHeaders } from '../lib/serverAuth';

export interface BackgroundExportRequest {
    fileName: string;
    outputFolder: string;
    fps: number;
    totalDuration: number;
    targetDims: { w: number; h: number };
    mediaTakes: MediaTake[];
    masterAudioUrl?: string;
    transitionPath?: string;
    adData: AdData;
    captionStyle: CaptionStyle | null;
    projectId: string;
    destination: { kind: 'local' | 'shared' | 'ops'; folderPath?: string; companyId?: string; opsFolderId?: string | null; viewContextId?: string | null };
}

interface ExportJobsContextValue {
    isExporting: boolean;
    startExport: (_request: BackgroundExportRequest) => string | null;
}

interface ActiveExport extends BackgroundExportRequest {
    jobId: string;
}

const ExportJobsContext = createContext<ExportJobsContextValue | null>(null);

const overlayFrameKey = (
    time: number,
    frameIndex: number,
    captions: CaptionTrack | undefined,
    titles: TitleHook[],
    customOverlayUrl?: string
) => {
    const segmentIndex = captions?.segments?.findIndex((segment) => time >= segment.start && time <= segment.end) ?? -1;
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
    return `${segmentIndex}:${wordIndex}:${activeTitleIds.join(',')}:${animatedFrame}:${customOverlayUrl || ''}`;
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
            const active = { ...request, fileName: safeName, jobId };
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
                        activeExport.adData.customOverlayUrl
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
                const finishResult = (await engine.finish(
                    `${API_BASE_URL}/api`,
                    activeExport.masterAudioUrl,
                    `${activeExport.fileName}_overlay`,
                    ''
                )) as { videoPath: string; audioPath: string };
                if (!finishResult.videoPath || !finishResult.audioPath) {
                    throw new Error('Os arquivos temporários da exportação não foram criados.');
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const os = (window as any).require('os');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const path = (window as any).require('path');
                const safeName = activeExport.fileName.replace(/[\\/:*?"<>|]/g, '_');
                const tempFinalPath = path.join(os.tmpdir(), `mileto-final-${Date.now()}-${crypto.randomUUID()}.mp4`);
                temporaryExportPaths = [finishResult.videoPath, finishResult.audioPath, tempFinalPath];

                updateProgress(70, 'Montando takes, efeitos e áudio');
                const response = await fetch(`${API_BASE_URL}/api/video/export-hybrid`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        takes: activeExport.mediaTakes.map((take) => ({
                            id: take.id,
                            type: take.type,
                            file_path: take.backendPath || take.fileUrl,
                            start: take.trim.start,
                            end: take.trim.end,
                            speed: take.speedPresetId && take.speedPresetId !== 'normal' ? take.speedPresetId : 1,
                            objectFit: take.objectFit || 'cover',
                            motionEffect: take.motionEffect,
                        })),
                        transitionPath: activeExport.transitionPath,
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
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.message || 'Falha ao montar o vídeo final.');

                updateProgress(96, 'Enviando o MP4 ao destino escolhido');
                const sourcePath = result.finalPath || result.outputPath || tempFinalPath;
                const fileName = `${safeName}.mp4`;
                let outputPath = activeExport.outputFolder;
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
                    const response = await fetch(`${API_BASE_URL}/api/ops/exports/upload`, {
                        method: 'POST',
                        headers: { ...(await localAuthHeaders()), 'Content-Type': 'application/json', ...(activeExport.destination.viewContextId ? { 'X-Ops-View-Context': activeExport.destination.viewContextId } : {}) },
                        body: JSON.stringify({ sourcePath, fileName, companyId: activeExport.destination.companyId, folderId: activeExport.destination.opsFolderId || '' }),
                    });
                    const responseText = await response.text();
                    let data: { ok?: boolean; message?: string };
                    try {
                        data = responseText ? JSON.parse(responseText) : {};
                    } catch {
                        throw new Error(
                            'O servidor local do Mileto ainda não foi atualizado para enviar vídeos ao Ops. Feche e abra o Mileto novamente e tente exportar de novo.'
                        );
                    }
                    if (!response.ok || !data.ok) throw new Error(data.message || 'Não foi possível enviar ao Mileto Ops.');
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
                    statusText: 'Vídeo exportado e salvo',
                    outputPath,
                });

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
