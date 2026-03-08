export type SpeedPresetType = 'normal' | 'fast_in_slow_out' | 'slow_in_fast_out' | 'swoosh';

export interface SpeedRemapConfig {
    /**
     * The type of mathematical curve applied to the time constraint.
     */
    presetId: SpeedPresetType;
}

/**
 * Visual Definition of the Presets for the front-end to render UI cards.
 */
export const SPEED_PRESETS: { id: SpeedPresetType; title: string; description: string }[] = [
    { id: 'normal', title: 'Normal (1x)', description: 'Velocidade original da câmera' },
    { id: 'fast_in_slow_out', title: 'Start Rápido', description: 'Entra rápido, termina em câmera lenta' },
    { id: 'slow_in_fast_out', title: 'Fim Sugado', description: 'Começa de boa, acelera no final' },
    { id: 'swoosh', title: 'Swoosh', description: 'Rápido nas pontas, lento no meio' },
];

/**
 * Given a normalized position inside the take (0.0 to 1.0),
 * this function returns the instantaneous playback rate (speed)
 * that the video player should use right at that fraction of time.
 *
 * Example: if position is 0.5 (halfway through the take's timeline duration),
 * and the curve is 'swoosh' (fast -> slow -> fast), it might return 0.5 (slow).
 *
 * @param presetId The selected geometric curve
 * @param normalizedPosition Value between 0.0 (start of take) and 1.0 (end of take).
 * @returns The playbackRate scaler (e.g., 1.0, 0.5, 2.5) for the HTML5 Video element.
 */
export function getPlaybackRateForRemap(presetId: SpeedPresetType, normalizedPosition: number): number {
    // Clamping to avoid edge bugs
    const t = Math.max(0, Math.min(1, normalizedPosition));

    switch (presetId) {
        case 'normal':
            return 1.0;

        case 'fast_in_slow_out':
            // Starts fast (1.93x) and decays linearly to slow (0.43x)
            // Mathematical correction: to make physical duration exactly 1.0,
            // we need Integral(1/v) = 1.0, which means higher peak to compensate for dip.
            return 1.93 - 1.5 * t;

        case 'slow_in_fast_out':
            // Starts slow (0.43x) and ramps up to fast (1.93x)
            return 0.43 + 1.5 * t;

        case 'swoosh':
            // Fast at the edges (max 2.44x), slow in the middle (min 0.6x)
            // Curve: a(t - 0.5)^2 + c where c=0.6, a=7.38
            return 7.38 * Math.pow(t - 0.5, 2) + 0.6;

        default:
            return 1.0;
    }
}
