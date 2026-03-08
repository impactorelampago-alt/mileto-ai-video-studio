import React, { useState, useEffect } from 'react';
import { useWizard } from '../../context/WizardContext';
import { AudioTimeline } from '../../types';
import { Play, Pause, ZoomIn, ZoomOut, Wand2, Scissors, Trash2, Undo2, X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { TrackLane } from './TrackLane.tsx';
import { TimeRuler } from './TimeRuler.tsx';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { timeToX } from './timelineUtils';

interface TimelineEditorProps {
    isOpen: boolean;
    onClose: () => void;
}

const DEFAULT_DURATION = 30;
const HEADER_WIDTH = 128; // Width of the TrackLane header (w-32) // 30 seconds default if no clips

export const TimelineEditor: React.FC<TimelineEditorProps> = ({ isOpen, onClose }) => {
    const { adData, updateAdData } = useWizard();
    const [timeline, setTimeline] = useState<AudioTimeline | null>(null);

    // Zoom Logic
    const [zoomPercent, setZoomPercent] = useState(100); // UI display value (100 = 100% fit)
    const [fitPxPerSec, setFitPxPerSec] = useState(100); // Calculated value to make it fit
    const timelineRef = React.useRef<HTMLDivElement>(null);
    const [viewportWidth, setViewportWidth] = useState(0);

    // Derived current scale
    const zoom = fitPxPerSec * (zoomPercent / 100);

    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [dragTime, setDragTime] = useState<number | null>(null);

    // Audio Engine - Moved up to be available for Zoom logic
    const { isPlaying, currentTime, play, pause, seek, isReady, audioBuffers } = useAudioEngine(
        timeline,
        React.useCallback((sourceUrl: string, duration: number) => {
            setTimeline((prev) => {
                if (!prev) return null;
                let hasChanges = false;

                const newTracks = prev.tracks.map((track) => {
                    const newClips = track.clips.map((clip) => {
                        if (clip.sourceUrl === sourceUrl) {
                            if (clip.outSec === 0) {
                                hasChanges = true;
                                return { ...clip, outSec: duration };
                            }
                        }
                        return clip;
                    });
                    return { ...track, clips: newClips };
                });

                if (!hasChanges) return prev;

                // Also update timeline duration if needed
                const maxEnd = newTracks.reduce((max, t) => {
                    return Math.max(
                        max,
                        t.clips.reduce((tm, c) => Math.max(tm, c.startSec + ((c.outSec || 30) - c.inSec)), 0)
                    );
                }, 0);

                return {
                    ...prev,
                    tracks: newTracks,
                    durationSec: maxEnd, // Recalculate duration strictly from clips
                };
            });
        }, [])
    );

    // Measure viewport with ResizeObserver
    useEffect(() => {
        if (!timelineRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Determine if we were in "fit" mode (zoom=100) before resize
                // If so, we want to stay in fit mode.
                // Simplified: always update viewportWidth, let the zoom logic decide
                setViewportWidth(entry.contentRect.width);
            }
        });
        resizeObserver.observe(timelineRef.current);
        return () => resizeObserver.disconnect();
    }, [isOpen]);

    // Width Logic: Ensure it fills at least the viewport
    const getTimelineWidth = (duration: number, z: number) => {
        const contentWidth = timeToX(duration, z);
        return Math.max(viewportWidth, contentWidth);
    };

    // Init or Migrate
    useEffect(() => {
        if (!isOpen) return;

        let initialTimeline: AudioTimeline;

        if (adData.audioTimeline) {
            initialTimeline = JSON.parse(JSON.stringify(adData.audioTimeline)); // Deep copy to avoid mutation
        } else {
            // Migration / Default
            initialTimeline = {
                durationSec: DEFAULT_DURATION,
                tracks: [
                    {
                        id: 'narration',
                        label: 'Narração',
                        type: 'audio',
                        enabled: adData.audioConfig.narration.enabled,
                        volume: adData.audioConfig.narration.volume,
                        muted: false,
                        solo: false,
                        clips: [],
                    },
                    {
                        id: 'bgm',
                        label: 'Música',
                        type: 'audio',
                        enabled: adData.audioConfig.background.enabled,
                        volume: adData.audioConfig.background.volume,
                        muted: false,
                        solo: false,
                        clips: [],
                    },
                ],
            };
        }

        // --- Synchronization Logic ---
        // Ensure Timeline tracks match the current adData URLs (Source of Truth)

        // 1. Sync Narration
        const narrTrack = initialTimeline.tracks.find((t) => t.id === 'narration');
        if (narrTrack) {
            if (adData.narrationAudioUrl) {
                const currentClip = narrTrack.clips[0];
                // If no clip, or different URL, replace it
                if (!currentClip || currentClip.sourceUrl !== adData.narrationAudioUrl) {
                    narrTrack.clips = [
                        {
                            id: uuidv4(),
                            sourceUrl: adData.narrationAudioUrl,
                            name: 'Narração Gerada',
                            startSec: adData.audioConfig.narration.offsetSec,
                            inSec: adData.audioConfig.narration.trimStart,
                            outSec: 0, // Will be auto-calculated
                            fadeInSec: adData.audioConfig.narration.fadeInSec,
                            fadeOutSec: adData.audioConfig.narration.fadeOutSec,
                            volume: 1,
                        },
                    ];
                }
            } else {
                // If no narration URL in adData, remove clip
                narrTrack.clips = [];
            }
        }

        // 2. Sync Background Music
        const bgmTrack = initialTimeline.tracks.find((t) => t.id === 'bgm');
        if (bgmTrack) {
            if (adData.musicAudioUrl) {
                const currentClip = bgmTrack.clips[0];
                if (!currentClip || currentClip.sourceUrl !== adData.musicAudioUrl) {
                    bgmTrack.clips = [
                        {
                            id: uuidv4(),
                            sourceUrl: adData.musicAudioUrl,
                            name: 'Música de Fundo',
                            startSec: adData.audioConfig.background.offsetSec,
                            inSec: adData.audioConfig.background.trimStart,
                            outSec: 0,
                            fadeInSec: adData.audioConfig.background.fadeInSec,
                            fadeOutSec: adData.audioConfig.background.fadeOutSec,
                            volume: 1,
                        },
                    ];
                }
            } else {
                // User deleted music -> Remove from timeline
                bgmTrack.clips = [];
            }
        }

        setTimeline(initialTimeline);
    }, [isOpen, adData.narrationAudioUrl, adData.musicAudioUrl]); // Re-run if URLs change while open

    // Auto-Zoom Logic
    const handleAutoZoom = React.useCallback(() => {
        // Must measure fresh width if state is stale, but we should rely on viewportWidth state
        // or measure directly if needed.
        // Let's rely on viewportWidth but add a fallback measurement if it's 0
        let effectiveWidth = viewportWidth;
        if (effectiveWidth === 0 && timelineRef.current) {
            effectiveWidth = timelineRef.current.getBoundingClientRect().width;
        }

        if (!timeline || effectiveWidth <= 0) return;

        const padding = 24;
        const headerWidth = 128; // w-32 from TrackLane header
        const availableWidth = Math.max(10, effectiveWidth - headerWidth - padding);

        // Calculate total duration from clips
        const maxClipEnd = timeline.tracks.reduce((max, track) => {
            const trackEnd = track.clips.reduce((tMax, clip) => {
                let duration = clip.outSec;
                if (!duration || duration <= 30.1) {
                    const buf = audioBuffers.get(clip.sourceUrl);
                    if (buf) duration = buf.duration;
                }
                const clipDur = (duration || 30) - clip.inSec;
                return Math.max(tMax, clip.startSec + clipDur);
            }, 0);
            return Math.max(max, trackEnd);
        }, 0);

        const timelineDur = Math.max(timeline.durationSec || 30, maxClipEnd, 1);

        // Calculate strict fit
        const fit = availableWidth / timelineDur;

        // No arbitrary min limit (like 10px/sec) that prevents fitting long audio.
        // Just a sanity check against 0.
        setFitPxPerSec(Math.max(0.5, fit));
        setZoomPercent(100);

        // Reset scroll
        if (timelineRef.current) {
            timelineRef.current.scrollLeft = 0;
        }
    }, [timeline, viewportWidth, audioBuffers]);

    // Initial Zoom: trigger when open, ready, and layout is stable
    useEffect(() => {
        if (!isOpen) return;

        // Use rAF to ensure layout paint
        const handle = requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                handleAutoZoom();
            });
        });

        return () => cancelAnimationFrame(handle);
    }, [isOpen, isReady, handleAutoZoom]);

    // Re-trigger zoom if viewport changes and we are in "fit" mode?
    // User requested: "Recalcular em resize"
    // If zoomPercent is 100, we interpret that as "Fit Mode".
    useEffect(() => {
        if (zoomPercent === 100 && isOpen) {
            handleAutoZoom();
        }
    }, [viewportWidth, zoomPercent, isOpen, handleAutoZoom]);

    // Autosave & Sync to AudioConfig (Legacy Support)
    useEffect(() => {
        if (timeline) {
            // Map timeline back to legacy audioConfig for ProjectPreviewPanel compatibility
            const narrTrack = timeline.tracks.find((t) => t.id === 'narration');
            const bgmTrack = timeline.tracks.find((t) => t.id === 'bgm');

            const narrClip = narrTrack?.clips[0];
            const bgmClip = bgmTrack?.clips[0];

            // DEBUG: Trace autosave payload
            console.log('Autosaving timeline:', timeline);
            console.log('Saving audioConfig:', {
                bgmVol: bgmTrack?.volume ?? 1,
                bgmClipVol: bgmClip?.volume ?? 1,
                narrTrackVol: narrTrack?.volume,
                calcBgm: (bgmTrack?.volume ?? 1) * (bgmClip?.volume ?? 1),
            });

            updateAdData({
                audioTimeline: timeline,
                audioConfig: {
                    narration: {
                        enabled: narrTrack?.enabled ?? true,
                        volume: narrTrack?.volume ?? 1,
                        offsetSec: narrClip?.startSec ?? 0,
                        trimStart: narrClip?.inSec ?? 0,
                        trimEnd: narrClip?.outSec || undefined,
                        fadeInSec: narrClip?.fadeInSec ?? 0,
                        fadeOutSec: narrClip?.fadeOutSec ?? 0,
                    },
                    background: {
                        enabled: bgmTrack?.enabled ?? true,
                        volume: (bgmTrack?.volume ?? 1) * (bgmClip?.volume ?? 1),
                        offsetSec: bgmClip?.startSec ?? 0,
                        trimStart: bgmClip?.inSec ?? 0,
                        trimEnd: bgmClip?.outSec || undefined,
                        fadeInSec: bgmClip?.fadeInSec ?? 0,
                        fadeOutSec: bgmClip?.fadeOutSec ?? 0,
                    },
                },
            });
        }
    }, [timeline, updateAdData]);

    // Lock Body Scroll
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    // Dragging State
    const [dragState, setDragState] = useState<{
        type: 'move' | 'trim-start' | 'trim-end';
        clipId: string;
        trackId: string;
        startX: number;
        initialStart: number;
        initialIn: number;
        initialOut: number;
    } | null>(null);

    // Mouse Move (Global)
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragState || !timeline) return;

            const deltaPixels = e.clientX - dragState.startX;
            const deltaSec = deltaPixels / zoom;

            setTimeline((prev) => {
                if (!prev) return null;
                const newTracks = prev.tracks.map((track) => {
                    if (track.id !== dragState.trackId) return track;

                    return {
                        ...track,
                        clips: track.clips.map((clip) => {
                            if (clip.id !== dragState.clipId) return clip;

                            const newClip = { ...clip };

                            if (dragState.type === 'move') {
                                newClip.startSec = Math.max(0, dragState.initialStart + deltaSec);
                            } else if (dragState.type === 'trim-start') {
                                const change = deltaSec;
                                newClip.startSec = Math.max(0, dragState.initialStart + change);
                                newClip.inSec = Math.max(0, dragState.initialIn + change);
                            } else if (dragState.type === 'trim-end') {
                                const change = deltaSec;
                                newClip.outSec = Math.max(newClip.inSec + 0.1, dragState.initialOut + change);
                            }

                            return newClip;
                        }),
                    };
                });

                // Recalculate duration
                const maxEnd = newTracks.reduce((max, t) => {
                    return Math.max(
                        max,
                        t.clips.reduce((tm, c) => Math.max(tm, c.startSec + ((c.outSec || 30) - c.inSec)), 0)
                    );
                }, 0);

                return { ...prev, tracks: newTracks, durationSec: maxEnd };
            });
        };

        const handleMouseUp = () => {
            setDragState(null);
        };

        if (dragState) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragState, zoom, timeline]);

    const handleClipMouseDown = React.useCallback(
        (e: React.MouseEvent, clipId: string, trackId: string, type: 'move' | 'trim-start' | 'trim-end') => {
            e.stopPropagation();
            const track = timeline?.tracks.find((t) => t.id === trackId);
            const clip = track?.clips.find((c) => c.id === clipId);
            if (!clip) return;

            setDragState({
                type,
                clipId,
                trackId,
                startX: e.clientX,
                initialStart: clip.startSec,
                initialIn: clip.inSec,
                initialOut: clip.outSec || clip.inSec + 30, // Fallback
            });
            setSelectedClipId(clipId);
            setSelectedTrackId(trackId);
        },
        [timeline]
    );

    const handleVolumeChange = React.useCallback((trackId: string, newVolume: number) => {
        setTimeline((prev) => {
            if (!prev) return null;
            return {
                ...prev,
                tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, volume: newVolume } : t)),
            };
        });
    }, []);

    const handleClipUpdate = React.useCallback(() => {
        // Placeholder for future clip updates
    }, []);

    const handleClipMouseDownWrapper = React.useCallback(
        (e: React.MouseEvent, clipId: string, trackId: string, type: 'move' | 'trim-start' | 'trim-end') => {
            handleClipMouseDown(e, clipId, trackId, type);
        },
        [handleClipMouseDown]
    );

    if (!isOpen || !timeline) return null;

    const handlePlayPause = () => {
        if (isPlaying) pause();
        else play();
    };

    return (
        <div
            className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            style={{ zIndex: 9999 }}
        >
            <div className="relative w-[92vw] max-w-[860px] h-[80vh] max-h-[520px] bg-background border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="h-14 px-4 flex items-center justify-between border-b border-black/5 dark:border-white/5 bg-card/50 shrink-0">
                    <div className="flex items-center gap-4">
                        <h2 className="text-base font-semibold text-foreground">Editar Áudio</h2>
                        <div className="h-4 w-px bg-black/10 dark:bg-white/10" />
                        <button
                            onClick={handleAutoZoom}
                            className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary text-xs font-medium rounded-full hover:bg-primary/20 transition-colors"
                        >
                            <Wand2 size={12} /> Ajuste Automático
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                pause();
                                onClose();
                            }}
                            className="p-2 text-slate-400 hover:text-foreground rounded-full hover:bg-black/5 dark:bg-white/5 transition-colors"
                        >
                            <span className="sr-only">Fechar</span>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-hidden relative flex flex-col bg-neutral-950/50">
                    {/* Toolbar */}
                    <div className="h-10 border-b border-black/5 dark:border-white/5 bg-muted/5 flex items-center px-4 gap-2 shrink-0">
                        <button
                            onClick={() => {
                                if (!selectedClipId || !timeline) return;

                                setTimeline((prev) => {
                                    if (!prev) return null;
                                    let hasChanges = false;

                                    const newTracks = prev.tracks.map((track) => {
                                        const clipIndex = track.clips.findIndex((c) => c.id === selectedClipId);
                                        if (clipIndex === -1) return track;

                                        const clip = track.clips[clipIndex];

                                        // Check if cursor is inside clip
                                        // Clip absolute start: clip.startSec
                                        // Clip absolute end: clip.startSec + (clip.outSec - clip.inSec) OR duration...
                                        // Actually easier:
                                        // relativeTime = currentTime - clip.startSec
                                        // If relativeTime > 0 and relativeTime < duration

                                        const clipDuration = (clip.outSec > 0 ? clip.outSec : 30) - clip.inSec;
                                        const relativeTime = currentTime - clip.startSec;

                                        if (relativeTime <= 0.1 || relativeTime >= clipDuration - 0.1) {
                                            // Too close to edges, don't split
                                            return track;
                                        }

                                        hasChanges = true;

                                        // Split!
                                        // Clip 1: Keep same start, modify outSec
                                        // New OutSec = Clip.inSec + relativeTime
                                        const clip1 = { ...clip, outSec: clip.inSec + relativeTime };

                                        // Clip 2: New start, new inSec, same outSec (original)
                                        // New Start = currentTime
                                        // New InSec = clip.inSec + relativeTime
                                        const clip2 = {
                                            ...clip,
                                            id: uuidv4(),
                                            startSec: currentTime,
                                            inSec: clip.inSec + relativeTime,
                                            name: `${clip.name} (Part 2)`,
                                        };

                                        const newClips = [...track.clips];
                                        newClips.splice(clipIndex, 1, clip1, clip2);

                                        return { ...track, clips: newClips };
                                    });

                                    const maxEnd = newTracks.reduce((max, t) => {
                                        return Math.max(
                                            max,
                                            t.clips.reduce(
                                                (tm, c) => Math.max(tm, c.startSec + ((c.outSec || 30) - c.inSec)),
                                                0
                                            )
                                        );
                                    }, 0);

                                    if (!hasChanges) return prev;
                                    return { ...prev, tracks: newTracks, durationSec: maxEnd };
                                });
                            }}
                            className="p-1.5 text-slate-400 hover:text-foreground hover:bg-black/5 dark:bg-white/5 rounded"
                            title="Dividir (S)"
                        >
                            <Scissors size={14} />
                        </button>
                        <button
                            onClick={() =>
                                selectedClipId &&
                                setTimeline((prev) => {
                                    if (!prev) return null;
                                    const newTracks = prev.tracks.map((t) => ({
                                        ...t,
                                        clips: t.clips.filter((c) => c.id !== selectedClipId),
                                    }));

                                    const maxEnd = newTracks.reduce((max, t) => {
                                        return Math.max(
                                            max,
                                            t.clips.reduce(
                                                (tm, c) => Math.max(tm, c.startSec + ((c.outSec || 30) - c.inSec)),
                                                0
                                            )
                                        );
                                    }, 0);

                                    return {
                                        ...prev,
                                        tracks: newTracks,
                                        durationSec: maxEnd,
                                    };
                                })
                            }
                            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-black/5 dark:bg-white/5 rounded"
                            title="Excluir (Del)"
                        >
                            <Trash2 size={14} />
                        </button>
                        <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-1" />
                        <button className="p-1.5 text-slate-400 hover:text-foreground hover:bg-black/5 dark:bg-white/5 rounded">
                            <Undo2 size={14} />
                        </button>

                        <div className="flex-1" />

                        <div className="flex items-center gap-1 bg-black/20 rounded p-0.5">
                            <button
                                onClick={() => setZoomPercent((z) => Math.max(10, z - 10))}
                                className="p-1 hover:text-foreground text-slate-400"
                            >
                                <ZoomOut size={12} />
                            </button>
                            <span className="text-[10px] w-8 text-center text-slate-500">{zoomPercent}%</span>
                            <button
                                onClick={() => setZoomPercent((z) => Math.min(500, z + 10))}
                                className="p-1 hover:text-foreground text-slate-400"
                            >
                                <ZoomIn size={12} />
                            </button>
                        </div>
                    </div>

                    {/* Timeline Tracks Area */}
                    <div
                        ref={timelineRef}
                        className="flex-1 overflow-x-auto overflow-y-hidden relative custom-scrollbar"
                        onMouseDown={(e) => {
                            // Seek logic
                            if ((e.target as HTMLElement).closest('.clip-item')) return;
                            // Check if clicking playhead handle
                            if ((e.target as HTMLElement).closest('.playhead-handle')) return;

                            const rect = e.currentTarget.getBoundingClientRect();
                            const scrollLeft = e.currentTarget.scrollLeft;
                            const x = e.clientX - rect.left + scrollLeft - HEADER_WIDTH;
                            const t = Math.max(0, x / zoom);
                            seek(t);
                            setSelectedClipId(null);
                        }}
                    >
                        <div
                            className="min-w-full h-full relative"
                            style={{ width: `${getTimelineWidth(timeline.durationSec, zoom) + HEADER_WIDTH}px` }}
                        >
                            <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-sm border-b border-black/5 dark:border-white/5">
                                <TimeRuler
                                    zoom={zoom}
                                    duration={timeline.durationSec}
                                    width={getTimelineWidth(timeline.durationSec, zoom) + HEADER_WIDTH}
                                    offset={HEADER_WIDTH}
                                />
                            </div>

                            <div className="relative pt-4 pb-10 px-0">
                                {/* Playhead Line */}
                                <div
                                    className="absolute top-0 bottom-0 w-px bg-red-500 z-40 group cursor-ew-resize hover:w-0.5 transition-all"
                                    style={{ left: `${timeToX(dragTime ?? currentTime, zoom) + HEADER_WIDTH}px` }}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();

                                        const wasPlaying = isPlaying;
                                        if (wasPlaying) pause();

                                        const handleMouseMove = (ev: MouseEvent) => {
                                            if (!timelineRef.current) return;
                                            const rect = timelineRef.current.getBoundingClientRect();
                                            const scrollLeft = timelineRef.current.scrollLeft;
                                            const x = ev.clientX - rect.left + scrollLeft - HEADER_WIDTH;
                                            const t = Math.max(0, x / zoom);

                                            // Update local drag state (visual only) - cheap!
                                            setDragTime(t);
                                        };

                                        const handleMouseUp = (ev: MouseEvent) => {
                                            window.removeEventListener('mousemove', handleMouseMove);
                                            window.removeEventListener('mouseup', handleMouseUp);

                                            // Final calculate to ensure we seek to where user dropped
                                            if (!timelineRef.current) return;
                                            const rect = timelineRef.current.getBoundingClientRect();
                                            const scrollLeft = timelineRef.current.scrollLeft;
                                            const x = ev.clientX - rect.left + scrollLeft - HEADER_WIDTH;
                                            const t = Math.max(0, x / zoom);

                                            setDragTime(null);
                                            seek(t); // Expensive seek only once at the end
                                            if (wasPlaying) play();
                                        };

                                        window.addEventListener('mousemove', handleMouseMove);
                                        window.addEventListener('mouseup', handleMouseUp);
                                    }}
                                >
                                    <div className="playhead-handle w-3 h-3 bg-red-500 -ml-1.5 transform rotate-45 -mt-1.5 shadow-sm group-hover:scale-125 transition-transform" />
                                </div>

                                <div className="space-y-4 py-2">
                                    {timeline.tracks.map((track) => (
                                        <div
                                            key={track.id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedTrackId(track.id);
                                            }}
                                            className={`${selectedTrackId === track.id ? 'bg-black/5 dark:bg-white/5 ring-1 ring-white/10' : ''}`}
                                        >
                                            <TrackLane
                                                track={track}
                                                zoom={zoom}
                                                audioBuffers={audioBuffers}
                                                selectedClipId={selectedClipId}
                                                onSelectClip={setSelectedClipId}
                                                onUpdateClip={handleClipUpdate}
                                                onMouseDown={handleClipMouseDownWrapper}
                                                onVolumeChange={handleVolumeChange}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="h-16 border-t border-black/5 dark:border-white/5 bg-card flex items-center justify-between px-6 shrink-0 z-20">
                    <div className="flex items-center gap-4">
                        <span className="font-mono text-xl font-medium tabular-nums min-w-[80px]">
                            {Math.floor(currentTime / 60)}:
                            {Math.floor(currentTime % 60)
                                .toString()
                                .padStart(2, '0')}
                            <span className="text-sm text-slate-500">.{(currentTime % 1).toFixed(1).substring(2)}</span>
                        </span>
                    </div>

                    <div className="flex items-center gap-4 absolute left-1/2 -translate-x-1/2">
                        <button
                            onClick={() => seek(Math.max(0, currentTime - 5))}
                            className="p-2 text-slate-400 hover:text-foreground rounded-full hover:bg-black/10 dark:bg-white/10"
                            title="-5s"
                        >
                            <span className="text-xs font-bold">-5s</span>
                        </button>
                        <button
                            className="w-12 h-12 bg-primary text-slate-900 rounded-full flex items-center justify-center hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                            onClick={handlePlayPause}
                            disabled={!isReady}
                        >
                            {isPlaying ? (
                                <Pause className="fill-current w-5 h-5" />
                            ) : (
                                <Play className="fill-current ml-1 w-5 h-5" />
                            )}
                        </button>
                        <button
                            onClick={() => seek(currentTime + 5)}
                            className="p-2 text-slate-400 hover:text-foreground rounded-full hover:bg-black/10 dark:bg-white/10"
                            title="+5s"
                        >
                            <span className="text-xs font-bold">+5s</span>
                        </button>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => {
                                pause();
                                // Force save timeline state one last time before closing
                                if (timeline) {
                                    const narrTrack = timeline.tracks.find((t) => t.id === 'narration');
                                    const bgmTrack = timeline.tracks.find((t) => t.id === 'bgm');
                                    const narrClip = narrTrack?.clips[0];
                                    const bgmClip = bgmTrack?.clips[0];

                                    const narrationVolume = narrTrack?.volume ?? 1;
                                    const backgroundVolume = (bgmTrack?.volume ?? 1) * (bgmClip?.volume ?? 1);

                                    // DEBUG: Check coupling
                                    console.log('Final Save:', { narrationVolume, backgroundVolume });

                                    updateAdData({
                                        audioTimeline: timeline,
                                        audioConfig: {
                                            narration: {
                                                enabled: narrTrack?.enabled ?? true,
                                                volume: narrationVolume,
                                                offsetSec: narrClip?.startSec ?? 0,
                                                trimStart: narrClip?.inSec ?? 0,
                                                trimEnd: narrClip?.outSec || undefined,
                                                fadeInSec: narrClip?.fadeInSec ?? 0,
                                                fadeOutSec: narrClip?.fadeOutSec ?? 0,
                                            },
                                            background: {
                                                enabled: bgmTrack?.enabled ?? true,
                                                volume: backgroundVolume,
                                                offsetSec: bgmClip?.startSec ?? 0,
                                                trimStart: bgmClip?.inSec ?? 0,
                                                trimEnd: bgmClip?.outSec || undefined,
                                                fadeInSec: bgmClip?.fadeInSec ?? 0,
                                                fadeOutSec: bgmClip?.fadeOutSec ?? 0,
                                            },
                                        },
                                    });
                                }
                                onClose();
                            }}
                            className="px-6 py-2 bg-primary text-slate-900 font-semibold rounded-lg hover:bg-primary/90 transition-colors"
                        >
                            Salvar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
