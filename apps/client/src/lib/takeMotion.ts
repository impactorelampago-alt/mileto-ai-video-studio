import type { MediaTake, TakeMotionEffect } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizedTakeProgress = (take: MediaTake, localTime: number): number => {
    const duration = Math.max(0.001, take.trim.end - take.trim.start);
    return clamp(localTime / duration, 0, 1);
};

export const easedMotionProgress = (progress: number, easing: TakeMotionEffect['easing']): number => {
    const p = clamp(progress, 0, 1);
    return easing === 'smooth' ? p * p * (3 - 2 * p) : p;
};

export const takeMotionScale = (effect: TakeMotionEffect | undefined, progress: number): number => {
    if (!effect) return 1;
    const amount = clamp(effect.intensity, 0.02, 0.35);
    if (effect.type === 'zoom-in-out') {
        const roundTripProgress = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
        return 1 + amount * easedMotionProgress(roundTripProgress, effect.easing);
    }
    const eased = easedMotionProgress(progress, effect.easing);
    return effect.type === 'zoom-out' ? 1 + amount * (1 - eased) : 1 + amount * eased;
};

export const takeMotionLabel = (effect: TakeMotionEffect | undefined): string | null => {
    if (!effect) return null;
    if (effect.type === 'zoom-in-out') return 'Zoom In + Out';
    return effect.type === 'zoom-out' ? 'Zoom Out' : 'Zoom In';
};
