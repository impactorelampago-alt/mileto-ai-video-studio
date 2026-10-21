import type { AudioClip } from '../types';

export const dragAudioClip = (
    clip: AudioClip,
    type: 'move' | 'trim-start' | 'trim-end',
    deltaSec: number,
    sourceDuration: number,
): AudioClip => {
    if (type === 'move') return { ...clip, startSec: Math.max(0, clip.startSec + deltaSec) };
    const minDuration = Math.min(0.1, clip.outSec - clip.inSec);
    if (type === 'trim-start') {
        const change = Math.max(-clip.inSec, -clip.startSec,
            Math.min(deltaSec, clip.outSec - clip.inSec - minDuration));
        return { ...clip, startSec: clip.startSec + change, inSec: clip.inSec + change };
    }
    return { ...clip, outSec: Math.max(clip.inSec + minDuration,
        Math.min(sourceDuration, clip.outSec + deltaSec)) };
};
