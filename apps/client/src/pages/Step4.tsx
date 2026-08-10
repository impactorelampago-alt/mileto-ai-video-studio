import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Sparkles,
    Wand2,
    Power,
    Clock,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Volume2,
    VolumeX,
    Download,
    Play,
    Bug,
    MapPin,
    Image as ImageIcon,
    Trash2,
    Upload,
    RotateCcw,
    Type,
} from 'lucide-react';
import { useWizard, SHOW_DEBUG_FEATURES } from '../context/WizardContext';
import { VideoSequencePreview, VideoSequencePreviewRef } from '../components/VideoSequencePreview';
import { TitleHook } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import axios from 'axios';
import { localAuthHeaders } from '../lib/serverAuth';
import { DynamicTitleRenderer } from '../components/DynamicTitleRenderer';
import { TextAnimationPicker } from '../components/TextAnimationPicker';
import { ExportModal } from '../components/ExportModal';
import { PREMIUM_TITLE_GROUPS, PREMIUM_TITLE_MODELS } from '../lib/premiumTitleModels';
import {
    CTA_TITLE_MODELS,
    IMAGE_TITLE_MODEL,
    LOCATION_TITLE_MODELS,
    SIMPLE_TITLE_MODELS,
    titleStylePresetById,
    titleStyleSelectionPatch,
    type TitleStylePreset,
} from '../lib/titleModelCatalog';
import { missingForCompletion, pendingWarningText } from '../lib/workflowWarnings';
import { narrationSourceKey } from '../lib/narrationState';
import { bindTitlesToBrandPalette, resolveOpsProjectBrand } from '../lib/opsProjectBrand';
import { TITLE_EDITOR_PORTRAIT_PREVIEW_WIDTH } from '../lib/titlePreviewGeometry';
import { limitTitleWords } from '../lib/titleText';

const EMPTY_TITLES: TitleHook[] = [];

const formatTimeValue = (value: number) => Number(Math.max(0, value).toFixed(2)).toString().replace('.', ',');

const TimeField = ({
    value,
    min = 0,
    onCommit,
    ariaLabel,
}: {
    value: number;
    min?: number;
    onCommit: (value: number) => void;
    ariaLabel: string;
}) => {
    const [draft, setDraft] = useState(() => formatTimeValue(value));

    useEffect(() => setDraft(formatTimeValue(value)), [value]);

    const commit = () => {
        const parsed = Number(draft.replace(',', '.'));
        if (!Number.isFinite(parsed)) {
            setDraft(formatTimeValue(value));
            return;
        }
        const next = Math.max(min, parsed);
        onCommit(next);
        setDraft(formatTimeValue(next));
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            aria-label={ariaLabel}
            value={draft}
            onChange={(event) => {
                const next = event.target.value;
                if (/^\d*(?:[.,]\d*)?$/.test(next)) setDraft(next);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commit();
                    event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                    setDraft(formatTimeValue(value));
                    event.currentTarget.blur();
                }
            }}
            className="h-8 w-[62px] rounded-md border border-white/8 bg-background px-2 text-center font-mono text-xs text-foreground outline-none transition-colors focus:border-brand-accent/60"
        />
    );
};

const TITLE_FONT_OPTIONS = [
    'DM Sans',
    'Inter',
    'Poppins',
    'Montserrat',
    'League Spartan',
    'Space Grotesk',
    'Archivo Black',
    'Bebas Neue',
    'Anton',
    'Oswald',
    'Playfair Display',
    'Impact',
];

const titleLibraryHeaderClass = (isOpen: boolean) => cn(
    'group flex min-h-14 cursor-pointer items-center justify-between border border-brand-accent/25 bg-brand-dark/85 px-4 py-3 shadow-sm transition-colors hover:border-brand-accent/45 hover:bg-brand-accent/[.055]',
    isOpen ? 'rounded-t-xl border-b-brand-accent/10' : 'rounded-xl'
);

const titleLibraryBodyClass =
    'border border-t-0 border-brand-accent/20 bg-brand-dark/40 p-4 rounded-b-xl animate-in slide-in-from-top-2 duration-200';

