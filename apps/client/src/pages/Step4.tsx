import { useState, useCallback, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { useWizard, SHOW_DEBUG_FEATURES } from '../context/WizardContext';
import { VideoSequencePreview, VideoSequencePreviewRef } from '../components/VideoSequencePreview';
import { TitleHook } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import axios from 'axios';
import { DynamicTitleRenderer } from '../components/DynamicTitleRenderer';
import { ExportModal } from '../components/ExportModal';

export const Step4 = () => {
    const { adData, updateAdData, mediaTakes, apiKeys, isDebugMode, setIsDebugMode } = useWizard();
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);
    // Accordion states
    const [isSimplesOpen, setIsSimplesOpen] = useState(true); // Changed to true as per instruction
    const [isCtaOpen, setIsCtaOpen] = useState(false);
    const [isPremiumOpen, setIsPremiumOpen] = useState(false); // New state
    const [isLocationOpen, setIsLocationOpen] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const previewRef = useRef<VideoSequencePreviewRef>(null);

    const titles = adData.dynamicTitles || [];

    // Initialize selectedTitleId when titles are loaded or generated
    useEffect(() => {
        if (titles.length > 0 && !selectedTitleId) {
            setSelectedTitleId(titles[0].id);
        }
    }, [titles, selectedTitleId]);

    const handleGenerateTitles = async () => {
        if (!adData.captions || !adData.captions.segments || adData.captions.segments.length === 0) {
            toast.error('Gere as legendas na Etapa 3 primeiro!');
            return;
        }

        setIsGenerating(true);
        const toastId = toast.loading('Lendo roteiro e gerando ganchos de atenção com IA...');

        try {
            const res = await axios.post(
                `${((window as any).API_BASE_URL || 'http://localhost:3301') || 'http://localhost:3301'}/api/video/generate-titles`,
                {
                    script: adData.narrationText,
                    captions: adData.captions,
                    openaiKey: apiKeys.openai,
                    geminiKey: apiKeys.gemini,
                }
            );

            if (res.data.ok && res.data.titles) {
                const finalTitles = (res.data.titles || []).map((t: TitleHook) => ({ ...t, hasSound: true }));
                updateAdData({ dynamicTitles: finalTitles });
                if (finalTitles.length > 0) {
                    setSelectedTitleId(finalTitles[0].id);
                }
                toast.success('Títulos gerados com sucesso!', { id: toastId });
            } else {
                throw new Error(res.data.message || 'Falha ao gerar');
            }
        } catch (error: unknown) {
            console.error(error);
            const errMsg = axios.isAxiosError(error)
                ? error.response?.data?.message || 'Erro ao comunicar com a inteligência artificial'
                : 'Erro ao comunicar com a inteligência artificial';
            toast.error(errMsg, { id: toastId });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleTargetTime = useCallback((time: number) => {
        previewRef.current?.seekToTime(time);
    }, []);

    const updateTitle = (id: string, updates: Partial<TitleHook>) => {
        const newTitles = titles.map((t) => {
            if (t.id === id) {
                const updated = { ...t, ...updates };
                // Also jump the video preview so they can instantly see the new font/color/position
                if (
                    updates.fontFamily ||
                    updates.primaryColor ||
                    updates.secondaryColor ||
                    updates.posY !== undefined ||
                    updates.scale !== undefined ||
                    updates.text ||
                    updates.styleId
                ) {
                    handleTargetTime(updated.startSec + (updated.durationSec || 3) / 2);
                }
                return updated;
            }
            return t;
        });
        updateAdData({ dynamicTitles: newTitles });
    };

    const handleSelectTitle = (title: TitleHook) => {
        setSelectedTitleId(title.id);
        handleTargetTime(title.startSec + (title.durationSec || 3) / 2);
    };

    const TITLE_MODELS = [
        { id: 'neo-pop', name: 'Neo Pop' },
        { id: 'solid-ribbon', name: 'Faixa Sólida' },
        { id: 'gradient-glow', name: 'Brilho Gradiente' },
        { id: 'framed-box', name: 'Caixa Emoldurada' },
        { id: 'minimal-underline', name: 'Minimalista' },
        { id: 'default', name: 'Padrão' },
    ];

    const CTA_MODELS = [
        { id: 'cta-search', name: 'Barra de Busca' },
        { id: 'cta-tap', name: 'Botão de Clique' },
        { id: 'cta-whatsapp', name: 'Balão WhatsApp' },
    ];

    const PREMIUM_MODELS: { id: string; name: string }[] = [];

    const LOCATION_MODELS = [
        { id: 'loc-pin-viagem', name: 'Pin de Viagem' },
        { id: 'loc-minimal-urbano', name: 'Minimalista' },
        { id: 'loc-tag-geo', name: 'Tag Geográfica' },
    ];

    const selectedTitle = titles.find((t) => t.id === selectedTitleId);

    return (
        <div className="max-w-[1600px] mx-auto pb-24 px-6 md:px-4">
            <header className="mb-6 md:mb-4 mt-6 md:mt-4 text-center">
                <h2 className="text-3xl lg:text-4xl font-extrabold text-foreground tracking-tight inline-flex items-center gap-2">
                    <span className="bg-linear-to-r from-brand-lime to-brand-accent bg-clip-text text-transparent">
                        Ganchos e Títulos
                    </span>
                </h2>
                <p className="text-brand-muted mt-2 max-w-2xl mx-auto text-xs md:text-sm font-medium">
                    Adicione ganchos visuais e Call-to-Actions impactantes para prender a atenção do seu público nos
                    primeiros segundos.
                </p>
            </header>

            <div className="grid lg:grid-cols-12 gap-4 lg:gap-6 h-[calc(100vh-180px)] min-h-[450px]">
                {/* COLUMN 1: AI Hooks (Left) */}
                <div className="lg:col-span-4 flex flex-col gap-3 bg-brand-card shadow-2xl border border-black/5 dark:border-white/5 rounded-3xl p-4 overflow-y-auto custom-scrollbar relative">
                    <button
                        onClick={handleGenerateTitles}
                        disabled={false}
                        className="w-full py-3.5 bg-linear-to-r from-brand-lime to-brand-accent hover:shadow-[0_0_15px_rgba(0,230,118,0.4)] hover:scale-[1.02] active:scale-[0.98] text-[#0a0f12] font-bold rounded-2xl text-[13px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 disabled:opacity-50 z-10"
                    >
                        {isGenerating ? (
                            <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                        ) : (
                            <Wand2 className="w-4 h-4" />
                        )}
                        {isGenerating ? 'Analisando...' : 'Gerar Títulos com IA'}
                    </button>

                    <button
                        onClick={() => {
                            const newTitle: TitleHook = {
                                id: `manual-${Date.now()}`,
                                text: '',
                                styleId: 'solid-ribbon',
                                startSec: 0,
                                durationSec: 3,
                                isActive: true,
                                hasSound: true,
                                posY: 30,
                                scale: 1,
                                primaryColor: '#00E676',
                                secondaryColor: '#ffffff',
                                animationId: 'pop',
                                fontFamily: 'Poppins',
                            };
                            updateAdData({ dynamicTitles: [...titles, newTitle] });
                            setSelectedTitleId(newTitle.id);
                            toast.success('Título criado! Edite o texto abaixo.');
                        }}
                        className="w-full py-3 border-2 border-dashed border-brand-accent/30 hover:border-brand-accent/60 hover:bg-brand-accent/5 text-brand-accent font-bold rounded-2xl text-[12px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 mt-1"
                    >
                        <Sparkles className="w-4 h-4" />
                        Criar Título
                    </button>

                    <div className="space-y-2 mt-1">
                        {titles.length === 0 && !isGenerating && (
                            <div className="text-center p-8 bg-brand-dark rounded-2xl border border-dashed border-black/10 dark:border-white/10 mt-4">
                                <div className="w-16 h-16 bg-black/5 dark:bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                    <Sparkles className="w-8 h-8 text-brand-muted opacity-50" />
                                </div>
                                <p className="text-xs text-brand-muted uppercase tracking-wider font-bold">
                                    Nenhum título gerado ainda
                                </p>
                            </div>
                        )}

                        {titles.map((title, i) => {
                            const isExpanded = title.id === selectedTitleId;
                            return (
                                <div
                                    key={title.id}
                                    onClick={() => handleSelectTitle(title)}
                                    className={cn(
                                        'flex flex-col bg-brand-dark rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden shadow-lg',
                                        title.isActive
                                            ? 'border-brand-accent/50 shadow-[0_0_15px_rgba(0,230,118,0.1)]'
                                            : 'border-black/5 dark:border-white/5 opacity-70 hover:opacity-100',
                                        isExpanded
                                            ? 'ring-1 ring-brand-accent bg-brand-accent/5'
                                            : 'hover:border-brand-accent/30'
                                    )}
                                >
                                    {/* Compact Card Header (Always Visible) */}
                                    <div className="flex items-center justify-between p-3 bg-black/5 dark:bg-white/5">
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
                                                {isExpanded ? (
                                                    <ChevronDown className="w-4 h-4 text-brand-accent" />
                                                ) : (
                                                    <ChevronUp className="w-4 h-4 text-brand-muted" />
                                                )}
                                                <span className="text-xs font-bold text-brand-accent bg-brand-accent/10 border border-brand-accent/20 px-2 py-0.5 rounded-md shrink-0 shadow-[0_0_8px_rgba(0,230,118,0.2)]">
                                                    #{i + 1}
                                                </span>
                                            </div>
                                            {!isExpanded && (
                                                <span className="text-xs text-foreground truncate font-semibold tracking-wide">
                                                    {title.text || 'Sem texto'}
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const newActive = !title.isActive;
                                                updateTitle(title.id, { isActive: newActive });
                                                if (newActive)
                                                    handleTargetTime(title.startSec + (title.durationSec || 3) / 2);
                                            }}
                                            className={cn(
                                                'p-2 rounded-xl transition-colors ml-2 shadow-inner',
                                                title.isActive
                                                    ? 'bg-brand-lime/20 text-brand-lime hover:bg-brand-lime/30 border border-brand-lime/20 drop-shadow-[0_0_5px_rgba(163,230,53,0.5)]'
                                                    : 'bg-black/5 dark:bg-white/5 text-brand-muted hover:text-foreground border border-transparent'
                                            )}
                                            title={title.isActive ? 'Desativar Gancho' : 'Ativar Gancho'}
                                        >
                                            <Power className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* Expanded Content Area */}
                                    {isExpanded && (
                                        <div className="flex border-t border-white/5 bg-black/20">
                                            {/* Main Content (Left) */}
                                            <div className="flex-1 p-2 md:p-3 flex flex-col gap-2 md:gap-3">
                                                <textarea
                                                    value={title.text}
                                                    onChange={(e) => updateTitle(title.id, { text: e.target.value })}
                                                    className="w-full bg-black/30 border border-white/5 rounded-md p-2 text-xs font-medium text-foreground resize-none focus:outline-none focus:border-brand-accent/50 h-12 md:h-16 custom-scrollbar placeholder:text-brand-muted"
                                                    placeholder="Texto do gancho..."
                                                />

                                                <div className="flex items-center justify-between bg-black/30 p-1.5 rounded-md border border-white/5 shadow-inner">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex items-center gap-1.5">
                                                            <Clock className="w-3 h-3 text-brand-accent" />
                                                            <span className="text-[10px] uppercase tracking-wider text-brand-muted font-semibold">
                                                                Início
                                                            </span>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step="0.1"
                                                                value={title.startSec}
                                                                onChange={(e) =>
                                                                    updateTitle(title.id, {
                                                                        startSec: Number(e.target.value),
                                                                    })
                                                                }
                                                                className="w-[52px] bg-brand-dark border border-white/5 rounded px-1 py-0.5 text-center text-xs text-foreground focus:outline-none focus:border-brand-accent transition-colors placeholder:text-brand-muted"
                                                            />
                                                        </div>
                                                        <div className="w-px h-3 bg-white/5" />
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[10px] uppercase tracking-wider text-brand-muted font-bold">
                                                                Fim
                                                            </span>
                                                            <input
                                                                type="number"
                                                                min="0.1"
                                                                step="0.1"
                                                                value={title.durationSec}
                                                                onChange={(e) =>
                                                                    updateTitle(title.id, {
                                                                        durationSec: Number(e.target.value),
                                                                    })
                                                                }
                                                                className="w-[52px] bg-background border border-black/10 dark:border-white/10 rounded-lg px-2 py-1 text-center text-xs font-mono text-foreground focus:outline-none focus:border-brand-accent transition-colors"
                                                            />
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleTargetTime(title.startSec);
                                                        }}
                                                        className="text-brand-accent hover:text-foreground text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 rounded-lg bg-brand-accent/10 hover:bg-brand-accent/20 transition-colors border border-brand-accent/20 shadow-[0_0_10px_rgba(0,230,118,0.1)]"
                                                    >
                                                        Sync
                                                    </button>
                                                </div>

                                                {/* Settings Grid */}
                                                <div className="grid grid-cols-2 gap-3 text-[11px] mt-1">
                                                    <div className="flex flex-col gap-1.5">
                                                        <span className="text-[9px] uppercase tracking-wider text-brand-muted font-bold pl-1">
                                                            Animação
                                                        </span>
                                                        <select
                                                            value={title.animationId || 'pop'}
                                                            onChange={(e) =>
                                                                updateTitle(title.id, {
                                                                    animationId: e.target.value,
                                                                })
                                                            }
                                                            className="bg-brand-card/50 border border-black/10 dark:border-white/10 text-foreground font-medium text-xs rounded-lg px-3 py-2 outline-none focus:border-brand-accent transition-colors cursor-pointer w-full appearance-none shadow-inner"
                                                        >
                                                            <option value="fade">Esmaecer Suave</option>
                                                            <option value="pop">Impacto Elástico</option>
                                                            <option value="slide">Deslize Rápido</option>
                                                            <option value="none">Estático</option>
                                                        </select>
                                                    </div>

                                                    <div className="flex flex-col gap-1.5">
                                                        <span className="text-[9px] uppercase tracking-wider text-brand-muted font-bold pl-1">
                                                            Fonte
                                                        </span>
                                                        <select
                                                            value={title.fontFamily || 'Poppins'}
                                                            onChange={(e) =>
                                                                updateTitle(title.id, { fontFamily: e.target.value })
                                                            }
                                                            className="bg-brand-card/50 border border-black/10 dark:border-white/10 text-foreground font-medium text-xs rounded-lg px-3 py-2 outline-none focus:border-brand-accent transition-colors cursor-pointer w-full appearance-none shadow-inner"
                                                        >
                                                            <option value="Inter">Inter</option>
                                                            <option value="Poppins">Poppins</option>
                                                            <option value="Montserrat">Montserrat</option>
                                                            <option value="Impact">Impact</option>
                                                            <option value="Bebas Neue">Bebas Neue</option>
                                                            <option value="Anton">Anton</option>
                                                        </select>
                                                    </div>

                                                    <div className="col-span-2 mt-2">
                                                        <button
                                                            onClick={() =>
                                                                updateTitle(title.id, { hasSound: !title.hasSound })
                                                            }
                                                            className={cn(
                                                                'w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border shadow-inner uppercase tracking-wider',
                                                                title.hasSound
                                                                    ? 'bg-brand-accent/10 border-brand-accent/30 text-brand-accent shadow-[0_0_15px_rgba(0,230,118,0.1)]'
                                                                    : 'bg-black/5 dark:bg-white/5 border-transparent text-brand-muted hover:text-foreground hover:bg-black/10 dark:bg-white/10'
                                                            )}
                                                        >
                                                            {title.hasSound ? (
                                                                <Volume2 className="w-4 h-4" />
                                                            ) : (
                                                                <VolumeX className="w-4 h-4" />
                                                            )}
                                                            {title.hasSound ? 'SFX Ativado' : 'Sem Áudio'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Vertical Sliders (Right) */}
                                            <div className="min-w-[84px] w-[84px] shrink-0 flex border-l border-white/5 bg-black/30 rounded-br-lg p-1.5">
                                                {/* Position */}
                                                <div className="w-1/2 flex flex-col items-center justify-between py-2 border-r border-white/5">
                                                    <span
                                                        className="text-[9px] uppercase tracking-widest text-brand-muted font-bold leading-none"
                                                        title="Topo"
                                                    >
                                                        0%
                                                    </span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            updateTitle(title.id, {
                                                                posY: Math.max(0, title.posY - 2),
                                                            });
                                                        }}
                                                        className="w-6 h-6 flex items-center justify-center text-brand-muted hover:text-foreground bg-black/20 hover:bg-white/10 rounded transition-colors text-sm font-bold"
                                                        title="Subir"
                                                    >
                                                        −
                                                    </button>
                                                    <div className="relative flex justify-center items-center py-2 h-full w-full overflow-visible min-h-[80px] md:min-h-[100px]">
                                                        <input
                                                            type="range"
                                                            min="0"
                                                            max="100"
                                                            step="1"
                                                            value={100 - title.posY}
                                                            onChange={(e) =>
                                                                updateTitle(title.id, {
                                                                    posY: 100 - parseInt(e.target.value),
                                                                })
                                                            }
                                                            className="absolute w-[80px] md:w-[96px] h-1.5 accent-brand-accent rounded-full appearance-none bg-brand-dark -rotate-90 origin-center cursor-ns-resize shadow-inner border border-white/5"
                                                            title={`Posição Vertical: ${title.posY}%`}
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            updateTitle(title.id, {
                                                                posY: Math.min(100, title.posY + 2),
                                                            });
                                                        }}
                                                        className="w-6 h-6 flex items-center justify-center text-brand-muted hover:text-foreground bg-black/20 hover:bg-white/10 rounded transition-colors text-sm font-bold"
                                                        title="Descer"
                                                    >
                                                        +
                                                    </button>
                                                    <span
                                                        className="text-[9px] uppercase tracking-widest text-slate-500 font-bold leading-none"
                                                        title="Base"
                                                    >
                                                        100%
                                                    </span>
                                                </div>

                                                {/* Size */}
                                                <div className="w-1/2 flex flex-col items-center justify-between py-2">
                                                    <span
                                                        className="text-[9px] uppercase tracking-widest text-brand-muted font-bold leading-none"
                                                        title="Max"
                                                    >
                                                        2x
                                                    </span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            updateTitle(title.id, {
                                                                scale: Math.min(2.5, (title.scale ?? 1) + 0.1),
                                                            });
                                                        }}
                                                        className="w-6 h-6 flex items-center justify-center text-brand-muted hover:text-foreground bg-black/20 hover:bg-white/10 rounded transition-colors text-sm font-bold"
                                                        title="Aumentar"
                                                    >
                                                        +
                                                    </button>
                                                    <div className="relative flex justify-center items-center py-2 h-full w-full overflow-visible min-h-[80px] md:min-h-[100px]">
                                                        <input
                                                            type="range"
                                                            min="0.5"
                                                            max="2.5"
                                                            step="0.1"
                                                            value={title.scale ?? 1}
                                                            onChange={(e) =>
                                                                updateTitle(title.id, {
                                                                    scale: parseFloat(e.target.value),
                                                                })
                                                            }
                                                            className="absolute w-[80px] md:w-[96px] h-1.5 accent-brand-accent rounded-full appearance-none bg-brand-dark -rotate-90 origin-center cursor-ns-resize shadow-inner border border-white/5"
                                                            title={`Tamanho: ${title.scale ?? 1}x`}
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            updateTitle(title.id, {
                                                                scale: Math.max(0.5, (title.scale ?? 1) - 0.1),
                                                            });
                                                        }}
                                                        className="w-6 h-6 flex items-center justify-center text-brand-muted hover:text-foreground bg-black/20 hover:bg-white/10 rounded transition-colors text-sm font-bold"
                                                        title="Diminuir"
                                                    >
                                                        −
                                                    </button>
                                                    <span
                                                        className="text-[9px] uppercase tracking-widest text-brand-muted font-bold leading-none"
                                                        title="Min"
                                                    >
                                                        .5x
                                                    </span>
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
                <div className="lg:col-span-4 bg-brand-card/30 border border-black/5 dark:border-white/5 shadow-inner rounded-3xl p-5 flex flex-col custom-scrollbar overflow-y-auto">
                    {/* Accordion: Simples */}
                    <div className="mb-6">
                        <div
                            className="flex items-center justify-between bg-brand-dark p-4 rounded-t-2xl border border-black/5 dark:border-white/5 shadow-sm cursor-pointer hover:bg-black/5 dark:bg-white/5 transition-colors group"
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
                                {TITLE_MODELS.map((model) => {
                                    const isSelected =
                                        selectedTitle?.styleId === model.id ||
                                        (!selectedTitle?.styleId && model.id === 'default');

                                    const mockTitle: TitleHook = selectedTitle
                                        ? {
                                              ...selectedTitle,
                                              text: 'EXEMPLO DE TÍTULO',
                                              styleId: model.id,
                                              primaryColor: isSelected ? selectedTitle.primaryColor : '#00E676',
                                              secondaryColor: isSelected ? selectedTitle.secondaryColor : '#ffffff',
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
                                              primaryColor: '#00E676',
                                              secondaryColor: '#ffffff',
                                          };

                                    return (
                                        <button
                                            key={model.id}
                                            onClick={() =>
                                                selectedTitle && updateTitle(selectedTitle.id, { styleId: model.id })
                                            }
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
                                                            value={selectedTitle.primaryColor || '#00E676'}
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
                                                            value={selectedTitle.secondaryColor || '#ffffff'}
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
                                                    <DynamicTitleRenderer title={mockTitle} />
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Accordion: Call to Action */}
                    <div className="mb-6 mt-4">
                        <div
                            className="flex items-center justify-between bg-brand-dark p-4 rounded-t-2xl border border-black/5 dark:border-white/5 shadow-sm cursor-pointer hover:bg-black/5 dark:bg-white/5 transition-colors group"
                            onClick={() => setIsCtaOpen(!isCtaOpen)}
                        >
                            <div className="flex items-center gap-3">
                                {isCtaOpen ? (
                                    <ChevronUp className="w-5 h-5 text-brand-lime" />
                                ) : (
                                    <ChevronDown className="w-5 h-5 text-brand-lime" />
                                )}
                                <h4 className="font-bold uppercase tracking-wider text-brand-lime text-[13px] drop-shadow-[0_0_5px_rgba(163,230,53,0.3)]">
                                    Categoria: Call to Action (CTA)
                                </h4>
                            </div>
                        </div>

                        {isCtaOpen && (
                            <div className="grid gap-4 bg-brand-dark/40 p-5 border border-t-0 border-black/5 dark:border-white/5 rounded-b-2xl">
                                {CTA_MODELS.map((model) => {
                                    const isSelected = selectedTitle?.styleId === model.id;

                                    const mockTitle: TitleHook = selectedTitle
                                        ? {
                                              ...selectedTitle,
                                              text: 'CHAMADA PARA AÇÃO',
                                              styleId: model.id,
                                              primaryColor: isSelected ? selectedTitle.primaryColor : '#A3E635',
                                              secondaryColor: isSelected ? selectedTitle.secondaryColor : '#ffffff',
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
                                              primaryColor: '#A3E635', // Lime default for CTA
                                              secondaryColor: '#ffffff',
                                          };

                                    return (
                                        <button
                                            key={model.id}
                                            onClick={
                                                () =>
                                                    selectedTitle &&
                                                    updateTitle(selectedTitle.id, {
                                                        styleId: model.id,
                                                        animationId: 'none',
                                                    }) // Ensure no generic animation overwrites cursors
                                            }
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
                                                            value={selectedTitle.primaryColor || '#A3E635'}
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
                                                            value={selectedTitle.secondaryColor || '#ffffff'}
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
                                                <DynamicTitleRenderer title={mockTitle} />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Accordion: Premium */}
                    <div className="mb-6 mt-4">
                        <div
                            className="flex items-center justify-between bg-brand-dark p-4 rounded-t-2xl border border-black/5 dark:border-white/5 shadow-sm cursor-pointer hover:bg-black/5 dark:bg-white/5 transition-colors group"
                            onClick={() => setIsPremiumOpen(!isPremiumOpen)}
                        >
                            <div className="flex items-center gap-3">
                                {isPremiumOpen ? (
                                    <ChevronUp className="w-5 h-5 text-amber-400" />
                                ) : (
                                    <ChevronDown className="w-5 h-5 text-amber-400" />
                                )}
                                <h4 className="font-bold uppercase tracking-wider text-amber-400 text-[13px] drop-shadow-[0_0_5px_rgba(251,191,36,0.3)]">
                                    Categoria: Especiais (Premium)
                                </h4>
                            </div>
                        </div>

                        {isPremiumOpen && (
                            <div className="grid gap-4 bg-brand-dark/40 p-5 border border-t-0 border-black/5 dark:border-white/5 rounded-b-2xl animate-in slide-in-from-top-2 duration-200">
                                {PREMIUM_MODELS.map((model) => {
                                    const isSelected = selectedTitle?.styleId === model.id;

                                    const mockTitle: TitleHook = selectedTitle
                                        ? {
                                              ...selectedTitle,
                                              text: 'Lançamento',
                                              styleId: model.id,
                                              primaryColor: isSelected ? selectedTitle.primaryColor : '#FBBF24',
                                              secondaryColor: isSelected ? selectedTitle.secondaryColor : '#ffffff',
                                          }
                                        : {
                                              id: 'mock',
                                              text: 'Lançamento',
                                              styleId: model.id,
                                              startSec: 0,
                                              durationSec: 1,
                                              isActive: true,
                                              posY: 30,
                                              scale: 1,
                                              primaryColor: '#FBBF24', // Amber default for Premium
                                              secondaryColor: '#ffffff',
                                          };

                                    return (
                                        <button
                                            key={model.id}
                                            onClick={() =>
                                                selectedTitle && updateTitle(selectedTitle.id, { styleId: model.id })
                                            }
                                            className={cn(
                                                'relative h-24 bg-background rounded-2xl border-2 flex flex-col items-center justify-center transition-all group overflow-hidden shadow-lg hover:shadow-xl',
                                                isSelected && selectedTitle
                                                    ? 'border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.15)]'
                                                    : 'border-transparent hover:border-black/10 dark:border-white/10',
                                                !selectedTitle && 'opacity-60 cursor-not-allowed'
                                            )}
                                            disabled={!selectedTitle}
                                        >
                                            <div className="absolute top-3 inset-x-0 w-full flex justify-center z-20">
                                                <span
                                                    className={cn(
                                                        'text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-background/80 backdrop-blur-md',
                                                        isSelected && selectedTitle
                                                            ? 'text-amber-400 border border-amber-400/50'
                                                            : 'text-brand-muted border border-white/5'
                                                    )}
                                                >
                                                    {model.name}
                                                </span>
                                            </div>

                                            {isSelected && selectedTitle && (
                                                <>
                                                    <div className="absolute top-3 right-3 bg-amber-400 rounded-full p-0.5 shadow-[0_0_10px_rgba(251,191,36,0.6)] z-10">
                                                        <CheckCircle2 className="w-5 h-5 text-[#0a0f12]" />
                                                    </div>
                                                    <div
                                                        className="absolute bottom-3 right-3 flex items-center gap-2 bg-brand-dark/95 p-1.5 rounded-xl border border-black/10 dark:border-white/10 backdrop-blur-md z-20 shadow-xl"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <input
                                                            type="color"
                                                            value={selectedTitle.primaryColor || '#FBBF24'}
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
                                                            value={selectedTitle.secondaryColor || '#ffffff'}
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

                                            <div className="scale-[0.45] origin-center -mt-2 w-full flex items-center justify-center">
                                                <DynamicTitleRenderer title={mockTitle} />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Accordion: Localização */}
                    <div className="mb-6 mt-4">
                        <div
                            className="flex items-center justify-between bg-brand-dark p-4 rounded-t-2xl border border-black/5 dark:border-white/5 shadow-sm cursor-pointer hover:bg-black/5 dark:bg-white/5 transition-colors group"
                            onClick={() => setIsLocationOpen(!isLocationOpen)}
                        >
                            <div className="flex items-center gap-3">
                                {isLocationOpen ? (
                                    <ChevronUp className="w-5 h-5 text-brand-accent" />
                                ) : (
                                    <ChevronDown className="w-5 h-5 text-brand-accent" />
                                )}
                                <MapPin className="w-4 h-4 text-brand-accent" />
                                <h4 className="font-bold uppercase tracking-wider text-brand-accent text-[13px] drop-shadow-[0_0_5px_rgba(0,230,118,0.3)]">
                                    Categoria: Localização
                                </h4>
                            </div>
                        </div>

                        {isLocationOpen && (
                            <div className="grid gap-4 bg-brand-dark/40 p-5 border border-t-0 border-black/5 dark:border-white/5 rounded-b-2xl animate-in slide-in-from-top-2 duration-200">
                                {LOCATION_MODELS.map((model) => {
                                    const isSelected = selectedTitle?.styleId === model.id;

                                    const mockTitle: TitleHook = selectedTitle
                                        ? {
                                              ...selectedTitle,
                                              text: 'São Paulo, SP',
                                              styleId: model.id,
                                              primaryColor: isSelected ? selectedTitle.primaryColor : '#00E676',
                                              secondaryColor: isSelected ? selectedTitle.secondaryColor : '#ffffff',
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
                                              primaryColor: '#00E676',
                                              secondaryColor: '#ffffff',
                                          };

                                    return (
                                        <button
                                            key={model.id}
                                            onClick={() =>
                                                selectedTitle && updateTitle(selectedTitle.id, { styleId: model.id })
                                            }
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
                                                            value={selectedTitle.primaryColor || '#00E676'}
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
                                                            value={selectedTitle.secondaryColor || '#ffffff'}
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
                                                    <DynamicTitleRenderer title={mockTitle} />
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* COLUMN 3: Preview (Right) */}
                <div className="lg:col-span-4 bg-brand-dark rounded-3xl border border-black/5 dark:border-white/5 overflow-hidden relative shadow-2xl flex flex-col justify-center">
                    {mediaTakes.length > 0 ? (
                        <div className="absolute inset-0 m-auto flex items-center justify-center">
                            <div
                                className="relative shadow-[0_0_50px_rgba(0,0,0,0.8)]"
                                style={{ width: '100%', maxWidth: '360px', aspectRatio: '9/16' }}
                            >
                                <VideoSequencePreview
                                    ref={previewRef}
                                    takes={mediaTakes}
                                    masterAudioUrl={adData.masterAudioUrl}
                                    captions={adData.captions}
                                    hideControls={true}
                                    onMuteToggle={() => {}}
                                    onMuteAll={() => {}}
                                    dynamicTitles={titles.filter((t) => t.isActive)}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-brand-muted z-10 p-6 text-center font-bold uppercase tracking-wider text-xs">
                            Adicione mídia na Etapa 1 para visualizar o vídeo.
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Navigation */}
            <div className="fixed bottom-0 right-0 left-0 bg-background/80 backdrop-blur-xl border-t border-black/5 dark:border-white/5 p-4 z-40 flex items-center justify-between shadow-2xl">
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
                    onClick={() => {
                        (window as unknown as { _isTestExportPattern: boolean })._isTestExportPattern = false;
                        setShowExportModal(true);
                    }}
                    className="px-10 py-3.5 bg-linear-to-r from-brand-lime to-brand-accent hover:shadow-[0_0_20px_rgba(0,230,118,0.4)] text-[#0a0f12] font-extrabold uppercase tracking-widest rounded-xl text-sm flex items-center gap-3 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                    <Download className="w-5 h-5 flex-shrink-0" />
                    <span>Exportar e Concluir</span>
                </button>

                {showExportModal && (
                    <ExportModal
                        onClose={() => setShowExportModal(false)}
                        previewRef={previewRef}
                        mediaTakes={mediaTakes}
                        masterAudioUrl={adData.masterAudioUrl || adData.narrationAudioUrl || undefined}
                        isHybridMode={true} // Ativando Pipeline Nativo (FFmpeg) oficializado
                        transitionPath={adData.transitionPath || adData.globalTransition?.filePath}
                    />
                )}
            </div>
        </div>
    );
};
