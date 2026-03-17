import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useWizard } from '../context/WizardContext';
import { VideoUpload } from '../components/VideoUpload';
import { TrimModal } from '../components/TrimModal';
import { AIImageModal } from '../components/AIImageModal';
import { AIVideoModal } from '../components/AIVideoModal';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { VideoSequencePreview } from '../components/VideoSequencePreview';
import {
    ArrowRight,
    Wand2,
    Trash2,
    Scissors,
    AlertTriangle,
    Clock,
    GripVertical,
    Zap,
    Video,
    Image as ImageIcon,
    Sparkles,
    Maximize,
    Minimize,
    ZoomIn,
} from 'lucide-react';
import { TransitionsModal } from '../components/TransitionsModal';
import { cn } from '../lib/utils';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MediaTake } from '../types';
import { SPEED_PRESETS, SpeedPresetType } from '../lib/speedRemapping';

interface SortableTakeProps {
    take: MediaTake;
    index: number;
    onRemove: (_id: string) => void;
    onEdit: (_take: MediaTake) => void;
    onToggleFit: (_id: string) => void;
    format: string;
}

const SortableTake = ({ take, index, onRemove, onEdit, onToggleFit, format }: SortableTakeProps) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: take.id,
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? 'none' : transition,
        zIndex: isDragging ? 50 : undefined,
    };

    const duration = take.trim.end - take.trim.start;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'p-4 hover:bg-black/5 dark:bg-white/5 transition-all flex items-center gap-4 group bg-background border border-black/5 dark:border-white/5 rounded-2xl mb-3 shadow-[0_4px_20px_rgba(0,0,0,0.2)] relative overflow-hidden'
            )}
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-move text-brand-muted hover:text-foreground p-1 -ml-2"
            >
                <GripVertical className="w-5 h-5 text-brand-muted/50" />
            </div>

            <div className="text-xs font-mono font-bold text-brand-muted/40 w-6">
                {(index + 1).toString().padStart(2, '0')}
            </div>

            {/* Thumbnail */}
            <div
                className={cn(
                    'bg-brand-dark rounded-xl overflow-hidden relative border border-black/10 dark:border-white/10 shrink-0 shadow-inner',
                    format === '9:16' ? 'w-14 h-24' : 'w-20 h-20'
                )}
            >
                {take.type === 'video' ? (
                    <video
                        src={take.proxyUrl || take.url}
                        className={cn(
                            'w-full h-full opacity-80',
                            take.objectFit === 'contain' ? 'object-contain' : 'object-cover'
                        )}
                    />
                ) : (
                    <img
                        src={take.url}
                        alt={take.fileName}
                        className={cn(
                            'w-full h-full opacity-80',
                            take.objectFit === 'contain' ? 'object-contain' : 'object-cover'
                        )}
                    />
                )}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-foreground tracking-wide truncate">{take.fileName}</h4>
                <div className="flex gap-2 mt-2">
                    <span className="text-[10px] bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-md text-brand-muted font-mono font-semibold border border-black/5 dark:border-white/5">
                        {take.trim.start.toFixed(1)}s - {take.trim.end.toFixed(1)}s
                    </span>
                </div>
            </div>

            {/* Duration */}
            <div className="text-right px-4">
                <span className="text-sm font-mono font-bold text-brand-accent bg-brand-accent/10 px-3 py-1 rounded-lg border border-brand-accent/20">
                    {duration.toFixed(1)}s
                </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pr-2">
                <button
                    onClick={() => onToggleFit(take.id)}
                    className="p-2.5 text-brand-muted hover:text-blue-400 hover:bg-blue-500/10 rounded-xl transition-all shadow-sm border border-transparent hover:border-blue-500/20"
                    title={
                        take.objectFit === 'contain'
                            ? 'Preencher Tela (Cortar Bordas)'
                            : 'Encaixar Original (Manter Bordas)'
                    }
                >
                    {take.objectFit === 'contain' ? <Maximize className="w-4 h-4" /> : <Minimize className="w-4 h-4" />}
                </button>
                <button
                    onClick={() => onEdit(take)}
                    className="p-2.5 text-brand-muted hover:text-[#0a0f12] hover:bg-brand-accent rounded-xl transition-all shadow-sm border border-transparent hover:border-brand-accent"
                    title="Editar Take"
                >
                    <Scissors className="w-4 h-4" />
                </button>
                <button
                    onClick={() => onRemove(take.id)}
                    className="p-2.5 text-brand-muted hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