const TitleFontPicker = ({
    value,
    onChange,
}: {
    value: string;
    onChange: (fontFamily: string) => void;
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="min-w-0">
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    setIsOpen((open) => !open);
                }}
                className={cn(
                    'flex h-12 w-full items-center justify-between rounded-xl border px-3 text-left transition-colors',
                    isOpen
                        ? 'border-brand-accent/60 bg-brand-accent/10'
                        : 'border-white/8 bg-black/20 hover:border-brand-accent/35 hover:bg-brand-accent/[.055]'
                )}
                aria-expanded={isOpen}
            >
                <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                        <Type className="h-4 w-4" />
                    </span>
                    <span className="truncate text-xs font-bold text-foreground" style={{ fontFamily: value }}>
                        {value}
                    </span>
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-brand-accent transition-transform', isOpen && 'rotate-180')} />
            </button>

            {isOpen && (
                <div
                    className="mt-2 grid grid-cols-2 gap-1.5 rounded-xl border border-brand-accent/25 bg-[#09110f] p-2 shadow-[0_16px_36px_rgba(0,0,0,.38)]"
                    onClick={(event) => event.stopPropagation()}
                >
                    {TITLE_FONT_OPTIONS.map((fontFamily) => {
                        const selected = fontFamily === value;
                        return (
                            <button
                                key={fontFamily}
                                type="button"
                                onClick={() => {
                                    onChange(fontFamily);
                                    setIsOpen(false);
                                }}
                                className={cn(
                                    'flex min-h-10 items-center rounded-lg border px-2.5 text-left text-[11px] transition-colors',
                                    selected
                                        ? 'border-brand-accent/45 bg-brand-accent/15 text-brand-accent'
                                        : 'border-transparent bg-white/[.035] text-foreground hover:border-brand-accent/25 hover:bg-brand-accent/[.08]'
                                )}
                                style={{ fontFamily }}
                            >
                                {fontFamily}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const Step4 = () => {
    const { adData, updateAdData, mediaTakes, isDebugMode, setIsDebugMode } = useWizard();
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);
    // Accordion states
    const [isSimplesOpen, setIsSimplesOpen] = useState(false);
    const [isCtaOpen, setIsCtaOpen] = useState(false);
    const [isPremiumOpen, setIsPremiumOpen] = useState(false);
    const [isLocationOpen, setIsLocationOpen] = useState(false);
    const [isCustomImgOpen, setIsCustomImgOpen] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const previewRef = useRef<VideoSequencePreviewRef>(null);

    const currentSourceKey = narrationSourceKey(adData);
    const currentCaptions = adData.captions?.sourceKey === currentSourceKey ? adData.captions : undefined;
    const titles = (adData.captions?.segments?.length && !currentCaptions)
        || (adData.dynamicTitlesSourceKey && adData.dynamicTitlesSourceKey !== currentSourceKey)
        ? EMPTY_TITLES
        : adData.dynamicTitles || EMPTY_TITLES;
    const orderedTitles = useMemo(
        () => titles
            .map((title, originalIndex) => ({ title, originalIndex }))
            .sort((left, right) =>
                left.title.startSec - right.title.startSec || left.originalIndex - right.originalIndex
            )
            .map(({ title }) => title),
        [titles]
    );
    const titleStateRef = useRef<TitleHook[]>(titles);
    const titleHistoryRef = useRef<{
        undo: TitleHook[][];
        redo: TitleHook[][];
        pendingBase: TitleHook[] | null;
        timer: ReturnType<typeof setTimeout> | null;
        restoring: boolean;
    }>({ undo: [], redo: [], pendingBase: null, timer: null, restoring: false });

    const cloneTitles = useCallback((items: TitleHook[]) => items.map((title) => ({ ...title })), []);

    const persistManualTitles = useCallback((items: TitleHook[]) => {
        const activeItems = items.filter((title) => title.isActive);
        const required = adData.titleGenerationSummary?.semanticCoverage?.required
            || (['hook', 'offer_or_benefit', 'cta'] as const).filter((role) =>
                activeItems.some((title) => title.semanticRoles?.includes(role))
            );
        const covered = required.filter((role) =>
            activeItems.some((title) => title.semanticRoles?.includes(role))
        );
        updateAdData({
            dynamicTitles: items,
            dynamicTitlesSourceKey: currentSourceKey,
            titleGenerationSummary: {
                ...adData.titleGenerationSummary,
                requested: adData.titleGenerationSummary?.requested ?? false,
                outcome: 'manual',
                titleCount: activeItems.length,
                semanticCoverage: {
                    required: [...required],
                    covered,
                    missing: required.filter((role) => !covered.includes(role)),
                },
                warning: undefined,
                warnings: undefined,
                diagnostic: undefined,
                diagnostics: undefined,
                generatedAt: new Date().toISOString(),
            },
        });
    }, [adData.titleGenerationSummary, currentSourceKey, updateAdData]);

    const flushPendingTitleHistory = useCallback(() => {
        const history = titleHistoryRef.current;
        if (history.timer) clearTimeout(history.timer);
        history.timer = null;
        if (!history.pendingBase) return;
        history.undo.push(history.pendingBase);
        if (history.undo.length > 60) history.undo.shift();
        history.pendingBase = null;
    }, []);

    useEffect(() => {
        const history = titleHistoryRef.current;
        const previous = titleStateRef.current;
        titleStateRef.current = titles;

        if (history.restoring) {
            history.restoring = false;
            return;
        }
        if (previous === titles) return;

        if (!history.pendingBase) history.pendingBase = cloneTitles(previous);
        history.redo = [];
        if (history.timer) clearTimeout(history.timer);
        history.timer = setTimeout(flushPendingTitleHistory, 450);
    }, [cloneTitles, flushPendingTitleHistory, titles]);

    useEffect(
        () => () => {
            const timer = titleHistoryRef.current.timer;
            if (timer) clearTimeout(timer);
        },
        []
    );

    const restoreTitleSnapshot = useCallback(
        (snapshot: TitleHook[]) => {
            const restored = cloneTitles(snapshot);
            titleHistoryRef.current.restoring = true;
            titleStateRef.current = restored;
            persistManualTitles(restored);
            setSelectedTitleId((current) =>
                current && restored.some((title) => title.id === current) ? current : (restored[0]?.id ?? null)
            );
        },
        [cloneTitles, persistManualTitles]
    );

    const undoTitleChange = useCallback(() => {
        flushPendingTitleHistory();
        const history = titleHistoryRef.current;
        const previous = history.undo.pop();
        if (!previous) return;
        history.redo.push(cloneTitles(titleStateRef.current));
        restoreTitleSnapshot(previous);
    }, [cloneTitles, flushPendingTitleHistory, restoreTitleSnapshot]);

    const redoTitleChange = useCallback(() => {
        flushPendingTitleHistory();
        const history = titleHistoryRef.current;
        const next = history.redo.pop();
        if (!next) return;
        history.undo.push(cloneTitles(titleStateRef.current));
        restoreTitleSnapshot(next);
    }, [cloneTitles, flushPendingTitleHistory, restoreTitleSnapshot]);

    useEffect(() => {
        const handleHistoryShortcut = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const target = event.target as HTMLElement | null;
            const isNativeEditor =
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLSelectElement ||
                !!target?.isContentEditable;
            if (isNativeEditor) return;

            const key = event.key.toLocaleLowerCase('pt-BR');
            if (key === 'z') {
                event.preventDefault();
                if (event.shiftKey) redoTitleChange();
                else undoTitleChange();
            } else if (key === 'y') {
                event.preventDefault();
                redoTitleChange();
            }
        };
        window.addEventListener('keydown', handleHistoryShortcut);
        return () => window.removeEventListener('keydown', handleHistoryShortcut);
    }, [redoTitleChange, undoTitleChange]);

    useEffect(() => {
        setSelectedTitleId(null);
    }, []);

    const handleGenerateTitles = async () => {
        if (isGenerating) return;
        if (!currentCaptions?.segments?.length) {
            toast.error(adData.captions?.segments?.length
                ? 'A narração mudou. Gere novamente as legendas na Etapa 3 antes dos títulos.'
                : 'Gere as legendas na Etapa 3 primeiro!');
            return;
        }

        setIsGenerating(true);
        const toastId = toast.loading('Lendo roteiro e gerando ganchos de atenção com IA...');

        try {
            const resolvedBrand = await resolveOpsProjectBrand(adData.opsCompany);
            const effectivePalette = resolvedBrand.required ? resolvedBrand.palette : adData.brandPalette;
            if (resolvedBrand.required) {
                const nextAdData = { ...adData, brandPalette: effectivePalette, brandPaletteUpdatedAt: resolvedBrand.paletteUpdatedAt };
                updateAdData({
                    brandPalette: effectivePalette,
                    brandPaletteUpdatedAt: resolvedBrand.paletteUpdatedAt,
                    dynamicTitles: bindTitlesToBrandPalette(nextAdData),
                });
            }
            const apiBaseUrl = (window as Window & { API_BASE_URL?: string }).API_BASE_URL || 'http://localhost:3301';
            const res = await axios.post(
                `${apiBaseUrl}/api/video/generate-titles`,
                {
                    script: adData.narrationText,
                    captions: currentCaptions,
                    format: adData.format,
                    brandPalette: effectivePalette,
                    companyId: resolvedBrand.company?.id || null,
                    opsViewContextId: resolvedBrand.context?.contextId || null,
                },
                { headers: await localAuthHeaders() }
            );

            if (res.data.ok && Array.isArray(res.data.titles)) {
                const finalTitles = (res.data.titles || []).map((t: TitleHook) => ({
                    ...t,
                    isActive: true,
                    hasSound: true,
                }));
                const warning = String(res.data.warning || '').trim() || undefined;
                updateAdData({
                    dynamicTitles: finalTitles,
                    dynamicTitlesSourceKey: currentSourceKey,
                    titleGenerationSummary: {
                        requested: true,
                        outcome: finalTitles.length
                            ? (res.data.source === 'local' ? 'fallback' : 'ai')
                            : 'none',
                        titleCount: finalTitles.length,
                        serverAttempts: Number(res.data.attempts) || 0,
                        clientRequests: 1,
                        configSource: res.data.configSource,
                        semanticCoverage: res.data.semanticCoverage,
                        metrics: res.data.metrics,
                        warning,
                        warnings: res.data.warnings,
                        diagnostic: res.data.diagnostic,
                        generatedAt: new Date().toISOString(),
                    },
                });
                setSelectedTitleId(null);
                if (finalTitles.length) {
                    const sourceLabel = res.data.source === 'local' ? 'fallback local' : 'IA';
                    toast.success(`${finalTitles.length} título(s) gerado(s) por ${sourceLabel}.`, {
                        id: toastId,
                        description: warning,
                    });
                } else {
                    toast.warning(warning || 'O vídeo pode continuar sem títulos automáticos.', { id: toastId });
                }
            } else {
                throw new Error(res.data.message || 'Falha ao gerar');
            }
        } catch (error: unknown) {
            const responseData = axios.isAxiosError<{
                message?: string;
                code?: string;
                requestId?: string;
                phase?: string;
            }>(error) ? error.response?.data : undefined;
            const diagnostic = {
                code: responseData?.code || (axios.isAxiosError(error) ? error.code : undefined) || 'title_generation_failed',
                status: axios.isAxiosError(error) ? Number(error.response?.status || 0) : 0,
                phase: responseData?.phase || 'manual_titles',
                requestId: responseData?.requestId,
            };
            console.error('[title-generation]', diagnostic);
            const errMsg = responseData?.message || 'Erro ao comunicar com a inteligência artificial';
            toast.error(errMsg, { id: toastId });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleTargetTime = useCallback((time: number) => {
        previewRef.current?.seekToTime(time);
    }, []);

    const currentPreviewTime = useCallback(() => Math.max(0, previewRef.current?.getCurrentTime() ?? 0), []);

    const handleOpenExport = () => {
        const missing = missingForCompletion(adData, mediaTakes);
        if (missing.length) toast.warning(pendingWarningText(missing), { duration: 8000 });
        (window as unknown as { _isTestExportPattern: boolean })._isTestExportPattern = false;
        setShowExportModal(true);
    };

    const updateTitle = (id: string, updates: Partial<TitleHook>) => {
        const affectsCoverage = ['text', 'sourceText', 'startSec', 'durationSec', 'isActive']
            .some((field) => Object.prototype.hasOwnProperty.call(updates, field));
        const newTitles = titles.map((t) => {
            if (t.id === id) {
                const safeUpdates = Object.prototype.hasOwnProperty.call(updates, 'text')
                    ? { ...updates, text: limitTitleWords(String(updates.text || ''), t.maxWords) }
                    : updates;
                const colorEdited = Object.prototype.hasOwnProperty.call(safeUpdates, 'primaryColor')
                    || Object.prototype.hasOwnProperty.call(safeUpdates, 'secondaryColor');
                const textChanged = Object.prototype.hasOwnProperty.call(safeUpdates, 'text')
                    || Object.prototype.hasOwnProperty.call(safeUpdates, 'sourceText');
                const startChanged = Object.prototype.hasOwnProperty.call(safeUpdates, 'startSec');
                const updated = {
                    ...t,
                    ...safeUpdates,
                    ...(textChanged ? {
                        sourceText: undefined,
                        triggerId: undefined,
                        semanticRoles: undefined,
                    } : (startChanged && t.semanticRoles?.includes('hook') ? {
                        semanticRoles: t.semanticRoles.filter((role) => role !== 'hook'),
                    } : {})),
                    ...(colorEdited && !Object.prototype.hasOwnProperty.call(safeUpdates, 'colorBinding')
                        ? { colorBinding: undefined }
                        : {}),
                };
                // Also jump the video preview so they can instantly see the new font/color/position
                if (
                    safeUpdates.fontFamily ||
                    safeUpdates.primaryColor ||
                    safeUpdates.secondaryColor ||
                    safeUpdates.posX !== undefined ||
                    safeUpdates.posY !== undefined ||
                    safeUpdates.scale !== undefined ||
                    safeUpdates.text ||
                    safeUpdates.styleId
                ) {
                    handleTargetTime(updated.startSec + (updated.durationSec || 3) / 2);
                }
                return updated;
            }
            return t;
        });
        if (affectsCoverage) persistManualTitles(newTitles);
        else updateAdData({ dynamicTitles: newTitles });
    };

    const updateTitleTransform = (id: string, updates: Partial<TitleHook>) => {
        // O editor sobre o próprio vídeo também pode alterar o texto. Reutilizar
        // o mesmo caminho do painel garante que evidências semânticas antigas não
        // sobrevivam a uma edição manual.
        updateTitle(id, updates);
    };

    const deleteTitle = (id: string) => {
        const index = titles.findIndex((title) => title.id === id);
        const remaining = titles.filter((title) => title.id !== id);
        persistManualTitles(remaining);
        setSelectedTitleId(remaining[Math.min(Math.max(index, 0), Math.max(remaining.length - 1, 0))]?.id ?? null);
        toast.success('Título removido.');
    };

    const handleSelectTitle = (title: TitleHook) => {
        setSelectedTitleId(title.id);
        handleTargetTime(title.startSec + (title.durationSec || 3) / 2);
    };

    const selectedTitle = titles.find((t) => t.id === selectedTitleId);

    const applySelectedTitleStyle = (
        model: TitleStylePreset,
        overrides: Pick<TitleStylePreset, 'animationId'> = {}
    ) => {
        if (!selectedTitle) return;
        const patch = titleStyleSelectionPatch(selectedTitle, { ...model, ...overrides });
        if (!Object.keys(patch).length) return;
        updateTitle(selectedTitle.id, patch);
    };

    return (
        <div className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col pb-20">
            <header className="mb-4 shrink-0 text-center">
                <h2 className="inline-flex items-center gap-2 text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
                    <span className="bg-linear-to-r from-brand-lime to-brand-accent bg-clip-text text-transparent">
                        Ganchos e Títulos
                    </span>
                </h2>
                <p className="mx-auto mt-1.5 max-w-2xl text-xs font-medium text-brand-muted">
                    Adicione ganchos visuais e Call-to-Actions impactantes para prender a atenção do seu público nos
                    primeiros segundos.
                </p>
            </header>

            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(250px,.8fr)_minmax(420px,1.45fr)_minmax(240px,.75fr)]">
                {/* COLUMN 1: AI Hooks (Left) */}
                <div className="custom-scrollbar relative flex min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-black/5 bg-brand-card p-3 shadow-xl dark:border-white/5">
                    <button
                        onClick={handleGenerateTitles}
                        disabled={isGenerating}
                        className="z-10 flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-brand-lime to-brand-accent py-3 text-[11px] font-bold uppercase tracking-wider text-[#0a0f12] transition-all hover:scale-[1.01] hover:shadow-[0_0_15px_rgba(0,230,118,0.4)] active:scale-[0.98] disabled:opacity-50"
                    >
                        {isGenerating ? (
                            <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                        ) : (
                            <Wand2 className="w-4 h-4" />
                        )}
                        {isGenerating ? 'Analisando...' : 'Gerar Títulos com IA'}
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => {
                            const startSec = currentPreviewTime();
                            const stylePreset = titleStylePresetById('solid-ribbon') || SIMPLE_TITLE_MODELS[0];
                            const newTitle: TitleHook = {
                                id: `manual-${Date.now()}`,
                                text: 'Novo título',
                                styleId: 'solid-ribbon',
                                startSec,
                                durationSec: 3,
                                isActive: true,
                                hasSound: true,
                                posY: 30,
                                posX: 50,
                                scale: 1,
                                primaryColor: stylePreset.primaryColor,
                                secondaryColor: stylePreset.secondaryColor,
                                animationId: 'pop',
                                fontFamily: stylePreset.fontFamily,
                            };
                            persistManualTitles([...titles, newTitle]);
                            setSelectedTitleId(newTitle.id);
                            handleTargetTime(startSec);
                            toast.success(
                                `Título criado em ${startSec.toFixed(1)}s. Dê dois cliques nele para editar.`
                            );
                        }}
                        className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-brand-accent/30 py-2.5 text-[10px] font-bold uppercase tracking-wider text-brand-accent transition-all hover:border-brand-accent/60 hover:bg-brand-accent/5"
                    >
                        <Sparkles className="w-4 h-4" />
                        Criar Título
                    </button>

                    <button
                        onClick={() => {
                            // Create file input for image upload
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = async (e) => {
                                const file = (e.target as HTMLInputElement).files?.[0];
                                if (!file) return;

                                // Validate file size (max 5MB)
                                if (file.size > 5 * 1024 * 1024) {
                                    toast.error('Imagem muito grande! Máximo 5MB.');
                                    return;
                                }

                                // Create title with uploaded image
                                const imageUrl = URL.createObjectURL(file);
                                const startSec = currentPreviewTime();
                                const newTitle: TitleHook = {
                                    id: `upload-${Date.now()}`,
                                    text: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
                                    styleId: 'image-overlay', // Custom style for uploaded images
                                    startSec,
                                    durationSec: 3,
                                    isActive: true,
                                    hasSound: false,
                                    posY: 50,
                                    posX: 50,
                                    scale: 1,
                                    primaryColor: IMAGE_TITLE_MODEL.primaryColor,
                                    secondaryColor: IMAGE_TITLE_MODEL.secondaryColor,
                                    animationId: 'fade',
                                    fontFamily: IMAGE_TITLE_MODEL.fontFamily,
                                    imageUrl: imageUrl, // Store the blob URL
                                };
                                persistManualTitles([...titles, newTitle]);
                                setSelectedTitleId(newTitle.id);
                                handleTargetTime(startSec);
                                toast.success('Imagem de título carregada!');
                            };
                            input.click();
                        }}
                        className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-500/30 py-2.5 text-[10px] font-bold uppercase tracking-wider text-blue-400 transition-all hover:border-blue-500/60 hover:bg-blue-500/5"
                    >
                        <Upload className="w-4 h-4" />
                        Upload de Imagem
                    </button>
                    </div>

                    <div className="space-y-2 mt-1">
                        {titles.length === 0 && !isGenerating && (
                            <div className="mt-2 rounded-xl border border-dashed border-black/10 bg-brand-dark p-5 text-center dark:border-white/10">
                                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-black/5 dark:bg-white/5">
                                    <Sparkles className="h-5 w-5 text-brand-muted opacity-50" />
                                </div>
                                <p className="text-xs text-brand-muted uppercase tracking-wider font-bold">
                                    Nenhum título gerado ainda
                                </p>
                            </div>
                        )}

                        {orderedTitles.map((title) => {
                            const isExpanded = title.id === selectedTitleId;
                            const titleEnd = title.startSec + Math.max(0.1, title.durationSec || 0);
                            return (
                                <div
                                    key={title.id}
                                    onClick={() => handleSelectTitle(title)}
                                    className={cn(
                                        'flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-brand-dark shadow-sm transition-all duration-200',
                                        title.isActive
                                            ? 'border-brand-accent/35'
                                            : 'border-black/5 dark:border-white/5 opacity-70 hover:opacity-100',
                                        isExpanded
                                            ? 'border-brand-accent bg-brand-accent/[.09] shadow-[0_0_0_1px_rgba(0,230,118,.14),0_12px_28px_rgba(0,0,0,.18)]'
                                            : 'hover:border-brand-accent/30'
                                    )}
                                >
                                    {/* Compact Card Header (Always Visible) */}
                                    <div className="flex min-h-12 items-center justify-between bg-black/5 p-2.5 dark:bg-white/[.035]">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <div
                                                className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-1 rounded-md transition-colors"
                                                onClick={(e) => {
                                                    if (isExpanded) {
                                                        e.stopPropagation();
                                                        setSelectedTitleId(null);
                                                    }
                                                }}
                                            >
                                                {isExpanded ? <ChevronUp className="h-4 w-4 text-brand-accent" /> : <ChevronDown className="h-4 w-4 text-brand-muted" />}
                                            </div>
                                            <span className="truncate text-xs font-semibold tracking-wide text-foreground">
                                                {title.text || 'Sem texto'}
                                            </span>
                                        </div>
                                        <div className="ml-2 flex shrink-0 items-center gap-2">
                                            <span
                                                className={cn(
                                                    'rounded-md border px-2 py-1 font-mono text-[9px] font-bold tabular-nums',
                                                    isExpanded
                                                        ? 'border-brand-accent/35 bg-brand-accent/15 text-brand-accent'
                                                        : 'border-white/8 bg-black/15 text-brand-muted'
                                                )}
                                                title={`Visível de ${formatTimeValue(title.startSec)}s a ${formatTimeValue(titleEnd)}s`}
                                            >
                                                {formatTimeValue(title.startSec)}s–{formatTimeValue(titleEnd)}s
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const newActive = !title.isActive;
                                                    updateTitle(title.id, { isActive: newActive });
                                                    if (newActive)
                                                        handleTargetTime(title.startSec + (title.durationSec || 3) / 2);
                                                }}
                                                className={cn(
                                                    'rounded-md border p-1.5 transition-colors',
                                                    title.isActive
                                                        ? 'bg-brand-lime/20 text-brand-lime hover:bg-brand-lime/30 border border-brand-lime/20 drop-shadow-[0_0_5px_rgba(163,230,53,0.5)]'
                                                        : 'bg-black/5 dark:bg-white/5 text-brand-muted hover:text-foreground border border-transparent'
                                                )}
                                                title={title.isActive ? 'Desativar Gancho' : 'Ativar Gancho'}
                                            >
                                                <Power className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expanded Content Area */}
                                    {isExpanded && (
                                        <div className="border-t border-white/5 bg-black/15 p-3">
                                            <div className="flex flex-col gap-3">
                                                <textarea
                                                    value={title.text}
                                                    onChange={(e) => updateTitle(title.id, { text: e.target.value })}
                                                    className="custom-scrollbar h-16 w-full resize-none rounded-lg border border-white/8 bg-black/25 p-2.5 text-xs font-medium text-foreground outline-none transition-colors placeholder:text-brand-muted focus:border-brand-accent/50"
                                                    placeholder="Texto do gancho..."
                                                />

                                                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-black/20 p-2">
                                                    <div className="flex min-w-0 flex-1 items-center gap-3">
                                                        <label className="flex items-center gap-1.5">
                                                            <Clock className="w-3 h-3 text-brand-accent" />
                                                            <span className="text-[10px] uppercase tracking-wider text-brand-muted font-semibold">
                                                                Início
                                                            </span>
                                                            <TimeField
                                                                value={title.startSec}
                                                                onCommit={(startSec) => updateTitle(title.id, { startSec })}
                                                                ariaLabel="Início do título em segundos"
                                                            />
                                                        </label>
                                                        <div className="w-px h-3 bg-white/5" />
                                                        <label className="flex items-center gap-1.5">
                                                            <span className="text-[10px] uppercase tracking-wider text-brand-muted font-bold">
                                                                Fim
                                                            </span>
                                                            <TimeField
                                                                min={Number((title.startSec + 0.1).toFixed(1))}
                                                                value={Number((title.startSec + title.durationSec).toFixed(1))}
                                                                onCommit={(endSec) => {
                                                                    updateTitle(title.id, {
                                                                        durationSec: Math.max(
                                                                            0.1,
                                                                            Number((endSec - title.startSec).toFixed(3))
                                                                        ),
                                                                    });
                                                                }}
                                                                ariaLabel="Fim do título em segundos"
                                                            />
                                                        </label>
                                                    </div>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            previewRef.current?.previewRange(
                                                                title.startSec,
                                                                title.startSec + Math.max(0.1, title.durationSec || 3)
                                                            );
                                                        }}
                                                        className="grid h-8 w-8 place-items-center rounded-md border border-brand-accent/20 bg-brand-accent/10 text-brand-accent transition-colors hover:bg-brand-accent/20 hover:text-foreground"
                                                        title="Reproduzir somente este título"
                                                    >
                                                        <Play className="h-3.5 w-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            updateTitle(title.id, { hasSound: !title.hasSound });
                                                        }}
                                                        className={cn(
                                                            'grid h-8 w-8 place-items-center rounded-md border transition-colors',
                                                            title.hasSound
                                                                ? 'border-brand-accent/25 bg-brand-accent/10 text-brand-accent'
                                                                : 'border-white/8 bg-white/[.035] text-brand-muted'
                                                        )}
                                                        title={title.hasSound ? 'Desativar efeito sonoro' : 'Ativar efeito sonoro'}
                                                    >
                                                        {title.hasSound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                                                    </button>
                                                </div>

                                                {/* Settings Grid */}
                                                <div className="grid grid-cols-2 gap-3 text-[11px]">
                                                    <div className="flex flex-col gap-1.5">
                                                        <span className="text-[9px] uppercase tracking-wider text-brand-muted font-bold pl-1">
                                                            Animação
                                                        </span>
                                                        <TextAnimationPicker
                                                            value={title.animationId || 'pop'}
                                                            onChange={(animationId) => updateTitle(title.id, { animationId })}
                                                        />
                                                    </div>

                                                    <div className="flex flex-col gap-1.5">
                                                        <span className="text-[9px] uppercase tracking-wider text-brand-muted font-bold pl-1">
                                                            Fonte
                                                        </span>
                                                        <TitleFontPicker
                                                            value={title.fontFamily || 'Poppins'}
                                                            onChange={(fontFamily) =>
                                                                updateTitle(title.id, { fontFamily })
                                                            }
                                                        />
                                                    </div>

                                                </div>
                                                <div className="flex items-center justify-between border-t border-white/5 pt-2">
                                                    <p className="text-[9px] font-semibold text-brand-muted">
                                                        Arraste, use as alças ou +/- para ajustar no preview. A legenda fica protegida.
                                                    </p>
                                                <button
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        updateTitle(title.id, {
                                                            posX: 50,
                                                            posY: 30,
                                                            scale: 1,
                                                            scaleX: 1,
                                                            scaleY: 1,
                                                            textBoxWidthPct: undefined,
                                                        });
                                                    }}
                                                    className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[9px] font-black uppercase tracking-wider text-brand-muted transition hover:bg-white/5 hover:text-brand-lime"
                                                    title="Restaurar posição e escala"
                                                >
                                                    <RotateCcw className="h-3.5 w-3.5" />
                                                    Centralizar
                                                </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* COLUMN 2: Visual Models (Center) */}
                <div className="custom-scrollbar flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-black/5 bg-brand-card/30 p-3 shadow-inner dark:border-white/5">
                    {/* Accordion: Simples */}
                    <div className="hidden">
                        <div
                            className="group flex cursor-pointer items-center justify-between rounded-t-xl border border-black/5 bg-brand-dark p-3 shadow-sm transition-colors hover:bg-black/5 dark:border-white/5 dark:bg-white/5"
                            onClick={() => setIsSimplesOpen(!isSimplesOpen)}
                        >
                            <div className="flex items-center gap-3">
                                {isSimplesOpen ? (
                                    <ChevronUp className="w-5 h-5 text-brand-muted" />
                                ) : (
                                    <ChevronDown className="w-5 h-5 text-brand-muted" />
                                )}
                                <h4 className="font-bold uppercase tracking-wider text-foreground text-[13px]">
                                    Categoria: Simples
                                </h4>
                            </div>
                        </div>

                        {isSimplesOpen && (
                            <div className="grid gap-4 bg-brand-dark/40 p-5 border border-t-0 border-black/5 dark:border-white/5 rounded-b-2xl">
                                {SIMPLE_TITLE_MODELS.map((model) => {
                                    const isSelected =
                                        selectedTitle?.styleId === model.id ||
                                        (!selectedTitle?.styleId && model.id === 'default');

                                    const mockTitle: TitleHook = selectedTitle
                                        ? {
                                              ...selectedTitle,
                                              text: 'EXEMPLO DE TÍTULO',
                                              styleId: model.id,
                                              primaryColor: isSelected
                                                  ? selectedTitle.primaryColor || model.primaryColor
                                                  : model.primaryColor,
                                              secondaryColor: isSelected
                                                  ? selectedTitle.secondaryColor || model.secondaryColor
                                                  : model.secondaryColor,
                                              fontFamily: isSelected
                                                  ? selectedTitle.fontFamily || model.fontFamily
                                                  : model.fontFamily,
                                          }
                                        : {
                                              id: 'mock',
                                              text: 'EXEMPLO DE TÍTULO',
                                              styleId: model.id,
                                              startSec: 0,
                                              durationSec: 1,
                                              isActive: true,
                                              posY: 30,
                                              scale: 1,
                                              primaryColor: model.primaryColor,
                                              secondaryColor: model.secondaryColor,
                                              fontFamily: model.fontFamily,
                                          };

                                    return (
                                        <button
                                            key={model.id}
                                            onClick={() => applySelectedTitleStyle(model)}
                                            className={cn(
                                                'relative h-24 bg-background rounded-2xl border-2 flex flex-col items-center justify-center transition-all group overflow-hidden shadow-lg hover:shadow-xl',
                                                isSelected && selectedTitle
                                                    ? 'border-brand-accent shadow-[0_0_15px_rgba(0,230,118,0.1)]'
                                                    : 'border-transparent hover:border-black/10 dark:border-white/10',
                                                !selectedTitle && 'opacity-60 cursor-not-allowed'
                                            )}
                                            disabled={!selectedTitle}
                                        >
                                            <div className="w-full px-3 py-2 border-b border-black/5 dark:border-white/5 bg-black/10 flex items-center justify-between shrink-0">
                                                <span
                                                    className={cn(
                                                        'text-[10px] font-bold uppercase tracking-wider',
                                                        isSelected && selectedTitle
                                                            ? 'text-brand-accent'
                                                            : 'text-brand-muted'
                                                    )}
                                                >
                                                    {model.name}
                                                </span>
                                            </div>

                                            {isSelected && selectedTitle && (
                                                <>
                                                    <div className="absolute top-3 right-3 bg-brand-accent rounded-full p-0.5 shadow-[0_0_10px_rgba(0,230,118,0.6)] z-10">
                                                        <CheckCircle2 className="w-5 h-5 text-[#0a0f12]" />
                                                    </div>
                                                    <div
                                                        className="absolute bottom-3 right-3 flex items-center gap-2 bg-brand-dark/95 p-1.5 rounded-xl border border-black/10 dark:border-white/10 backdrop-blur-md z-20 shadow-xl"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <input
                                                            type="color"
                                                            value={selectedTitle.primaryColor || model.primaryColor}
                                                            onChange={(e) =>
                                                                updateTitle(selectedTitle.id, {
                                                                    primaryColor: e.target.value,
                                                                })
                                                            }
                                                            className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                                                            title="Cor de Fundo / Destaque"
                                                        />
                                                        <input
                                                            type="color"
                                                            value={selectedTitle.secondaryColor || model.secondaryColor}
                                                            onChange={(e) =>
                                                                updateTitle(selectedTitle.id, {
                                                                    secondaryColor: e.target.value,
                                                                })
                                                            }
                                                            className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                                                            title="Cor do Texto"
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            <div className="flex-1 w-full flex items-center justify-center overflow-hidden">
                                                <div className="scale-[0.45] origin-center">
                                                    <DynamicTitleRenderer title={mockTitle} previewMode />
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Accordion: Call to Action */}
                    <div className="mb-3 mt-2">
                        <div
                            className={titleLibraryHeaderClass(isCtaOpen)}
                            onClick={() => setIsCtaOpen(!isCtaOpen)}
                        >
                            <div className="flex items-center gap-3">
                                {isCtaOpen ? (
                                    <ChevronUp className="h-5 w-5 text-brand-accent" />
                                ) : (
                                    <ChevronDown className="h-5 w-5 text-brand-accent" />
                                )}
                                <h4 className="text-[12px] font-black uppercase tracking-wider text-brand-accent">
                                    Call to Action (CTA)
                                </h4>
                            </div>
                        </div>

                        {isCtaOpen && (
                            <div className={cn(titleLibraryBodyClass, 'grid gap-4')}>
                                {CTA_TITLE_MODELS.map((model) => {
                                    const isSelected = selectedTitle?.styleId === model.id;

                                    const mockTitle: TitleHook = selectedTitle
                                        ? {
                                              ...selectedTitle,
                                              text: 'CHAMADA PARA AÇÃO',
                                              styleId: model.id,
                                              animationId: model.animationId,
                                              primaryColor: isSelected
                                                  ? selectedTitle.primaryColor || model.primaryColor
                                                  : model.primaryColor,
                                              secondaryColor: isSelected
                                                  ? selectedTitle.secondaryColor || model.secondaryColor
                                                  : model.secondaryColor,
                                              fontFamily: isSelected
                                                  ? selectedTitle.fontFamily || model.fontFamily
                                                  : model.fontFamily,
                                          }
                                        : {
                                              id: 'mock',
                                              text: 'CHAMADA PARA AÇÃO',
                                              styleId: model.id,
                                              startSec: 0,
                                              durationSec: 1,
                                              isActive: true,
                                              posY: 30,
                                              scale: 1,
                                              animationId: model.animationId,
                                              primaryColor: model.primaryColor,
                                              secondaryColor: model.secondaryColor,
                                              fontFamily: model.fontFamily,
                                          };

                                    return (
                                        <button
                                            key={model.id}
                                            onClick={() => applySelectedTitleStyle(model)}
                                            className={cn(
                                                'relative h-24 bg-background rounded-2xl border-2 flex flex-col items-center justify-center transition-all group overflow-hidden shadow-lg hover:shadow-xl',
                                                isSelected && selectedTitle
                                                    ? 'border-brand-lime shadow-[0_0_15px_rgba(163,230,53,0.1)]'
                                                    : 'border-transparent hover:border-black/10 dark:border-white/10',
                                                !selectedTitle && 'opacity-60 cursor-not-allowed'
                                            )}
                                            disabled={!selectedTitle}
                                        >
                                            <div className="w-full px-3 py-2 border-b border-black/5 dark:border-white/5 bg-black/10 flex items-center justify-between shrink-0">
                                                <span className="text-[10px] font-bold text-brand-muted uppercase tracking-wider group-hover:text-brand-lime transition-colors">
                                                    {model.name}
                                                </span>
                                            </div>

                                            {isSelected && selectedTitle && (
                                                <>
                                                    <div className="absolute top-3 right-3 bg-brand-lime rounded-full p-0.5 shadow-[0_0_10px_rgba(163,230,53,0.6)] z-10">
                                                        <CheckCircle2 className="w-5 h-5 text-[#0a0f12]" />
                                                    </div>
                                                    <div
                                                        className="absolute bottom-3 right-3 flex items-center gap-2 bg-brand-dark/95 p-1.5 rounded-xl border border-black/10 dark:border-white/10 backdrop-blur-md z-20 shadow-xl"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <input
                                                            type="color"
                                                            value={selectedTitle.primaryColor || model.primaryColor}
                                                            onChange={(e) =>
                                                                updateTitle(selectedTitle.id, {
                                                                    primaryColor: e.target.value,
                                                                })
                                                            }
                                                            className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                                                            title="Cor de Fundo / Destaque"
                                                        />
                                                        <input
                                                            type="color"
                                                            value={selectedTitle.secondaryColor || model.secondaryColor}
                                                            onChange={(e) =>
                                                                updateTitle(selectedTitle.id, {
                                                                    secondaryColor: e.target.value,
                                                                })
                                                            }
                                                            className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                                                            title="Cor do Texto"
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            {/* Preview box */}
                                            <div
                                                className="flex-1 w-full flex items-center justify-center pointer-events-none overflow-hidden"
                                                style={{ transform: 'scale(0.40)' }}
                                            >
                                                <DynamicTitleRenderer title={mockTitle} previewMode />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Accordion: Premium */}
                    <div className="mb-3 mt-2">
                        <div
                            className={titleLibraryHeaderClass(isPremiumOpen)}
                            onClick={() => setIsPremiumOpen(!isPremiumOpen)}
                        >
                            <div className="flex items-center gap-3">
                                {isPremiumOpen ? (
                                    <ChevronUp className="h-5 w-5 text-brand-accent" />
                                ) : (
                                    <ChevronDown className="h-5 w-5 text-brand-accent" />
                                )}
                                <div>
                                    <h4 className="text-[12px] font-black uppercase tracking-wider text-brand-accent">
                                        Biblioteca Premium
                                    </h4>
                                    <p className="mt-0.5 text-[9px] font-semibold text-brand-muted">
                                        {PREMIUM_TITLE_MODELS.length} modelos curados para uso real
                                    </p>
                                </div>
                            </div>
                            <span className="rounded-full border border-brand-accent/25 bg-brand-accent/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-brand-accent">
                                Motion
                            </span>
                        </div>

                        {isPremiumOpen && (
                            <div className={cn(titleLibraryBodyClass, 'space-y-6')}>
                                {PREMIUM_TITLE_GROUPS.map((group) => (
                                    <section key={group}>
                                        <div className="mb-3 flex items-center gap-3">
                                            <span className="text-[9px] font-black uppercase tracking-[.22em] text-brand-accent/80">
                                                {group}
                                            </span>
                                            <span className="h-px flex-1 bg-linear-to-r from-amber-300/20 to-transparent" />
                                        </div>

                                        <div className="grid gap-3">
                                            {PREMIUM_TITLE_MODELS.filter((model) => model.group === group).map(
                                                (model) => {
                                                    const isSelected = selectedTitle?.styleId === model.id;
                                                    const mockTitle: TitleHook = {
                                                        ...(selectedTitle || {
                                                            id: 'mock',
                                                            startSec: 0,
                                                            durationSec: 3,
                                                            isActive: true,
                                                            posY: 30,
                                                            scale: 1,
                                                        }),
                                                        text: model.sample,
                                                        styleId: model.id,
                                                        animationId: 'none',
                                                        primaryColor: isSelected
                                                            ? selectedTitle?.primaryColor || model.primaryColor
                                                            : model.primaryColor,
                                                        secondaryColor: isSelected
                                                            ? selectedTitle?.secondaryColor || model.secondaryColor
                                                            : model.secondaryColor,
                                                        fontFamily: isSelected
                                                            ? selectedTitle?.fontFamily || model.fontFamily
                                                            : model.fontFamily,
                                                    };

                                                    return (
                                                        <button
                                                            key={model.id}
                                                            onClick={() => applySelectedTitleStyle(model, {
                                                                animationId: 'none',
                                                            })}
                                                            className={cn(
                                                                'group/model relative min-h-40 overflow-hidden rounded-2xl border bg-background text-left shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-2xl',
                                                                isSelected && selectedTitle
                                                                    ? 'border-brand-accent/65 ring-1 ring-brand-accent/15'
                                                                    : 'border-white/8 hover:border-brand-accent/25',
                                                                !selectedTitle && 'cursor-not-allowed opacity-60'
                                                            )}
                                                            disabled={!selectedTitle}
                                                        >
                                                            <div className="flex items-start justify-between gap-3 border-b border-white/6 bg-white/[.025] px-3.5 py-3">
                                                                <div className="min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="truncate text-[11px] font-black uppercase tracking-wider text-foreground">
                                                                            {model.name}
                                                                        </span>
                                                                        {isSelected && selectedTitle && (
                                                                            <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-accent" />
                                                                        )}
                                                                    </div>
                                                                    <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-brand-muted">
                                                                        {model.description}
                                                                    </p>
                                                                </div>
                                                                <div className="flex shrink-0 gap-1">
                                                                    <span
                                                                        className="h-3.5 w-3.5 rounded-full border border-white/20"
                                                                        style={{ backgroundColor: model.primaryColor }}
                                                                    />
                                                                    <span
                                                                        className="h-3.5 w-3.5 rounded-full border border-white/20"
                                                                        style={{
                                                                            backgroundColor: model.secondaryColor,
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div className="flex h-24 w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(255,255,255,.06),transparent_70%)] px-2">
                                                                <div className="origin-center scale-[0.36]">
                                                                    <DynamicTitleRenderer
                                                                        title={mockTitle}
                                                                        previewMode
                                                                    />
                                                                </div>
                                                            </div>

                                                            {isSelected && selectedTitle && (
                                                                <div
                                                                    className="absolute bottom-2.5 right-2.5 z-20 flex items-center gap-1.5 rounded-xl border border-white/10 bg-brand-dark/95 p-1.5 shadow-xl backdrop-blur-md"
                                                                    onClick={(event) => event.stopPropagation()}
                                                                >
                                                                    <input
                                                                        type="color"
                                                                        value={
                                                                            selectedTitle.primaryColor ||
                                                                            model.primaryColor
                                                                        }
                                                                        onChange={(event) =>
                                                                            updateTitle(selectedTitle.id, {
                                                                                primaryColor: event.target.value,
                                                                            })
                                                                        }
                                                                        className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                                                                        title="Cor de destaque"
                                                                    />
                                                                    <input
                                                                        type="color"
                                                                        value={
                                                                            selectedTitle.secondaryColor ||
                                                                            model.secondaryColor
                                                                        }
                                                                        onChange={(event) =>
                                                                            updateTitle(selectedTitle.id, {
                                                                                secondaryColor: event.target.value,
                                                                            })
                                                                        }
                                                                        className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                                                                        title="Cor do texto"
                                                                    />
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                }
                                            )}
                                        </div>
                                    </section>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Accordion: Localização */}
                    <div className="mb-3 mt-2">
                        <div
                            className={titleLibraryHeaderClass(isLocationOpen)}
                            onClick={() => setIsLocationOpen(!isLocationOpen)}
                        >
                            <div className="flex items-center gap-3">
                                {isLocationOpen ? (
                                    <ChevronUp className="w-5 h-5 text-brand-accent" />
                                ) : (
                                    <ChevronDown className="w-5 h-5 text-brand-accent" />
                                )}
                                <MapPin className="w-4 h-4 text-brand-accent" />
                                <h4 className="text-[12px] font-black uppercase tracking-wider text-brand-accent">
                                    Localização
                                </h4>
                            </div>
                        </div>

                        {isLocationOpen && (
                            <div className={cn(titleLibraryBodyClass, 'grid gap-4')}>
                                {LOCATION_TITLE_MODELS.map((model) => {
                                    const isSelected = selectedTitle?.styleId === model.id;

                                    const mockTitle: TitleHook = selectedTitle
                                        ? {
                                              ...selectedTitle,
                                              text: 'São Paulo, SP',
                                              styleId: model.id,
                                              primaryColor: isSelected
                                                  ? selectedTitle.primaryColor || model.primaryColor
                                                  : model.primaryColor,
                                              secondaryColor: isSelected
                                                  ? selectedTitle.secondaryColor || model.secondaryColor
                                                  : model.secondaryColor,
                                              fontFamily: isSelected
                                                  ? selectedTitle.fontFamily || model.fontFamily
                                                  : model.fontFamily,
                                          }
                                        : {
                                              id: 'mock',
                                              text: 'São Paulo, SP',
                                              styleId: model.id,
                                              startSec: 0,
                                              durationSec: 1,
                                              isActive: true,
                                              posY: 30,
                                              scale: 1,
                                              primaryColor: model.primaryColor,
                                              secondaryColor: model.secondaryColor,
                                              fontFamily: model.fontFamily,
                                          };

                                    return (
                                        <button
                                            key={model.id}
                                            onClick={() => applySelectedTitleStyle(model)}
                                            className={cn(
                                                'relative h-24 bg-background rounded-2xl border-2 flex flex-col items-center justify-center transition-all group overflow-hidden shadow-lg hover:shadow-xl',
                                                isSelected && selectedTitle
                                                    ? 'border-brand-accent shadow-[0_0_15px_rgba(0,230,118,0.15)]'
                                                    : 'border-transparent hover:border-black/10 dark:border-white/10',
                                                !selectedTitle && 'opacity-60 cursor-not-allowed'
                                            )}
                                            disabled={!selectedTitle}
                                        >
                                            <div className="w-full px-3 py-2 border-b border-black/5 dark:border-white/5 bg-black/10 flex items-center justify-between shrink-0">
                                                <span
                                                    className={cn(
                                                        'text-[10px] font-bold uppercase tracking-wider',
                                                        isSelected && selectedTitle
                                                            ? 'text-brand-accent'
                                                            : 'text-brand-muted'
                                                    )}
                                                >
                                                    {model.name}
                                                </span>
                                            </div>

                                            {isSelected && selectedTitle && (
                                                <>
                                                    <div className="absolute top-2 right-3 bg-brand-accent rounded-full p-0.5 shadow-[0_0_10px_rgba(0,230,118,0.6)] z-10">
                                                        <CheckCircle2 className="w-5 h-5 text-[#0a0f12]" />
                                                    </div>
                                                    <div
                                                        className="absolute bottom-3 right-3 flex items-center gap-2 bg-brand-dark/95 p-1.5 rounded-xl border border-black/10 dark:border-white/10 backdrop-blur-md z-20 shadow-xl"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <input
                                                            type="color"
                                                            value={selectedTitle.primaryColor || model.primaryColor}
                                                            onChange={(e) =>
                                                                updateTitle(selectedTitle.id, {
                                                                    primaryColor: e.target.value,
                                                                })
                                                            }
                                                            className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                                                            title="Cor do Ícone / Destaque"
                                                        />
                                                        <input
                                                            type="color"
                                                            value={selectedTitle.secondaryColor || model.secondaryColor}
                                                            onChange={(e) =>
                                                                updateTitle(selectedTitle.id, {
                                                                    secondaryColor: e.target.value,
                                                                })
                                                            }
                                                            className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                                                            title="Cor do Texto"
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            <div className="flex-1 w-full flex items-center justify-center overflow-hidden">
                                                <div className="scale-[0.35] origin-center">
                                                    <DynamicTitleRenderer title={mockTitle} previewMode />
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Accordion: Upload Imagem Personalizada */}
                    <div className="mb-3 mt-2">
                        <div
                            className={titleLibraryHeaderClass(isCustomImgOpen)}
                            onClick={() => setIsCustomImgOpen(!isCustomImgOpen)}
                        >
                            <div className="flex items-center gap-3">
                                {isCustomImgOpen ? (
                                    <ChevronUp className="h-5 w-5 text-brand-accent" />
                                ) : (
                                    <ChevronDown className="h-5 w-5 text-brand-accent" />
                                )}
                                <ImageIcon className="h-4 w-4 text-brand-accent" />
                                <h4 className="text-[12px] font-black uppercase tracking-wider text-brand-accent">
                                    Imagem Personalizada (Logo/Selo)
                                </h4>
                            </div>
                        </div>

                        {isCustomImgOpen && (
                            <div className={cn(titleLibraryBodyClass, 'space-y-4')}>
                                {adData.customOverlayUrl ? (
                                    <div className="flex items-center justify-between bg-background border border-black/10 dark:border-white/10 rounded-xl p-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 bg-black/5 dark:bg-white/5 rounded-lg flex items-center justify-center overflow-hidden">
                                                <img
                                                    src={adData.customOverlayUrl}
                                                    alt="Custom Overlay"
                                                    className="max-w-full max-h-full object-contain"
                                                />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-foreground">Imagem Carregada</p>
                                                <p className="text-xs text-brand-muted">
                                                    A imagem será mantida fixa durante o vídeo.
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => updateAdData({ customOverlayUrl: undefined })}
                                            className="p-2 text-brand-muted hover:text-red-500 bg-black/5 hover:bg-red-500/10 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <label
                                        className={cn(
                                            'flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors',
                                            isUploadingImage
                                                ? 'opacity-50 border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5'
                                                : 'border-blue-400/30 hover:border-blue-400 hover:bg-blue-400/5 bg-background'
                                        )}
                                    >
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                            {isUploadingImage ? (
                                                <div className="animate-spin w-6 h-6 border-2 border-blue-400/30 border-t-blue-400 rounded-full mb-2" />
                                            ) : (
                                                <ImageIcon className="w-8 h-8 text-blue-400/70 mb-2" />
                                            )}
                                            <p className="font-bold text-sm text-foreground">
                                                {isUploadingImage ? 'Enviando...' : 'Clique para enviar imagem'}
                                            </p>
                                            <p className="text-xs text-brand-muted mt-1 uppercase tracking-wider font-semibold">
                                                PNG SEM FUNDO RECOMENDADO
                                            </p>
                                        </div>
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept="image/png, image/jpeg, image/webp"
                                            disabled={isUploadingImage}
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setIsUploadingImage(true);
                                                try {
                                                    const tmpUrl = URL.createObjectURL(file);
                                                    updateAdData({ customOverlayUrl: tmpUrl });
                                                    // Num cenário ideal, faríamos o upload pro S3/Servidor aqui igual fazemos com música
                                                } finally {
                                                    setIsUploadingImage(false);
                                                }
                                            }}
                                        />
                                    </label>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* COLUMN 3: Preview (Right) */}
                <div className="self-start lg:sticky lg:top-0">
                    {mediaTakes.length > 0 ? (
                        <VideoSequencePreview
                            ref={previewRef}
                            takes={mediaTakes}
                            masterAudioUrl={adData.masterAudioUrl}
                            captions={currentCaptions}
                            onMuteToggle={() => {}}
                            onMuteAll={() => {}}
                            showTakeList={false}
                            showHeaderMute={false}
                            compactViewport
                            compactViewportWidth={TITLE_EDITOR_PORTRAIT_PREVIEW_WIDTH}
                            dynamicTitles={titles.filter((t) => t.isActive)}
                            selectedTitleId={selectedTitleId}
                            onTitleSelect={setSelectedTitleId}
                            onTitleTransformChange={updateTitleTransform}
                            onTitleDelete={deleteTitle}
                        />
                    ) : (
                        <div className="flex min-h-[480px] items-center justify-center rounded-2xl border border-dashed border-white/8 bg-brand-dark p-6 text-center text-xs font-bold uppercase tracking-wider text-brand-muted">
                            Adicione mídia na Etapa 1 para visualizar o vídeo.
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Navigation */}
            <div className="fixed bottom-0 right-0 left-0 z-40 flex h-16 items-center justify-between border-t border-black/5 bg-background/95 px-5 pr-24 shadow-2xl backdrop-blur-xl dark:border-white/5">
                {/* Debug Controls (Left) */}
                <div className="flex items-center gap-4">
                    {SHOW_DEBUG_FEATURES && (
                        <>
                            <button
                                onClick={() => setIsDebugMode(!isDebugMode)}
                                className={cn(
                                    'flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border',
                                    isDebugMode
                                        ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.1)]'
                                        : 'bg-black/5 dark:bg-white/5 text-brand-muted border-transparent hover:text-foreground hover:bg-black/10 dark:bg-white/10'
                                )}
                                title="Ativa guias visuais e logs de renderização para garantir 1:1 Preview/Export"
                            >
                                <Bug className="w-4 h-4" />
                                Modo Debug {isDebugMode ? 'ON' : 'OFF'}
                            </button>

                            {isDebugMode && (
                                <button
                                    onClick={() => {
                                        // Sinaliza globalmente para o Modal truncar 3 segundos
                                        (window as unknown as { _isTestExportPattern: boolean })._isTestExportPattern =
                                            true;
                                        setShowExportModal(true);
                                    }}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-purple-500/20 shadow-[0_0_10px_rgba(168,85,247,0.1)]"
                                    title="Roda a arquitetura final nativa FFmpeg cortada em 5 segundos."
                                >
                                    <Play className="w-4 h-4 fill-current" />
                                    Testar Motor Rápido (5s)
                                </button>
                            )}
                        </>
                    )}
                </div>

                {/* Primary Export Action (Right) */}
                <button
                    onClick={handleOpenExport}
                    className="flex items-center gap-2.5 rounded-xl bg-linear-to-r from-brand-lime to-brand-accent px-8 py-2.5 text-xs font-extrabold uppercase tracking-widest text-[#0a0f12] transition-transform hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(0,230,118,0.4)] active:scale-[0.98]"
                >
                    <Download className="w-5 h-5 flex-shrink-0" />
                    <span>Exportar e Concluir</span>
                </button>

                {showExportModal && (
                    <ExportModal
                        onClose={() => setShowExportModal(false)}
                        mediaTakes={mediaTakes}
                        masterAudioUrl={adData.masterAudioUrl || adData.narrationAudioUrl || undefined}
                        transitionPath={adData.transitionPath || adData.globalTransition?.filePath}
                        transitionRotation={adData.transitionRotation ?? 0}
                    />
                )}
            </div>
        </div>
    );
};
