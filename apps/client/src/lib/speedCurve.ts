import { v4 as uuidv4 } from 'uuid';
import { SpeedKeyframe } from '../types';

export const SPEED_PRESETS = {
    NORMAL: 'normal',
    SMOOTH_IN_OUT: 'smooth-in-out',
    BULLET: 'bullet',
    HERO: 'hero',
    MONTAGE: 'montage',
    JUMP_CUT: 'jump-cut',
};

export interface SpeedPreset {
    id: string;
    label: string;
    icon?: string; // Could be an SVG path or icon name
    curve: (idGenerator?: () => string) => SpeedKeyframe[];
}

const generateId = () => uuidv4();

export const presets: SpeedPreset[] = [
    {
        id: SPEED_PRESETS.NORMAL,
        label: 'Normal',
        curve: (genId = generateId) => [
            { id: genId(), position: 0, speed: 1 },
            { id: genId(), position: 1, speed: 1 },
        ],
    },
    {
        id: SPEED_PRESETS.SMOOTH_IN_OUT,
        label: 'Suave',
        curve: (genId = generateId) => [
            { id: genId(), position: 0, speed: 0.7 },
            { id: genId(), position: 0.5, speed: 1.5 },
            { id: genId(), position: 1, speed: 0.7 },
        ],
    },
    {
        id: SPEED_PRESETS.BULLET,
        label: 'Bala',
        curve: (genId = generateId) => [
            { id: genId(), position: 0, speed: 1 },
            { id: genId(), position: 0.4, speed: 1 },
            { id: genId(), position: 0.5, speed: 3 }, // Fast in middle
            { id: genId(), position: 0.6, speed: 1 },
            { id: genId(), position: 1, speed: 1 },
        ],
    },
    {
        id: SPEED_PRESETS.HERO,
        label: 'Herói',
        curve: (genId = generateId) => [
            { id: genId(), position: 0, speed: 0.5 }, // Slow start
            { id: genId(), position: 0.3, speed: 0.5 },
            { id: genId(), position: 0.6, speed: 1.5 }, // Accelerate
            { id: genId(), position: 1, speed: 2 },
        ],
    },
    {
        id: SPEED_PRESETS.MONTAGE,
        label: 'Montagem',
        curve: (genId = generateId) => [
            { id: genId(), position: 0, speed: 1 },
            { id: genId(), position: 0.25, speed: 2 },
            { id: genId(), position: 0.5, speed: 0.8 },
            { id: genId(), position: 0.75, speed: 2.5 },
            { id: genId(), position: 1, speed: 1 },
        ],
    },
    {
        id: SPEED_PRESETS.JUMP_CUT,
        label: 'Jump Cut',
        curve: (genId = generateId) => [
            { id: genId(), position: 0, speed: 1 },
            { id: genId(), position: 0.9, speed: 1 },
            { id: genId(), position: 1, speed: 10 }, // Sudden jump at end? Maybe not supported well by smooth interpolation but fun
        ],
    },
];

export const getSpeedAtPosition = (curve: SpeedKeyframe[], position: number): number => {
    if (!curve || curve.length === 0) return 1;

    // Sort just in case
    const sorted = [...curve].sort((a, b) => a.position - b.position);

    // If pos is before first point
    if (position <= sorted[0].position) return sorted[0].speed;
    // If pos is after last point
    if (position >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].speed;

    // Find segment
    for (let i = 0; i < sorted.length - 1; i++) {
        const reset = sorted[i];
        const next = sorted[i + 1];

        if (position >= reset.position && position <= next.position) {
            // Linear interpolation
            const range = next.position - reset.position;
            if (range === 0) return reset.speed;

            const progress = (position - reset.position) / range;
            return reset.speed + (next.speed - reset.speed) * progress;
        }
    }

    return 1;
};

// Helper: Normalize points to ensure they start at 0 and end at 1 if missing
export const normalizeCurve = (curve: SpeedKeyframe[]): SpeedKeyframe[] => {
    const newCurve = [...curve].sort((a, b) => a.position - b.position);

    // Ensure start at 0
    if (newCurve[0].position > 0) {
        newCurve.unshift({ id: uuidv4(), position: 0, speed: newCurve[0].speed });
    } else {
        newCurve[0].position = 0; // Snap to 0
    }

    // Ensure end at 1
    if (newCurve[newCurve.length - 1].position < 1) {
        newCurve.push({ id: uuidv4(), position: 1, speed: newCurve[newCurve.length - 1].speed });
    } else {
        newCurve[newCurve.length - 1].position = 1; // Snap to 1
    }

    return newCurve;
};

const INTEGRATION_STEPS = 200;

/**
 * Calculates the total display duration of a trimmed video segment
 * after applying the speed curve. The speed curve is defined over [0, 1]
 * of the trimmed segment and the actual playback speed varies.
 * display_duration = integral(1/speed(p) dp, 0, 1) * trimDuration
 */
export const computeDisplayDuration = (trimDuration: number, curve: SpeedKeyframe[]): number => {
    if (!curve || curve.length === 0 || trimDuration <= 0) return trimDuration;
    const sorted = normalizeCurve(curve);
    let sum = 0;
    const step = 1 / INTEGRATION_STEPS;
    for (let i = 0; i < INTEGRATION_STEPS; i++) {
        const p = i * step + step / 2; // midpoint
        const speed = getSpeedAtPosition(sorted, p);
        sum += (1 / Math.max(speed, 0.01)) * step;
    }
    return sum * trimDuration;
};

/**
 * Given elapsed display time for a take, returns the corresponding
 * source video time (relative to trim.start = 0).
 * i.e.: where in the original trimmed clip we currently are.
 */
export const sourceTimeAtDisplayTime = (trimDuration: number, curve: SpeedKeyframe[], displayT: number): number => {
    if (!curve || curve.length === 0 || trimDuration <= 0) return displayT;
    const sorted = normalizeCurve(curve);
    const totalDisplayDur = computeDisplayDuration(trimDuration, sorted);
    if (totalDisplayDur <= 0) return 0;

    // Clamp displayT
    const t = Math.min(displayT, totalDisplayDur);
    // Integrate until we've accumulated `t` display seconds
    const step = 1 / INTEGRATION_STEPS;
    let accumulated = 0;
    let sourcePos = 0; // [0, 1] progress in source
    for (let i = 0; i < INTEGRATION_STEPS; i++) {
        const p = i * step;
        const speed = getSpeedAtPosition(sorted, p + step / 2);
        const displayStep = (1 / Math.max(speed, 0.01)) * step;
        if (accumulated + displayStep >= t) {
            // Interpolate within this step
            const fraction = (t - accumulated) / Math.max(displayStep, 1e-9);
            sourcePos = p + fraction * step;
            break;
        }
        accumulated += displayStep;
        sourcePos = p + step;
    }
    return Math.min(sourcePos, 1) * trimDuration;
};
