import React, { useRef, useState, useEffect, useMemo } from 'react';
import { SpeedKeyframe } from '../types';
import { presets, SPEED_PRESETS } from '../lib/speedCurve';
import { cn } from '../lib/utils';
import { RotateCcw } from 'lucide-react';

interface SpeedCurveEditorProps {
    curve: SpeedKeyframe[];
    presetId?: string;
    onChange: (newCurve: SpeedKeyframe[], newPresetId?: string) => void;
    duration: number; // Duration of the TRIMMED segment
    currentTime: number; // Current playback time relative to trim start
    onSeek: (time: number) => void;
}

export const SpeedCurveEditor = ({
    curve,
    presetId,
    onChange,
    duration,
    currentTime,
    onSeek,
}: SpeedCurveEditorProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    // Ensure we always have at least 2 points (0 and 1)
    const activeCurve = useMemo(() => {
        if (!curve || curve.length < 2) {
            // Default flat curve
            return presets.find((p) => p.id === SPEED_PRESETS.NORMAL)!.curve();
        }
        return curve;
    }, [curve]);

    const handlePointMouseDown = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDraggingId(id);
    };

    const handleContainerMouseDown = (e: React.MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const position = x / rect.width;
        const newTime = position * duration;
        onSeek(newTime);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!draggingId || !containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

        const position = x / rect.width;

        // Y axis: Top is MAX speed (3x), Bottom is MIN speed (0.1x)
        // Let's say range is 0.1 to 3.0.
        // 0px = 3.0, height = 0.1
        // normalizedY (0 to 1) = y / height
        // speed = MAX - normalizedY * (MAX - MIN)

        const MAX_SPEED = 3.0;
        const MIN_SPEED = 0.1;

        const normalizedY = y / rect.height;
        let speed = MAX_SPEED - normalizedY * (MAX_SPEED - MIN_SPEED);

        // Clamp speed
        speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));

        // Update curve
        const newCurve = activeCurve.map((p) => {
            if (p.id !== draggingId) return p;

            // Constraints: start must be 0, end must be 1 (position)
            // But we might want to allow moving start/end SPEED, but not POSITION?
            // Usually first and last points are fixed at pos 0 and 1.

            let newPos = position;
            if (p.position === 0 || Math.abs(p.position - 0) < 0.01) newPos = 0;
            if (p.position === 1 || Math.abs(p.position - 1) < 0.01) newPos = 1;

            // Also ensure we don't cross other points?
            // For simplicity, let's just update. sorting happens later or we assume user knows.
            // Actually, keep it sorted is better.

            return { ...p, position: newPos, speed };
        });

        // Sort by position to avoid tangles
        newCurve.sort((a, b) => a.position - b.position);

        // Fix start/end if they moved away from edges?
        // Actually, let's enforce first point is 0 and last is 1
        if (newCurve[0].position !== 0) newCurve[0].position = 0;
        if (newCurve[newCurve.length - 1].position !== 1) newCurve[newCurve.length - 1].position = 1;

        onChange(newCurve, 'custom');
    };

    const handleMouseUp = () => {
        setDraggingId(null);
    };

    useEffect(() => {
        if (draggingId) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingId, activeCurve]);

    // Render Graph
    // We need to draw a smooth curve (svg path) through points.
    // Or just straight lines for MVP. Straight lines are easier to visualize what FFmpeg does (linear interpolation between pts).
    // Let's use Polyline for now.

    // We need dimensions for SVG.
    // Let's assume fixed aspect or use percent.
    // SVG viewBox="0 0 100 100" preserveAspectRatio="none"

    const pointsToSvgPoints = () => {
        const MAX_SPEED = 3.0;
        const MIN_SPEED = 0.1;

        return activeCurve
            .map((p) => {
                const x = p.position * 100;
                const normalizedSpeed = (MAX_SPEED - p.speed) / (MAX_SPEED - MIN_SPEED);
                const y = normalizedSpeed * 100;
                return `${x},${y}`;
            })
            .join(' ');
    };

    return (
        <div className="flex flex-col gap-6 p-4 bg-muted/10 rounded-xl border border-border">
            {/* Header / Toolbar */}
            <div className="flex justify-between items-center">
                <h4 className="text-sm font-medium text-foreground">Curva de Velocidade</h4>
                <button
                    onClick={() =>
                        onChange(presets.find((p) => p.id === SPEED_PRESETS.NORMAL)!.curve(), SPEED_PRESETS.NORMAL)
                    }
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                    <RotateCcw className="w-3 h-3" /> Resetar
                </button>
            </div>

            {/* Presets */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {presets.map((p) => (
                    <button
                        key={p.id}
                        onClick={() => onChange(p.curve(), p.id)}
                        className={cn(
                            'px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors border',
                            presetId === p.id
                                ? 'bg-primary text-black border-primary'
                                : 'bg-card border-border text-muted-foreground hover:bg-muted'
                        )}
                    >
                        {p.label}
                    </button>
                ))}
            </div>

            {/* Graph Area */}
            <div
                className="relative h-20 bg-card rounded-lg border border-border select-none cursor-pointer"
                ref={containerRef}
                onMouseDown={handleContainerMouseDown}
            >
                {/* Horizontal Guide Lines */}
                <div className="absolute inset-0 flex flex-col justify-between p-2 opacity-20 pointer-events-none">
                    <div className="border-t border-white w-full h-0"></div>
                    <div className="border-t border-white w-full h-0"></div>
                    <div className="border-t border-white w-full h-0"></div>
                </div>
                {/* Labels */}
                <div className="absolute left-2 top-2 text-[10px] text-muted-foreground pointer-events-none">3x</div>
                <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
                    1x
                </div>
                <div className="absolute left-2 bottom-2 text-[10px] text-muted-foreground pointer-events-none">
                    0.1x
                </div>

                {/* The Curve */}
                <svg
                    className="absolute inset-0 w-full h-full overflow-visible"
                    preserveAspectRatio="none"
                    viewBox="0 0 100 100"
                >
                    {/* 1x Line Reference */}
                    <line
                        x1="0"
                        y1="65.5"
                        x2="100"
                        y2="65.5"
                        stroke="currentColor"
                        className="text-muted-foreground/30"
                        strokeDasharray="4"
                        strokeWidth="0.5"
                    />

                    <polyline
                        points={pointsToSvgPoints()}
                        fill="none"
                        stroke="currentColor"
                        className="text-primary"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                    />
                </svg>

                {/* Interactive Points */}
                {activeCurve.map((p) => {
                    const MAX_SPEED = 3.0;
                    const MIN_SPEED = 0.1;
                    const left = `${p.position * 100}%`;
                    const normalizedSpeed = (MAX_SPEED - p.speed) / (MAX_SPEED - MIN_SPEED);
                    const top = `${normalizedSpeed * 100}%`;

                    return (
                        <div
                            key={p.id}
                            className={cn(
                                'absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 cursor-grab active:cursor-grabbing flex items-center justify-center z-10 transition-transform hover:scale-125',
                                draggingId === p.id
                                    ? 'bg-white border-primary scale-125 shadow-[0_0_10px_rgba(34,197,94,0.5)]'
                                    : 'bg-card border-primary'
                            )}
                            style={{ left, top }}
                            onMouseDown={(e) => handlePointMouseDown(e, p.id)}
                            title={`${p.speed.toFixed(1)}x`}
                        >
                            <div className="w-1 h-1 bg-primary rounded-full" />
                        </div>
                    );
                })}

                {/* Playhead Indicator */}
                <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white z-20 pointer-events-none"
                    style={{ left: `${(currentTime / duration) * 100}%` }}
                />

                {/* Add Point Hint (Double click maybe?) - For MVP, fixed points per preset is safer */}
            </div>

            <p className="text-[10px] text-muted-foreground text-center">
                Arraste os pontos para ajustar a velocidade. Para cima = Mais rápido. Para baixo = Câmera lenta.
            </p>
        </div>
    );
};
