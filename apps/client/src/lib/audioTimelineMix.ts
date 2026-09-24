import type { AudioClip, AudioConfig, AudioTimeline, TimelineTrack } from '../types';

const EPSILON = 0.02;

const mixableClip = (track: TimelineTrack | undefined, label: string): AudioClip | null => {
    if (!track?.clips.length) return null;
    const clips = [...track.clips].sort((a, b) => a.startSec - b.startSec);
    const first = clips[0];
    let last = first;
    for (const next of clips.slice(1)) {
        const previousEnd = last.startSec + (last.outSec - last.inSec);
        if (next.sourceUrl !== first.sourceUrl
            || Math.abs(next.startSec - previousEnd) > EPSILON
            || Math.abs(next.inSec - last.outSec) > EPSILON
            || Math.abs((next.volume ?? 1) - (first.volume ?? 1)) > EPSILON) {
            throw new Error(`${label}: há blocos separados ou movidos. Use as bordas para um recorte contínuo antes de salvar.`);
        }
        last = next;
    }
    return clips.length === 1 ? first : { ...first, outSec: last.outSec, fadeOutSec: last.fadeOutSec };
};

/** O mixer atual recebe um intervalo contínuo por faixa; nunca descarte blocos extras silenciosamente. */
export const audioConfigFromTimeline = (timeline: AudioTimeline): AudioConfig => {
    const narrationTrack = timeline.tracks.find((track) => track.id === 'narration');
    const backgroundTrack = timeline.tracks.find((track) => track.id === 'bgm');
    const narration = mixableClip(narrationTrack, 'Narração');
    const background = mixableClip(backgroundTrack, 'Música');
    return {
        narration: {
            enabled: !!narration,
            volume: (narrationTrack?.volume ?? 1) * (narration?.volume ?? 1),
            offsetSec: narration?.startSec ?? 0,
            trimStart: narration?.inSec ?? 0,
            trimEnd: narration?.outSec || undefined,
            fadeInSec: narration?.fadeInSec ?? 0,
            fadeOutSec: narration?.fadeOutSec ?? 0,
        },
        background: {
            enabled: !!background,
            volume: (backgroundTrack?.volume ?? 1) * (background?.volume ?? 1),
            offsetSec: background?.startSec ?? 0,
            trimStart: background?.inSec ?? 0,
            trimEnd: background?.outSec || undefined,
            fadeInSec: background?.fadeInSec ?? 0,
            fadeOutSec: background?.fadeOutSec ?? 0,
        },
    };
};
