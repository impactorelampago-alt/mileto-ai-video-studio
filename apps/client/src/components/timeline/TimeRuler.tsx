import React, { useRef, useEffect } from 'react';

import { formatTimeValues, getSmartTickStep, timeToX } from './timelineUtils';

interface TimeRulerProps {
    zoom: number; // pixels per second
    duration: number;
    width: number;
    offset?: number;
}

export const TimeRuler: React.FC<TimeRulerProps> = ({ zoom, duration, width: propWidth, offset = 0 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Use propWidth to match parent container exactly
        const width = propWidth;
        const height = 24;

        // Handle HiDPI
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#a1a1aa'; // zinc-400 (lighter than before)
        ctx.font = '11px sans-serif'; // Cleaner font
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        // Translate context to account for header width
        ctx.translate(offset, 0);

        const tickStep = getSmartTickStep(zoom);

        // Optimize: Only iterate visible range or full range with step?
        // Iterating by tickStep is efficient enough for typical durations.
        // Start from -tickStep to ensure 0 is drawn if needed, mostly loop 0 to duration

        // We really want consistent spacing.
        // Iterate by small chunks? No, iterate by tickStep is best for "Major" ticks.
        // But we also want minor ticks. A simple strategy:
        // 1. Draw Major Ticks (Labels) based on tickStep
        // 2. Draw Minor Ticks (subdivisions)

        // How many subdivisions?
        // If step is 5, maybe 1s ticks?
        // If step is 10, maybe 1s or 2s ticks?

        let subStep = tickStep / 5;
        if (tickStep === 1) subStep = 0.5; // 0.5s ticks
        if (tickStep === 0.5) subStep = 0.1;

        // Avoid too dense minor ticks if subStep < 3px
        if (subStep * zoom < 5) {
            subStep = tickStep / 2; // Fallback to just halves
            if (subStep * zoom < 5) subStep = tickStep; // No minor ticks
        }

        // Maximum time to draw
        const drawDuration = duration + tickStep * 2;

        ctx.beginPath();
        // Drawing loop
        for (let t = 0; t <= drawDuration; t += subStep) {
            const x = timeToX(t, zoom);
            if (x > width) break;

            // Check if it's close to a major tick
            // Use epsilon for float comparison
            const isMajor = Math.abs(t % tickStep) < 0.001 || Math.abs((t % tickStep) - tickStep) < 0.001;

            if (isMajor) {
                // Major Tick
                ctx.fillRect(x, 0, 1, 10);
                // Label
                // Only draw label if it fits? (avoid overlapping)
                // Since getSmartTickStep targets ~100px, labels should fit easily.
                ctx.fillText(formatTimeValues(Math.round(t)), x + 4, 12);
            } else {
                // Minor Tick
                ctx.fillRect(x, 0, 1, 5);
            }
        }
    }, [zoom, duration, propWidth]);

    return (
        <div className="sticky top-0 z-40 bg-card/95 backdrop-blur border-b border-border h-6 select-none pointer-events-none">
            <canvas ref={canvasRef} className="block" />
        </div>
    );
};
