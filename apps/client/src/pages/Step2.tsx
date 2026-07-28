import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useWizard, ENABLE_MEDIA_AI } from '../context/WizardContext';
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
import { SpeedPresetType } from '../lib/speedRemapping';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ZoomEffectsModal } from '../components/ZoomEffectsModal';
import { takeMotionLabel } from '../lib/takeMotion';
import { missingBeforeStep, pendingWarningText } from '../lib/workflowWarnings';

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
                'group relative mb-2.5 flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-black/5 bg-background p-3 shadow-[0_6px_24px_rgba(0,0,0,0.16)] transition-all hover:border-brand-lime/15 hover:bg-black/[0.025] dark:border-white/7 dark:hover:bg-white/[0.035]'
            )}
        >
            <div
                {...attributes}
                {...listeners}
                className="-ml-1 cursor-grab rounded-lg p-1 text-brand-muted/45 transition hover:bg-white/5 hover:text-foreground active:cursor-grabbing"
            >
                <GripVertical className="w-5 h-5 text-brand-muted/50" />
            </div>

            <div className="w-5 shrink-0 text-center font-mono text-[10px] font-bold text-brand-muted/40">
                {(index + 1).toString().padStart(2, '0')}
            </div>

            {/* Thumbnail */}
            <div
                className={cn(
                    'bg-brand-dark rounded-xl overflow-hidden relative border border-black/10 dark:border-white/10 shrink-0 shadow-inner',
                    format === '9:16' ? 'h-20 w-12' : 'h-16 w-16'
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
                <h4 className="truncate text-xs font-bold tracking-wide text-foreground">{take.fileName}</h4>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="text-[10px] bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-md text-brand-muted font-mono font-semibold border border-black/5 dark:border-white/5">
                        {take.trim.start.toFixed(1)}s - {take.trim.end.toFixed(1)}s
                    </span>
                    {take.motionEffect && (
                        <span className="rounded-md border border-emerald-400/20 bg-emerald-400/8 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-300">
                            {takeMotionLabel(take.motionEffect)} · {Math.round(take.motionEffect.intensity * 100)}%
                        </span>
                    )}
                </div>
            </div>

            {/* Duration */}
            <div className="shrink-0 text-right">
                <span className="rounded-lg border border-brand-accent/20 bg-brand-accent/10 px-2 py-1 font-mono text-xs font-bold text-brand-accent">
                    {duration.toFixed(1)}s
                </span>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1 rounded-xl border border-white/7 bg-black/10 p-1">
                <button
                    onClick={() => onToggleFit(take.id)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-brand-muted transition hover:bg-cyan-500/10 hover:text-cyan-300"
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
                    className="grid h-8 w-8 place-items-center rounded-lg text-brand-muted transition hover:bg-brand-lime/12 hover:text-brand-lime"
                    title="Editar Take"
                >
                    <Scissors className="w-4 h-4" />
                </button>
                <button
                    onClick={() => onRemove(take.id)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-brand-muted transition hover:bg-red-500/10 hover:text-red-400"
                    title="Remover take"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

export const Step2 = () => {
    const navigate = useNavigate();
    const { mediaTakes, setMediaTakes, removeMediaTake, clearMediaTakes, apiKeys, addMediaTake, adData, musicLibrary, selectedMusicId } =
        useWizard();
    const [editingTake, setEditingTake] = useState<MediaTake | null>(null);
    const [showImageModal, setShowImageModal] = useState(false);
    const [showVideoModal, setShowVideoModal] = useState(false);
    const [showTransitionsModal, setShowTransitionsModal] = useState(false);
    const [showZoomModal, setShowZoomModal] = useState(false);
    const [targetTakeId, setTargetTakeId] = useState<string | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);

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

    const rawTakesDuration = mediaTakes.reduce((acc, take) => {
        const duration = take.trim.end - take.trim.start;
        return acc + duration;
    }, 0);
    const narrationDuration = adData.narrationDuration || 0;
    // A narração/mixagem é o relógio final. Takes excedentes continuam editáveis,
    // porém nada depois do fim do áudio entra no preview ou na exportação.
    const totalDuration = narrationDuration > 0
        ? Math.min(rawTakesDuration, narrationDuration)
        : rawTakesDuration;

    const handleNext = () => {
        const missing = missingBeforeStep(3, adData, mediaTakes);
        if (missing.length) toast.warning(pendingWarningText(missing), { duration: 7000 });
        navigate('/wizard/step/3');
    };

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



    return (
        <ErrorBoundary>
            <div className="mx-auto w-full max-w-[1440px] pb-24">
                <header className="mb-7 mt-2 text-center">
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

                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[220px_minmax(480px,1fr)_320px]">
                    {/* Col 1: Upload & Sources */}
                    <div className="space-y-6">
                        <VideoUpload />

                        {/* AI Generation Tools — desligado no v1 (ver ENABLE_MEDIA_AI) */}
                        {ENABLE_MEDIA_AI && (
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
                        )}
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

                        {mediaTakes.length > 0 && totalDuration < narrationDuration && (
                            <div className="flex items-start gap-3 text-yellow-500 text-xs bg-yellow-500/10 p-4 rounded-2xl border border-yellow-500/20 font-medium leading-relaxed">
                                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                <p>
                                    Seus takes ainda não cobrem toda a narração. Adicione mais material ou use o corte
                                    automático para completar o tempo.
                                </p>
                            </div>
                        )}

                        {narrationDuration > 0 && rawTakesDuration > narrationDuration + 0.05 && (
                            <div className="flex items-start gap-3 rounded-2xl border border-brand-lime/20 bg-brand-lime/[0.06] p-4 text-xs font-medium leading-relaxed text-brand-lime">
                                <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                                <p>
                                    A sequência possui {(rawTakesDuration - narrationDuration).toFixed(1)}s além do áudio.
                                    O preview e a exportação terminam exatamente junto com a mixagem.
                                </p>
                            </div>
                        )}

                        {/* Segments List */}
                        <div className="overflow-hidden rounded-3xl border border-black/5 bg-brand-card p-4 shadow-2xl dark:border-white/5 sm:p-5">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-black/5 pb-4 dark:border-white/5">
                                {/* Toggle All Fit Button */}
                                <button
                                    onClick={() => {
                                        if (mediaTakes.length === 0) return;
                                        const allContain = mediaTakes.every((t) => t.objectFit === 'contain');
                                        const newState = allContain ? 'cover' : 'contain';
                                        setMediaTakes(mediaTakes.map((t) => ({ ...t, objectFit: newState })));
                                    }}
                                    disabled={mediaTakes.length === 0}
                                    className="p-2 bg-cyan-500/10 text-cyan-500 hover:bg-cyan-500/20 rounded-lg border border-cyan-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
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

                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    {mediaTakes.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmClear(true)}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/15 bg-red-500/[0.055] px-2.5 py-2 text-[10px] font-black uppercase tracking-wider text-red-300 transition hover:bg-red-500/10"
                                            title="Remover todos os takes"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" /> Limpar
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setShowZoomModal(true)}
                                        disabled={mediaTakes.length === 0}
                                        className="relative p-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg border border-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Aplicar Zoom In ou Zoom Out em um ou vários takes"
                                    >
                                        <ZoomIn className="w-4 h-4" />
                                        {mediaTakes.some((take) => take.motionEffect) && (
                                            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,.9)]" />
                                        )}
                                    </button>

                                    <button
                                        onClick={() => {
                                            setTargetTakeId(null);
                                            setShowTransitionsModal(true);
                                        }}
                                        className="p-2 bg-fuchsia-500/10 text-fuchsia-400 hover:bg-fuchsia-500/20 rounded-lg border border-fuchsia-500/20 transition-all shadow-sm relative"
                                        title="Adicionar efeitos visuais padrão entre cortes"
                                    >
                                        <Sparkles className="w-4 h-4" />
                                        {adData.globalTransition && (
                                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,0.8)]"></span>
                                        )}
                                    </button>

                                    <button
                                        onClick={() => {
                                            // Compute effective audio duration from audioConfig (edited in step 1).
                                            // The final master audio mix uses duration=first (narration), so the video
                                            // should match the narration length — not the (usually much longer) music track.
                                            const audioConfig = adData.audioConfig;
                                            let effectiveAudioDuration = 0;

                                            // Narration extent: offset + (trimEnd - trimStart) — this drives the video length
                                            if (audioConfig?.narration?.enabled !== false) {
                                                const narr = audioConfig?.narration;
                                                const rawNarrDur = narrationDuration || 0;
                                                const narrStart = narr?.trimStart || 0;
                                                const narrEnd = narr?.trimEnd || rawNarrDur;
                                                const narrOffset = narr?.offsetSec || 0;
                                                if (narrEnd > narrStart) {
                                                    effectiveAudioDuration = narrOffset + (narrEnd - narrStart);
                                                }
                                            }

                                            // Fallback: raw narration duration
                                            if (effectiveAudioDuration === 0) {
                                                effectiveAudioDuration = narrationDuration || 0;
                                            }

                                            // Last-resort fallback (music only, no narration): use music extent
                                            if (effectiveAudioDuration === 0 && audioConfig?.background?.enabled !== false) {
                                                const bg = audioConfig?.background;
                                                const selectedMusic = musicLibrary.find(
                                                    (m) => m.id === selectedMusicId
                                                );
                                                const rawMusicDur = selectedMusic?.durationSec || 0;
                                                const musicStart = bg?.trimStart || 0;
                                                const musicEnd = bg?.trimEnd || rawMusicDur;
                                                const musicOffset = bg?.offsetSec || 0;
                                                if (musicEnd > musicStart) {
                                                    effectiveAudioDuration = musicOffset + (musicEnd - musicStart);
                                                }
                                            }

                                            if (mediaTakes.length === 0 || effectiveAudioDuration === 0) {
                                                if (effectiveAudioDuration === 0)
                                                    toast.error('Adicione uma narração ou música para ajustar!');
                                                return;
                                            }

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
                                                        // Manter a precisão evita que o arredondamento de cada
                                                        // take some décimos e ultrapasse o fim do áudio.
                                                        end: Math.max(0, assignedDuration),
                                                    },
                                                    speedPresetId: 'normal' as const, // Remove speed effects for automatic mode
                                                };
                                            });

                                            // Se sobrou muito tempo realocável, significa que todos os vídeos somados são menores que a narração
                                            if (remainingAudioTime > 0.5) {
                                                // Lógica de LOOP para vídeos curtos: Duplicar takes até atingir effectiveAudioDuration
                                                const newTakesArr = [...newTakes];
                                                let loopIdx = 0;
                                                let timeToFill = remainingAudioTime;
                                                const maxTakesToDuplicate = 800;
                                                
                                                while (timeToFill > 0.5 && newTakesArr.length < maxTakesToDuplicate && mediaTakes.length > 0) {
                                                    const baseTake = mediaTakes[loopIdx % mediaTakes.length];
                                                    const idealTakeDur = baseTake.type === 'video' && baseTake.originalDurationSeconds > 0 
                                                                    ? baseTake.originalDurationSeconds 
                                                                    : timeToFill;
                                                    
                                                    const durationForThisLoop = Math.min(idealTakeDur, timeToFill);
                                                    
                                                    newTakesArr.push({
                                                        ...baseTake,
                                                        id: `${baseTake.id}-loop-${Date.now()}-${loopIdx}`,
                                                        trim: {
                                                            start: 0,
                                                            end: Math.max(0, durationForThisLoop)
                                                        },
                                                        speedPresetId: 'normal' as const, // Remove speed effects for automatic mode
                                                    });
                                                    
                                                    timeToFill -= durationForThisLoop;
                                                    loopIdx++;
                                                }
                                                setMediaTakes(newTakesArr);
                                                toast.success(
                                                    `Cortes em Loop: takes foram duplicados para preencher toda a narração de ${effectiveAudioDuration.toFixed(1)}s ✓`
                                                );
                                            } else {
                                                setMediaTakes(newTakes);
                                                toast.success(
                                                    `Cortes Automáticos ajustados para totalizar ${effectiveAudioDuration.toFixed(1)}s ✓`
                                                );
                                            }
                                        }}
                                        disabled={mediaTakes.length === 0}
                                        className="grid h-9 w-9 place-items-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-400 shadow-sm transition-all hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                        title="Dividir e preencher tempo do áudio inteligentemente (Corte Automático)"
                                        aria-label="Corte automático"
                                    >
                                        <Scissors className="w-4 h-4" />
                                    </button>

                                    <span className="ml-1 rounded-lg border border-white/7 bg-black/10 px-2.5 py-2 text-[9px] font-black uppercase tracking-wider text-brand-muted">
                                        {mediaTakes.length} {mediaTakes.length === 1 ? 'take' : 'takes'}
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

                {confirmClear && (
                    <ConfirmDialog
                        mode="confirm"
                        title="Remover todos os takes?"
                        message="A sequência visual será esvaziada por completo. As mídias originais continuarão nas bibliotecas."
                        confirmLabel="Remover todos"
                        onClose={() => setConfirmClear(false)}
                        onConfirm={() => {
                            clearMediaTakes();
                            setEditingTake(null);
                            setConfirmClear(false);
                            toast.success('Todos os takes foram removidos.');
                        }}
                    />
                )}

                {/* AI Modals — desligados no v1 (ver ENABLE_MEDIA_AI) */}
                {ENABLE_MEDIA_AI && (
                    <>
                        <AIImageModal isOpen={showImageModal} onClose={() => setShowImageModal(false)} />
                        <AIVideoModal
                            isOpen={showVideoModal}
                            onClose={() => setShowVideoModal(false)}
                            apiKeys={apiKeys}
                            addMediaTake={addMediaTake}
                        />
                    </>
                )}

                {/* Footer Navigation */}
                <div className="fixed bottom-0 right-0 left-0 bg-background/80 backdrop-blur-md border-t border-border p-4 z-20 flex justify-end">
                    <button
                        onClick={handleNext}
                        className="px-8 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-lg text-sm transition-all flex items-center gap-2 shadow-lg shadow-green-900/10"
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

                <ZoomEffectsModal
                    isOpen={showZoomModal}
                    takes={mediaTakes}
                    onClose={() => setShowZoomModal(false)}
                    onApply={(takeIds, effect) => {
                        const selected = new Set(takeIds);
                        setMediaTakes((current) => current.map((take) => selected.has(take.id) ? { ...take, motionEffect: effect || undefined } : take));
                        toast.success(effect ? `Zoom aplicado em ${takeIds.length} ${takeIds.length === 1 ? 'take' : 'takes'}.` : 'Zoom removido dos takes selecionados.');
                    }}
                />
        </ErrorBoundary>
    );
};
