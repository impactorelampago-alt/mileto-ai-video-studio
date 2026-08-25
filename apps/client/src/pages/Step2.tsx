import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useWizard, ENABLE_MEDIA_AI } from '../context/WizardContext';
import { VideoUpload } from '../components/VideoUpload';
import { TrimModal } from '../components/TrimModal';
import { AIImageModal } from '../components/AIImageModal';
import { AIVideoModal } from '../components/AIVideoModal';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { VideoSequencePreview, type VideoSequencePreviewRef } from '../components/VideoSequencePreview';
import {
    ArrowRight,
    Wand2,
    Trash2,
    Scissors,
    Clock,
    GripVertical,
    Sparkles,
    Maximize,
    Minimize,
    ZoomIn,
    Layers3,
    Loader2,
    Volume2,
    VolumeX,
    Zap,
    Shuffle,
    CopyPlus,
    Download,
    Frame,
    Check,
    AudioLines,
} from 'lucide-react';
import { TransitionsModal } from '../components/TransitionsModal';
import { MediaSourceModal } from '../components/MediaSourceModal';
import { ExportModal } from '../components/ExportModal';
import { cn, generateId } from '../lib/utils';
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
import type { MediaTake, TakeAudioMode } from '../types';
import { SpeedPresetType } from '../lib/speedRemapping';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ZoomEffectsModal } from '../components/ZoomEffectsModal';
import { takeMotionLabel } from '../lib/takeMotion';
import { missingBeforeStep, pendingWarningText } from '../lib/workflowWarnings';
import { VideoEnhancementModal } from '../components/VideoEnhancementModal';
import { normalizeVideoEnhancement, sharpnessLabel } from '../lib/videoEnhancement';
import { recoverOpsTakeSource } from '../lib/opsMediaRecovery';
import { prepareOpsTakeForExport } from '../lib/opsMediaRecovery';
import { refreshSharedTakeForExport } from '../lib/sharedMediaRecovery';
import { applyQuickEdit } from '../lib/quickEdit';
import { automaticCutTakes } from '../lib/automaticCuts';
import {
    hasCurrentTakeIsolation,
    normalizeTakeAudio,
    resolveEffectiveNarrationAudio,
    takeOriginalSourceKey,
} from '../lib/audioIsolation';
import { isolateAudioSource } from '../lib/audioIsolationApi';

const copyTakeFileName = (fileName: string, label: string) => {
    const extensionIndex = fileName.lastIndexOf('.');
    if (extensionIndex <= 0) return `${fileName} (${label})`;
    return `${fileName.slice(0, extensionIndex)} (${label})${fileName.slice(extensionIndex)}`;
};

const cloneMediaTake = (
    take: MediaTake,
    options?: { trim?: { start: number; end: number }; label?: string }
): MediaTake => ({
    ...take,
    id: generateId(),
    fileName: copyTakeFileName(take.fileName, options?.label || 'cópia'),
    trim: { ...(options?.trim || take.trim) },
    externalMedia: take.externalMedia
        ? {
            ...take.externalMedia,
            viewContext: take.externalMedia.viewContext ? { ...take.externalMedia.viewContext } : take.externalMedia.viewContext,
        }
        : undefined,
    motionEffect: take.motionEffect ? { ...take.motionEffect } : undefined,
    enhancement: take.enhancement ? { ...take.enhancement } : undefined,
    sharpness: take.sharpness ? { ...take.sharpness } : undefined,
    audio: take.audio ? { ...take.audio } : undefined,
    // A transição pertence ao encontro entre duas posições da sequência; um
    // clone nasce sem uma transição individual para não herdar um vínculo antigo.
    transition: undefined,
});

interface SortableTakeProps {
    take: MediaTake;
    index: number;
    onRemove: (_id: string) => void;
    onEdit: (_take: MediaTake) => void;
    onDuplicate: (_takeId: string) => void;
    onToggleFit: (_id: string) => void;
    onEnhance: (_id: string) => void;
    onZoom: (_id: string) => void;
    onTransition: (_id: string) => void;
    onMute: (_id: string) => void;
    onAudioMode: (_id: string, _mode: TakeAudioMode) => void;
    onAudioVolume: (_id: string, _volume: number) => void;
    isIsolatingAudio: boolean;
    onSeek: (_index: number) => void;
    isLast: boolean;
    format: string;
}

