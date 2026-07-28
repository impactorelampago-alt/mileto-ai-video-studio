import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Film, FolderOpen, Loader2, X, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import type { MediaTake } from '../types';
import { useWizard } from '../context/WizardContext';
import { useExportJobs } from '../context/ExportJobsContext';

interface ExportModalProps {
    onClose: () => void;
    mediaTakes: MediaTake[];
    masterAudioUrl?: string;
    transitionPath?: string;
}

export const ExportModal = ({ onClose, mediaTakes, masterAudioUrl, transitionPath }: ExportModalProps) => {
    const { adData, captionStyle, projectId, saveProject } = useWizard();
    const { isExporting, startExport } = useExportJobs();
    const navigate = useNavigate();
    const [fileName, setFileName] = useState('MeuVideo_Mileto');
    const [fps, setFps] = useState(30);
    const [starting, setStarting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [outputFolder, setOutputFolder] = useState(() => {
        const saved = localStorage.getItem('mileto_export_folder');
        if (saved) return saved;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const os = (window as any).require('os');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const path = (window as any).require('path');
        return path.join(os.homedir(), 'Desktop');
    });
    const [targetDims, setTargetDims] = useState({ w: 1080, h: 1920 });

    useEffect(() => {
        let cancelled = false;
        const probe = (url: string): Promise<{ w: number; h: number } | null> =>
            new Promise((resolve) => {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.muted = true;
                video.onloadedmetadata = () => resolve({ w: video.videoWidth, h: video.videoHeight });
                video.onerror = () => resolve(null);
                video.src = url;
            });

        void (async () => {
            const dimensions = await Promise.all(
                mediaTakes.filter((take) => take.type === 'video').map((take) => probe(take.fileUrl || take.url))
            );
            const valid = dimensions.filter((item): item is { w: number; h: number } => !!item?.w && !!item?.h);
            if (!valid.length || cancelled) return;
            setTargetDims({
                w: Math.max(2, Math.floor(Math.min(...valid.map((item) => item.w)) / 2) * 2),
                h: Math.max(2, Math.floor(Math.min(...valid.map((item) => item.h)) / 2) * 2),
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [mediaTakes]);

    const takesDuration = mediaTakes.reduce((total, take) => total + (take.trim.end - take.trim.start), 0);
    const totalDuration = Number(adData.narrationDuration || 0) > 0 ? Number(adData.narrationDuration) : takesDuration;

    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainder = Math.floor(seconds % 60);
        return `${minutes}m ${remainder}s`;
    };

    const handleBrowseFolder = useCallback(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { ipcRenderer } = (window as any).require('electron');
        const result = await ipcRenderer.invoke('select-folder');
        if (!result.canceled && result.folderPath) {
            setOutputFolder(result.folderPath);
            localStorage.setItem('mileto_export_folder', result.folderPath);
        }
    }, []);

    const handleFinishWithoutExport = useCallback(async () => {
        setStarting(true);
        const saved = await saveProject({ lastStep: 4 });
        setStarting(false);
        if (!saved) {
            toast.error('Não foi possível salvar o rascunho. Nenhuma edição foi descartada.');
            return;
        }
        toast.success('Edição concluída sem exportar. Você pode retomá-la quando quiser.');
        onClose();
        navigate('/');
    }, [navigate, onClose, saveProject]);

    const handleExport = useCallback(async () => {
        if (starting || isExporting) {
            setErrorMsg('Já existe uma exportação em andamento. Acompanhe pelo sino de atividades.');
            return;
        }
        if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
            setErrorMsg('A duração final do projeto é inválida. Confira a narração e os takes.');
            return;
        }

        setStarting(true);
        setErrorMsg('');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { ipcRenderer } = (window as any).require('electron');
        const folderAuthorization = await ipcRenderer.invoke('export-authorize-folder', outputFolder);
        if (!folderAuthorization?.ok) {
            setStarting(false);
            setErrorMsg(folderAuthorization?.message || 'Selecione novamente a pasta de destino.');
            return;
        }
        const saved = await saveProject({ lastStep: 4 });
        if (!saved) {
            setStarting(false);
            setErrorMsg('Não foi possível salvar o projeto antes da exportação. Nenhuma edição foi descartada.');
            return;
        }

        const jobId = startExport({
            fileName: fileName.trim() || 'MeuVideo_Mileto',
            outputFolder,
            fps,
            totalDuration,
            targetDims,
            mediaTakes: [...mediaTakes],
            masterAudioUrl,
            transitionPath,
            adData: {
                ...adData,
                dynamicTitles: [...(adData.dynamicTitles || [])],
                captions: adData.captions ? { ...adData.captions, segments: [...adData.captions.segments] } : undefined,
            },
            captionStyle: captionStyle ? { ...captionStyle } : null,
            projectId,
        });
        setStarting(false);
        if (!jobId) {
            setErrorMsg('Já existe uma exportação em andamento. Acompanhe pelo sino de atividades.');
            return;
        }

        toast.success('Exportação iniciada em segundo plano. Acompanhe o progresso pelo sino.');
        onClose();
        navigate('/');
    }, [
        adData,
        captionStyle,
        fileName,
        fps,
        isExporting,
        masterAudioUrl,
        mediaTakes,
        navigate,
        onClose,
        outputFolder,
        projectId,
        saveProject,
        startExport,
        starting,
        targetDims,
        totalDuration,
        transitionPath,
    ]);

    return createPortal(
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
            <div className="relative z-101 flex w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-brand-accent/30 bg-brand-dark/95 shadow-[0_0_50px_rgba(0,230,118,0.15)] ring-1 ring-white/5">
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[20px_20px] opacity-20" />
                <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-white/10 bg-brand-card/50 px-6 py-5">
                    <div className="flex items-center gap-4">
                        <div className="rounded-xl border border-brand-accent/20 bg-brand-accent/10 p-2.5 shadow-[0_0_15px_rgba(0,230,118,0.2)]">
                            <Film className="h-6 w-6 text-brand-accent" />
                        </div>
                        <div>
                            <h3 className="text-[15px] font-black uppercase tracking-wider text-foreground">
                                Exportar Vídeo
                            </h3>
                            <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-brand-muted">
                                {formatDuration(totalDuration)} • {mediaTakes.length}{' '}
                                {mediaTakes.length === 1 ? 'clipe' : 'clipes'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={starting}
                        className="rounded-full bg-white/5 p-2 text-brand-muted transition hover:bg-red-500/20 hover:text-red-400 disabled:opacity-40"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="relative z-10 flex flex-col gap-6 p-8">
                    <div className="flex flex-col gap-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-brand-accent">
                            Nome do arquivo
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="text"
                                autoFocus
                                value={fileName}
                                onChange={(event) => setFileName(event.target.value)}
                                className="flex-1 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm font-semibold text-foreground outline-none focus:border-brand-accent/50"
                            />
                            <span className="rounded-xl border border-white/5 bg-white/5 px-3 py-3 font-mono text-xs font-bold text-brand-muted">
                                .MP4
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-brand-accent">
                            Pasta de destino
                        </label>
                        <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-black/50 px-4 py-3 font-mono text-xs text-brand-muted">
                                {outputFolder}
                            </div>
                            <button
                                onClick={() => void handleBrowseFolder()}
                                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase text-brand-muted transition hover:border-brand-accent/50 hover:text-foreground"
                            >
                                <FolderOpen className="h-4 w-4" /> Alterar
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-brand-accent">
                            Taxa de quadros
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            {[24, 30, 60].map((value) => (
                                <button
                                    key={value}
                                    onClick={() => setFps(value)}
                                    className={cn(
                                        'rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-wider transition',
                                        fps === value
                                            ? 'border-brand-accent bg-brand-accent/10 text-brand-accent'
                                            : 'border-white/10 bg-black/30 text-brand-muted hover:text-foreground'
                                    )}
                                >
                                    {value} FPS
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-brand-accent/10 bg-brand-accent/5 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-brand-muted">
                        <span>{masterAudioUrl ? 'Áudio master incluído' : 'Exportação sem áudio'}</span>
                        <span className="text-brand-lime">
                            {targetDims.w}×{targetDims.h}
                        </span>
                    </div>

                    {errorMsg && (
                        <div className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300">
                            <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {errorMsg}
                        </div>
                    )}

                    <div className="rounded-xl border border-brand-lime/15 bg-brand-lime/[0.055] px-4 py-3 text-[11px] leading-relaxed text-foreground/70">
                        Ao iniciar, você voltará ao Início. O vídeo continuará sendo processado e o progresso aparecerá
                        no sino de atividades.
                    </div>
                </div>

                <div className="relative z-10 flex shrink-0 justify-end gap-4 border-t border-white/10 bg-brand-card/80 px-8 py-5">
                    <button
                        onClick={() => void handleFinishWithoutExport()}
                        disabled={starting}
                        className="rounded-xl border border-white/10 bg-white/5 px-5 py-3.5 text-[10px] font-bold uppercase tracking-wider text-brand-muted hover:text-foreground disabled:opacity-40"
                    >
                        Concluir sem exportar
                    </button>
                    <button
                        onClick={() => void handleExport()}
                        disabled={!fileName.trim() || starting || isExporting}
                        className="flex items-center gap-3 rounded-xl bg-linear-to-r from-brand-lime to-brand-accent px-8 py-3.5 text-xs font-black uppercase tracking-widest text-[#0a0f12] transition hover:shadow-[0_0_25px_rgba(0,230,118,0.4)] disabled:opacity-45"
                    >
                        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {starting
                            ? 'Salvando projeto...'
                            : isExporting
                              ? 'Exportação em andamento'
                              : 'Exportar em segundo plano'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