export const Step2 = () => {
    const navigate = useNavigate();
    const { mediaTakes, setMediaTakes, removeMediaTake, apiKeys, addMediaTake, adData, musicLibrary, selectedMusicId } =
        useWizard();
    const [editingTake, setEditingTake] = useState<MediaTake | null>(null);
    const [showImageModal, setShowImageModal] = useState(false);
    const [showVideoModal, setShowVideoModal] = useState(false);
    const [showTransitionsModal, setShowTransitionsModal] = useState(false);
    const [targetTakeId, setTargetTakeId] = useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const totalDuration = mediaTakes.reduce((acc, take) => {
        const duration = take.trim.end - take.trim.start;
        return acc + duration;
    }, 0);
    const narrationDuration = adData.narrationDuration || 0;

    const handleMuteToggle = (takeId: string) => {
        setMediaTakes((prev) =>
            prev.map((t) => (t.id === takeId ? { ...t, muteOriginalAudio: !t.muteOriginalAudio } : t))
        );
    };

    const handleToggleFit = (takeId: string) => {
        setMediaTakes((prev) =>
            prev.map((t) =>
                t.id === takeId ? { ...t, objectFit: t.objectFit === 'contain' ? 'cover' : 'contain' } : t
            )
        );
    };

    const handleMuteAll = (muted: boolean) => {
        setMediaTakes((prev) => prev.map((t) => ({ ...t, muteOriginalAudio: muted })));
    };

    const handleSaveTake = (
        takeId: string,
        newTrim: { start: number; end: number; speedPresetId?: SpeedPresetType }
    ) => {
        setMediaTakes((prev) =>
            prev.map((t) => {
                if (t.id === takeId) {
                    return {
                        ...t,
                        trim: { start: newTrim.start, end: newTrim.end },
                        speedPresetId: newTrim.speedPresetId ?? t.speedPresetId,
                    };
                }
                return t;
            })
        );
        setEditingTake(null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            setMediaTakes((items) => {
                const oldIndex = items.findIndex((item) => item.id === active.id);
                const newIndex = items.findIndex((item) => item.id === over.id);
                const newItems = arrayMove(items, oldIndex, newIndex);

                // Strip all transitions upon reordering
                return newItems.map((take) => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { transition, ...rest } = take;
                    return rest;
                });
            });
            toast.info('Transições individuais removidas após reordenar.');
        }
    };

    const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);

    const handleBatchSpeed = (presetId: SpeedPresetType) => {
        const preset = SPEED_PRESETS.find((p) => p.id === presetId);
        if (!preset) return;

        setMediaTakes((prev) =>
            prev.map((t) => ({
                ...t,
                speedPresetId: presetId,
            }))
        );
        toast.success(`Efeito de velocidade "${preset.title}" aplicado em todos os takes!`);
        setIsSpeedMenuOpen(false);
    };

    return (
        <ErrorBoundary>
            <div className="max-w-6xl mx-auto pb-20">
                <header className="mb-12 text-center mt-8">
                    <h2 className="text-4xl font-extrabold text-foreground tracking-tight">
                        Seus{' '}
                        <span className="bg-linear-to-r from-brand-lime to-brand-accent bg-clip-text text-transparent">
                            Takes Visuais
                        </span>
                    </h2>
                    <p className="text-brand-muted mt-3 max-w-2xl mx-auto text-sm font-medium">
                        Adicione vídeos ou gere imagens por IA para compor o anúncio.
                    </p>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,0.9fr)] gap-6">
                    {/* Col 1: Upload & Sources */}
                    <div className="space-y-6">
                        <VideoUpload />

                        {/* AI Generation Tools */}
                        <div className="space-y-4 bg-brand-card border border-black/5 dark:border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-[2px] bg-linear-to-r from-brand-lime/40 to-brand-accent/10"></div>
                            <h3 className="text-[13px] tracking-wide uppercase font-semibold text-brand-muted flex items-center gap-2 mb-4">
                                <Wand2 className="w-4 h-4 text-brand-accent" /> Gerar com IA
                            </h3>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setShowImageModal(true)}
                                    className="flex flex-col items-center justify-center p-4 bg-background hover:bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 hover:border-brand-accent/40 rounded-2xl transition-all group shadow-inner min-h-[110px]"
                                >
                                    <div className="p-3 bg-brand-accent/10 rounded-xl mb-3 group-hover:scale-110 transition-transform shadow-[0_0_15px_rgba(0,230,118,0.1)]">
                                        <ImageIcon className="w-5 h-5 text-brand-accent" />
                                    </div>
                                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                                        Imagem
                                    </span>
                                </button>
                                <button
                                    onClick={() => setShowVideoModal(true)}
                                    className="flex flex-col items-center justify-center p-4 bg-background hover:bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 hover:border-purple-500/40 rounded-2xl transition-all group shadow-inner min-h-[110px]"
                                >
                                    <div className="p-3 bg-purple-500/10 rounded-xl mb-3 group-hover:scale-110 transition-transform shadow-[0_0_15px_rgba(168,85,247,0.1)]">
                                        <Video className="w-5 h-5 text-purple-400" />
                                    </div>
                                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                                        Vídeo
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Col 2: Timeline/Segments */}
                    <div className="space-y-6">
                        {/* Duration Info Card */}
                        <div
                            className={cn(
                                'rounded-3xl border p-6 flex items-center justify-between shadow-2xl relative overflow-hidden',
                                totalDuration < narrationDuration
                                    ? 'bg-yellow-500/5 border-yellow-500/10'
                                    : 'bg-brand-lime/5 border-brand-lime/10'
                            )}
                        >
                            <div className="flex items-center gap-4">
                                <div
                                    className={cn(
                                        'p-3 rounded-2xl shadow-inner',
                                        totalDuration < narrationDuration ? 'bg-yellow-500/10' : 'bg-brand-lime/10'
                                    )}
                                >
                                    <Clock
                                        className={cn(
                                            'w-6 h-6',
                                            totalDuration < narrationDuration
                                                ? 'text-yellow-500'
                                                : 'text-brand-lime drop-shadow-[0_0_5px_rgba(163,230,53,0.5)]'
                                        )}
                                    />
                                </div>
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wider text-foreground">
                                        Tempo Alocado
                                    </p>
                                    <p className="text-[11px] uppercase tracking-widest text-brand-muted font-bold mt-1">
                                        Narração: {narrationDuration.toFixed(1)}s
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <span
                                    className={cn(
                                        'text-3xl font-black font-mono tracking-tighter',
                                        totalDuration < narrationDuration
                                            ? 'text-yellow-500'
                                            : 'text-brand-lime drop-shadow-[0_0_8px_rgba(163,230,53,0.6)]'
                                    )}
                                >
                                    {totalDuration.toFixed(1)}s
                                </span>
                            </div>
                        </div>

                        {totalDuration < narrationDuration && (
                            <div className="flex items-start gap-3 text-yellow-500 text-xs bg-yellow-500/10 p-4 rounded-2xl border border-yellow-500/20 font-medium leading-relaxed">
                                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                <p>
                                    Seus takes somam menos tempo do que a narração. O vídeo final ficará com tela preta
                                    ou loop no final.
                                </p>
                            </div>
                        )}

                        {/* Segments List */}
                        <div className="bg-brand-card border border-black/5 dark:border-white/5 rounded-3xl overflow-hidden shadow-2xl p-6">
                            <div className="pb-4 mb-4 border-b border-black/5 dark:border-white/5 flex justify-between items-center">
                                {/* Toggle All Fit Button */}
                                <button
                                    onClick={() => {
                                        if (mediaTakes.length === 0) return;
                                        const allContain = mediaTakes.every((t) => t.objectFit === 'contain');
                                        const newState = allContain ? 'cover' : 'contain';
                                        setMediaTakes(mediaTakes.map((t) => ({ ...t, objectFit: newState })));
                                    }}
                                    disabled={mediaTakes.length === 0}
                                    className="p-2 bg-cyan-500/25 text-cyan-400 hover:bg-cyan-500/40 rounded-lg border border-cyan-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                    title={
                                        mediaTakes.length > 0 && mediaTakes.every((t) => t.objectFit === 'contain')
                                            ? 'Preencher Tela (Todos)'
                                            : 'Encaixar Original (Todos)'
                                    }
                                >
                                    {mediaTakes.length > 0 && mediaTakes.every((t) => t.objectFit === 'contain') ? (
                                        <Maximize className="w-4 h-4" />
                                    ) : (
                                        <Minimize className="w-4 h-4" />
                                    )}
                                </button>

                                <div className="flex items-center gap-3">
                                    {/* Botão Zoom (Em Breve) */}
                                    <button
                                        disabled
                                        className="p-2 bg-emerald-500/25 text-emerald-400 rounded-lg border border-emerald-500/40 transition-colors opacity-50 cursor-not-allowed"
                                        title="Zoom (Disponível em breve)"
                                    >
                                        <ZoomIn className="w-4 h-4" />
                                    </button>
                                    {/* Batch Speed Button */}
                                    <div className="relative">
                                        <button
                                            onClick={() => setIsSpeedMenuOpen(!isSpeedMenuOpen)}
                                            disabled={mediaTakes.length === 0}
                                            className="p-2 bg-yellow-500/25 text-yellow-400 hover:bg-yellow-500/40 rounded-lg border border-yellow-500/40 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="Aplicar curva de velocidade em todos"
                                        >
                                            <Zap className="w-4 h-4" />
                                        </button>

                                        {isSpeedMenuOpen && (
                                            <>
                                                <div
                                                    className="fixed inset-0 z-40"
                                                    onClick={() => setIsSpeedMenuOpen(false)}
                                                />
                                                <div className="absolute top-full right-0 mt-2 w-[240px] bg-brand-card border border-black/10 dark:border-white/10 rounded-xl shadow-2xl z-50 p-2 text-left">
                                                    <div className="mb-2 px-2 border-b border-black/5 dark:border-white/5 pb-2">
                                                        <span className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">
                                                            Aplicar em todos
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        {SPEED_PRESETS.map((preset) => (
                                                            <button
                                                                key={preset.id}
                                                                onClick={() => handleBatchSpeed(preset.id)}
                                                                className="flex flex-col items-start px-3 py-2 hover:bg-black/5 dark:bg-white/5 rounded-md transition-colors text-left"
                                                            >
                                                                <span className="text-sm font-semibold text-foreground">
                                                                    {preset.title}
                                                                </span>
                                                                <span className="text-[10px] text-brand-muted/70 uppercase tracking-wider font-bold mt-1">
                                                                    {preset.description}
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <button
                                        onClick={() => {
                                            setTargetTakeId(null);
                                            setShowTransitionsModal(true);
                                        }}
                                        className="p-2 bg-fuchsia-500/25 text-fuchsia-400 hover:bg-fuchsia-500/40 rounded-lg border border-fuchsia-500/40 transition-all shadow-sm relative"
                                        title="Adicionar efeitos visuais padrão entre cortes"
                                    >
                                        <Sparkles className="w-4 h-4" />
                                        {adData.globalTransition && (
                                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,0.8)]"></span>
                                        )}
                                    </button>

                                    <button
                                        onClick={() => {
                                            // Compute effective audio duration from audioConfig (edited in step 1)
                                            const audioConfig = adData.audioConfig;
                                            let effectiveAudioDuration = 0;

                                            // Narration extent: offset + (trimEnd - trimStart)
                                            if (audioConfig?.narration?.enabled !== false) {
                                                const narr = audioConfig?.narration;
                                                const rawNarrDur = narrationDuration || 0;
                                                const narrStart = narr?.trimStart || 0;
                                                const narrEnd = narr?.trimEnd || rawNarrDur;
                                                const narrOffset = narr?.offsetSec || 0;
                                                if (narrEnd > narrStart) {
                                                    effectiveAudioDuration = Math.max(
                                                        effectiveAudioDuration,
                                                        narrOffset + (narrEnd - narrStart)
                                                    );
                                                }
                                            }

                                            // Music extent: offset + (trimEnd - trimStart)
                                            if (audioConfig?.background?.enabled !== false) {
                                                const bg = audioConfig?.background;
                                                const selectedMusic = musicLibrary.find(
                                                    (m) => m.id === selectedMusicId
                                                );
                                                const rawMusicDur = selectedMusic?.durationSec || 0;
                                                const musicStart = bg?.trimStart || 0;
                                                const musicEnd = bg?.trimEnd || rawMusicDur;
                                                const musicOffset = bg?.offsetSec || 0;
                                                if (musicEnd > musicStart) {
                                                    effectiveAudioDuration = Math.max(
                                                        effectiveAudioDuration,
                                                        musicOffset + (musicEnd - musicStart)
                                                    );
                                                }
                                            }

                                            // Fallback: raw narration duration
                                            if (effectiveAudioDuration === 0) {
                                                effectiveAudioDuration = narrationDuration || 0;
                                            }

                                            if (mediaTakes.length === 0 || effectiveAudioDuration === 0) {
                                                if (effectiveAudioDuration === 0)
                                                    toast.error('Adicione uma narração ou música para ajustar!');
                                                return;
                                            }

                                            // Overshoot by 1.5 seconds to ensure video doesn't cut to black before audio ends
                                            effectiveAudioDuration += 1.5;

                                            // Redistribuição Inteligente (Smart Split)
                                            let remainingAudioTime = effectiveAudioDuration;
                                            const finalDurations = new Map<string, number>();
                                            let activeTakes = [...mediaTakes];
                                            let attempts = 0;

                                            while (
                                                activeTakes.length > 0 &&
                                                remainingAudioTime > 0.001 &&
                                                attempts < 100
                                            ) {
                                                attempts++;
                                                const slice = remainingAudioTime / activeTakes.length;
                                                const takesToLockForThisRound = [];

                                                for (const take of activeTakes) {
                                                    // Imagens não têm limite de tempo. Vídeos usam o tempo máximo (originalDurationSeconds).
                                                    const maxDur =
                                                        take.type === 'video' && take.originalDurationSeconds > 0
                                                            ? take.originalDurationSeconds
                                                            : Number.MAX_VALUE;

                                                    // Se o take é menor do que a fatia que caberia a ele
                                                    if (maxDur < slice + 0.05) {
                                                        takesToLockForThisRound.push(take);
                                                    }
                                                }

                                                if (takesToLockForThisRound.length === 0) {
                                                    // Nenhum take precisa ser travado, divide o tempo restante igualmente
                                                    for (const take of activeTakes) {
                                                        finalDurations.set(take.id, slice);
                                                    }
                                                    remainingAudioTime = 0;
                                                    break;
                                                } else {
                                                    // Travar os takes curtos em sua duração máxima
                                                    for (const take of takesToLockForThisRound) {
                                                        const maxDur =
                                                            take.type === 'video' && take.originalDurationSeconds > 0
                                                                ? take.originalDurationSeconds
                                                                : 0;
                                                        finalDurations.set(take.id, maxDur);
                                                        remainingAudioTime -= maxDur;
                                                        activeTakes = activeTakes.filter((t) => t.id !== take.id);
                                                    }
                                                }
                                            }

                                            const newTakes = mediaTakes.map((take) => {
                                                const assignedDuration = finalDurations.get(take.id) || 0;
                                                return {
                                                    ...take,
                                                    trim: {
                                                        start: 0,
                                                        end: Number(assignedDuration.toFixed(1)),
                                                    },
                                                };
                                            });

                                            setMediaTakes(newTakes);

                                            // Se sobrou muito tempo realocável, significa que todos os vídeos somados são menores que a narração
                                            if (remainingAudioTime > 0.5) {
                                                toast.warning(
                                                    `Cortes ajustados, mas seus vídeos são curtos demais para preencher toda a narração!`
                                                );
                                            } else {
                                                toast.success(
                                                    `Cortes automáticos ajustados para totalizar ${effectiveAudioDuration.toFixed(1)}s ✓`
                                                );
                                            }
                                        }}
                                        disabled={mediaTakes.length === 0}
                                        className="p-2 bg-blue-500/25 text-blue-400 hover:bg-blue-500/40 rounded-lg border border-blue-500/40 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Dividir tempo do áudio igualmente entre os takes (Smart Cut)"
                                    >
                                        <Scissors className="w-4 h-4" />
                                    </button>

                                    <span className="text-[10px] uppercase tracking-wider font-bold text-brand-muted ml-2">
                                        {mediaTakes.length} cortes
                                    </span>
                                </div>
                            </div>

                            {mediaTakes.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground text-sm">
                                    Nenhum vídeo adicionado ainda. Faça upload ao lado.
                                </div>
                            ) : (
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleDragEnd}
                                >
                                    <SortableContext
                                        items={mediaTakes.map((s) => s.id)}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        <div className="flex flex-col gap-3 relative">
                                            {mediaTakes.map((take, index) => (
                                                <div key={take.id} className="relative flex flex-col items-center">
                                                    <div className="w-full">
                                                        <SortableTake
                                                            take={take}
                                                            index={index}
                                                            onRemove={removeMediaTake}
                                                            onEdit={setEditingTake}
                                                            onToggleFit={handleToggleFit}
                                                            format={adData.format}
                                                        />
                                                    </div>

                                                    {/* Individual Transition Button between Takes */}
                                                    {index < mediaTakes.length - 1 &&
                                                        (() => {
                                                            const activeTrans =
                                                                take.transition?.asset || adData.globalTransition;
                                                            const isSpecific = !!take.transition;
                                                            return (
                                                                <div className="w-full relative z-10 my-0.5 px-4">
                                                                    <button
                                                                        onClick={() => {
                                                                            setTargetTakeId(take.id);
                                                                            setShowTransitionsModal(true);
                                                                        }}
                                                                        className={cn(
                                                                            'w-full flex items-center justify-center gap-2 py-1 relative overflow-hidden transition-all duration-200 group/trans',
                                                                            isSpecific
                                                                                ? 'opacity-100 hover:opacity-90'
                                                                                : activeTrans
                                                                                  ? 'opacity-70 hover:opacity-100'
                                                                                  : 'opacity-40 hover:opacity-100'
                                                                        )}
                                                                        title={
                                                                            activeTrans
                                                                                ? isSpecific
                                                                                    ? `Transição Específica (${activeTrans.originalName})`
                                                                                    : `Transição Global Ativa (${activeTrans.originalName})`
                                                                                : `Adicionar Transição Específica após o Take ${index + 1}`
                                                                        }
                                                                    >
                                                                        {/* Background Line Layer */}
                                                                        <div
                                                                            className={cn(
                                                                                'absolute inset-0 top-1/2 -translate-y-1/2 h-1 rounded-full transition-colors',
                                                                                isSpecific
                                                                                    ? 'bg-fuchsia-500'
                                                                                    : activeTrans
                                                                                      ? 'bg-fuchsia-500/30 group-hover/trans:bg-fuchsia-500/50'
                                                                                      : 'bg-black/5 dark:bg-white/5 group-hover/trans:bg-fuchsia-500/50'
                                                                            )}
                                                                        />

                                                                        {/* Center Pill Layer */}
                                                                        <div
                                                                            className={cn(
                                                                                'relative flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold shadow-sm transition-colors ring-4 ring-brand-card',
                                                                                isSpecific
                                                                                    ? 'bg-fuchsia-500 text-foreground'
                                                                                    : activeTrans
                                                                                      ? 'bg-brand-card border border-fuchsia-500/30 text-fuchsia-500/80 group-hover/trans:border-fuchsia-500/60'
                                                                                      : 'bg-brand-card border border-black/5 dark:border-white/5 text-brand-muted group-hover/trans:border-fuchsia-500/50 group-hover/trans:text-fuchsia-400'
                                                                            )}
                                                                        >
                                                                            <Sparkles
                                                                                className={cn(
                                                                                    'w-3 h-3',
                                                                                    isSpecific
                                                                                        ? 'text-foreground'
                                                                                        : 'text-fuchsia-500'
                                                                                )}
                                                                            />
                                                                            {activeTrans
                                                                                ? activeTrans.originalName
                                                                                : 'Adicionar Transição Específica'}
                                                                        </div>
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                </div>
                                            ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            )}
                        </div>
                    </div>

                    {/* Col 3: Preview */}
                    <div className="lg:sticky lg:top-24 self-start">
                        <VideoSequencePreview
                            takes={mediaTakes}
                            masterAudioUrl={adData.masterAudioUrl}
                            onMuteToggle={handleMuteToggle}
                            onMuteAll={handleMuteAll}
                        />
                    </div>
                </div>

                {/* Trim Modal */}
                {editingTake && (
                    <TrimModal take={editingTake} onSave={handleSaveTake} onClose={() => setEditingTake(null)} />
                )}

                {/* AI Modals */}
                <AIImageModal isOpen={showImageModal} onClose={() => setShowImageModal(false)} />
                <AIVideoModal
                    isOpen={showVideoModal}
                    onClose={() => setShowVideoModal(false)}
                    apiKeys={apiKeys}
                    addMediaTake={addMediaTake}
                />

                {/* Footer Navigation */}
                <div className="fixed bottom-0 right-0 left-0 bg-background/80 backdrop-blur-md border-t border-border p-4 z-20 flex justify-end">
                    <button
                        onClick={() => navigate('/step/3')}
                        className="px-8 py-2.5 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground font-bold rounded-lg text-sm transition-all flex items-center gap-2 shadow-lg shadow-green-900/10"
                    >
                        Próximo: Estilo
                        <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Transitions Modal */}
            <TransitionsModal
                isOpen={showTransitionsModal}
                onClose={() => setShowTransitionsModal(false)}
                targetTakeId={targetTakeId}
            />
        </ErrorBoundary>
    );
};