const SortableTake = ({ take, index, onRemove, onEdit, onDuplicate, onToggleFit, onEnhance, onZoom, onTransition, onMute, onAudioMode, onAudioVolume, isIsolatingAudio, onSeek, isLast, format }: SortableTakeProps) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: take.id,
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? 'none' : transition,
        zIndex: isDragging ? 50 : undefined,
    };

    const duration = take.trim.end - take.trim.start;
    const audio = normalizeTakeAudio(take.audio);

    return (
        <div
            ref={setNodeRef}
            style={style}
            onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('button,input,select,[data-drag-handle]')) return;
                onSeek(index);
            }}
            className={cn(
                'group relative mb-2.5 flex min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border border-black/5 bg-background p-3 shadow-[0_6px_24px_rgba(0,0,0,0.16)] transition-all hover:border-brand-lime/15 hover:bg-black/[0.025] dark:border-white/7 dark:hover:bg-white/[0.035]'
            )}
            title="Ir para o início deste take no monitor"
        >
            <div
                {...attributes}
                {...listeners}
                data-drag-handle
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
                    {take.sharpness?.mode && take.sharpness.mode !== 'inherit' && (
                        <span className="rounded-md border border-brand-lime/20 bg-brand-lime/8 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-brand-lime">
                            Nitidez {take.sharpness.mode === 'off' ? 'desligada' : sharpnessLabel(take.sharpness.amount)}
                        </span>
                    )}
                </div>
                {take.type === 'video' && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                        <span className="mr-0.5 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-brand-muted">
                            <AudioLines className="h-3 w-3" /> Áudio
                        </span>
                        {([
                            ['off', 'Desligado'],
                            ['original', 'Original'],
                            ['isolated', isIsolatingAudio ? 'Isolando...' : 'Voz isolada'],
                        ] as const).map(([mode, label]) => (
                            <button
                                key={mode}
                                type="button"
                                disabled={isIsolatingAudio}
                                onClick={() => onAudioMode(take.id, mode)}
                                className={cn(
                                    'rounded-md border px-2 py-1 text-[9px] font-bold transition disabled:cursor-wait disabled:opacity-45',
                                    audio.mode === mode
                                        ? mode === 'isolated'
                                            ? 'border-violet-400/35 bg-violet-500/12 text-violet-200'
                                            : mode === 'original'
                                                ? 'border-brand-lime/30 bg-brand-lime/10 text-brand-lime'
                                                : 'border-amber-400/25 bg-amber-400/10 text-amber-300'
                                        : 'border-black/5 text-brand-muted hover:text-foreground dark:border-white/8'
                                )}
                            >
                                {mode === 'isolated' && isIsolatingAudio && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                                {label}
                            </button>
                        ))}
                        {audio.mode !== 'off' && (
                            <label className="ml-1 inline-flex min-w-[126px] flex-1 items-center gap-2 text-[9px] font-bold text-brand-muted">
                                <input
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.05"
                                    value={audio.volume}
                                    onChange={(event) => onAudioVolume(take.id, Number(event.target.value))}
                                    className="h-1 min-w-[70px] flex-1 accent-brand-lime"
                                    aria-label={`Volume do áudio de ${take.fileName}`}
                                />
                                <span className="w-8 text-right font-mono">{Math.round(audio.volume * 100)}%</span>
                            </label>
                        )}
                    </div>
                )}
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
                    onClick={() => onEdit(take)}
                    className="grid h-8 w-8 place-items-center rounded-lg bg-blue-500/10 text-blue-300 transition hover:bg-blue-500/18"
                    title="Primeiro ajuste: cortar este take"
                    aria-label="Cortar este take"
                >
                    <Scissors className="h-4 w-4" />
                </button>
                <button
                    onClick={() => onDuplicate(take.id)}
                    className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/10 text-violet-300 transition hover:bg-violet-500/18"
                    title="Duplicar este take"
                    aria-label="Duplicar este take"
                >
                    <CopyPlus className="h-4 w-4" />
                </button>
                <button
                    onClick={() => onMute(take.id)}
                    disabled={take.type !== 'video'}
                    className={cn(
                        'grid h-8 w-8 place-items-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-25',
                        audio.mode === 'off'
                            ? 'bg-amber-400/10 text-amber-300 hover:bg-amber-400/15'
                            : 'text-brand-muted hover:bg-brand-lime/10 hover:text-brand-lime'
                    )}
                    title={take.type !== 'video' ? 'Imagens não possuem faixa de áudio' : audio.mode === 'off' ? 'Ativar áudio original deste take' : 'Desligar áudio deste take'}
                    aria-label={audio.mode === 'off' ? 'Ativar áudio original deste take' : 'Desligar áudio deste take'}
                >
                    {audio.mode === 'off' ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <button
                    onClick={() => onToggleFit(take.id)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-cyan-400/70 transition hover:bg-cyan-500/10 hover:text-cyan-300"
                    title={take.objectFit === 'contain' ? 'Preencher este take' : 'Encaixar este take'}
                >
                    {take.objectFit === 'contain' ? <Maximize className="h-4 w-4" /> : <Minimize className="h-4 w-4" />}
                </button>
                <button
                    onClick={() => onEnhance(take.id)}
                    className="relative grid h-8 w-8 place-items-center rounded-lg text-brand-lime/75 transition hover:bg-brand-lime/12 hover:text-brand-lime"
                    title="Aprimorar somente este take"
                >
                    <Wand2 className="h-4 w-4" />
                    {((take.enhancement?.mode && take.enhancement.mode !== 'inherit') || (take.sharpness?.mode && take.sharpness.mode !== 'inherit')) && (
                        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-lime shadow-[0_0_6px_rgba(0,230,118,.9)]" />
                    )}
                </button>
                <button
                    onClick={() => onZoom(take.id)}
                    className="relative grid h-8 w-8 place-items-center rounded-lg text-emerald-400/75 transition hover:bg-emerald-500/10 hover:text-emerald-300"
                    title="Zoom somente neste take"
                >
                    <ZoomIn className="h-4 w-4" />
                    {take.motionEffect && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-300" />}
                </button>
                <button
                    onClick={() => onTransition(take.id)}
                    disabled={isLast}
                    className="relative grid h-8 w-8 place-items-center rounded-lg text-fuchsia-400/75 transition hover:bg-fuchsia-500/10 hover:text-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-20"
                    title={isLast ? 'O último take não possui transição seguinte' : 'Transição após este take'}
                >
                    <Sparkles className="h-4 w-4" />
                    {take.transition && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-fuchsia-300" />}
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

// Animações sutis da moldura (Vídeo Moldura) — de propósito discretas.
const MOLDURA_ANIMATIONS = [
    { id: 'none' as const, label: 'Nenhuma' },
    { id: 'vibrate' as const, label: 'Vibrar' },
    { id: 'bounce' as const, label: 'Saltitar' },
];

export const Step2 = () => {
    const navigate = useNavigate();
    const { mediaTakes, setMediaTakes, removeMediaTake, clearMediaTakes, apiKeys, addMediaTake, adData, updateAdData, musicLibrary, selectedMusicId } =
        useWizard();
    const [editingTake, setEditingTake] = useState<MediaTake | null>(null);
    const [showImageModal, setShowImageModal] = useState(false);
    const [showVideoModal, setShowVideoModal] = useState(false);
    const [showTransitionsModal, setShowTransitionsModal] = useState(false);
    const [showZoomModal, setShowZoomModal] = useState(false);
    const [zoomTargetTakeId, setZoomTargetTakeId] = useState<string | null>(null);
    const [showEnhancementModal, setShowEnhancementModal] = useState(false);
    const [enhancementTargetTakeId, setEnhancementTargetTakeId] = useState<string | null>(null);
    const [targetTakeId, setTargetTakeId] = useState<string | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);
    const [isQuickEditing, setIsQuickEditing] = useState(false);
    const [isolatingTakeId, setIsolatingTakeId] = useState<string | null>(null);
    // Vídeo Moldura: esta é a última etapa (upload da moldura PNG + export).
    const isMoldura = adData.videoModel === 'moldura';
    const [isFramePickerOpen, setIsFramePickerOpen] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const previewRef = useRef<VideoSequencePreviewRef>(null);
    const opsSourceRepairsRef = useRef(new Set<string>());
    const latestMediaTakesRef = useRef(mediaTakes);
    latestMediaTakesRef.current = mediaTakes;

    // Fast Refresh pode preservar o estado React enquanto troca o código. Se o
    // projeto já estava aberto com URLs expiradas/vazias, recupera os cards no
    // próprio Step 2 sem exigir que a pessoa volte à Home ou refaça os cortes.
    useEffect(() => {
        for (const take of mediaTakes) {
            const needsSource = take.externalMedia?.source === 'mileto_ops' &&
                !(take.proxyUrl || take.fileUrl || take.url);
            if (!needsSource || opsSourceRepairsRef.current.has(take.id)) continue;

            opsSourceRepairsRef.current.add(take.id);
            void recoverOpsTakeSource(take)
                .then((recoveredTake) => {
                    setMediaTakes((current) => current.map((candidate) => candidate.id === take.id ? {
                        ...candidate,
                        ...recoveredTake,
                        // Configurações que possam ter mudado durante a recuperação
                        // continuam pertencendo ao estado mais recente do editor.
                        trim: candidate.trim,
                        motionEffect: candidate.motionEffect,
                        transition: candidate.transition,
                        enhancement: candidate.enhancement,
                        sharpness: candidate.sharpness,
                        audio: candidate.audio,
                        muteOriginalAudio: candidate.muteOriginalAudio,
                    } : candidate));
                })
                .catch((error) => {
                    console.warn('[Step2] Não foi possível renovar um take do Mileto Ops:', (error as Error)?.message);
                })
                .finally(() => {
                    opsSourceRepairsRef.current.delete(take.id);
                });
        }
    }, [mediaTakes, setMediaTakes]);

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
    const allTakesMuted = mediaTakes.length > 0 && mediaTakes.every(
        (take) => normalizeTakeAudio(take.audio).mode === 'off',
    );
    const effectiveNarration = resolveEffectiveNarrationAudio(adData);
    const selectedMusic = musicLibrary.find((music) => music.id === selectedMusicId);
    const narrationTrackDuration = (() => {
        if (adData.audioConfig?.narration?.enabled === false) return 0;
        const narration = adData.audioConfig?.narration;
        const start = narration?.trimStart ?? 0;
        const end = narration?.trimEnd ?? narrationDuration;
        return end > start ? (narration?.offsetSec ?? 0) + (end - start) : 0;
    })();
    const backgroundTrackDuration = (() => {
        if (adData.audioConfig?.background?.enabled === false) return 0;
        if (!adData.musicAudioUrl && !selectedMusic) return 0;
        const background = adData.audioConfig?.background;
        const start = background?.trimStart ?? 0;
        const end = background?.trimEnd ?? selectedMusic?.durationSec ?? 0;
        return end > start ? (background?.offsetSec ?? 0) + (end - start) : 0;
    })();
    const narrationFallbackDuration = adData.audioConfig?.narration?.enabled === false ? 0 : narrationDuration;
    const automaticCutDuration = narrationTrackDuration || narrationFallbackDuration || backgroundTrackDuration;
    // A mixagem é o relógio final. Takes excedentes continuam editáveis, porém
    // nada depois do fim efetivo do áudio entra no preview ou na exportação.
    const totalDuration = automaticCutDuration > 0
        ? Math.min(rawTakesDuration, automaticCutDuration)
        : rawTakesDuration;
    const durationDelta = rawTakesDuration - automaticCutDuration;
    const isDurationShort = automaticCutDuration > 0 && durationDelta < -0.05;
    const hasDurationReserve = automaticCutDuration > 0 && durationDelta > 0.05;
    // O master termina com a narração quando ela existe (`amix duration=first`).
    // A música só define o relógio do projeto quando não há faixa narrada.
    const quickEditTargetDuration = automaticCutDuration;
    const quickEditRemaining = Math.max(0, quickEditTargetDuration - rawTakesDuration);
    const canQuickEdit = mediaTakes.length > 0
        && quickEditTargetDuration > 0
        && quickEditRemaining <= 0.05;

    const handleNext = () => {
        const missing = missingBeforeStep(3, adData, mediaTakes);
        if (missing.length) toast.warning(pendingWarningText(missing), { duration: 7000 });
        navigate('/wizard/step/3');
    };

    // Vídeo Moldura: a moldura PNG vira o overlay (mesma camada que os títulos
    // usam no modelo de takes). Não há legenda nem título.
    const handleFramePicked = (take: MediaTake) => {
        if (!/\.png$/i.test(take.fileName || '')) {
            toast.error('A moldura precisa ser um arquivo PNG com transparência.');
            return;
        }
        updateAdData({ frameOverlay: { ...take, objectFit: 'contain' } });
        setIsFramePickerOpen(false);
        toast.success('Moldura aplicada ao vídeo inteiro.');
    };

    const handleOpenExportMoldura = () => {
        if (mediaTakes.length === 0) {
            toast.warning('Adicione pelo menos um take antes de exportar.');
            return;
        }
        if (!adData.frameOverlay) {
            toast.warning('Escolha uma moldura PNG antes de exportar.');
            return;
        }
        setShowExportModal(true);
    };

    const handleTakeAudioMode = async (takeId: string, mode: TakeAudioMode) => {
        const take = latestMediaTakesRef.current.find((candidate) => candidate.id === takeId);
        if (!take) return;
        if (take.type !== 'video') {
            toast.error('Somente takes de vídeo podem fornecer áudio.');
            return;
        }

        if (mode !== 'isolated' || hasCurrentTakeIsolation(take)) {
            setMediaTakes((current) => current.map((candidate) => candidate.id === takeId
                ? {
                    ...candidate,
                    audio: { ...normalizeTakeAudio(candidate.audio), mode },
                    muteOriginalAudio: mode !== 'original',
                }
                : candidate));
            return;
        }

        if (isolatingTakeId) return;
        setIsolatingTakeId(takeId);
        const toastId = toast.loading(`Isolando a voz de ${take.fileName}...`);
        const sourceKey = takeOriginalSourceKey(take);
        try {
            const prepared = take.sharedAssetId
                ? await refreshSharedTakeForExport(take)
                : take.externalMedia?.source === 'mileto_ops'
                    ? await prepareOpsTakeForExport(take)
                    : take;
            const result = await isolateAudioSource({
                sourceUrl: prepared.fileUrl || prepared.url,
                sourcePath: prepared.backendPath,
                sourceType: 'take',
            });
            const latestTake = latestMediaTakesRef.current.find((candidate) => candidate.id === takeId);
            if (!latestTake || takeOriginalSourceKey(latestTake) !== sourceKey) {
                throw new Error('A mídia mudou durante o isolamento. O resultado antigo foi descartado.');
            }
            setMediaTakes((current) => current.map((candidate) => candidate.id === takeId
                ? {
                    ...candidate,
                    url: prepared.url,
                    backendPath: prepared.backendPath,
                    fileUrl: prepared.fileUrl,
                    proxyUrl: prepared.proxyUrl,
                    externalMedia: prepared.externalMedia,
                    audio: {
                        ...normalizeTakeAudio(candidate.audio),
                        mode: 'isolated',
                        isolatedAudioUrl: result.outputUrl,
                        isolatedAudioPath: result.outputPath,
                        isolationSourceKey: sourceKey,
                    },
                    muteOriginalAudio: true,
                }
                : candidate));
            toast.success(
                result.cacheHit ? 'Voz isolada recuperada e ativada.' : 'Voz isolada e ativada. O take original foi preservado.',
                { id: toastId },
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erro desconhecido';
            toast.error(`Não foi possível isolar este take: ${message}`, {
                id: toastId,
                description: 'A configuração anterior permaneceu ativa e o arquivo original não foi alterado.',
                duration: 9000,
            });
        } finally {
            setIsolatingTakeId(null);
        }
    };

    const handleTakeAudioVolume = (takeId: string, volume: number) => {
        setMediaTakes((current) => current.map((take) => take.id === takeId
            ? { ...take, audio: { ...normalizeTakeAudio(take.audio), volume } }
            : take));
    };

    const handleMuteToggle = (takeId: string) => {
        const take = latestMediaTakesRef.current.find((candidate) => candidate.id === takeId);
        if (!take || take.type !== 'video') return;
        const nextMode: TakeAudioMode = normalizeTakeAudio(take.audio).mode === 'off' ? 'original' : 'off';
        void handleTakeAudioMode(takeId, nextMode);
    };

    const handleToggleFit = (takeId: string) => {
        setMediaTakes((prev) =>
            prev.map((t) =>
                t.id === takeId ? { ...t, objectFit: t.objectFit === 'contain' ? 'cover' : 'contain' } : t
            )
        );
    };

    const handleMuteAll = (muted: boolean) => {
        setMediaTakes((prev) => prev.map((take) => ({
            ...take,
            muteOriginalAudio: muted,
            audio: {
                ...normalizeTakeAudio(take.audio),
                mode: muted || take.type !== 'video' ? 'off' : 'original',
            },
        })));
    };

    const seekToTakeStart = (index: number) => {
        previewRef.current?.seekToTake(index);
    };

    const handleDuplicateTake = (takeId: string) => {
        setMediaTakes((current) => {
            const sourceIndex = current.findIndex((take) => take.id === takeId);
            if (sourceIndex < 0) return current;
            const next = [...current];
            next.splice(sourceIndex + 1, 0, cloneMediaTake(current[sourceIndex]));
            return next;
        });
        toast.success('Take duplicado e inserido logo abaixo do original.');
    };

    const handleShuffleTakes = () => {
        if (mediaTakes.length < 2) {
            toast.info('Adicione pelo menos dois takes para embaralhar.');
            return;
        }
        setMediaTakes((current) => {
            const shuffled = current.map((take) => ({ ...take, transition: undefined }));
            for (let index = shuffled.length - 1; index > 0; index -= 1) {
                const target = Math.floor(Math.random() * (index + 1));
                [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
            }
            if (shuffled.every((take, index) => take.id === current[index]?.id)) {
                shuffled.push(shuffled.shift()!);
            }
            return shuffled;
        });
        toast.success('Takes embaralhados.', {
            description: 'As transições individuais foram removidas porque a ordem mudou.',
        });
    };

    const handleSaveTake = (
        takeId: string,
        newTrims: Array<{
            start: number;
            end: number;
            speedPresetId?: SpeedPresetType;
            kind: 'primary' | 'created';
        }>
    ) => {
        setMediaTakes((current) => {
            const sourceIndex = current.findIndex((take) => take.id === takeId);
            if (sourceIndex < 0 || newTrims.length === 0) return current;
            const source = current[sourceIndex];
            const orderedTrims = [
                ...newTrims.filter((trim) => trim.kind === 'primary').sort((a, b) => a.start - b.start),
                ...newTrims.filter((trim) => trim.kind === 'created').sort((a, b) => a.start - b.start),
            ];
            const replacements = orderedTrims.map((trim, index) => {
                if (index === 0) {
                    return {
                        ...source,
                        trim: { start: trim.start, end: trim.end },
                        speedPresetId: trim.speedPresetId ?? source.speedPresetId,
                    };
                }
                return {
                    ...cloneMediaTake(source, {
                        trim: { start: trim.start, end: trim.end },
                        label: trim.kind === 'created' ? 'novo take' : `corte ${index + 1}`,
                    }),
                    speedPresetId: trim.speedPresetId ?? source.speedPresetId,
                };
            });
            const next = [...current];
            next.splice(sourceIndex, 1, ...replacements);
            return next;
        });
        if (newTrims.length > 1) {
            toast.success(`${newTrims.length} takes criados a partir da mesma mídia.`);
        }
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

    const handleAutomaticCuts = () => {
        const audioConfig = adData.audioConfig;
        let effectiveAudioDuration = 0;

        if (audioConfig?.narration?.enabled !== false) {
            const narration = audioConfig?.narration;
            const narrationStart = narration?.trimStart || 0;
            const narrationEnd = narration?.trimEnd || narrationDuration;
            const narrationOffset = narration?.offsetSec || 0;
            if (narrationEnd > narrationStart) {
                effectiveAudioDuration = narrationOffset + (narrationEnd - narrationStart);
            }
        }

        if (effectiveAudioDuration === 0) effectiveAudioDuration = narrationDuration;

        if (effectiveAudioDuration === 0 && audioConfig?.background?.enabled !== false) {
            const background = audioConfig?.background;
            const selectedMusic = musicLibrary.find((music) => music.id === selectedMusicId);
            const musicStart = background?.trimStart || 0;
            const musicEnd = background?.trimEnd || selectedMusic?.durationSec || 0;
            const musicOffset = background?.offsetSec || 0;
            if (musicEnd > musicStart) effectiveAudioDuration = musicOffset + (musicEnd - musicStart);
        }

        if (mediaTakes.length === 0 || effectiveAudioDuration === 0) {
            if (effectiveAudioDuration === 0) toast.error('Adicione uma narração ou música para ajustar.');
            return;
        }

        try {
            const result = automaticCutTakes(
                mediaTakes,
                effectiveAudioDuration,
                (source, index) => `${source.id}-loop-${Date.now()}-${index}`,
            );
            setMediaTakes(result.takes);
            toast.success(
                result.looped
                    ? `Cortes em loop ajustados para ${effectiveAudioDuration.toFixed(1)}s.`
                    : `Cortes automáticos ajustados para ${effectiveAudioDuration.toFixed(1)}s.`,
            );
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível ajustar os cortes.');
        }
    };

    const handleQuickEdit = async () => {
        if (!canQuickEdit || isQuickEditing) return;
        setIsQuickEditing(true);
        try {
            const quickEdit = await applyQuickEdit(mediaTakes, quickEditTargetDuration, adData.globalTransition);
            const quickEditedTakes = quickEdit.takes;

            setMediaTakes(quickEditedTakes);
            updateAdData({
                globalTransition: quickEdit.transition,
                transitionPath: quickEdit.transition.filePath,
                // Preserva o giro que o usuário já escolheu no painel de transições.
                transitionRotation: adData.transitionRotation ?? 0,
                transitionVolume: 1,
                transitionMuted: false,
            });
            toast.success(`Edição rápida aplicada em ${quickEditedTakes.length} ${quickEditedTakes.length === 1 ? 'take' : 'takes'}.`, {
                description: 'Cortes, preenchimento, nitidez suave, In + Out, áudio mudo e Film Burn configurados.',
            });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível aplicar a edição rápida.');
        } finally {
            setIsQuickEditing(false);
        }
    };



    return (
        <ErrorBoundary>
            <div className="mx-auto w-full max-w-[1320px] pb-20">
                <header className="mb-3 text-center">
                    <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
                        Seus{' '}
                        <span className="bg-linear-to-r from-brand-lime to-brand-accent bg-clip-text text-transparent">
                            Takes Visuais
                        </span>
                    </h2>
                    <p className="text-brand-muted mt-1.5 max-w-2xl mx-auto text-xs font-medium">
                        Adicione vídeos ou gere imagens por IA para compor o anúncio.
                    </p>
                </header>

                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(620px,1fr)_minmax(240px,270px)]">
                    {/* Timeline/Segments */}
                    <div className="space-y-3">
                        {/* Compact, persistent timing summary */}
                        <div className="isolate z-30 overflow-visible rounded-2xl border border-white/8 bg-[#11181b] shadow-[0_14px_35px_rgba(0,0,0,.42)] xl:sticky xl:top-0">
                            <div className="flex min-h-[68px] flex-wrap items-center gap-3 px-4 py-3">
                                <div className="flex min-w-[150px] flex-1 items-center gap-3">
                                    <span
                                        className={cn(
                                            'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
                                            isDurationShort ? 'bg-amber-400/10 text-amber-300' : 'bg-brand-lime/10 text-brand-lime'
                                        )}
                                    >
                                        <Clock className="h-4.5 w-4.5" />
                                    </span>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.13em] text-foreground">Tempo do projeto</p>
                                        <p className="mt-0.5 text-[10px] font-medium text-brand-muted">
                                            O vídeo final acompanha a narração
                                        </p>
                                    </div>
                                </div>

                            <div className="flex items-center gap-4 rounded-xl border border-white/6 bg-black/10 px-3 py-2">
                                <div className="text-center">
                                    <p className="text-[8px] font-black uppercase tracking-widest text-brand-muted">Narração</p>
                                    <p className="mt-0.5 font-mono text-xs font-black text-foreground">{narrationDuration.toFixed(1)}s</p>
                                </div>
                                <span className="h-7 w-px bg-white/7" />
                                <div className="text-center">
                                    <p className="text-[8px] font-black uppercase tracking-widest text-brand-muted">Takes</p>
                                    <p className="mt-0.5 font-mono text-xs font-black text-foreground">{rawTakesDuration.toFixed(1)}s</p>
                                </div>
                                <span className="h-7 w-px bg-white/7" />
                                <div className="text-center">
                                    <p className="text-[8px] font-black uppercase tracking-widest text-brand-muted">Final</p>
                                    <p className="mt-0.5 font-mono text-xs font-black text-brand-lime">{totalDuration.toFixed(1)}s</p>
                                </div>
                            </div>

                            <span
                                className={cn(
                                    'rounded-lg border px-2.5 py-2 text-[9px] font-black uppercase tracking-wider',
                                    mediaTakes.length === 0
                                        ? 'border-white/8 bg-white/[0.035] text-brand-muted'
                                        : isDurationShort
                                          ? 'border-amber-400/20 bg-amber-400/10 text-amber-300'
                                          : 'border-brand-lime/20 bg-brand-lime/10 text-brand-lime'
                                )}
                                title={
                                    hasDurationReserve
                                        ? `${durationDelta.toFixed(1)}s excedentes ficam disponíveis para edição, mas não passam do fim do áudio.`
                                        : undefined
                                }
                            >
                                {mediaTakes.length === 0
                                    ? 'Aguardando takes'
                                    : narrationDuration <= 0
                                      ? 'Sem narração'
                                      : isDurationShort
                                      ? `Faltam ${Math.abs(durationDelta).toFixed(1)}s`
                                      : hasDurationReserve
                                        ? `+${durationDelta.toFixed(1)}s de reserva`
                                        : 'Sincronizado'}
                            </span>
                            </div>

                            <div className="flex items-center justify-between gap-3 border-t border-white/7 px-3 py-2.5">
                                <VideoUpload />

                                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                                    <button
                                        type="button"
                                        onClick={handleQuickEdit}
                                        disabled={!canQuickEdit || isQuickEditing}
                                        className={cn(
                                            'mr-1 inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[10px] font-black uppercase tracking-wider transition disabled:cursor-not-allowed',
                                            canQuickEdit
                                                ? 'border-brand-lime/25 bg-brand-lime/[0.075] text-brand-lime hover:border-brand-lime/45 hover:bg-brand-lime/[0.12]'
                                                : 'border-white/8 bg-white/[0.035] text-brand-muted/45'
                                        )}
                                        title={
                                            canQuickEdit
                                                ? 'Aplicar cortes e acabamento rápido em todos os takes'
                                                : quickEditTargetDuration <= 0
                                                  ? 'Gere ou selecione a trilha do projeto primeiro'
                                                  : `Adicione mais ${quickEditRemaining.toFixed(1)}s de takes para liberar`
                                        }
                                        aria-label="Edição rápida"
                                    >
                                        {isQuickEditing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                                        Edição rápida
                                        {!canQuickEdit && quickEditTargetDuration > 0 && (
                                            <span className="font-mono text-[8px] opacity-70">{rawTakesDuration.toFixed(0)}/{quickEditTargetDuration.toFixed(0)}s</span>
                                        )}
                                    </button>

                                    {isMoldura && (
                                        <button
                                            type="button"
                                            onClick={() => setIsFramePickerOpen(true)}
                                            className={cn(
                                                'mr-1 inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[10px] font-black uppercase tracking-wider transition',
                                                adData.frameOverlay
                                                    ? 'border-violet-400/50 bg-violet-500/20 text-violet-100 shadow-[0_0_14px_rgba(139,92,246,0.25)] hover:bg-violet-500/28'
                                                    : 'border-violet-400/25 bg-violet-500/[0.09] text-violet-300 hover:border-violet-400/45 hover:bg-violet-500/16'
                                            )}
                                            title={adData.frameOverlay ? 'Trocar a moldura do vídeo' : 'Escolher a moldura PNG — fica por cima de todos os takes'}
                                            aria-label="Moldura"
                                        >
                                            <Frame className="h-4 w-4" />
                                            Moldura
                                            {adData.frameOverlay && <Check className="h-3 w-3" />}
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={handleShuffleTakes}
                                        disabled={mediaTakes.length < 2}
                                        className="grid h-9 w-9 place-items-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-300 transition hover:bg-violet-500/18 disabled:cursor-not-allowed disabled:opacity-35"
                                        title="Embaralhar a ordem dos takes"
                                        aria-label="Embaralhar a ordem dos takes"
                                    >
                                        <Shuffle className="h-4 w-4" />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleAutomaticCuts}
                                        disabled={mediaTakes.length === 0}
                                        className="grid h-9 w-9 place-items-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-300 transition hover:bg-blue-500/18 disabled:cursor-not-allowed disabled:opacity-35"
                                        title="Primeiro ajuste: cortes automáticos em todos os takes"
                                        aria-label="Cortes automáticos em todos os takes"
                                    >
                                        <Scissors className="h-4 w-4" />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleMuteAll(!allTakesMuted)}
                                        disabled={mediaTakes.length === 0}
                                        className={cn(
                                            'grid h-9 w-9 place-items-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-35',
                                            allTakesMuted
                                                ? 'border-amber-400/25 bg-amber-400/12 text-amber-300'
                                                : 'border-amber-400/12 bg-amber-400/[0.055] text-amber-300/75 hover:bg-amber-400/12'
                                        )}
                                        title={allTakesMuted ? 'Ativar som em todos os takes' : 'Silenciar todos os takes'}
                                        aria-label={allTakesMuted ? 'Ativar som em todos os takes' : 'Silenciar todos os takes'}
                                    >
                                        {allTakesMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            const allContain = mediaTakes.every((take) => take.objectFit === 'contain');
                                            setMediaTakes((current) => current.map((take) => ({ ...take, objectFit: allContain ? 'cover' : 'contain' })));
                                        }}
                                        disabled={mediaTakes.length === 0}
                                        className="grid h-9 w-9 place-items-center rounded-lg border border-cyan-500/15 bg-cyan-500/[0.07] text-cyan-300/80 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-35"
                                        title={mediaTakes.every((take) => take.objectFit === 'contain') ? 'Preencher todos os takes' : 'Encaixar todos os takes'}
                                        aria-label={mediaTakes.every((take) => take.objectFit === 'contain') ? 'Preencher todos os takes' : 'Encaixar todos os takes'}
                                    >
                                        {mediaTakes.length > 0 && mediaTakes.every((take) => take.objectFit === 'contain')
                                            ? <Maximize className="h-4 w-4" />
                                            : <Minimize className="h-4 w-4" />}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEnhancementTargetTakeId(null);
                                            setShowEnhancementModal(true);
                                        }}
                                        disabled={mediaTakes.length === 0}
                                        className="relative grid h-9 w-9 place-items-center rounded-lg border border-brand-lime/20 bg-brand-lime/10 text-brand-lime transition hover:bg-brand-lime/16 disabled:cursor-not-allowed disabled:opacity-35"
                                        title="Aprimorar todos os takes"
                                        aria-label="Aprimorar todos os takes"
                                    >
                                        <Wand2 className="h-4 w-4" />
                                        {(adData.videoEnhancement?.enabled || (adData.videoEnhancement?.globalSharpness || 0) > 0) && (
                                            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-lime shadow-[0_0_7px_rgba(0,230,118,.9)]" />
                                        )}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setZoomTargetTakeId(null);
                                            setShowZoomModal(true);
                                        }}
                                        disabled={mediaTakes.length === 0}
                                        className="relative grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/15 bg-emerald-500/[0.07] text-emerald-300/80 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-35"
                                        title="Zoom em todos ou em vários takes"
                                        aria-label="Zoom em todos ou em vários takes"
                                    >
                                        <ZoomIn className="h-4 w-4" />
                                        {mediaTakes.some((take) => take.motionEffect) && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-300" />}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTargetTakeId(null);
                                            setShowTransitionsModal(true);
                                        }}
                                        disabled={mediaTakes.length === 0}
                                        className="relative grid h-9 w-9 place-items-center rounded-lg border border-fuchsia-500/15 bg-fuchsia-500/[0.07] text-fuchsia-300/80 transition hover:bg-fuchsia-500/15 disabled:cursor-not-allowed disabled:opacity-35"
                                        title="Transição entre todos os takes"
                                        aria-label="Transição entre todos os takes"
                                    >
                                        <Sparkles className="h-4 w-4" />
                                        {adData.globalTransition && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-fuchsia-300" />}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setConfirmClear(true)}
                                        disabled={mediaTakes.length === 0}
                                        className="grid h-9 w-9 place-items-center rounded-lg border border-red-500/15 bg-red-500/[0.055] text-red-300/75 transition hover:bg-red-500/12 disabled:cursor-not-allowed disabled:opacity-35"
                                        title="Remover todos os takes"
                                        aria-label="Remover todos os takes"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>

                                    <span className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/7 bg-black/10 px-2.5 font-mono text-[10px] font-black text-brand-muted" title="Quantidade de takes">
                                        <Layers3 className="h-3.5 w-3.5" />
                                        {mediaTakes.length}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Segments List */}
                        <div className="rounded-3xl border border-black/5 bg-brand-card p-4 shadow-2xl dark:border-white/5 sm:p-5">

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
                                        <div className="relative flex flex-col gap-2.5">
                                            {mediaTakes.map((take, index) => (
                                                <SortableTake
                                                    key={take.id}
                                                    take={take}
                                                    index={index}
                                                    onRemove={removeMediaTake}
                                                    onEdit={setEditingTake}
                                                    onDuplicate={handleDuplicateTake}
                                                    onToggleFit={handleToggleFit}
                                                    onEnhance={(takeId) => {
                                                        setEnhancementTargetTakeId(takeId);
                                                        setShowEnhancementModal(true);
                                                    }}
                                                    onZoom={(takeId) => {
                                                        setZoomTargetTakeId(takeId);
                                                        setShowZoomModal(true);
                                                    }}
                                                    onTransition={(takeId) => {
                                                        setTargetTakeId(takeId);
                                                        setShowTransitionsModal(true);
                                                    }}
                                                    onMute={handleMuteToggle}
                                                    onAudioMode={(takeId, mode) => {
                                                        void handleTakeAudioMode(takeId, mode);
                                                    }}
                                                    onAudioVolume={handleTakeAudioVolume}
                                                    isIsolatingAudio={isolatingTakeId === take.id}
                                                    onSeek={seekToTakeStart}
                                                    isLast={index === mediaTakes.length - 1}
                                                    format={adData.format}
                                                />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            )}
                        </div>
                    </div>

                    {/* Compact, persistent preview. The central list is the single source of take controls. */}
                    <div className="self-start xl:sticky xl:top-0">
                        <VideoSequencePreview
                            ref={previewRef}
                            takes={mediaTakes}
                            masterAudioUrl={adData.masterAudioUrl}
                            onMuteToggle={handleMuteToggle}
                            onMuteAll={handleMuteAll}
                            showTakeList={false}
                            showHeaderMute={false}
                            compactViewport
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
                {isMoldura ? (
                    <div className="fixed bottom-0 right-0 left-0 z-40 flex h-16 items-center justify-between gap-3 border-t border-border bg-background/95 px-5 pr-24 backdrop-blur-xl">
                        {/* Moldura (esquerda): chip da imagem + seletor de animação sutil */}
                        <div className="flex min-w-0 items-center gap-2">
                            {adData.frameOverlay ? (
                                <>
                                    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/[.09] px-2 py-1.5">
                                        <img
                                            src={adData.frameOverlay.proxyUrl || adData.frameOverlay.fileUrl || adData.frameOverlay.url}
                                            alt="Moldura selecionada"
                                            className="h-7 w-7 shrink-0 rounded bg-black/30 object-contain"
                                        />
                                        <span className="max-w-[130px] truncate text-[11px] font-semibold text-foreground">
                                            {adData.frameOverlay.fileName}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => updateAdData({ frameOverlay: undefined, frameOverlayAnimation: 'none' })}
                                            title="Remover moldura"
                                            className="grid h-6 w-6 place-items-center rounded text-red-300 transition hover:bg-red-500/15"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    {/* Animação sutil */}
                                    <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-white/[.03] py-1 pr-1 pl-1.5">
                                        <span className="px-1 text-[9px] font-black uppercase tracking-wider text-brand-muted">Animação</span>
                                        {MOLDURA_ANIMATIONS.map((opt) => {
                                            const active = (adData.frameOverlayAnimation ?? 'none') === opt.id;
                                            return (
                                                <button
                                                    key={opt.id}
                                                    type="button"
                                                    onClick={() => updateAdData({ frameOverlayAnimation: opt.id })}
                                                    className={cn(
                                                        'rounded-md px-2 py-1 text-[10px] font-bold transition',
                                                        active
                                                            ? 'bg-violet-500/25 text-violet-100 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
                                                            : 'text-brand-muted hover:bg-white/5 hover:text-foreground'
                                                    )}
                                                >
                                                    {opt.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-muted">
                                    <Frame className="h-3.5 w-3.5 text-violet-300" />
                                    Escolha a <span className="font-bold text-violet-300">Moldura</span> na barra acima
                                </span>
                            )}
                        </div>
                        {/* Export (direita) */}
                        <button
                            onClick={handleOpenExportMoldura}
                            className="flex items-center gap-2.5 rounded-xl bg-linear-to-r from-brand-lime to-brand-accent px-8 py-2.5 text-xs font-extrabold uppercase tracking-widest text-[#0a0f12] transition-transform hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,230,118,0.4)] active:scale-[0.98]"
                        >
                            <Download className="h-5 w-5 shrink-0" />
                            <span>Exportar e Concluir</span>
                        </button>
                    </div>
                ) : (
                    <div className="fixed bottom-0 right-0 left-0 z-40 flex h-16 items-center justify-end border-t border-border bg-background/95 px-5 pr-24 backdrop-blur-xl">
                        <button
                            onClick={handleNext}
                            className="px-8 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-lg text-sm transition-all flex items-center gap-2 shadow-lg shadow-green-900/10"
                        >
                            Próximo: Estilo
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* Vídeo Moldura: picker do PNG + export (reaproveita o pipeline de overlay) */}
                {isMoldura && isFramePickerOpen && (
                    <MediaSourceModal
                        kind="image"
                        title="Escolher moldura PNG"
                        onClose={() => setIsFramePickerOpen(false)}
                        onTakePicked={handleFramePicked}
                    />
                )}
                {isMoldura && showExportModal && (
                    <ExportModal
                        onClose={() => setShowExportModal(false)}
                        mediaTakes={mediaTakes}
                        masterAudioUrl={adData.masterAudioUrl || effectiveNarration.url || undefined}
                        transitionPath={adData.globalTransition?.filePath || undefined}
                        transitionRotation={adData.transitionRotation ?? 0}
                    />
                )}
            </div>

            {/* Transitions Modal */}
            <TransitionsModal
                isOpen={showTransitionsModal}
                onClose={() => {
                    setShowTransitionsModal(false);
                    setTargetTakeId(null);
                }}
                targetTakeId={targetTakeId}
                />

                <ZoomEffectsModal
                    isOpen={showZoomModal}
                    takes={mediaTakes}
                    targetTakeId={zoomTargetTakeId}
                    onClose={() => {
                        setShowZoomModal(false);
                        setZoomTargetTakeId(null);
                    }}
                    onApply={(takeIds, effect) => {
                        const selected = new Set(takeIds);
                        setMediaTakes((current) => current.map((take) => selected.has(take.id) ? { ...take, motionEffect: effect || undefined } : take));
                        toast.success(effect ? `Zoom aplicado em ${takeIds.length} ${takeIds.length === 1 ? 'take' : 'takes'}.` : 'Zoom removido dos takes selecionados.');
                    }}
                />

                <VideoEnhancementModal
                    isOpen={showEnhancementModal}
                    takes={mediaTakes}
                    settings={normalizeVideoEnhancement(adData.videoEnhancement)}
                    targetTakeId={enhancementTargetTakeId}
                    onClose={() => {
                        setShowEnhancementModal(false);
                        setEnhancementTargetTakeId(null);
                    }}
                    onApplyGlobal={(videoEnhancement) => {
                        updateAdData({ videoEnhancement });
                        setMediaTakes((current) => current.map((take) => ({
                            ...take,
                            enhancement: undefined,
                            sharpness: undefined,
                        })));
                        toast.success('Melhoria aplicada a todos os takes.');
                    }}
                    onApplyTake={(takeId, enhancement, sharpness) => {
                        setMediaTakes((current) => current.map((take) => take.id === takeId
                            ? { ...take, enhancement, sharpness }
                            : take));
                        toast.success('Melhoria aplicada somente ao take escolhido.');
                    }}
                    onResetAll={() => {
                        updateAdData({ videoEnhancement: { enabled: false, intensity: 'balanced', globalSharpness: 0 } });
                        setMediaTakes((current) => current.map((take) => ({ ...take, enhancement: undefined, sharpness: undefined })));
                        toast.success('Todas as melhorias foram removidas.');
                    }}
                    onResetTake={(takeId) => {
                        setMediaTakes((current) => current.map((take) => take.id === takeId
                            ? { ...take, enhancement: undefined, sharpness: undefined }
                            : take));
                        toast.success('Este take voltou a usar o ajuste global.');
                    }}
                />
        </ErrorBoundary>
    );
};
