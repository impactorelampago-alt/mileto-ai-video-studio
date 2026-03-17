import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, CheckCircle2, XCircle, Film, FolderOpen } from 'lucide-react';
import { cn } from '../lib/utils';
import { DOMCaptureEngine } from '../lib/export/DOMCaptureEngine';
import { VideoSequencePreviewRef } from './VideoSequencePreview';
import { MediaTake } from '../types';
import { useWizard, SHOW_DEBUG_FEATURES } from '../context/WizardContext';

interface ExportModalProps {
    onClose: () => void;
    previewRef: React.RefObject<VideoSequencePreviewRef | null>;
    mediaTakes: MediaTake[];
    masterAudioUrl?: string;
    isHybridMode?: boolean; // Se ativo, FFMPEG processa vídeos, Frontend só exporta texto
    transitionPath?: string;
}

type ExportPhase = 'config' | 'exporting' | 'done' | 'error';

export const ExportModal = ({
    onClose,
    previewRef,
    mediaTakes,
    masterAudioUrl,
    isHybridMode = false,
    transitionPath,
}: ExportModalProps) => {
    const { adData } = useWizard();
    // Config state
    const [fileName, setFileName] = useState('MeuVideo_Mileto');
    const [fps, setFps] = useState(30);
    const [outputFolder, setOutputFolder] = useState(() => {
        const saved = localStorage.getItem('mileto_export_folder');
        if (saved) return saved;
        // Default to Desktop
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const os = (window as any).require('os');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pathMod = (window as any).require('path');
        return pathMod.join(os.homedir(), 'Desktop');
    });

    // Export state
    const [phase, setPhase] = useState<ExportPhase>('config');
    const [progress, setProgress] = useState(0);
    const [currentFrame, setCurrentFrame] = useState(0);
    const [totalFrames, setTotalFrames] = useState(0);
    const [eta, setEta] = useState('');
    const [statusText, setStatusText] = useState('');
    const [outputPath, setOutputPath] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    // Refs for cancellation
    const cancelledRef = useRef(false);
    const startTimeRef = useRef(0);

    // Calculate total duration from all takes
    let totalDuration = mediaTakes.reduce((acc, take) => acc + (take.trim.end - take.trim.start), 0);

    // Override length if user clicked "Testar Motor Rápido (5s)"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any)._isTestExportPattern) {
        totalDuration = Math.min(5, totalDuration);
    }

    const formatTime = (seconds: number) => {
        if (!isFinite(seconds) || seconds <= 0) return '--:--';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const formatDuration = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}m ${s}s`;
    };

    const handleCancel = useCallback(() => {
        cancelledRef.current = true;
        setStatusText('Cancelando...');
    }, []);

    const handleBrowseFolder = useCallback(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { ipcRenderer } = (window as any).require('electron');
        const result = await ipcRenderer.invoke('select-folder');
        if (!result.canceled && result.folderPath) {
            setOutputFolder(result.folderPath);
            localStorage.setItem('mileto_export_folder', result.folderPath);
        }
    }, []);

    const handleExport = useCallback(async () => {
        if (!previewRef.current) return;
        // ═══ EXPORT DEBUG ALERT ═══
        if (SHOW_DEBUG_FEATURES) {
            const debugInfo = mediaTakes
                .map((t) => `${t.fileName}: speed=${t.speedPresetId || '1x'}, path=${t.backendPath ? 'OK' : 'FAIL'}`)
                .join('\\n');

            alert(
                `[DEBUG EXPORT HYBRID]\\nMode: ${isHybridMode}\\nTransitionPath: ${transitionPath || 'VAZIO/NULO!'}\\n\\nTakes:\\n${debugInfo}\\n\\nTotal Duration: ${totalDuration}s`
            );
        }
        // ══════════════════════════

        const total = Math.ceil(totalDuration * fps);
        setTotalFrames(total);
        setPhase('exporting');
        setProgress(0);
        setCurrentFrame(0);
        setStatusText('Inicializando encoder...');
        cancelledRef.current = false;
        startTimeRef.current = Date.now();

        try {
            // Se estiver em modo híbrido, avisa o CaptureEngine para filmar com Transparencia (Alpha WebM)
            const engine = new DOMCaptureEngine(1080, 1920, fps, isHybridMode);
            await engine.start();

            setStatusText(isHybridMode ? 'Extraindo Títulos e Legendas (Overlay)...' : 'Renderizando frames...');

            for (let i = 0; i < total; i++) {
                // Check cancellation
                if (cancelledRef.current) {
                    engine.abort();
                    setPhase('config');
                    setStatusText('');
                    return;
                }

                const time = i / fps;
                const canvas = await previewRef.current!.extractFrameSync(time, isHybridMode);
                if (canvas) {
                    await engine.captureFrame(canvas);
                }

                // Update progress
                const pct = ((i + 1) / total) * 100;
                setProgress(pct);
                setCurrentFrame(i + 1);

                // Calculate ETA
                const elapsed = (Date.now() - startTimeRef.current) / 1000;
                const framesPerSec = (i + 1) / elapsed;
                const remaining = (total - (i + 1)) / framesPerSec;
                setEta(formatTime(remaining));

                // Update status every 10 frames
                if (i % 10 === 0) {
                    setStatusText(`Frame ${i + 1}/${total} (${framesPerSec.toFixed(1)} fps)`);
                }
            }

            // Check cancellation before finishing
            if (cancelledRef.current) {
                engine.abort();
                setPhase('config');
                return;
            }

            setStatusText('Mixando áudio e finalizando...');
            setProgress(99);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const path = (window as any).require('path');
            // Sanitize filename: remove Windows-invalid chars
            const safeName = (fileName.trim() || 'MeuVideo_Mileto').replace(/[\\/:*?"<>|]/g, '_');
            const fullOutputPath = path.join(outputFolder, `${safeName}.mp4`);

            const API_BASE = (window as any).API_BASE_URL || 'http://localhost:3301';
            let finalPath: string;

            if (isHybridMode) {
                // Híbrido: Salva titulo/audio, diz pro backend fundir tudo pesado lá embaixo.
                setStatusText('Acoplando FFMpeg Hardware (Isso será rápido)...');
                const finishResult = (await engine.finish(
                    `${API_BASE}/api`,
                    masterAudioUrl || undefined,
                    `${fileName.trim()}_overlay`,
                    '' // Let finish pick temp returning an object
                )) as { videoPath: string; audioPath: string };

                const overlayPath = finishResult.videoPath;
                const generatedAudioPath = finishResult.audioPath;

                // ═══ DEBUG: Log payload before sending to backend ═══
                const hybridPayload = {
                    takes: mediaTakes.map((t) => ({
                        id: t.id,
                        type: t.type,
                        file_path: t.backendPath || t.fileUrl,
                        start: t.trim.start,
                        end: t.trim.end,
                        speed: t.speedPresetId && t.speedPresetId !== 'normal' ? t.speedPresetId : 1.0,
                        objectFit: t.objectFit || 'cover',
                        muteOriginalAudio: !!t.muteOriginalAudio,
                    })),
                    transitionPath: transitionPath,
                    audioPath: generatedAudioPath,
                    overlayPath: overlayPath,
                    finalPath: fullOutputPath,
                    duration: totalDuration,
                    format: adData.format,
                };

                console.log('══════════════════════════════════════════════');
                console.log('[EXPORT DEBUG] HYBRID PAYLOAD COMPLETO:', JSON.stringify(hybridPayload, null, 2));
                console.log(
                    '[EXPORT DEBUG] mediaTakes speedPresetIds:',
                    mediaTakes.map((t) => `${t.fileName}: ${t.speedPresetId || 'undefined'}`)
                );
                console.log('[EXPORT DEBUG] transitionPath:', transitionPath);
                console.log(
                    '[EXPORT DEBUG] takes backendPaths:',
                    mediaTakes.map((t) => `backendPath=${t.backendPath}, fileUrl=${t.fileUrl}`)
                );
                console.log('══════════════════════════════════════════════');

                const hybridResp = await fetch(`${API_BASE}/api/video/export-hybrid`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(hybridPayload),
                });

                const hbData = await hybridResp.json();
                if (!hbData.ok) throw new Error(hbData.message);
                finalPath = hbData.finalPath || hbData.outputPath || fullOutputPath;
            } else {
                // Legado: Muxa Opaque Video + Audio Localmente
                const legacyResult = await engine.finish(
                    `${API_BASE}/api`,
                    masterAudioUrl || undefined,
                    fileName.trim(),
                    fullOutputPath
                );
                finalPath = typeof legacyResult === 'string' ? legacyResult : '';
            }

            if (finalPath) {
                setOutputPath(finalPath);
                setPhase('done');
                setProgress(100);
                setStatusText('Exportação concluída!');
            } else {
                // User cancelled save dialog
                setPhase('config');
                setStatusText('');
            }
        } catch (err: unknown) {
            console.error('[Export Error]', err);
            setErrorMsg(err instanceof Error ? err.message : String(err));
            setPhase('error');
        }
    }, [
        fps,
        totalDuration,
        previewRef,
        masterAudioUrl,
        mediaTakes,
        isHybridMode,
        transitionPath,
        fileName,
        outputFolder,
    ]);

    // Prevent accidental close during export
    const handleClose = () => {
        if (phase === 'exporting') {
            if (!window.confirm('A exportação está em andamento. Deseja cancelar?')) return;
            cancelledRef.current = true;
        }
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="bg-brand-dark/95 border border-brand-accent/30 rounded-3xl w-full max-w-lg shadow-[0_0_50px_rgba(0,230,118,0.15)] flex flex-col overflow-hidden relative z-101 ring-1 ring-white/5">
                {/* HUD Scanlines Overlay */}
                <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[20px_20px] opacity-20"></div>

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-black/10 dark:border-white/10 bg-brand-card/50 shrink-0 relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="p-2.5 rounded-xl bg-brand-accent/10 border border-brand-accent/20 shadow-[0_0_15px_rgba(0,230,118,0.2)]">
                            <Film className="w-6 h-6 text-brand-accent drop-shadow-[0_0_8px_rgba(0,230,118,0.8)]" />
                        </div>
                        <div>
                            <h3 className="font-black uppercase tracking-wider text-foreground text-[15px] drop-shadow-md">
                                Exportar Vídeo
                            </h3>
                            <p className="text-[11px] uppercase tracking-widest text-brand-muted font-bold mt-1">
                                {formatDuration(totalDuration)} • {mediaTakes.length} CLIPE
                                {mediaTakes.length > 1 ? 'S' : ''}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-2 bg-black/5 dark:bg-white/5 hover:bg-red-500/20 rounded-full text-brand-muted hover:text-red-400 transition-all border border-transparent hover:border-red-500/30"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 flex flex-col gap-6 relative z-10">
                    {phase === 'config' && (
                        <>
                            {/* File Name */}
                            <div className="flex flex-col gap-2.5">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-brand-accent">
                                    Nome do arquivo
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="text"
                                        autoFocus
                                        value={fileName}
                                        onChange={(e) => setFileName(e.target.value)}
                                        onKeyDown={(e) => e.stopPropagation()}
                                        className="flex-1 bg-black/50 border border-black/10 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-brand-accent/50 focus:border-brand-accent/50 transition-all shadow-inner"
                                        placeholder="Nome_do_Video"
                                    />
                                    <span className="text-xs text-brand-muted font-mono font-bold uppercase tracking-widest bg-black/5 dark:bg-white/5 px-3 py-3 rounded-xl border border-black/5 dark:border-white/5">
                                        .MP4
                                    </span>
                                </div>
                            </div>

                            {/* Destination Folder */}
                            <div className="flex flex-col gap-2.5">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-brand-accent">
                                    Pasta de Destino
                                </label>
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 bg-black/50 border border-black/10 dark:border-white/10 rounded-xl px-4 py-3 text-xs font-mono text-brand-muted truncate shadow-inner">
                                        {outputFolder}
                                    </div>
                                    <button
                                        onClick={handleBrowseFolder}
                                        className="flex items-center gap-2 px-4 py-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl text-xs uppercase font-bold tracking-wider text-brand-muted hover:text-foreground hover:border-brand-accent/50 hover:bg-brand-accent/10 transition-all"
                                    >
                                        <FolderOpen className="w-4 h-4" />
                                        Alterar
                                    </button>
                                </div>
                            </div>

                            {/* FPS Selector */}
                            <div className="flex flex-col gap-3">
                                <label className="text-[10px] uppercase tracking-widest font-bold text-brand-accent">
                                    Taxa de quadros
                                </label>
                                <div className="grid grid-cols-3 gap-3">
                                    {[24, 30, 60].map((f) => (
                                        <button
                                            key={f}
                                            onClick={() => setFps(f)}
                                            className={cn(
                                                'px-4 py-3 rounded-xl text-xs font-black uppercase tracking-wider border transition-all shadow-inner relative overflow-hidden',
                                                fps === f
                                                    ? 'bg-brand-accent/10 border-brand-accent text-brand-accent shadow-[0_0_15px_rgba(0,230,118,0.15)] ring-1 ring-brand-accent/50'
                                                    : 'bg-black/50 border-black/10 dark:border-white/10 text-brand-muted hover:text-foreground hover:border-white/30 hover:bg-black/5 dark:bg-white/5'
                                            )}
                                        >
                                            {fps === f && (
                                                <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(0,230,118,0.1)_50%,transparent_75%)] bg-[length:250%_250%] animate-scan"></div>
                                            )}
                                            {f} FPS
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[10px] uppercase tracking-wider font-bold text-brand-muted opacity-80 pl-1">
                                    {fps === 24
                                        ? 'CINEMATOGRÁFICO — IDEAL PARA NARRATIVAS'
                                        : fps === 30
                                          ? 'PADRÃO — MELHOR COMPATIBILIDADE'
                                          : 'SUAVE — MAIOR QUALIDADE DE MOVIMENTO'}
                                </p>
                            </div>

                            {/* Audio Info */}
                            <div className="flex items-center gap-4 p-4 rounded-xl bg-black/30 border border-black/5 dark:border-white/5 shadow-inner mt-2">
                                <div
                                    className={cn(
                                        'w-2.5 h-2.5 rounded-full shadow-[0_0_8px_currentColor]',
                                        masterAudioUrl ? 'bg-brand-lime text-brand-lime' : 'bg-red-500 text-red-500'
                                    )}
                                />
                                <span className="text-[10px] uppercase tracking-wider font-bold text-brand-muted">
                                    {masterAudioUrl
                                        ? 'MIXAGEM MASTER DE ÁUDIO (SFX + VOZ) INCLUÍDA'
                                        : 'ALERTA: VÍDEO SERÁ EXPORTADO SEM ÁUDIO (MUDO)'}
                                </span>
                            </div>

                            {/* Estimates */}
                            <div className="flex items-center justify-between text-[11px] uppercase tracking-widest font-bold text-brand-muted px-2 py-2 bg-brand-accent/5 border border-brand-accent/10 rounded-lg">
                                <span>
                                    FRAMES:{' '}
                                    <strong className="text-brand-accent drop-shadow-[0_0_5px_rgba(0,230,118,0.5)]">
                                        {Math.ceil(totalDuration * fps)}
                                    </strong>
                                </span>
                                <span>
                                    RES:{' '}
                                    <strong className="text-brand-lime drop-shadow-[0_0_5px_rgba(163,230,53,0.5)]">
                                        1080×1920
                                    </strong>
                                </span>
                            </div>
                        </>
                    )}

                    {phase === 'exporting' && (
                        <div className="flex flex-col gap-6 py-4">
                            {/* Animated spinner + status */}
                            <div className="flex items-center gap-4 bg-black/40 p-4 rounded-xl border border-black/5 dark:border-white/5 shadow-inner">
                                <div className="relative flex items-center justify-center w-8 h-8">
                                    <div className="absolute inset-0 border-2 border-brand-accent/20 rounded-full"></div>
                                    <div className="absolute inset-0 border-2 border-brand-accent border-t-transparent rounded-full animate-spin"></div>
                                    <div className="w-1.5 h-1.5 bg-brand-lime rounded-full shadow-[0_0_8px_var(--color-brand-lime)] animate-ping"></div>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase tracking-widest font-bold text-brand-accent mb-1 animate-pulse">
                                        SISTEMA ATIVO
                                    </span>
                                    <span className="text-xs text-foreground font-bold uppercase tracking-wider">
                                        {statusText}
                                    </span>
                                </div>
                            </div>

                            {/* HUD Progress bar */}
                            <div className="relative w-full h-4 bg-black/80 rounded-full overflow-hidden border border-black/10 dark:border-white/10 shadow-inner p-0.5">
                                <div
                                    className="absolute inset-y-0.5 left-0.5 bg-linear-to-r from-brand-lime to-brand-accent rounded-full transition-all duration-300 ease-out shadow-[0_0_15px_rgba(163,230,53,0.8)]"
                                    style={{ width: `calc(${progress}% - 4px)` }}
                                >
                                    <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_25%,rgba(255,255,255,0.5)_50%,transparent_75%)] bg-size-[250%_100%] animate-scan opacity-50"></div>
                                </div>
                            </div>

                            {/* Stats row */}
                            <div className="flex items-center justify-between text-[11px] font-mono font-bold uppercase tracking-widest text-brand-muted px-2">
                                <span>
                                    SYS.FRM: <span className="text-foreground">{currentFrame}</span>/
                                    <span className="text-foreground/50">{totalFrames}</span>
                                </span>
                                <span className="text-brand-lime drop-shadow-[0_0_5px_rgba(163,230,53,0.5)] text-lg">
                                    {progress.toFixed(1)}%
                                </span>
                                <span>
                                    ETA: <span className="text-brand-accent">{eta}</span>
                                </span>
                            </div>
                        </div>
                    )}

                    {phase === 'done' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="relative">
                                <div className="absolute inset-0 bg-brand-lime/20 blur-xl rounded-full animate-pulse"></div>
                                <div className="p-5 rounded-full bg-brand-lime/20 border border-brand-lime/50 relative z-10 shadow-[0_0_20px_rgba(163,230,53,0.4)]">
                                    <CheckCircle2 className="w-12 h-12 text-brand-lime drop-shadow-[0_0_8px_rgba(163,230,53,0.8)]" />
                                </div>
                            </div>
                            <div className="text-center space-y-2">
                                <h4 className="text-xl font-black uppercase tracking-widest text-foreground drop-shadow-md">
                                    OPERAÇÃO CONCLUÍDA
                                </h4>
                                <p className="text-[11px] uppercase tracking-widest text-brand-lime font-bold font-mono bg-brand-lime/10 px-4 py-2 rounded-xl border border-brand-lime/20 break-all max-w-[400px]">
                                    {outputPath}
                                </p>
                            </div>
                        </div>
                    )}

                    {phase === 'error' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="relative">
                                <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full animate-pulse"></div>
                                <div className="p-5 rounded-full bg-red-500/20 border border-red-500/50 relative z-10 shadow-[0_0_20px_rgba(239,68,68,0.4)]">
                                    <XCircle className="w-12 h-12 text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                                </div>
                            </div>
                            <div className="text-center space-y-2">
                                <h4 className="text-xl font-black uppercase tracking-widest text-foreground drop-shadow-md">
                                    FALHA NO SISTEMA
                                </h4>
                                <p className="text-[11px] uppercase tracking-widest text-red-400 font-bold font-mono bg-red-500/10 px-4 py-2 rounded-xl border border-red-500/20 break-all max-w-[400px]">
                                    ERR_CODE :: {errorMsg}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-8 py-5 border-t border-black/10 dark:border-white/10 bg-brand-card/80 flex justify-end gap-4 shrink-0 relative z-10">
                    {phase === 'config' && (
                        <>
                            <button
                                onClick={handleExport}
                                disabled={!fileName.trim()}
                                className="px-10 py-3.5 bg-linear-to-r from-brand-lime to-brand-accent hover:shadow-[0_0_25px_rgba(0,230,118,0.4)] text-[#0a0f12] font-black rounded-xl transition-transform hover:scale-105 active:scale-95 flex items-center gap-3 text-xs uppercase tracking-widest disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-none"
                            >
                                <Download className="w-4 h-4" />
                                EXPORTAR VÍDEO
                            </button>
                        </>
                    )}

                    {phase === 'exporting' && (
                        <button
                            onClick={handleCancel}
                            className="px-8 py-3.5 bg-red-500/10 text-red-400 hover:text-red-300 hover:bg-red-500/20 font-black uppercase tracking-widest rounded-xl transition-colors text-xs border border-red-500/30 w-full shadow-[0_0_15px_rgba(239,68,68,0.1)]"
                        >
                            INTERROMPER PROCESSO
                        </button>
                    )}

                    {(phase === 'done' || phase === 'error') && (
                        <button
                            onClick={handleClose}
                            className="px-10 py-3.5 bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:bg-white/20 text-foreground font-black uppercase tracking-widest rounded-xl transition-transform hover:scale-105 active:scale-95 text-xs w-full border border-black/10 dark:border-white/10 shadow-lg"
                        >
                            FECHAR TERMINAL
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};
