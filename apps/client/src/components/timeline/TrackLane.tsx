import React from 'react';
import { Plus, Minus } from 'lucide-react';
import { TimelineTrack, AudioClip } from '../../types';
import { ClipItem } from './ClipItem.tsx';

interface TrackLaneProps {
    track: TimelineTrack;
    zoom: number;
    audioBuffers?: Map<string, AudioBuffer>; // New prop
    selectedClipId: string | null;
    onSelectClip: (id: string | null) => void;
    onUpdateClip: (trackId: string, clipId: string, updates: Partial<AudioClip>) => void;
    onMouseDown: (
        e: React.MouseEvent,
        clipId: string,
        trackId: string,
        type: 'move' | 'trim-start' | 'trim-end'
    ) => void;
    onVolumeChange: (trackId: string, volume: number) => void;
    onSpeedChange: (trackId: string, speed: number) => void;
}

// Export non-memoized for testing if needed, or just memoized at top level.
// We'll export the component as usual but wrap the definition.

// Memoize the component to avoid re-rendering every frame during playback
const TrackLaneComponent: React.FC<TrackLaneProps> = ({
    track,
    zoom,
    audioBuffers,
    selectedClipId,
    onSelectClip,
    onUpdateClip,
    onMouseDown,
    onVolumeChange,
    onSpeedChange,
}) => {
    return (
        <div className="h-32 border-b border-black/5 dark:border-white/5 relative group bg-black/20 hover:bg-black/5 dark:bg-white/5 transition-colors flex">
            {/* Track Header (Controls) */}
            <div
                className="w-32 shrink-0 border-r border-black/5 dark:border-white/5 bg-[#18181b] flex flex-row items-center justify-between px-3 py-4 gap-2 z-20 relative shadow-xl"
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* Label (Horizontal) with Volume % and Speed */}
                <div className="flex-1 flex flex-col items-end justify-center gap-1">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-foreground/50 text-right leading-tight">
                        {track.label}
                    </div>

                    <div className="flex flex-col items-end gap-0.5">
                        <div className="text-[10px] font-mono text-primary font-bold tracking-tighter">
                            {Math.round(track.volume * 100)}%
                        </div>

                        {/* Speed Control Pill */}
                        <div className="flex items-center bg-black/40 rounded-full px-1 py-0.5 mt-1 border border-white/5">
                            <button
                                onClick={() => onSpeedChange(track.id, Math.max(0.5, (track.speed || 1.0) - 0.1))}
                                className="text-foreground/40 hover:text-primary transition-colors hover:bg-white/10 rounded-full cursor-pointer flex items-center justify-center p-0.5"
                                title="Reduzir Velocidade"
                            >
                                <svg
                                    width="8"
                                    height="8"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="m15 18-6-6 6-6" />
                                </svg>
                            </button>
                            <span className="text-[9px] font-mono font-medium text-foreground/80 w-6 text-center tabular-nums">
                                {(track.speed || 1.0).toFixed(1)}x
                            </span>
                            <button
                                onClick={() => onSpeedChange(track.id, Math.min(2.0, (track.speed || 1.0) + 0.1))}
                                className="text-foreground/40 hover:text-primary transition-colors hover:bg-white/10 rounded-full cursor-pointer flex items-center justify-center p-0.5"
                                title="Aumentar Velocidade"
                            >
                                <svg
                                    width="8"
                                    height="8"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Custom Volume Slider (Vertical) with +/- */}
                <div className="h-full flex flex-col items-center justify-between py-1 gap-1 w-8">
                    <button
                        onClick={() => onVolumeChange(track.id, Math.min(1.5, track.volume + 0.05))}
                        className="text-foreground/40 hover:text-foreground p-0.5 transition-colors"
                        title="Aumentar Volume"
                    >
                        <Plus size={12} />
                    </button>

                    <div className="flex-1 w-6 flex justify-center group/slider relative min-h-0">
                        <div className="relative w-1.5 h-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                            {/* Input (Rotated or vertical sizing) */}
                            <input
                                type="range"
                                min="0"
                                max="1.5"
                                step="0.01"
                                value={track.volume}
                                onChange={(e) => onVolumeChange(track.id, parseFloat(e.target.value))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                style={{
                                    appearance: 'slider-vertical' as any,
                                    touchAction: 'none',
                                }}
                            />

                            {/* Visual Overlay */}
                            <div className="absolute inset-0 w-full h-full flex justify-center pointer-events-none">
                                <div className="w-full h-full relative">
                                    <div
                                        className="absolute bottom-0 w-full bg-primary"
                                        style={{ height: `${(track.volume / 1.5) * 100}%` }}
                                    />
                                </div>
                                {/* Thumb */}
                                <div
                                    className="absolute left-1/2 -translate-x-1/2 w-3 h-3 bg-black border-2 border-primary rounded-full shadow-lg transition-transform group-hover/slider:scale-125"
                                    style={{ bottom: `calc(${(track.volume / 1.5) * 100}% - 6px)` }}
                                >
                                    <div className="absolute inset-0 m-auto w-1 h-1 bg-primary rounded-full" />
                                </div>
                            </div>
                        </div>

                        {/* Tooltip/Value Indicator on Hover */}
                        <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 bg-black text-foreground text-[10px] px-1 rounded opacity-0 group-hover/slider:opacity-100 transition-opacity pointer-events-none">
                            {Math.round(track.volume * 100)}%
                        </div>
                    </div>

                    <button
                        onClick={() => onVolumeChange(track.id, Math.max(0, track.volume - 0.05))}
                        className="text-foreground/40 hover:text-foreground p-0.5"
                    >
                        <Minus size={10} />
                    </button>
                </div>
            </div>

            {/* Clips Container Area */}
            <div className="flex-1 relative overflow-hidden">
                <div className="absolute inset-0 top-6 bottom-1">
                    {track.clips.map((clip) => (
                        <ClipItem
                            key={clip.id}
                            clip={clip}
                            zoom={zoom}
                            audioBuffer={audioBuffers?.get(clip.sourceUrl)} // Pass specific buffer
                            speed={track.speed} // Pass the multiplier
                            isSelected={selectedClipId === clip.id}
                            onSelect={() => onSelectClip(clip.id)}
                            onUpdate={(updates: Partial<AudioClip>) => onUpdateClip(track.id, clip.id, updates)}
                            onMouseDown={(e: React.MouseEvent, type: 'move' | 'trim-start' | 'trim-end') =>
                                onMouseDown(e, clip.id, track.id, type)
                            }
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export const TrackLane = React.memo(TrackLaneComponent);
