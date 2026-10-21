import type { AudioClip, AudioConfig, AudioTimeline, AudioTrackConfig } from '../types';

const clipsFromConfig = (
    config: AudioTrackConfig, sourceUrl: string, name: string, newId: () => string,
): AudioClip[] => (config.segments ?? [{ ...config, volume: 1 }]).map((segment) => ({
    id: newId(), sourceUrl, name,
    startSec: segment.offsetSec,
    inSec: segment.trimStart,
    outSec: segment.trimEnd || 0,
    fadeInSec: segment.fadeInSec,
    fadeOutSec: segment.fadeOutSec,
    volume: segment.volume,
}));

export const reconcileAudioTimelineSources = (
    timeline: AudioTimeline,
    narrationUrl: string | null,
    musicUrl: string | null,
    config: AudioConfig,
    resetLegacyNarration: boolean,
    newId: () => string,
): AudioTimeline => {
    let changed = false;
    const tracks = timeline.tracks.map((track) => {
        if (track.id === 'narration') {
            const first = track.clips[0];
            if (!narrationUrl) {
                if (!track.clips.length) return track;
                changed = true;
                return { ...track, clips: [] };
            }
            if (!first && !config.narration.enabled) return track;
            if (first && first.sourceUrl === narrationUrl && !resetLegacyNarration) {
                if (track.enabled) return track;
                changed = true;
                return { ...track, enabled: true };
            }
            changed = true;
            return { ...track, enabled: true,
                clips: clipsFromConfig(config.narration, narrationUrl, 'Narração Gerada', newId) };
        }
        if (track.id === 'bgm') {
            if (!musicUrl) {
                if (!track.clips.length) return track;
                changed = true;
                return { ...track, clips: [] };
            }
            if (!track.clips.length) {
                if (!config.background.enabled) return track;
                changed = true;
                return { ...track, enabled: true,
                    clips: clipsFromConfig(config.background, musicUrl, 'Música de Fundo', newId) };
            }
            if (track.clips.every((clip) => clip.sourceUrl === musicUrl)) {
                if (track.enabled) return track;
                changed = true;
                return { ...track, enabled: true };
            }
            changed = true;
            return { ...track, enabled: true,
                clips: track.clips.map((clip) => ({ ...clip, sourceUrl: musicUrl })) };
        }
        return track;
    });
    return changed ? { ...timeline, tracks } : timeline;
};
