import { useEffect, useRef, useState } from 'react';
import { Loader2, Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

interface MiletoMediaPlayerProps {
    src: string;
    title: string;
    autoPlay?: boolean;
}

const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${minutes}:${rest.toString().padStart(2, '0')}`;
};

export const MiletoMediaPlayer = ({ src, title, autoPlay = true }: MiletoMediaPlayerProps) => {
    const shellRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [waiting, setWaiting] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [muted, setMuted] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setPlaying(false);
        setWaiting(true);
        setCurrentTime(0);
        setDuration(0);
        setFailed(false);
    }, [src]);

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

    return (
        <div
            ref={shellRef}
            className="group relative overflow-hidden rounded-3xl border border-brand-lime/20 bg-[#020706] shadow-[0_28px_100px_rgba(0,0,0,0.65),0_0_60px_rgba(0,230,118,0.08)]"
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
                        <p className="text-sm font-black text-white">Não foi possível reproduzir esta entrega.</p>
                        <p className="mt-2 text-xs text-white/45">Tente abrir novamente ou baixe o arquivo pela fila interna.</p>
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
                <div className="mb-3 flex items-end justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-brand-lime">Mileto Player</div>
                        <div className="mt-1 truncate text-sm font-black text-white">{title}</div>
                    </div>
                    <div className="shrink-0 font-mono text-[11px] text-white/70">
                        {formatTime(currentTime)} <span className="text-white/25">/</span> {formatTime(duration)}
                    </div>
                </div>

                <input
                    type="range"
                    min={0}
                    max={Math.max(duration, 0.01)}
                    step={0.01}
                    value={Math.min(currentTime, Math.max(duration, 0.01))}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        if (videoRef.current) videoRef.current.currentTime = next;
                        setCurrentTime(next);
                    }}
                    aria-label="Posição do vídeo"
                    className="h-1.5 w-full cursor-pointer accent-brand-lime"
                />

                <div className="mt-3 flex items-center gap-2">
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
                        onClick={() => {
                            const next = !muted;
                            setMuted(next);
                            if (videoRef.current) videoRef.current.muted = next;
                        }}
                        className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:text-white"
                        aria-label={muted ? 'Ativar som' : 'Silenciar'}
                    >
                        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                    <input
                        type="range"
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
                        aria-label="Volume"
                        className="hidden h-1 w-24 cursor-pointer accent-brand-lime sm:block"
                    />
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={() => void toggleFullscreen()}
                        className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                        aria-label="Tela cheia"
                    >
                        <Maximize2 className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MiletoMediaPlayer;
