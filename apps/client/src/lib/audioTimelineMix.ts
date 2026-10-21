import type { AudioConfig, AudioTimeline, AudioTrackConfig, TimelineTrack } from '../types';

const trackConfig = (track: TimelineTrack | undefined, label: string): AudioTrackConfig => {
    const clips = [...(track?.clips ?? [])].sort((a, b) => a.startSec - b.startSec);
    const first = clips[0];
    if (clips.some((clip) => clip.sourceUrl !== first.sourceUrl)) {
        throw new Error(`${label}: todos os blocos devem usar a fonte atual da faixa.`);
    }
    if (clips.some((clip) => ![clip.startSec, clip.inSec, clip.outSec].every(Number.isFinite)
        || clip.startSec < 0 || clip.inSec < 0 || clip.outSec <= clip.inSec)) {
        throw new Error(`${label}: aguarde o áudio carregar e confira os limites do recorte.`);
    }

    return {
        enabled: clips.length > 0 && !track?.muted,
        volume: (track?.volume ?? 1) * (clips.length === 1 ? first.volume ?? 1 : 1),
        offsetSec: first?.startSec ?? 0,
        trimStart: first?.inSec ?? 0,
        trimEnd: clips.length ? Math.max(...clips.map((clip) => clip.outSec)) : undefined,
        fadeInSec: first?.fadeInSec ?? 0,
        fadeOutSec: clips[clips.length - 1]?.fadeOutSec ?? 0,
        ...(clips.length > 1 ? { segments: clips.map((clip) => ({
            offsetSec: clip.startSec,
            trimStart: clip.inSec,
            trimEnd: clip.outSec,
            volume: clip.volume ?? 1,
            fadeInSec: clip.fadeInSec,
            fadeOutSec: clip.fadeOutSec,
        })) } : {}),
    };
};

/** Preserva cada bloco; excluir ou mover um trecho não pode restaurar o áudio removido. */
export const audioConfigFromTimeline = (timeline: AudioTimeline): AudioConfig => ({
    narration: trackConfig(timeline.tracks.find((track) => track.id === 'narration'), 'Narração'),
    background: trackConfig(timeline.tracks.find((track) => track.id === 'bgm'), 'Música'),
});

export const configuredAudioTrackDuration = (config: AudioTrackConfig, sourceDuration = 0): number => {
    const segments = config.segments ?? [config];
    return segments.reduce((max, segment) => {
        const sourceEnd = segment.trimEnd || sourceDuration;
        const end = sourceDuration > 0 ? Math.min(sourceEnd, sourceDuration) : sourceEnd;
        return end > segment.trimStart
            ? Math.max(max, segment.offsetSec + end - segment.trimStart)
            : max;
    }, 0);
};
