import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    CheckCircle2,
    Download,
    Film,
    FolderOpen,
    Gauge,
    HardDrive,
    Link2,
    ListPlus,
    Loader2,
    Music,
    Search,
    Video,
    Trash2,
    X,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { API_BASE_URL as API } from '../lib/apiBase';
import { cn } from '../lib/utils';
import type { MusicTrack } from '../types';
import { useDownloadJobs } from '../context/DownloadJobsContext';

interface DownloadedMedia extends MusicTrack {
    type: 'audio' | 'video';
}

interface DownloadModalProps {
    onClose: () => void;
    onDownloaded: (media: DownloadedMedia) => void;
    allowVideo?: boolean;
    defaultDestination?: string;
}

interface DownloadFolderNode {
    name: string;
    relPath: string;
    children?: DownloadFolderNode[];
}

interface DownloadFolderOption {
    value: string;
    label: string;
}

interface VideoOption {
    quality: string;
    height: number;
    label: string;
    fps?: number;
    estimatedBytes?: number;
}

interface AudioOption {
    bitrate: number;
    label: string;
}

interface InspectedMedia {
    id: string;
    title: string;
    durationSec: number;
    thumbnail?: string;
    source: string;
    sourceUrl: string;
    uploader?: string;
    live: boolean;
    hasVideo: boolean;
    hasAudio: boolean;
    sourceAudioBitrate?: number;
    videoOptions: VideoOption[];
    audioOptions: AudioOption[];
}

type LinkInputMode = 'single' | 'batch';
type BatchItemStatus = 'inspecting' | 'ready' | 'error';

interface BatchDownloadItem {
    id: string;
    url: string;
    status: BatchItemStatus;
    media?: InspectedMedia;
    error?: string;
}

type DownloadMode = 'audio' | 'video';
type Phase = 'idle' | 'inspecting' | 'ready' | 'downloading' | 'done' | 'error';
type ErrorStage = 'inspect' | 'download';
type JobStep = 'downloading' | 'processing';

interface StatusResponse {
    ok: boolean;
    phase: 'downloading' | 'done' | 'error';
    percent?: number;
    step?: JobStep;
    stepPercent?: number;
    title?: string;
    track?: DownloadedMedia;
    error?: string;
    message?: string;
}

class ApiResponseError extends Error {}

const MAX_BATCH_LINKS = 50;

const readApiJson = async <T,>(response: Response): Promise<T> => {
    const responseText = await response.text();
    try {
        return JSON.parse(responseText) as T;
    } catch {
        const isMissingRoute =
            response.status === 404 ||
            /<!doctype|cannot\s+(?:get|post|delete|patch)/i.test(responseText);
        throw new ApiResponseError(
            isMissingRoute
                ? 'O servidor interno ainda está usando uma versão anterior. Feche completamente o Mileto e abra novamente.'
                : `O servidor local respondeu em formato inesperado (HTTP ${response.status}). Reinicie o Mileto e tente novamente.`
        );
    }
};

