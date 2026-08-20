import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Check, RotateCcw, Trash2, Scissors, Split, Undo2, GripVertical, CopyPlus, ArrowRight, Sparkles, Crop, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { MediaTake } from '../types';
import { cn, generateId } from '../lib/utils';
import { SpeedPresetType } from '../lib/speedRemapping';
import { ConfirmDialog } from './ConfirmDialog';
import { FramingEditor } from './FramingEditor';

/** Enquadramento 1:1 opcional emitido pelo editor junto dos cortes. */
export interface TrimFramingPayload {
    framing?: { x: number; y: number };
    ignoreSquare?: boolean;
}

interface TrimModalProps {
    take: MediaTake;
    onSave: (
        takeId: string,
        newTrims: Array<{ start: number; end: number; speedPresetId?: SpeedPresetType; kind: 'primary' | 'created' }>,
        framing?: TrimFramingPayload
    ) => void;
    onClose: () => void;
    /**
     * Fluxo de curadoria em lote: salva os ajustes deste take (sem processar)
     * e volta à pasta para o usuário escolher o próximo.
     */
    onStage?: (
        takeId: string,
        newTrims: Array<{ start: number; end: number; speedPresetId?: SpeedPresetType; kind: 'primary' | 'created' }>,
        framing?: TrimFramingPayload
    ) => void;
    /** Reabre o editor com cortes salvos anteriormente (carrinho da curadoria). */
    initialTrims?: Array<{ start: number; end: number; kind: 'primary' | 'created' }>;
    /** Progresso da curadoria exibido no cabeçalho (posição, aprovados e fila). */
    queue?: { position: number; total: number; approved: number; staged?: number };
    /** Habilita o modo de enquadramento 1:1 (só na curadoria do acervo). */
    framingEnabled?: boolean;
    initialFraming?: { x: number; y: number };
    initialIgnoreSquare?: boolean;
}

interface LocalSegment {
    id: string;
    start: number;
    end: number;
    kind: 'primary' | 'created';
}

