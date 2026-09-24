import type { AudioConfig, AudioTimeline } from '../types';

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
            if (first && first.sourceUrl === narrationUrl && !resetLegacyNarration) {
                if (track.enabled) return track;
                changed = true;
                return { ...track, enabled: true };
            }
            changed = true;
            return { ...track, enabled: true, clips: [{
                id: first?.id || newId(),
                sourceUrl: narrationUrl,
                name: 'Narração Gerada',
                startSec: config.narration.offsetSec,
                inSec: config.narration.trimStart,
                outSec: config.narration.trimEnd || 0,
                fadeInSec: config.narration.fadeInSec,
                fadeOutSec: config.narration.fadeOutSec,
                volume: 1,
            }] };
        }
        if (track.id === 'bgm') {
            if (!musicUrl) {
                if (!track.clips.length) return track;
                changed = true;
                return { ...track, clips: [] };
            }
            if (!track.clips.length) {
                changed = true;
                return { ...track, enabled: true, clips: [{
                    id: newId(), sourceUrl: musicUrl, name: 'Música de Fundo',
                    startSec: config.background.offsetSec,
                    inSec: config.background.trimStart,
                    outSec: config.background.trimEnd || 0,
                    fadeInSec: config.background.fadeInSec,
                    fadeOutSec: config.background.fadeOutSec,
                    volume: 1,
                }] };
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