const inspectMediaUrl = async (url: string, allowVideo: boolean): Promise<InspectedMedia> => {
    const response = await fetch(`${API}/api/download/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(65000),
    });
    const data = await readApiJson<{ ok: boolean; media?: InspectedMedia; message?: string }>(response);
    if (!response.ok || !data.ok || !data.media) {
        throw new Error(data.message || 'Não foi possível analisar esse link.');
    }
    if (data.media.live) {
        throw new Error('Transmissões ao vivo ainda não podem ser baixadas. Use um vídeo já finalizado.');
    }
    if (!data.media.hasVideo && !data.media.hasAudio) {
        throw new Error('Esse link não oferece vídeo nem áudio compatível para download.');
    }
    if (!allowVideo && !data.media.hasAudio) {
        throw new Error('Esse link não oferece uma faixa de áudio para conversão.');
    }
    return data.media;
};

const recommendedVideoQuality = (media: InspectedMedia) =>
    media.videoOptions.find((option) => option.height === 1080)?.quality ||
    media.videoOptions.find((option) => option.height > 0 && option.height < 1080)?.quality ||
    media.videoOptions[0]?.quality ||
    'best';

const parseBatchLinks = (value: string) => {
    const unique = new Set<string>();
    for (const part of value.split(/[\s,;]+/)) {
        const candidate = part.trim();
        if (candidate) unique.add(candidate);
    }
    return [...unique];
};

const formatDuration = (seconds: number) => {
    if (!seconds || !Number.isFinite(seconds)) return 'Duração não informada';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        : `${minutes}:${String(secs).padStart(2, '0')}`;
};

const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes >= 1024 ** 3) return `~${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `~${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
};

const formatDestinationLabel = (destination: string) =>
    destination
        ? destination
              .split('/')
              .filter(Boolean)
              .join(' / ')
        : 'Arquivos (raiz)';

const fallbackFolderOptions = (destination: string): DownloadFolderOption[] => {
    const values = ['', destination, 'Imagens', 'Músicas', 'Vídeos'].filter(
        (value, index, all) => all.indexOf(value) === index
    );
    return values.map((value) => ({ value, label: formatDestinationLabel(value) }));
};

const flattenFolderTree = (
    node: DownloadFolderNode,
    options: DownloadFolderOption[] = []
): DownloadFolderOption[] => {
    const value = node.relPath === '/' ? '' : node.relPath;
    if (value) options.push({ value, label: formatDestinationLabel(value) });
    for (const child of node.children || []) flattenFolderTree(child, options);
    return options;
};

export const DownloadModal = ({
    onClose,
    onDownloaded,
    allowVideo = false,
    defaultDestination,
}: DownloadModalProps) => {
    const initialDestination = defaultDestination ?? (allowVideo ? '' : 'Músicas');
    const [inputMode, setInputMode] = useState<LinkInputMode>('single');
    const [url, setUrl] = useState('');
    const [batchText, setBatchText] = useState('');
    const [batchItems, setBatchItems] = useState<BatchDownloadItem[]>([]);
    const [isBatchInspecting, setIsBatchInspecting] = useState(false);
    const [isBatchStarting, setIsBatchStarting] = useState(false);
    const [mode, setMode] = useState<DownloadMode>(allowVideo ? 'video' : 'audio');
    const [phase, setPhase] = useState<Phase>('idle');
    const [errorStage, setErrorStage] = useState<ErrorStage>('inspect');
    const [errorMsg, setErrorMsg] = useState('');
    const [media, setMedia] = useState<InspectedMedia | null>(null);
    const [selectedQuality, setSelectedQuality] = useState('best');
    const [selectedBitrate, setSelectedBitrate] = useState(192);
    const [jobId, setJobId] = useState<string | null>(null);
    const [jobStep, setJobStep] = useState<JobStep>('downloading');
    const [jobPercent, setJobPercent] = useState(0);
    const [downloadTitle, setDownloadTitle] = useState('');
    const [isCancelling, setIsCancelling] = useState(false);
    const [destination, setDestination] = useState(initialDestination);
    const [folderOptions, setFolderOptions] = useState<DownloadFolderOption[]>(() =>
        fallbackFolderOptions(initialDestination)
    );
    const deliveredRef = useRef(false);
    const onDownloadedRef = useRef(onDownloaded);
    const { registerJob, enqueueInternetDownloads } = useDownloadJobs();

    useEffect(() => {
        onDownloadedRef.current = onDownloaded;
    }, [onDownloaded]);

    useEffect(() => {
        let cancelled = false;
        const requestedDestination = defaultDestination ?? (allowVideo ? '' : 'Músicas');
        setDestination(requestedDestination);
        setFolderOptions(fallbackFolderOptions(requestedDestination));

        const loadFolders = async () => {
            try {
                const response = await fetch(`${API}/api/files/tree`);
                const data = await readApiJson<{ ok: boolean; root?: DownloadFolderNode }>(response);
                if (cancelled || !response.ok || !data.ok || !data.root) return;

                const loaded = flattenFolderTree(data.root);
                const options = [{ value: '', label: 'Arquivos (raiz)' }, ...loaded];
                if (requestedDestination && !options.some((option) => option.value === requestedDestination)) {
                    options.splice(1, 0, {
                        value: requestedDestination,
                        label: formatDestinationLabel(requestedDestination),
                    });
                }
                setFolderOptions(
                    options.filter(
                        (option, index, all) => all.findIndex((item) => item.value === option.value) === index
                    )
                );
            } catch {
                // Mantém as pastas padrão caso a árvore ainda esteja carregando.
            }
        };

        void loadFolders();
        return () => {
            cancelled = true;
        };
    }, [allowVideo, defaultDestination]);

    useEffect(() => {
        if (phase !== 'downloading' || !jobId) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const schedule = (delay: number) => {
            if (!cancelled) timer = setTimeout(() => void poll(), delay);
        };
        const poll = async () => {
            try {
                const response = await fetch(`${API}/api/download/status/${jobId}`, {
                    signal: AbortSignal.timeout(10000),
                });
                const data = await readApiJson<StatusResponse>(response);
                if (cancelled) return;
                if (!response.ok || !data.ok) {
                    if (response.status === 404) throw new ApiResponseError('O acompanhamento deste download foi perdido.');
                    throw new ApiResponseError(data.message || `Falha ao consultar o download (${response.status}).`);
                }

                if (data.phase === 'downloading') {
                    setJobStep(data.step || 'downloading');
                    setJobPercent(Math.max(0, Math.min(100, Number(data.percent || data.stepPercent || 0))));
                    if (data.title) setDownloadTitle(data.title);
                    schedule(900);
                    return;
                }
                if (data.phase === 'error') {
                    setErrorStage('download');
                    setErrorMsg(data.error || data.message || 'O download falhou.');
                    setPhase('error');
                    return;
                }

                setJobPercent(100);
                setPhase('done');
                if (data.track && !deliveredRef.current) {
                    deliveredRef.current = true;
                    onDownloadedRef.current(data.track);
                }
            } catch (error) {
                if (!cancelled) {
                    if (error instanceof ApiResponseError) {
                        setErrorStage('download');
                        setErrorMsg(error.message);
                        setPhase('error');
                        return;
                    }
                    console.warn('[Download] Falha temporária ao consultar status:', error);
                    schedule(1500);
                }
            }
        };

        schedule(250);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [phase, jobId]);

    const handleInspect = useCallback(async () => {
        const trimmed = url.trim();
        if (!trimmed) {
            toast.error('Cole um link primeiro.');
            return;
        }
        setPhase('inspecting');
        setErrorMsg('');
        setErrorStage('inspect');
        setMedia(null);

        try {
            const inspected = await inspectMediaUrl(trimmed, allowVideo);
            setSelectedQuality(recommendedVideoQuality(inspected));
            setSelectedBitrate(192);
            setMode(allowVideo && inspected.hasVideo ? 'video' : 'audio');
            setMedia(inspected);
            setPhase('ready');
        } catch (error) {
            setErrorStage('inspect');
            setErrorMsg(error instanceof Error ? error.message : 'Não foi possível analisar esse link.');
            setPhase('error');
        }
    }, [allowVideo, url]);

    const handleBatchInspect = useCallback(async () => {
        const links = parseBatchLinks(batchText);
        if (!links.length) {
            toast.error('Cole pelo menos um link. Use um link por linha.');
            return;
        }
        if (links.length > MAX_BATCH_LINKS) {
            toast.warning(`Serão analisados os primeiros ${MAX_BATCH_LINKS} links deste lote.`);
        }

        const items: BatchDownloadItem[] = links.slice(0, MAX_BATCH_LINKS).map((itemUrl) => ({
            id: crypto.randomUUID(),
            url: itemUrl,
            status: 'inspecting',
        }));
        setBatchItems(items);
        setIsBatchInspecting(true);

        let cursor = 0;
        const worker = async () => {
            while (cursor < items.length) {
                const index = cursor;
                cursor += 1;
                const item = items[index];
                try {
                    const inspected = await inspectMediaUrl(item.url, allowVideo);
                    items[index] = { ...item, status: 'ready', media: inspected };
                } catch (error) {
                    items[index] = {
                        ...item,
                        status: 'error',
                        error: error instanceof Error ? error.message : 'Não foi possível analisar este link.',
                    };
                }
                setBatchItems([...items]);
            }
        };

        try {
            await Promise.all(Array.from({ length: Math.min(3, items.length) }, () => worker()));
            const firstReady = items.find((item) => item.status === 'ready' && item.media)?.media;
            if (firstReady) {
                setMode(allowVideo && firstReady.hasVideo ? 'video' : 'audio');
                setSelectedQuality(recommendedVideoQuality(firstReady));
            }
        } finally {
            setBatchItems([...items]);
            setIsBatchInspecting(false);
        }
    }, [allowVideo, batchText]);

    const handleBatchStart = useCallback(() => {
        const compatible = batchItems.filter((item) =>
            item.status === 'ready' && item.media && (mode === 'video' ? item.media.hasVideo : item.media.hasAudio)
        );
        if (!compatible.length) {
            toast.error(`Nenhum link analisado oferece ${mode === 'video' ? 'vídeo' : 'áudio'} compatível.`);
            return;
        }

        setIsBatchStarting(true);
        const queued = enqueueInternetDownloads(compatible.map((item) => ({
            url: item.url,
            mode,
            quality: selectedQuality,
            audioBitrate: selectedBitrate,
            destination,
            title: item.media?.title,
        })));
        setIsBatchStarting(false);
        if (!queued) return;

        const skipped = batchItems.length - compatible.length;
        toast.success(`${queued} ${queued === 1 ? 'download foi enviado' : 'downloads foram enviados'} para a fila do sino.`);
        if (skipped > 0) {
            toast.warning(`${skipped} ${skipped === 1 ? 'link foi ignorado' : 'links foram ignorados'} por erro ou formato incompatível.`);
        }
        onClose();
    }, [batchItems, destination, enqueueInternetDownloads, mode, onClose, selectedBitrate, selectedQuality]);

    const removeBatchItem = useCallback((id: string) => {
        setBatchItems((current) => current.filter((item) => item.id !== id));
    }, []);

    const handleStart = useCallback(async () => {
        if (!media) return;
        setPhase('downloading');
        setErrorMsg('');
        setJobId(null);
        setJobStep('downloading');
        setJobPercent(0);
        setDownloadTitle(media.title);
        deliveredRef.current = false;

        try {
            const response = await fetch(`${API}/api/download/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url.trim(),
                    mode,
                    quality: selectedQuality,
                    audioBitrate: selectedBitrate,
                    destination,
                }),
            });
            const data = await readApiJson<{ ok: boolean; jobId?: string; message?: string }>(response);
            if (!response.ok || !data.ok || !data.jobId) {
                throw new Error(data.message || 'Não foi possível iniciar o download.');
            }
            setJobId(data.jobId);
            registerJob(data.jobId, { mode, title: media.title, destination });
            toast.success('Download iniciado. Você pode fechar esta janela e continuar usando o Mileto.');
        } catch (error) {
            setErrorStage('download');
            setErrorMsg(error instanceof Error ? error.message : 'Não foi possível iniciar o download.');
            setPhase('error');
        }
    }, [destination, media, mode, registerJob, selectedBitrate, selectedQuality, url]);

    const resetInspection = useCallback(() => {
        setMedia(null);
        setPhase('idle');
        setErrorMsg('');
        setJobId(null);
    }, []);

    const handleCancel = useCallback(async () => {
        if (!jobId || isCancelling) return;
        setIsCancelling(true);
        try {
            const response = await fetch(`${API}/api/download/${jobId}`, { method: 'DELETE' });
            const data = await readApiJson<{ ok: boolean; message?: string }>(response);
            if (!response.ok || !data.ok) throw new Error(data.message || 'Não foi possível cancelar.');
            setJobId(null);
            setErrorStage('download');
            setErrorMsg('Download cancelado. Você pode alterar a qualidade e tentar novamente.');
            setPhase('error');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível cancelar o download.');
        } finally {
            setIsCancelling(false);
        }
    }, [isCancelling, jobId]);

    const resetAll = useCallback(() => {
        setInputMode('single');
        setUrl('');
        setBatchText('');
        setBatchItems([]);
        setIsBatchInspecting(false);
        setIsBatchStarting(false);
        setMode(allowVideo ? 'video' : 'audio');
        setMedia(null);
        setPhase('idle');
        setErrorMsg('');
        setJobId(null);
        setJobPercent(0);
        setIsCancelling(false);
        setDestination(initialDestination);
        deliveredRef.current = false;
    }, [allowVideo, initialDestination]);

    const chooseMode = (nextMode: DownloadMode) => {
        setMode(nextMode);
        setErrorMsg('');
        if (media) {
            if ((nextMode === 'video' && !media.hasVideo) || (nextMode === 'audio' && !media.hasAudio)) return;
            setPhase('ready');
        } else {
            setPhase('idle');
        }
    };

    const isInspecting = phase === 'inspecting';
    const showLinkForm = phase === 'idle' || isInspecting || (phase === 'error' && errorStage === 'inspect');
    const showOptions =
        Boolean(media) && (phase === 'ready' || (phase === 'error' && errorStage === 'download'));
    const selectedVideoOption = media?.videoOptions.find((option) => option.quality === selectedQuality);
    const parsedBatchCount = Math.min(parseBatchLinks(batchText).length, MAX_BATCH_LINKS);
    const readyBatchItems = batchItems.filter((item) => item.status === 'ready' && item.media);
    const compatibleBatchCount = readyBatchItems.filter((item) =>
        mode === 'video' ? item.media?.hasVideo : item.media?.hasAudio
    ).length;

    return createPortal(
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className={cn(
                'relative z-101 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-3xl border border-brand-accent/30 bg-brand-dark/95 shadow-[0_0_50px_rgba(0,230,118,0.15)] ring-1 ring-white/5',
                inputMode === 'batch' ? 'max-w-4xl' : 'max-w-2xl'
            )}>
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-size-[20px_20px] opacity-20" />

                <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-white/10 bg-brand-card/50 px-6 py-5">
                    <div className="flex min-w-0 items-center gap-4">
                        <div className="rounded-xl border border-brand-accent/20 bg-brand-accent/10 p-2.5 shadow-[0_0_15px_rgba(0,230,118,0.2)]">
                            <Download className="h-6 w-6 text-brand-accent" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-[15px] font-black uppercase tracking-wider text-foreground">
                                Baixar da Internet
                            </h3>
                            <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-widest text-brand-muted">
                                Analisa o link · mostra qualidades · salva na biblioteca
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Fechar"
                        title={phase === 'downloading' ? 'Fechar e continuar em segundo plano' : 'Fechar'}
                        className="rounded-full p-2 text-brand-muted transition-all hover:bg-red-500/20 hover:text-red-400"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="relative z-10 flex flex-col gap-5 overflow-y-auto p-6 sm:p-8">
                    {phase !== 'downloading' && phase !== 'done' && (
                        <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/20 p-1">
                            <button
                                onClick={() => {
                                    setInputMode('single');
                                    resetInspection();
                                }}
                                className={cn(
                                    'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors',
                                    inputMode === 'single'
                                        ? 'bg-brand-accent/15 text-brand-accent'
                                        : 'text-brand-muted hover:text-foreground'
                                )}
                            >
                                <Link2 className="h-4 w-4" /> Um link
                            </button>
                            <button
                                onClick={() => {
                                    setInputMode('batch');
                                    resetInspection();
                                }}
                                className={cn(
                                    'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors',
                                    inputMode === 'batch'
                                        ? 'bg-brand-lime/15 text-brand-lime'
                                        : 'text-brand-muted hover:text-foreground'
                                )}
                            >
                                <ListPlus className="h-4 w-4" /> Vários links
                            </button>
                        </div>
                    )}

                    {inputMode === 'single' && showLinkForm && (
                        <>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                                    <Link2 className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-foreground">Analisar link</p>
                                    <p className="text-[11px] text-brand-muted">
                                        Cole o link; depois escolha entre vídeo ou música e a qualidade.
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2.5">
                                <label
                                    htmlFor="media-download-url"
                                    className="text-[10px] font-bold uppercase tracking-widest text-brand-accent"
                                >
                                    Link da mídia
                                </label>
                                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 transition-colors focus-within:border-brand-accent/50">
                                    <Link2 className="h-4 w-4 shrink-0 text-brand-muted" />
                                    <input
                                        id="media-download-url"
                                        type="url"
                                        value={url}
                                        onChange={(event) => setUrl(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' && !isInspecting) void handleInspect();
                                        }}
                                        placeholder="https://youtube.com/watch?v=... ou outro site"
                                        autoFocus
                                        disabled={isInspecting}
                                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-brand-muted/50 disabled:opacity-60"
                                    />
                                </div>
                                <p className="text-[11px] leading-relaxed text-brand-muted">
                                    Compatível com YouTube e diversos sites reconhecidos pelo mecanismo do aplicativo.
                                </p>
                            </div>

                            {phase === 'error' && errorStage === 'inspect' && (
                                <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                                    <p className="break-words text-xs text-red-300">{errorMsg}</p>
                                </div>
                            )}

                            <button
                                onClick={() => void handleInspect()}
                                disabled={!url.trim() || isInspecting}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-lime px-5 py-3 text-sm font-bold text-[#0a0f12] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {isInspecting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Search className="h-4 w-4" />
                                )}
                                {isInspecting ? 'Analisando site e formatos...' : 'Analisar opções'}
                            </button>
                        </>
                    )}

                    {inputMode === 'batch' && (
                        <>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand-lime/20 bg-brand-lime/10 text-brand-lime">
                                    <ListPlus className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-foreground">Baixar vários links</p>
                                    <p className="text-[11px] text-brand-muted">
                                        Cole até {MAX_BATCH_LINKS} links. O Mileto analisa três por vez e organiza os downloads no sino.
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2.5">
                                <div className="flex items-center justify-between gap-3">
                                    <label
                                        htmlFor="media-download-batch"
                                        className="text-[10px] font-bold uppercase tracking-widest text-brand-lime"
                                    >
                                        Links da mídia · um por linha
                                    </label>
                                    <span className="text-[10px] font-mono text-brand-muted">
                                        {parsedBatchCount}/{MAX_BATCH_LINKS}
                                    </span>
                                </div>
                                <textarea
                                    id="media-download-batch"
                                    value={batchText}
                                    onChange={(event) => setBatchText(event.target.value)}
                                    placeholder={'https://youtube.com/watch?v=...\nhttps://instagram.com/reel/...\nhttps://outro-site.com/video/...'}
                                    rows={6}
                                    autoFocus
                                    disabled={isBatchInspecting || isBatchStarting}
                                    className="w-full resize-y rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-mono text-xs leading-6 text-foreground outline-none transition-colors placeholder:text-brand-muted/40 focus:border-brand-lime/50 disabled:opacity-60"
                                />
                            </div>

                            <button
                                onClick={() => void handleBatchInspect()}
                                disabled={!parsedBatchCount || isBatchInspecting || isBatchStarting}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-lime px-5 py-3 text-sm font-bold text-[#0a0f12] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {isBatchInspecting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Search className="h-4 w-4" />
                                )}
                                {isBatchInspecting
                                    ? `Analisando ${batchItems.length} links...`
                                    : batchItems.length
                                      ? 'Analisar novamente'
                                      : 'Analisar todos os links'}
                            </button>

                            {batchItems.length > 0 && (
                                <>
                                    <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:grid-cols-3">
                                        {allowVideo ? (
                                            <div>
                                                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-brand-muted">
                                                    Formato do lote
                                                </p>
                                                <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-brand-dark p-1">
                                                    <button
                                                        onClick={() => setMode('video')}
                                                        className={cn(
                                                            'rounded-lg px-2 py-2 text-[11px] font-bold',
                                                            mode === 'video' ? 'bg-brand-accent/15 text-brand-accent' : 'text-brand-muted'
                                                        )}
                                                    >
                                                        Vídeo
                                                    </button>
                                                    <button
                                                        onClick={() => setMode('audio')}
                                                        className={cn(
                                                            'rounded-lg px-2 py-2 text-[11px] font-bold',
                                                            mode === 'audio' ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted'
                                                        )}
                                                    >
                                                        MP3
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-brand-muted">
                                                    Formato do lote
                                                </p>
                                                <div className="rounded-xl border border-brand-lime/20 bg-brand-lime/10 px-3 py-2.5 text-xs font-bold text-brand-lime">
                                                    Música MP3
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <label
                                                htmlFor="batch-download-quality"
                                                className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-brand-muted"
                                            >
                                                Qualidade
                                            </label>
                                            {mode === 'video' ? (
                                                <select
                                                    id="batch-download-quality"
                                                    value={selectedQuality}
                                                    onChange={(event) => setSelectedQuality(event.target.value)}
                                                    className="w-full rounded-xl border border-white/10 bg-brand-dark px-3 py-2.5 text-xs text-foreground outline-none"
                                                >
                                                    <option value="best">Melhor disponível</option>
                                                    <option value="1080">Até 1080p</option>
                                                    <option value="720">Até 720p</option>
                                                    <option value="480">Até 480p</option>
                                                </select>
                                            ) : (
                                                <select
                                                    id="batch-download-quality"
                                                    value={selectedBitrate}
                                                    onChange={(event) => setSelectedBitrate(Number(event.target.value))}
                                                    className="w-full rounded-xl border border-white/10 bg-brand-dark px-3 py-2.5 text-xs text-foreground outline-none"
                                                >
                                                    {[128, 192, 256, 320].map((bitrate) => (
                                                        <option key={bitrate} value={bitrate}>{bitrate} kbps</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>

                                        <div>
                                            <label
                                                htmlFor="batch-download-destination"
                                                className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-brand-muted"
                                            >
                                                Salvar o lote em
                                            </label>
                                            <select
                                                id="batch-download-destination"
                                                value={destination}
                                                onChange={(event) => setDestination(event.target.value)}
                                                className="w-full rounded-xl border border-white/10 bg-brand-dark px-3 py-2.5 text-xs text-foreground outline-none"
                                            >
                                                {folderOptions.map((option) => (
                                                    <option key={option.value || '__batch_root__'} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-bold text-foreground">Resultado da análise</p>
                                            <p className="mt-0.5 text-[10px] text-brand-muted">
                                                {compatibleBatchCount} prontos para {mode === 'video' ? 'vídeo' : 'MP3'} ·{' '}
                                                {batchItems.filter((item) => item.status === 'error').length} com erro
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => {
                                                setBatchItems([]);
                                                setBatchText('');
                                            }}
                                            disabled={isBatchInspecting}
                                            className="text-[10px] font-bold uppercase tracking-wider text-brand-muted hover:text-red-400 disabled:opacity-40"
                                        >
                                            Limpar lote
                                        </button>
                                    </div>

                                    <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                                        {batchItems.map((item, index) => (
                                            <div
                                                key={item.id}
                                                className={cn(
                                                    'flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5',
                                                    item.status === 'error'
                                                        ? 'border-red-500/25 bg-red-500/5'
                                                        : item.status === 'ready'
                                                          ? 'border-brand-lime/20 bg-brand-lime/5'
                                                          : 'border-white/10 bg-black/20'
                                                )}
                                            >
                                                <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
                                                    {item.media?.thumbnail ? (
                                                        <img src={item.media.thumbnail} alt="" className="h-full w-full object-cover" />
                                                    ) : item.status === 'inspecting' ? (
                                                        <Loader2 className="h-5 w-5 animate-spin text-brand-accent" />
                                                    ) : item.status === 'error' ? (
                                                        <XCircle className="h-5 w-5 text-red-400" />
                                                    ) : (
                                                        <Film className="h-5 w-5 text-brand-muted" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-xs font-bold text-foreground">
                                                        {item.media?.title || `Link ${index + 1}`}
                                                    </p>
                                                    <p className={cn(
                                                        'mt-1 line-clamp-2 text-[10px]',
                                                        item.status === 'error' ? 'text-red-300' : 'text-brand-muted'
                                                    )}>
                                                        {item.status === 'inspecting'
                                                            ? 'Analisando formatos...'
                                                            : item.error || `${item.media?.source || 'Site'} · ${formatDuration(item.media?.durationSec || 0)}`}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => removeBatchItem(item.id)}
                                                    disabled={isBatchInspecting || isBatchStarting}
                                                    aria-label="Remover do lote"
                                                    className="shrink-0 rounded-lg p-2 text-brand-muted hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="flex flex-col gap-2 rounded-2xl border border-brand-accent/20 bg-brand-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="text-xs font-bold text-brand-accent">Fila em segundo plano</p>
                                            <p className="mt-1 text-[10px] text-brand-muted">
                                                Até cinco downloads rodam juntos; os demais aguardam e aparecem no sino.
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleBatchStart}
                                            disabled={!compatibleBatchCount || isBatchInspecting || isBatchStarting}
                                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-lime px-5 py-3 text-xs font-black text-[#0a0f12] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            {isBatchStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                            Baixar {compatibleBatchCount} {compatibleBatchCount === 1 ? 'link' : 'links'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {inputMode === 'single' && showOptions && media && (
                        <>
                            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                                <div className="flex gap-4 p-4">
                                    {media.thumbnail ? (
                                        <img
                                            src={media.thumbnail}
                                            alt="Capa da mídia"
                                            className="h-24 w-36 shrink-0 rounded-xl object-cover"
                                            onError={(event) => {
                                                event.currentTarget.style.display = 'none';
                                            }}
                                        />
                                    ) : (
                                        <div className="flex h-24 w-36 shrink-0 items-center justify-center rounded-xl bg-white/5">
                                            <Film className="h-7 w-7 text-brand-muted" />
                                        </div>
                                    )}
                                    <div className="min-w-0 py-1">
                                        <p className="line-clamp-2 text-sm font-bold leading-snug text-foreground">
                                            {media.title}
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                                            <span>{media.source}</span>
                                            <span>{formatDuration(media.durationSec)}</span>
                                            {media.uploader && (
                                                <span className="max-w-40 truncate">{media.uploader}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {allowVideo && (
                                <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/20 p-1">
                                    <button
                                        onClick={() => chooseMode('video')}
                                        disabled={!media.hasVideo}
                                        className={cn(
                                            'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:opacity-30',
                                            mode === 'video'
                                                ? 'bg-brand-accent/15 text-brand-accent'
                                                : 'text-brand-muted hover:text-foreground'
                                        )}
                                    >
                                        <Video className="h-3.5 w-3.5" /> Vídeo
                                    </button>
                                    <button
                                        onClick={() => chooseMode('audio')}
                                        disabled={!media.hasAudio}
                                        className={cn(
                                            'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:opacity-30',
                                            mode === 'audio'
                                                ? 'bg-brand-lime/15 text-brand-lime'
                                                : 'text-brand-muted hover:text-foreground'
                                        )}
                                    >
                                        <Music className="h-3.5 w-3.5" /> Música MP3
                                    </button>
                                </div>
                            )}

                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <label
                                    htmlFor="media-download-destination"
                                    className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-brand-muted"
                                >
                                    <FolderOpen className="h-3.5 w-3.5" /> Salvar em
                                </label>
                                <select
                                    id="media-download-destination"
                                    value={destination}
                                    onChange={(event) => setDestination(event.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-brand-dark px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-accent/50"
                                >
                                    {folderOptions.map((option) => (
                                        <option key={option.value || '__root__'} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-2 text-[10px] leading-relaxed text-brand-muted/80">
                                    A pasta que estava aberta foi selecionada automaticamente. Você pode trocar antes de baixar.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <label className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-brand-muted">
                                    <Gauge className="h-3.5 w-3.5" />{' '}
                                    {mode === 'video' ? 'Qualidade do vídeo' : 'Qualidade de saída do MP3'}
                                </label>
                                {mode === 'video' ? (
                                    <select
                                        value={selectedQuality}
                                        onChange={(event) => setSelectedQuality(event.target.value)}
                                        className="w-full rounded-xl border border-white/10 bg-brand-dark px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-accent/50"
                                    >
                                        {media.videoOptions.map((option) => (
                                            <option key={option.quality} value={option.quality}>
                                                {option.label}
                                                {option.fps ? ` · ${option.fps} fps` : ''}
                                                {formatBytes(option.estimatedBytes)
                                                    ? ` · ${formatBytes(option.estimatedBytes)}`
                                                    : ''}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <select
                                        value={selectedBitrate}
                                        onChange={(event) => setSelectedBitrate(Number(event.target.value))}
                                        className="w-full rounded-xl border border-white/10 bg-brand-dark px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-lime/50"
                                    >
                                        {media.audioOptions.map((option) => (
                                            <option key={option.bitrate} value={option.bitrate}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                <p className="mt-2 text-[10px] leading-relaxed text-brand-muted/80">
                                    {mode === 'video'
                                        ? `Saída MP4${selectedVideoOption?.height ? ` em até ${selectedVideoOption.height}p` : ''}. O tamanho é uma estimativa do site.`
                                        : `O áudio será extraído e convertido para MP3${media.sourceAudioBitrate ? `; a fonte informa até ~${media.sourceAudioBitrate} kbps` : ''}.`}
                                </p>
                            </div>

                            {phase === 'error' && errorStage === 'download' && (
                                <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                                    <p className="break-words text-xs text-red-300">{errorMsg}</p>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={resetInspection}
                                    className="rounded-xl border border-white/10 px-4 py-3 text-xs font-bold text-brand-muted transition-colors hover:text-foreground"
                                >
                                    Outro link
                                </button>
                                <button
                                    onClick={() => void handleStart()}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-lime px-5 py-3 text-sm font-black text-[#0a0f12] transition-all hover:brightness-110"
                                >
                                    <Download className="h-4 w-4" />{' '}
                                    {mode === 'video' ? 'Baixar vídeo' : 'Baixar e converter'}
                                </button>
                            </div>
                        </>
                    )}

                    {phase === 'downloading' && (
                        <div className="flex flex-col items-center gap-5 py-6">
                            <div className="relative">
                                <Loader2 className="h-14 w-14 animate-spin text-brand-accent" />
                                {mode === 'video' ? (
                                    <Video className="absolute inset-0 m-auto h-5 w-5 text-brand-lime" />
                                ) : (
                                    <Music className="absolute inset-0 m-auto h-5 w-5 text-brand-lime" />
                                )}
                            </div>
                            <div className="w-full text-center">
                                <p className="mx-auto max-w-md truncate text-sm font-bold text-foreground">
                                    {downloadTitle || 'Preparando download...'}
                                </p>
                                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-brand-muted">
                                    {jobStep === 'processing'
                                        ? mode === 'video'
                                            ? 'Preparando MP4'
                                            : 'Convertendo para MP3'
                                        : 'Baixando da fonte'}
                                </p>
                            </div>
                            <div className="w-full">
                                <div className="mb-2 flex items-center justify-between text-[10px] font-mono text-brand-muted">
                                    <span>Progresso geral</span>
                                    <span>{Math.round(jobPercent)}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full border border-white/5 bg-black/30">
                                    <div
                                        className="h-full bg-gradient-to-r from-brand-lime to-brand-accent transition-all duration-500"
                                        style={{ width: `${Math.max(2, jobPercent)}%` }}
                                    />
                                </div>
                            </div>
                            <p className="max-w-sm text-center text-[11px] leading-relaxed text-brand-muted/70">
                                O download continuará em segundo plano se você fechar esta janela.
                            </p>
                            <div className="flex flex-wrap justify-center gap-3">
                                <button
                                    onClick={() => void handleCancel()}
                                    disabled={!jobId || isCancelling}
                                    className="rounded-xl border border-red-500/20 px-4 py-2.5 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {isCancelling ? 'Cancelando...' : 'Cancelar download'}
                                </button>
                                <button
                                    onClick={onClose}
                                    className="rounded-xl bg-brand-lime px-4 py-2.5 text-xs font-black text-[#0a0f12] hover:brightness-110"
                                >
                                    Continuar usando o app
                                </button>
                            </div>
                        </div>
                    )}

                    {phase === 'done' && (
                        <div className="flex flex-col items-center gap-5 py-7 text-center">
                            <CheckCircle2 className="h-16 w-16 text-brand-lime drop-shadow-[0_0_12px_rgba(0,230,118,0.5)]" />
                            <div>
                                <p className="text-base font-black text-foreground">Download concluído</p>
                                <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-brand-muted">
                                    <HardDrive className="h-3.5 w-3.5" />
                                    Salvo em {formatDestinationLabel(destination)}.
                                </p>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={resetAll}
                                    className="rounded-xl border border-white/10 px-5 py-3 text-sm font-bold text-brand-muted hover:text-foreground"
                                >
                                    Baixar outro
                                </button>
                                <button
                                    onClick={onClose}
                                    className="rounded-xl bg-brand-lime px-6 py-3 text-sm font-bold text-[#0a0f12] hover:brightness-110"
                                >
                                    Concluir
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default DownloadModal;
