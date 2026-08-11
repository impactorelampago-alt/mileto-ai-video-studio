import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { MediaRange } from './MediaRange';

interface AudioPlayerProps {
    src: string;
    className?: string;
    compact?: boolean;
}

const formatTime = (time: number) => {
    if (!Number.isFinite(time) || time < 0) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, className, compact = false }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(0.8);
    const [waiting, setWaiting] = useState(!compact);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        // A new synthesis can arrive while the element still has the previous
        // buffer. Reloading explicitly guarantees that play uses the new MP3.
        audio.pause();
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        // Listas podem conter dezenas de faixas. No modo compacto, nao fazemos
        // prefetch de todas elas; o estado de carregamento comeca no primeiro play.
        setWaiting(!compact);
        setFailed(false);
        audio.load();
    }, [compact, src]);

    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = volume;
    }, [volume]);

    const togglePlay = async () => {
        const audio = audioRef.current;
        if (!audio || failed) return;
        if (!audio.paused) {
            audio.pause();
            return;
        }
        try {
            setWaiting(true);
            if (audio.ended) audio.currentTime = 0;
            await audio.play();
        } catch (error) {
            console.error('Audio playback failed:', error);
            toast.error('Não foi possível reproduzir este áudio. Selecione a música novamente.');
        }
    };

    const toggleMute = () => {
        const audio = audioRef.current;
        if (!audio) return;
        const next = !isMuted;
        audio.muted = next;
        setIsMuted(next);
    };

    return (
        <div
            className={cn(
                'flex min-w-0 items-center rounded-xl border border-white/8 bg-black/20',
                compact ? 'gap-1.5 p-1.5' : 'gap-3 p-3',
                className,
            )}
        >
            <audio
                ref={audioRef}
                src={src}
                preload={compact ? 'none' : 'metadata'}
                onLoadedMetadata={(event) => {
                    const nextDuration = event.currentTarget.duration;
                    setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
                    setCurrentTime(event.currentTarget.currentTime);
                    setWaiting(false);
                }}
                onDurationChange={(event) => {
                    const nextDuration = event.currentTarget.duration;
                    if (Number.isFinite(nextDuration)) setDuration(nextDuration);
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onWaiting={() => setWaiting(true)}
                onCanPlay={() => setWaiting(false)}
                onPlaying={() => setWaiting(false)}
                onError={() => {
                    setWaiting(false);
                    setFailed(true);
                }}
            />

            <button
                type="button"
                onClick={() => void togglePlay()}
                disabled={failed}
                aria-label={failed ? 'Áudio indisponível' : isPlaying ? 'Pausar' : 'Reproduzir'}
                className={cn(
                    'flex shrink-0 items-center justify-center rounded-full bg-primary text-slate-950 transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-45',
                    compact ? 'h-7 w-7' : 'h-8 w-8',
                )}
            >
                {waiting && !isPlaying ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950" />
                ) : isPlaying ? (
                    <Pause className="h-4 w-4 fill-current" />
                ) : (
                    <Play className="ml-0.5 h-4 w-4 fill-current" />
                )}
            </button>

            {!compact && <span className="w-10 text-right font-mono text-xs text-slate-400">{formatTime(currentTime)}</span>}

            <MediaRange
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={(event) => {
                    const next = Number(event.target.value);
                    if (audioRef.current) audioRef.current.currentTime = next;
                    setCurrentTime(next);
                }}
                label="Posição do áudio"
                compact={compact}
                disabled={!duration || failed}
                className="min-w-8 flex-1"
            />

            {!compact && <span className="w-10 font-mono text-xs text-slate-500">{formatTime(duration)}</span>}

            <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? 'Ativar som' : 'Silenciar'}
                className="shrink-0 text-slate-400 transition-colors hover:text-foreground"
            >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>

            {!compact && (
                <MediaRange
                    min={0}
                    max={1}
                    value={isMuted ? 0 : volume}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        const audio = audioRef.current;
                        setVolume(next);
                        setIsMuted(next === 0);
                        if (audio) {
                            audio.volume = next;
                            audio.muted = next === 0;
                        }
                    }}
                    label="Volume"
                    compact
                    className="hidden w-20 sm:flex"
                />
            )}
        </div>
    );
};
