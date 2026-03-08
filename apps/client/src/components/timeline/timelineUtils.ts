// Constants
export const BASE_PX_PER_SEC = 100; // Making 100 the base for easier mental math, or 80 as user suggested. Let's use 100 as current defaults were 100.
// Actually user suggested base 80 and zoom 0.1 etc.
// Current app uses "zoom = 100" meaning 100 px/sec.
// Let's stick to: zoom is pxPerSec directly.
// User said: "pxPerSec = basePxPerSec * zoom".
// In our app, 'zoom' state IS the pxPerSec (starts at 100).
// Simpler: Just use zoom as pxPerSec.

export const timeToX = (t: number, zoom: number) => t * zoom;
export const xToTime = (x: number, zoom: number) => x / zoom;

export const getSmartTickStep = (zoom: number): number => {
    // Target meaningful spacing in pixels (e.g. 100px per major tick)
    const targetMajorPx = 100;
    const rawStepSec = targetMajorPx / zoom;

    // Strict "Nice" intervals to snap to.
    // PREFER: 1, 2, 5, 10, 15, 30, 60...
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

    // Find smallest step >= rawStepSec
    const step = steps.find((s) => s >= rawStepSec) || steps[steps.length - 1];
    return step;
};

export const formatTimeValues = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    // If we have decimals (zoom high), show them?
    // User request just showed mm:ss examples.
    return `${m}:${s.toString().padStart(2, '0')}`;
};
