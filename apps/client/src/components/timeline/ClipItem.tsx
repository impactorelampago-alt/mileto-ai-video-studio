import React from 'react';
import { AudioClip } from '../../types';
import { cn } from '../../lib/utils';
import { timeToX } from './timelineUtils';

interface ClipItemProps {
    clip: AudioClip;
    zoom: number;
    audioBuffer?: AudioBuffer;
    speed?: number;
    isSelected: boolean;
    onSelect: () => void;
    onUpdate?: (updates: Partial<AudioClip>) => void; // Optional if unused
    onMouseDown: (e: React.MouseEvent, type: 'move' | 'trim-start' | 'trim-end') => void;
}

export const ClipItem: React.FC<ClipItemProps> = ({
    clip,
    zoom,
    audioBuffer,
    speed = 1.0,
    isSelected,
    onSelect,
    onMouseDown,
}) => {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);

    // Strict usage of timeToX for position and dimension
    const left = timeToX(clip.startSec, zoom);

    // Resolve duration: outSec > buffer > default(30)
    let resolvedDuration = clip.outSec;
    if ((!resolvedDuration || resolvedDuration <= 0) && audioBuffer) {
        resolvedDuration = audioBuffer.duration;
    }
    const sourceDuration = Math.max(
        0.1,
        (resolvedDuration && resolvedDuration > 0 ? resolvedDuration : 30) - clip.inSec
    );
    const visualDuration = sourceDuration / speed;

    const width = Math.max(10, timeToX(visualDuration, zoom));

    // Waveform Drawing
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !audioBuffer) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;

        // Canvas dimensions matching the rendered width/height
        // Note: width is dynamic based on zoom.
        // We need to set canvas.width/height attributes to logical * dpr

        const cssWidth = width;
        const cssHeight = 56; // approximate inner height (inset 6px + 1px border?) - lets assume fill parent

        // We use ResizeObserver or just effect on width change.
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;

        // Reset transform
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, cssWidth, cssHeight);

        // Draw Logic
        // We need to slice the buffer from clip.inSec to clip.inSec + duration
        // Buffer sample rate is typically 44100 or 48000

        const sampleRate = audioBuffer.sampleRate;
        const startSample = Math.floor(clip.inSec * sampleRate);
        const endSample = Math.floor((clip.inSec + sourceDuration) * sampleRate);
        const totalSamples = endSample - startSample;

        if (totalSamples <= 0) return;

        const data = audioBuffer.getChannelData(0); // Mono or Left channel

        // How many samples per pixel?
        const step = Math.ceil(totalSamples / cssWidth);
        const amp = cssHeight / 2; // Middle baseline

        // Style: Green Theme
        // We want a gradient? Or just solid bars?
        // User requested: "verde forte, verde fraco" (strong green, weak green)

        const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight);
        gradient.addColorStop(0, '#4ade80'); // green-400 (top/high)
        gradient.addColorStop(0.5, '#22c55e'); // green-500 (mid)
        gradient.addColorStop(1, '#4ade80'); // green-400 (bottom)

        ctx.fillStyle = gradient; // '#22c55e'; // green-500

        // Optimization: Draw simpler path
        ctx.beginPath();

        for (let i = 0; i < cssWidth; i++) {
            let min = 1.0;
            let max = -1.0;

            // Scan block of samples for this pixel
            // Using a loop here might be heavy if step is huge (e.g. zoomed out on 1 hour audio)
            // But for 30s clips it's fine.
            const datumIndex = startSample + i * step; // Fixed const

            // Simple sub-sampling if step is large (> 10)
            const subStep = Math.max(1, Math.floor(step / 10));

            for (let j = 0; j < step; j += subStep) {
                const idx = Math.floor(datumIndex + j);
                if (idx >= data.length) break;
                const val = data[idx];
                if (val < min) min = val;
                if (val > max) max = val;
            }

            // Sanity check
            if (max < min) {
                max = 0;
                min = 0;
            }

            // Convert to Y coords
            // -1 -> height, 1 -> 0 ? No. -1..1 range.
            // 1.0 = height (bottom?), -1.0 = 0 (top?)
            // Usually 0 is center.

            // Center is amp (cssHeight/2)
            // y = amp + val * amp * 0.9 (scale factor)

            const yMin = amp + min * amp * 0.9;
            const yMax = amp + max * amp * 0.9;

            // Draw vertical bar from min to max
            ctx.fillRect(i, yMin, 1, Math.max(1, yMax - yMin));
        }
    }, [audioBuffer, width, clip.inSec, sourceDuration, zoom]); // Re-render if zoom/trim changes

    return (
        <div
            className={cn(
                'clip-item absolute top-0 bottom-0 rounded-md border border-green-500/30 bg-green-900/40 overflow-hidden cursor-move select-none backdrop-blur-sm transition-colors',
                isSelected && 'border-green-400 ring-2 ring-green-400/50 z-20 bg-green-900/60'
            )}
            style={{
                left: `${left}px`,
                width: `${width}px`,
                transform: 'translate3d(0,0,0)',
            }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'CANVAS') {
                    onSelect();
                    onMouseDown(e, 'move');
                }
            }}
            onClick={(e) => {
                e.stopPropagation();
                onSelect();
            }}
        >
            {/* Waveform Background */}
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-80 pointer-events-none" />

            <div className="relative px-2 py-1 text-xs text-green-100 font-medium truncate w-full pointer-events-none shadow-sm z-10">
                {clip.name}
            </div>

            {/* Trim Handles */}
            <div
                className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-green-500/30 z-30 transition-colors"
                onMouseDown={(e) => {
                    e.stopPropagation();
                    onMouseDown(e, 'trim-start');
                }}
            />
            <div
                className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-green-500/30 z-30 transition-colors"
                onMouseDown={(e) => {
                    e.stopPropagation();
                    onMouseDown(e, 'trim-end');
                }}
            />
        </div>
    );
};
