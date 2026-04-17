import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Check, RotateCcw, Trash2, Scissors, Split, Undo2, GripVertical } from 'lucide-react';
import { MediaTake } from '../types';
import { cn, generateId } from '../lib/utils';
import { SpeedPresetType } from '../lib/speedRemapping';

interface TrimModalProps {
    take: MediaTake;
    onSave: (takeId: string, newTrim: { start: number; end: number; speedPresetId?: SpeedPresetType }) => void;
    onClose: () => void;
}

interface LocalSegment {
    id: string;
    start: number;
    end: number;
}

export const TrimModal = ({ take, onSave, onClose }: TrimModalProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);

    // State
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(take.trim.start);
    const [duration, setDuration] = useState(take.originalDurationSeconds || 0);

    const [localSpeedPreset] = useState<SpeedPresetType>(take.speedPresetId || 'normal');

    // Init with the SINGLE trim from the take
    const [segments, setSegments] = useState<LocalSegment[]>([
        {
            id: generateId(),
            start: take.trim.start,
            end: take.trim.end,
        },
    ]);
    const [activeSegmentId, setActiveSegmentId] = useState<string>(segments[0].id);

    // History for Undo
    const [history, setHistory] = useState<LocalSegment[][]>([]);

    const addToHistory = useCallback(() => {
        setHistory((prev) => [...prev, segments]);
    }, [segments]);

    const handleUndo = () => {
        if (history.length === 0) return;
        const previousState = history[history.length - 1];
        setSegments(previousState);
        setHistory((prev) => prev.slice(0, -1));
        if (!previousState.find((s) => s.id === activeSegmentId)) {
            setActiveSegmentId(previousState[0].id);
        }
    };

    // Initial load & Metadata
    const handleLoadedMetadata = () => {
        if (videoRef.current && !isNaN(videoRef.current.duration)) {
            if (Math.abs(videoRef.current.duration - duration) > 0.1 || duration === 0) {
                const newDuration = videoRef.current.duration;
                setDuration(newDuration);
                setSegments((prev) =>
                    prev.map((s) => {
                        if (s.end === 0 || s.end > newDuration) return { ...s, end: newDuration };
                        return s;
                    })
                );
            }
        }
    };

    useEffect(() => {
        if (videoRef.current && segments.length === 1) {
            // Ensure we start at the trim start
            if (videoRef.current.currentTime < segments[0].start) {
                videoRef.current.currentTime = segments[0].start;
            }
        }
    }, []);

    const handleTimeUpdate = () => {
        if (!videoRef.current) return;
        if (isDragging === 'playhead' || isDragging === 'range') return;

        const time = videoRef.current.currentTime;
        setCurrentTime(time);

        // ENFORCE PREVIEW BOUNDARIES (Single Segment Rule)
        if (isPlaying && segments.length === 1) {
            const seg = segments[0];
            // If we've passed the end, stop and reset to start
            if (time >= seg.end) {
                videoRef.current.pause();
                videoRef.current.currentTime = seg.start;
                setIsPlaying(false);
                return;
            }
        }

        const currentSeg = segments.find((s) => time >= s.start && time <= s.end);

        if (videoRef.current.playbackRate !== 1) videoRef.current.playbackRate = 1;

        if (currentSeg && currentSeg.id !== activeSegmentId && isPlaying) {
            setActiveSegmentId(currentSeg.id);
        }
    };

    const handleEnded = () => {
        setIsPlaying(false);
        if (segments.length === 1 && videoRef.current) {
            videoRef.current.currentTime = segments[0].start;
        } else if (videoRef.current) {
            videoRef.current.currentTime = 0;
        }
    };

    const togglePlay = () => {
        if (!videoRef.current) return;
        if (isPlaying) {
            videoRef.current.pause();
        } else {
            // Enforce Start Boundary before playing
            if (segments.length === 1) {
                const seg = segments[0];
                const tolerance = 0.1;
                if (
                    videoRef.current.currentTime < seg.start - tolerance ||
                    videoRef.current.currentTime >= seg.end - tolerance
                ) {
                    videoRef.current.currentTime = seg.start;
                }
            }
            videoRef.current.play().catch(() => {});
        }
        setIsPlaying(!isPlaying);
    };

    // --- SPLIT LOGIC ---
    const handleSplit = () => {
        const activeSeg = segments.find((s) => s.id === activeSegmentId);
        if (!activeSeg) return;

        if (currentTime > activeSeg.start + 0.1 && currentTime < activeSeg.end - 0.1) {
            addToHistory();
            const newSeg1 = { ...activeSeg, end: currentTime };
            const newSeg2 = {
                id: generateId(),
                start: currentTime,
                end: activeSeg.end,
            };

            setSegments((prev) => {
                const index = prev.findIndex((s) => s.id === activeSegmentId);
                const newList = [...prev];
                newList.splice(index, 1, newSeg1, newSeg2);
                return newList;
            });
            setActiveSegmentId(newSeg2.id);
        } else {
            alert('Posicione a agulha dentro do segmento selecionado para dividir.');
        }
    };

    // --- DELETE LOGIC ---
    const handleDelete = () => {
        if (segments.length <= 1) {
            alert('Você não pode excluir o último segmento. Use Cancelar se quiser sair.');
            return;
        }
        const confirmDelete = window.confirm('Excluir este corte?');
        if (!confirmDelete) return;

        addToHistory();
        setSegments((prev) => {
            const newList = prev.filter((s) => s.id !== activeSegmentId);
            return newList;
        });
        setActiveSegmentId(segments.find((s) => s.id !== activeSegmentId)?.id || '');
    };

    // --- RESET ---
    const handleReset = () => {
        if (window.confirm('Isso apagará todos os cortes e voltará ao original. Continuar?')) {
            addToHistory();
            const newId = generateId();
            setSegments([{ id: newId, start: 0, end: duration }]);
            setActiveSegmentId(newId);
            setHistory([]);
            if (videoRef.current) videoRef.current.currentTime = 0;
        }
    };

    // --- SAVE ---
    const handleSave = () => {
        // Enforce Single Segment Rule
        if (segments.length !== 1) {
            alert(
                'Atenção: Para confirmar, deve haver apenas UM segmento contínuo.\n\nPor favor, exclua os cortes indesejados antes de salvar.'
            );
            return;
        }

        const finalSeg = segments[0];
        // Now include the speed config as well if changed
        onSave(take.id, {
            start: finalSeg.start,
            end: finalSeg.end,
            speedPresetId: localSpeedPreset,
        });
    };

    // --- DRAGGING HANDLES & SCRUBBING ---
    const [isDragging, setIsDragging] = useState<'start' | 'end' | 'playhead' | 'range' | null>(null);
    const dragStartSegments = useRef<LocalSegment[]>([]);
    const rangeDragStartMouseTime = useRef<number>(0);
    const rangeDragStartSegmentStart = useRef<number>(0);

    const handleMouseDown = (e: React.MouseEvent, type: 'playhead') => {
        setIsDragging(type);
        handleMouseMove(e.nativeEvent);
    };

    const handleHandleMouseDown = (e: React.MouseEvent, type: 'start' | 'end') => {
        e.stopPropagation();
        setIsDragging(type);
        dragStartSegments.current = segments;
    };

    const handleMouseMove = useCallback(
        (e: MouseEvent) => {
            if (!isDragging || !timelineRef.current || duration <= 0) return;

            const rect = timelineRef.current.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const percentage = x / rect.width;
            const newTime = percentage * duration;

            if (isDragging === 'range') {
                const deltaSeconds = newTime - rangeDragStartMouseTime.current;
                const finalStart = rangeDragStartSegmentStart.current + deltaSeconds;

                setSegments((prev) =>
                    prev.map((s) => {
                        if (s.id !== activeSegmentId) return s;

                        const durationLen = s.end - s.start;
                        let newStart = finalStart;
                        let newEnd = finalStart + durationLen;

                        // Boundary checks
                        if (newStart < 0) {
                            newStart = 0;
                            newEnd = durationLen;
                        } else if (newEnd > duration) {
                            newEnd = duration;
                            newStart = duration - durationLen;
                        }

                        // Sync video preview to the NEW START of the take
                        if (videoRef.current) {
                            videoRef.current.currentTime = newStart;
                        }

                        return { ...s, start: newStart, end: newEnd };
                    })
                );
                return;
            }

            setSegments((prev) =>
                prev.map((s) => {
                    if (s.id !== activeSegmentId) return s;

                    if (isDragging === 'start') {
                        const newStart = Math.min(newTime, s.end - 0.2);
                        return { ...s, start: newStart };
                    } else if (isDragging === 'end') {
                        const newEnd = Math.max(newTime, s.start + 0.2);
                        return { ...s, end: newEnd };
                    }
                    return s;
                })
            );

            if (videoRef.current) videoRef.current.currentTime = newTime;
        },
        [isDragging, duration, activeSegmentId, currentTime]
    );

    const handleMouseUp = useCallback(() => {
        if (isDragging === 'start' || isDragging === 'end' || isDragging === 'range') {
            setHistory((prev) => [...prev, dragStartSegments.current]);
        }
        setIsDragging(null);
    }, [isDragging]);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [isDragging, handleMouseMove, handleMouseUp]);

    // Helpers
    const formatTime = (seconds: number) => {
        if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 10);
        return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
    };

    const getPercent = (time: number) => {
        if (duration <= 0) return 0;
        return (time / duration) * 100;
    };

    const activeSegment = segments.find((s) => s.id === activeSegmentId);

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm p-4">
            <div className="bg-background border border-border rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col overflow-hidden max-h-[95vh] relative z-[101]">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shrink-0">
                    <div className="flex flex-col">
                        <h3 className="font-semibold text-foreground flex items-center gap-2">
                            <Scissors className="w-4 h-4 text-primary" />
                            Editor de Cortes
                        </h3>
                        {take.fileName && (
                            <span className="text-xs text-muted-foreground ml-6 truncate max-w-[300px]">
                                {take.fileName}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleUndo}
                            disabled={history.length === 0}
                            className="p-2 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-xs flex gap-1 items-center mr-2"
                            title="Desfazer"
                        >
                            <Undo2 className="w-4 h-4" />
                            <span className="hidden sm:inline">Desfazer</span>
                        </button>

                        <button
                            onClick={handleReset}
                            className="p-2 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors text-xs flex gap-1 items-center"
                            title="Resetar"
                        >
                            <RotateCcw className="w-4 h-4" />
                            <span className="hidden sm:inline">Resetar</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden min-h-0 bg-background">
                    {/* Video Area */}
                    <div className="w-full h-[50vh] min-h-[300px] shrink-0 bg-black flex items-center justify-center relative p-4 border-b border-border/50">
                        {take.type === 'video' ? (
                            <video
                                ref={videoRef}
                                src={take.url}
                                className="h-full w-auto max-w-full object-contain rounded-lg shadow-2xl bg-black"
                                onTimeUpdate={handleTimeUpdate}
                                onLoadedMetadata={handleLoadedMetadata}
                                onClick={togglePlay}
                                onEnded={handleEnded}
                            />
                        ) : (
                            <img
                                src={take.url}
                                className="h-full w-auto max-w-full object-contain rounded-lg shadow-2xl bg-black"
                                alt="Preview"
                            />
                        )}

                        {!isPlaying && take.type === 'video' && (
                            <button
                                onClick={togglePlay}
                                className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/10 transition-colors group z-10"
                            >
                                <div className="w-16 h-16 bg-black/20 dark:bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center group-hover:scale-110 transition-transform shadow-xl">
                                    <Play className="w-8 h-8 text-foreground fill-white ml-1" />
                                </div>
                            </button>
                        )}
                    </div>

                    {/* Controls Container */}
                    <div className="flex flex-col p-4 gap-4">
                                {/* Tools */}
                                <div className="min-h-[60px] flex items-center justify-center">
                                    <div className="flex items-center justify-center gap-6">
                                        <button
                                            onClick={handleUndo}
                                            disabled={history.length === 0}
                                            className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed group transition-all"
                                        >
                                            <div className="p-2.5 rounded-full bg-muted group-enabled:group-hover:bg-primary group-enabled:group-hover:text-primary-foreground transition-colors">
                                                <Undo2 className="w-4 h-4" />
                                            </div>
                                            <span className="text-[10px] uppercase font-bold tracking-wider">
                                                Desfazer
                                            </span>
                                        </button>

                                        <button
                                            onClick={handleSplit}
                                            disabled={!activeSegment}
                                            className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed group transition-all"
                                        >
                                            <div className="p-2.5 rounded-full bg-muted group-enabled:group-hover:bg-primary group-enabled:group-hover:text-primary-foreground transition-colors">
                                                <Split className="w-4 h-4 rotate-90" />
                                            </div>
                                            <span className="text-[10px] uppercase font-bold tracking-wider">
                                                Dividir
                                            </span>
                                        </button>

                                        <button
                                            onClick={handleDelete}
                                            disabled={!activeSegment || segments.length <= 1}
                                            className="flex flex-col items-center gap-1 text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed group transition-all"
                                        >
                                            <div className="p-2.5 rounded-full bg-muted group-enabled:group-hover:bg-destructive/10 group-enabled:group-hover:text-destructive transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </div>
                                            <span className="text-[10px] uppercase font-bold tracking-wider">
                                                Excluir
                                            </span>
                                        </button>
                                    </div>
                                </div>

                                {/* Timeline Track (Bottom) */}
                                <div
                                    className="pb-4 select-none relative w-full"
                                    ref={timelineRef}
                                    onMouseDown={(e) => handleMouseDown(e, 'playhead')}
                                >
                                    {/* Time Ruler */}
                                    <div className="flex justify-between text-xs font-mono text-muted-foreground mb-1 pointer-events-none">
                                        <span>{formatTime(0)}</span>
                                        <span>{formatTime(duration)}</span>
                                    </div>

                                    {/* Track Container */}
                                    <div className="relative h-16 bg-muted/20 rounded-lg overflow-hidden border border-border cursor-pointer group">
                                        {/* Segments Loop */}
                                        {segments.map((seg) => {
                                            const isActive = seg.id === activeSegmentId;
                                            return (
                                                <div
                                                    key={seg.id}
                                                    className={cn(
                                                        'absolute top-2 bottom-2 rounded-md border cursor-pointer transition-all overflow-visible',
                                                        isActive
                                                            ? 'bg-primary/20 border-primary z-10 shadow-[0_0_15px_rgba(34,197,94,0.3)]'
                                                            : 'bg-muted/50 border-border hover:bg-muted'
                                                    )}
                                                    style={{
                                                        left: `${getPercent(seg.start)}%`,
                                                        width: `${getPercent(seg.end - seg.start)}%`,
                                                    }}
                                                    onMouseDown={(e) => {
                                                        e.stopPropagation();
                                                        setActiveSegmentId(seg.id);
                                                        if (isActive) {
                                                            setIsDragging('range');
                                                            dragStartSegments.current = segments;
                                                            const rect = timelineRef.current?.getBoundingClientRect();
                                                            if (rect) {
                                                                const x = e.clientX - rect.left;
                                                                const mouseTime = (x / rect.width) * duration;
                                                                rangeDragStartMouseTime.current = mouseTime;
                                                                rangeDragStartSegmentStart.current = seg.start;
                                                            }
                                                        }
                                                    }}
                                                >
                                                    <div className="w-full h-full opacity-30 flex items-center justify-center pointer-events-none group-hover:opacity-50 transition-opacity">
                                                        <span className="text-[10px] text-foreground/50 select-none flex items-center gap-1">
                                                            <GripVertical className="w-2 h-2" />
                                                            {formatTime(seg.end - seg.start)}
                                                        </span>
                                                    </div>

                                                    {/* Drag Handles */}
                                                    {isActive && (
                                                        <>
                                                            <div
                                                                className="absolute top-1/2 -translate-y-1/2 left-0 w-8 -ml-4 h-12 cursor-ew-resize flex items-center justify-center group/handle z-20 select-none touch-none"
                                                                onMouseDown={(e) => handleHandleMouseDown(e, 'start')}
                                                            >
                                                                <div className="relative h-8 w-4 bg-red-500 rounded-l-sm group-hover/handle:bg-orange-500 transition-colors shadow-lg flex items-center justify-center scale-90 group-hover/handle:scale-105 transition-transform">
                                                                    <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-r-[6px] border-r-white/50" />
                                                                </div>
                                                            </div>

                                                            <div
                                                                className="absolute top-1/2 -translate-y-1/2 right-0 w-8 -mr-4 h-12 cursor-ew-resize flex items-center justify-center group/handle z-20 select-none touch-none"
                                                                onMouseDown={(e) => handleHandleMouseDown(e, 'end')}
                                                            >
                                                                <div className="relative h-8 w-4 bg-red-500 rounded-r-sm group-hover/handle:bg-orange-500 transition-colors shadow-lg flex items-center justify-center scale-90 group-hover/handle:scale-105 transition-transform">
                                                                    <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-white/50" />
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {/* Playhead */}
                                        <div
                                            className="absolute top-0 bottom-0 z-50 w-0"
                                            style={{ left: `${getPercent(currentTime)}%` }}
                                        >
                                            <div
                                                className="absolute -left-4 -right-4 top-0 bottom-0 cursor-grab active:cursor-grabbing flex justify-center group touch-none"
                                                onMouseDown={(e) => {
                                                    e.stopPropagation();
                                                    handleMouseDown(e, 'playhead');
                                                }}
                                            >
                                                <div className="w-0.5 h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)] relative">
                                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[12px] border-t-red-500 group-hover:border-t-orange-500 transition-colors drop-shadow-md scale-110 group-hover:scale-125 transition-transform" />
                                                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground border border-border text-[10px] font-bold px-2 py-1 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                                                        {formatTime(currentTime)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-border bg-card flex justify-end gap-3 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 hover:bg-muted text-muted-foreground rounded-lg transition-colors text-sm font-medium border border-transparent hover:border-border"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-8 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-lg transition-transform hover:scale-105 active:scale-95 flex items-center gap-2 text-sm shadow-lg shadow-green-900/10"
                    >
                        <Check className="w-4 h-4" />
                        Confirmar ({segments.length} cortes)
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
