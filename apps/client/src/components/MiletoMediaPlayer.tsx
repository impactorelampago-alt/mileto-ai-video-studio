import { useEffect, useRef, useState } from 'react';
import {
    Download,
    Loader2,
    Maximize2,
    Minimize2,
    Pause,
    Play,
    RotateCcw,
    Volume2,
    VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { MediaRange } from './MediaRange';

interface MiletoMediaPlayerProps {
    src: string;
    title: string;
    autoPlay?: boolean;
    downloadName?: string;
    onDownload?: () => void | Promise<void>;
    resolveDownloadSource?: () => Promise<{ src: string; fileName?: string }>;
    showDownload?: boolean;
}

const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${minutes}:${rest.toString().padStart(2, '0')}`;
};

const safeFileName = (candidate: string) => {
    const clean = candidate
        .split('')
        .map((character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character)
        .join('')
        .replace(/[. ]+$/g, '')
        .trim() || 'video-mileto';
    if (/\.[a-z0-9]{2,5}$/i.test(clean)) return clean;
    return `${clean}.mp4`;
};

const triggerAnchorDownload = (href: string, fileName: string) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = fileName;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
};

/**
 * Hands the source directly to Chromium. Fetching a video into a Blob here
 * would duplicate large deliveries in RAM and signed URLs may reject CORS.
 * Remote libraries can provide onDownload to refresh their capability first.
 */
const downloadSource = (src: string, requestedName: string) => {
    const parsed = new URL(src, window.location.href);
    if (!['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol)) {
        throw new Error('Fonte de download inválida.');
    }

    triggerAnchorDownload(parsed.href, safeFileName(requestedName));
};

export const MiletoMediaPlayer = ({
    src,
    title,
    autoPlay = true,
    downloadName,
    onDownload,
    resolveDownloadSource,
    showDownload = true,
}: MiletoMediaPlayerProps) => {
    const shellRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [waiting, setWaiting] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [muted, setMuted] = useState(false);
    const [failed, setFailed] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);

    useEffect(() => {
        setPlaying(false);
        setWaiting(true);
        setCurrentTime(0);
        setDuration(0);
        setFailed(false);
    }, [src]);

    useEffect(() => {
        const handleFullscreen = () => setFullscreen(document.fullscreenElement === shellRef.current);
        document.addEventListener('fullscreenchange', handleFullscreen);
        return () => document.removeEventListener('fullscreenchange', handleFullscreen);
    }, []);

    const togglePlayback = async () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.ended) video.currentTime = 0;
        if (video.paused) {
            await video.play().catch(() => setFailed(true));
        } else {
            video.pause();
        }
    };

    const restart = () => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = 0;
        void video.play().catch(() => setFailed(true));
    };

    const toggleFullscreen = async () => {
        if (!shellRef.current) return;
        if (document.fullscreenElement) await document.exitFullscreen();
        else await shellRef.current.requestFullscreen();
    };

    const seekBy = (delta: number) => {
        const video = videoRef.current;
        if (!video) return;
        const upperLimit = duration || video.duration || 0;
        const next = Math.min(upperLimit, Math.max(0, video.currentTime + delta));
        video.currentTime = next;
        setCurrentTime(next);
    };

    const toggleMute = () => {
        const video = videoRef.current;
        if (!video) return;
        const next = !muted;
        setMuted(next);
        video.muted = next;
    };

    const handleDownload = async () => {
        if (downloading) return;
        setDownloading(true);
        try {
            if (onDownload) await onDownload();
            else {
                const resolved = resolveDownloadSource
                    ? await resolveDownloadSource()
                    : { src, fileName: downloadName };
                downloadSource(resolved.src, resolved.fileName || downloadName || title);
            }
            if (!onDownload) toast.success('Download iniciado.');
        } catch (error) {
            console.error('Media download failed:', error);
            toast.error('Não foi possível baixar este arquivo.');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div
            ref={shellRef}
            tabIndex={0}
            aria-label={`Player de vídeo: ${title}`}
            onKeyDown={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('button,input')) return;
                if (event.key === ' ' || event.key.toLowerCase() === 'k') {
                    event.preventDefault();
                    void togglePlayback();
                } else if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    seekBy(-5);
                } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    seekBy(5);
                } else if (event.key.toLowerCase() === 'm') {
                    event.preventDefault();
                    toggleMute();
                } else if (event.key.toLowerCase() === 'f') {
                    event.preventDefault();
                    void toggleFullscreen();
                }
            }}
            className="group relative overflow-hidden rounded-3xl border border-brand-lime/20 bg-[#020706] shadow-[0_28px_100px_rgba(0,0,0,0.65),0_0_60px_rgba(0,230,118,0.08)] outline-none focus-visible:ring-2 focus-visible:ring-brand-lime/60"
        >
            <video
                ref={videoRef}
                src={src}
                autoPlay={autoPlay}
                playsInline
                preload="auto"
                onClick={() => void togglePlayback()}
                onLoadedMetadata={(event) => {
                    setDuration(event.currentTarget.duration || 0);
                    event.currentTarget.volume = volume;
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onPlaying={() => setWaiting(false)}
                onWaiting={() => setWaiting(true)}
                onCanPlay={() => setWaiting(false)}
                onEnded={() => setPlaying(false)}
                onError={() => {
                    setWaiting(false);
                    setFailed(true);
                }}
                className="max-h-[72vh] min-h-[300px] w-full bg-black object-contain"
            />

            <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/90 via-transparent to-black/25" />

            {waiting && !failed && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <div className="grid h-14 w-14 place-items-center rounded-full border border-brand-lime/25 bg-black/65 text-brand-lime backdrop-blur-md">
                        <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                </div>
            )}

            {failed && (
                <div className="absolute inset-0 grid place-items-center bg-black/75 p-8 text-center">
                    <div>
                        <p className="text-sm font-black text-white">Não foi possível reproduzir este vídeo.</p>
                        <p className="mt-2 text-xs text-white/45">Tente abrir novamente ou use o botão de download.</p>
                    </div>
                </div>
            )}

            {!playing && !waiting && !failed && (
                <button
                    type="button"
                    onClick={() => void togglePlayback()}
                    className="absolute inset-0 m-auto grid h-20 w-20 place-items-center rounded-full border border-brand-lime/40 bg-brand-lime/90 text-[#03100c] shadow-[0_0_55px_rgba(0,230,118,0.32)] transition hover:scale-105 hover:brightness-110"
                    aria-label="Reproduzir vídeo"
                >
                    <Play className="ml-1 h-8 w-8 fill-current" />
                </button>
            )}

            <div className="absolute inset-x-0 bottom-0 p-5">
                <div className="mb-2 flex items-end justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-brand-lime">Mileto Player</div>
                        <div className="mt-1 truncate text-sm font-black text-white">{title}</div>
                    </div>
                    <div className="shrink-0 font-mono text-[11px] text-white/70">
                        {formatTime(currentTime)} <span className="text-white/25">/</span> {formatTime(duration)}
                    </div>
                </div>

                <MediaRange
                    min={0}
                    max={Math.max(duration, 0.01)}
                    step={0.01}
                    value={Math.min(currentTime, Math.max(duration, 0.01))}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        if (videoRef.current) videoRef.current.currentTime = next;
                        setCurrentTime(next);
                    }}
                    label="Posição do vídeo"
                    className="w-full"
                />

                <div className="mt-1 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void togglePlayback()}
                        className="grid h-10 w-10 place-items-center rounded-full bg-brand-lime text-[#03100c] transition hover:brightness-110"
                        aria-label={playing ? 'Pausar' : 'Reproduzir'}
                    >
                        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
                    </button>
                    <button
                        type="button"
                        onClick={restart}
                        className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                        aria-label="Reiniciar"
                    >
                        <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={toggleMute}
                        className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:text-white"
                        aria-label={muted ? 'Ativar som' : 'Silenciar'}
                    >
                        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                    <MediaRange
                        min={0}
                        max={1}
                        step={0.01}
                        value={muted ? 0 : volume}
                        onChange={(event) => {
                            const next = Number(event.target.value);
                            setVolume(next);
                            setMuted(next === 0);
                            if (videoRef.current) {
                                videoRef.current.volume = next;
                                videoRef.current.muted = next === 0;
                            }
                        }}
                        label="Volume"
                        compact
                        className="hidden w-24 sm:flex"
                    />
                    <div className="flex-1" />
                    {showDownload && (
                        <button
                            type="button"
                            onClick={() => void handleDownload()}
                            disabled={downloading}
                            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-55"
                            aria-label="Baixar vídeo"
                            title="Baixar"
                        >
                            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => void toggleFullscreen()}
                        className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                        aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                    >
                        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MiletoMediaPlayer;