export const TrimModal = ({ take, onSave, onClose, onStage, initialTrims, queue, framingEnabled = false, initialFraming, initialIgnoreSquare = false }: TrimModalProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);

    // State
    const [isPlaying, setIsPlaying] = useState(false);
    // Enquadramento 1:1 (curadoria): modo aberto + centro do crop + "ignorar".
    const [framingMode, setFramingMode] = useState(false);
    const [framing, setFraming] = useState<{ x: number; y: number } | undefined>(initialFraming);
    const [ignoreSquare, setIgnoreSquare] = useState<boolean>(initialIgnoreSquare);
    const [currentTime, setCurrentTime] = useState(initialTrims?.[0]?.start ?? take.trim.start);
    const [duration, setDuration] = useState(take.originalDurationSeconds || 0);
    const [confirmDialog, setConfirmDialog] = useState<{
        title: string;
        message: string;
        confirmLabel: string;
        onConfirm: () => void;
    } | null>(null);

    const [localSpeedPreset] = useState<SpeedPresetType>(take.speedPresetId || 'normal');

    // Init with the SINGLE trim from the take — ou com os cortes salvos no
    // carrinho da curadoria, quando o take é reaberto para ajuste.
    const [segments, setSegments] = useState<LocalSegment[]>(() => (
        initialTrims && initialTrims.length
            ? initialTrims.map((trim) => ({
                id: generateId(),
                start: trim.start,
                end: trim.end,
                kind: trim.kind,
            }))
            : [
                {
                    id: generateId(),
                    start: take.trim.start,
                    end: take.trim.end,
                    kind: 'primary',
                },
            ]
    ));
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
        // Durante qualquer arraste quem manda na agulha é o mouse, não o vídeo.
        if (isDragging) return;

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
        if (activeSeg.kind === 'created') {
            toast.info('A faixa azul não pode ser dividida. Arraste-a para posicionar e use as alças para ajustar a duração.');
            return;
        }

        if (currentTime > activeSeg.start + 0.1 && currentTime < activeSeg.end - 0.1) {
            addToHistory();
            const newSeg1 = { ...activeSeg, end: currentTime };
            const newSeg2 = {
                id: generateId(),
                start: currentTime,
                end: activeSeg.end,
                kind: 'primary' as const,
            };

            setSegments((prev) => {
                const index = prev.findIndex((s) => s.id === activeSegmentId);
                const newList = [...prev];
                newList.splice(index, 1, newSeg1, newSeg2);
                return newList;
            });
            setActiveSegmentId(newSeg2.id);
        } else {
            toast.warning('Posicione a agulha dentro do segmento selecionado para dividir.');
        }
    };

    // Cria uma segunda seleção com exatamente a duração do recorte verde. A
    // faixa azul pode ser arrastada pelo vídeo e será salva como um novo take.
    const handleCreateTake = () => {
        const active = segments.find((segment) => segment.id === activeSegmentId);
        const source = active?.kind === 'primary'
            ? active
            : segments.find((segment) => segment.kind === 'primary');
        if (!source || duration <= 0) return;

        const segmentDuration = Math.min(duration, Math.max(0.2, source.end - source.start));
        let start = source.end;
        if (start + segmentDuration > duration) {
            start = Math.max(0, source.start - segmentDuration);
        }
        const created: LocalSegment = {
            id: generateId(),
            start,
            end: Math.min(duration, start + segmentDuration),
            kind: 'created',
        };

        addToHistory();
        setSegments((current) => [...current, created]);
        setActiveSegmentId(created.id);
        setCurrentTime(created.start);
        if (videoRef.current) videoRef.current.currentTime = created.start;
        toast.success('Faixa azul criada.', {
            description: 'Arraste para posicionar e use as alças laterais para aumentar ou diminuir a duração.',
        });
    };

    // --- DELETE LOGIC ---
    const handleDelete = () => {
        if (segments.length <= 1) {
            toast.warning('Você não pode excluir o último segmento. Use Cancelar se quiser sair.');
            return;
        }
        setConfirmDialog({
            title: 'Excluir este corte?',
            message: 'O segmento selecionado será removido.',
            confirmLabel: 'Excluir',
            onConfirm: () => {
                setConfirmDialog(null);
                addToHistory();
                setSegments((prev) => prev.filter((s) => s.id !== activeSegmentId));
                setActiveSegmentId(segments.find((s) => s.id !== activeSegmentId)?.id || '');
            },
        });
    };

    // --- RESET ---
    const handleReset = () => {
        setConfirmDialog({
            title: 'Voltar ao original?',
            message: 'Isso apagará todos os cortes e restaurará o take inteiro.',
            confirmLabel: 'Restaurar',
            onConfirm: () => {
                setConfirmDialog(null);
                addToHistory();
                const newId = generateId();
                setSegments([{ id: newId, start: 0, end: duration, kind: 'primary' }]);
                setActiveSegmentId(newId);
                setHistory([]);
                if (videoRef.current) videoRef.current.currentTime = 0;
            },
        });
    };

    // --- SAVE ---
    const collectValidTrims = () => {
        const validSegments = segments
            .filter((segment) => segment.end - segment.start >= 0.2)
            .sort((first, second) => first.start - second.start);
        if (validSegments.length === 0) {
            toast.error('Mantenha ao menos um trecho válido antes de confirmar.');
            return null;
        }
        return validSegments.map((segment) => ({
            start: segment.start,
            end: segment.end,
            speedPresetId: localSpeedPreset,
            kind: segment.kind,
        }));
    };

    const framingPayload = (): TrimFramingPayload | undefined =>
        framingEnabled ? { framing, ignoreSquare } : undefined;

    const handleSave = () => {
        const trims = collectValidTrims();
        if (trims) onSave(take.id, trims, framingPayload());
    };

    const handleStage = () => {
        if (!onStage) return;
        const trims = collectValidTrims();
        if (trims) onStage(take.id, trims, framingPayload());
    };

    // --- DRAGGING HANDLES & SCRUBBING ---
    // Motor de arraste 1:1: os movimentos do mouse são coalescidos em um frame
    // de animação (nunca mais de uma atualização por frame) e o seek do vídeo
    // nunca enfileira — a agulha e as alças seguem o mouse na hora e o preview
    // busca o frame mais recente que o decoder conseguir entregar.
    type DragType = 'start' | 'end' | 'playhead' | 'range';
    const [isDragging, setIsDragging] = useState<DragType | null>(null);
    const draggingRef = useRef<DragType | null>(null);
    const dragPointerX = useRef(0);
    const dragFrameRef = useRef<number | null>(null);
    const pendingSeekRef = useRef<number | null>(null);
    const dragStartSegments = useRef<LocalSegment[]>([]);
    const rangeDragStartMouseTime = useRef<number>(0);
    const rangeDragStartSegmentStart = useRef<number>(0);
    const segmentsRef = useRef(segments);
    useEffect(() => {
        segmentsRef.current = segments;
    }, [segments]);

    const seekPreview = useCallback((time: number) => {
        const video = videoRef.current;
        if (!video) return;
        if (video.seeking) {
            pendingSeekRef.current = time;
            return;
        }
        pendingSeekRef.current = null;
        video.currentTime = time;
    }, []);

    const handleSeeked = () => {
        if (pendingSeekRef.current === null) return;
        const next = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (videoRef.current) videoRef.current.currentTime = next;
    };

    const applyDragFrame = useCallback(() => {
        dragFrameRef.current = null;
        const type = draggingRef.current;
        if (!type || !timelineRef.current || duration <= 0) return;

        const rect = timelineRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(dragPointerX.current - rect.left, rect.width));
        const newTime = (x / rect.width) * duration;

        if (type === 'playhead') {
            setCurrentTime(newTime);
            seekPreview(newTime);
            return;
        }

        const current = segmentsRef.current;
        const active = current.find((s) => s.id === activeSegmentId);
        if (!active) return;

        if (type === 'range') {
            const length = active.end - active.start;
            const wanted = rangeDragStartSegmentStart.current + (newTime - rangeDragStartMouseTime.current);
            const newStart = Math.max(0, Math.min(wanted, duration - length));
            if (Math.abs(newStart - active.start) < 0.0001) return;
            setSegments(current.map((s) => (s.id === active.id ? { ...s, start: newStart, end: newStart + length } : s)));
            setCurrentTime(newStart);
            seekPreview(newStart);
            return;
        }

        if (type === 'start') {
            const newStart = Math.max(0, Math.min(newTime, active.end - 0.2));
            setSegments(current.map((s) => (s.id === active.id ? { ...s, start: newStart } : s)));
            setCurrentTime(newStart);
            seekPreview(newStart);
            return;
        }

        const newEnd = Math.min(duration, Math.max(newTime, active.start + 0.2));
        setSegments(current.map((s) => (s.id === active.id ? { ...s, end: newEnd } : s)));
        setCurrentTime(newEnd);
        seekPreview(newEnd);
    }, [activeSegmentId, duration, seekPreview]);

    const scheduleDragFrame = useCallback(() => {
        if (dragFrameRef.current !== null) return;
        dragFrameRef.current = requestAnimationFrame(applyDragFrame);
    }, [applyDragFrame]);

    const beginDrag = (event: React.PointerEvent, type: DragType) => {
        draggingRef.current = type;
        setIsDragging(type);
        dragStartSegments.current = segmentsRef.current;
        dragPointerX.current = event.clientX;
        scheduleDragFrame();
    };

    useEffect(() => {
        if (!isDragging) return;
        const onPointerMove = (event: PointerEvent) => {
            dragPointerX.current = event.clientX;
            scheduleDragFrame();
        };
        const endDrag = () => {
            if (dragFrameRef.current !== null) {
                cancelAnimationFrame(dragFrameRef.current);
                dragFrameRef.current = null;
            }
            applyDragFrame();
            const type = draggingRef.current;
            if (type && type !== 'playhead') {
                setHistory((prev) => [...prev, dragStartSegments.current]);
            }
            draggingRef.current = null;
            setIsDragging(null);
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', endDrag);
            window.removeEventListener('pointercancel', endDrag);
        };
    }, [applyDragFrame, isDragging, scheduleDragFrame]);

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
                            {queue && (
                                <span className="ml-1 inline-flex items-center gap-2 rounded-full border border-blue-400/25 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wide">
                                    <span className="text-blue-300">Take {queue.position} de {queue.total}</span>
                                    <span className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
                                        <span
                                            className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-500"
                                            style={{ width: `${Math.round((queue.approved / Math.max(1, queue.total)) * 100)}%` }}
                                        />
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-emerald-300">
                                        <Sparkles className="h-3 w-3" />
                                        {queue.approved} aprovado{queue.approved === 1 ? '' : 's'}
                                    </span>
                                    {(queue.staged ?? 0) > 0 && (
                                        <span className="inline-flex items-center gap-1 text-sky-300">
                                            <Scissors className="h-3 w-3" />
                                            {queue.staged} na fila
                                        </span>
                                    )}
                                </span>
                            )}
                        </h3>
                        {take.fileName && (
                            <span className="text-xs text-muted-foreground ml-6 truncate max-w-[300px]">
                                {take.fileName}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {framingEnabled && (
                            <button
                                onClick={() => {
                                    const next = !framingMode;
                                    setFramingMode(next);
                                    if (next) {
                                        videoRef.current?.pause();
                                        setIsPlaying(false);
                                    }
                                }}
                                className={cn(
                                    'mr-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition',
                                    framingMode
                                        ? 'border-violet-400/50 bg-violet-500/20 text-violet-200'
                                        : 'border-white/10 text-muted-foreground hover:border-violet-400/40 hover:text-violet-300'
                                )}
                                title="Definir o enquadramento 1:1 deste take (vale para os cortes aprovados)"
                            >
                                <Crop className="w-4 h-4" />
                                <span className="hidden sm:inline">Enquadrar 1:1</span>
                                {(framing || ignoreSquare) && <Check className="w-3 h-3" />}
                            </button>
                        )}
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
                                onSeeked={handleSeeked}
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

                        {framingEnabled && framingMode && (
                            <div className="absolute inset-0 z-30 flex flex-col gap-2 bg-black p-4">
                                <div className="relative min-h-0 flex-1">
                                    <FramingEditor
                                        src={take.url}
                                        type={take.type}
                                        value={framing}
                                        onChange={setFraming}
                                        disabled={ignoreSquare}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-[11px] text-white/70">
                                        Arraste o quadrado — a faixa dentro dele é o que aparece quando o vídeo for 1:1.
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setIgnoreSquare((value) => !value)}
                                        className={cn(
                                            'inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition',
                                            ignoreSquare
                                                ? 'border-red-400/50 bg-red-500/15 text-red-200'
                                                : 'border-white/10 text-white/70 hover:border-red-400/40 hover:text-red-300'
                                        )}
                                    >
                                        <Ban className="w-4 h-4" />
                                        Ignorar no 1:1
                                        <span className={cn('relative h-4 w-8 rounded-full transition', ignoreSquare ? 'bg-red-500' : 'bg-white/20')}>
                                            <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', ignoreSquare ? 'right-0.5' : 'left-0.5')} />
                                        </span>
                                    </button>
                                </div>
                            </div>
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
                                            disabled={!activeSegment || activeSegment.kind === 'created'}
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
                                            onClick={handleCreateTake}
                                            disabled={duration <= 0}
                                            className="group flex flex-col items-center gap-1 text-blue-300 transition-all hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            <div className="rounded-full bg-blue-500/15 p-2.5 transition-colors group-enabled:group-hover:bg-blue-500/25">
                                                <CopyPlus className="h-4 w-4" />
                                            </div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider">
                                                Criar
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
                                    onPointerDown={(e) => beginDrag(e, 'playhead')}
                                >
                                    <div className="mb-2 flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className="h-2.5 w-2.5 rounded-sm border border-primary bg-primary/30" />
                                            Take atual
                                        </span>
                                        {segments.some((segment) => segment.kind === 'created') && (
                                            <span className="inline-flex items-center gap-1.5 text-blue-300">
                                                <span className="h-2.5 w-2.5 rounded-sm border border-blue-400 bg-blue-500/35" />
                                                Novo take · arraste e ajuste a duração pelas alças
                                            </span>
                                        )}
                                    </div>
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
                                            const isCreated = seg.kind === 'created';
                                            return (
                                                <div
                                                    key={seg.id}
                                                    className={cn(
                                                        // Sem transição de posição/tamanho: o segmento precisa colar no
                                                        // mouse durante o arraste, sem efeito elástico.
                                                        'absolute top-2 bottom-2 rounded-md border cursor-pointer transition-colors overflow-visible',
                                                        isActive
                                                            ? isCreated
                                                                ? 'z-20 border-blue-300 bg-blue-500/35 shadow-[0_0_18px_rgba(59,130,246,0.45)]'
                                                                : 'z-10 border-primary bg-primary/20 shadow-[0_0_15px_rgba(34,197,94,0.3)]'
                                                            : isCreated
                                                                ? 'z-10 border-blue-500/60 bg-blue-500/20 hover:bg-blue-500/30'
                                                                : 'border-border bg-muted/50 hover:bg-muted'
                                                    )}
                                                    style={{
                                                        left: `${getPercent(seg.start)}%`,
                                                        width: `${getPercent(seg.end - seg.start)}%`,
                                                    }}
                                                    onPointerDown={(e) => {
                                                        e.stopPropagation();
                                                        setActiveSegmentId(seg.id);
                                                        if (isActive) {
                                                            const rect = timelineRef.current?.getBoundingClientRect();
                                                            if (rect) {
                                                                const x = e.clientX - rect.left;
                                                                rangeDragStartMouseTime.current = (x / rect.width) * duration;
                                                                rangeDragStartSegmentStart.current = seg.start;
                                                            }
                                                            beginDrag(e, 'range');
                                                        }
                                                    }}
                                                >
                                                    <div className="w-full h-full opacity-30 flex items-center justify-center pointer-events-none group-hover:opacity-50 transition-opacity">
                                                        <span className="text-[10px] text-foreground/50 select-none flex items-center gap-1">
                                                            <GripVertical className="w-2 h-2" />
                                                            {formatTime(seg.end - seg.start)}
                                                        </span>
                                                    </div>

                                                    {/* Drag Handles — a faixa azul (novo take) também é redimensionável */}
                                                    {isActive && (
                                                        <>
                                                            <div
                                                                className="absolute top-1/2 -translate-y-1/2 left-0 w-8 -ml-4 h-12 cursor-ew-resize flex items-center justify-center group/handle z-20 select-none touch-none"
                                                                onPointerDown={(e) => {
                                                                    e.stopPropagation();
                                                                    beginDrag(e, 'start');
                                                                }}
                                                            >
                                                                <div className={cn(
                                                                    'relative h-8 w-4 rounded-l-sm transition-colors shadow-lg flex items-center justify-center scale-90 group-hover/handle:scale-105 transition-transform',
                                                                    isCreated
                                                                        ? 'bg-blue-500 group-hover/handle:bg-sky-400'
                                                                        : 'bg-red-500 group-hover/handle:bg-orange-500'
                                                                )}>
                                                                    <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-r-[6px] border-r-white/50" />
                                                                </div>
                                                            </div>

                                                            <div
                                                                className="absolute top-1/2 -translate-y-1/2 right-0 w-8 -mr-4 h-12 cursor-ew-resize flex items-center justify-center group/handle z-20 select-none touch-none"
                                                                onPointerDown={(e) => {
                                                                    e.stopPropagation();
                                                                    beginDrag(e, 'end');
                                                                }}
                                                            >
                                                                <div className={cn(
                                                                    'relative h-8 w-4 rounded-r-sm transition-colors shadow-lg flex items-center justify-center scale-90 group-hover/handle:scale-105 transition-transform',
                                                                    isCreated
                                                                        ? 'bg-blue-500 group-hover/handle:bg-sky-400'
                                                                        : 'bg-red-500 group-hover/handle:bg-orange-500'
                                                                )}>
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
                                                onPointerDown={(e) => {
                                                    e.stopPropagation();
                                                    beginDrag(e, 'playhead');
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
                        Confirmar ({segments.length} {segments.length === 1 ? 'take' : 'takes'})
                    </button>
                    {onStage && (
                        <button
                            onClick={handleStage}
                            className="px-6 py-2 bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-500 hover:to-sky-400 text-white font-bold rounded-lg transition-transform hover:scale-105 active:scale-95 flex items-center gap-2 text-sm shadow-lg shadow-blue-900/30"
                            title="Salva os ajustes deste take (sem processar) e volta à pasta para você escolher o próximo"
                        >
                            Salvar e escolher o próximo
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {confirmDialog && (
                <ConfirmDialog
                    mode="confirm"
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmLabel={confirmDialog.confirmLabel}
                    variant="danger"
                    onConfirm={confirmDialog.onConfirm}
                    onClose={() => setConfirmDialog(null)}
                />
            )}
        </div>,
        document.body
    );
};
