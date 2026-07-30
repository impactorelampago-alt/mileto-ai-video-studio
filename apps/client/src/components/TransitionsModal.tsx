import React, { useState, useEffect, useRef } from 'react';
import { useWizard } from '../context/WizardContext';
import { X, Upload, Loader2, Volume2, VolumeX, Check, Plus, Sparkles, Trash2, Search, Film, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import type { TransitionAsset } from '../types';

const TransitionCard = ({
    t,
    isSelected,
    currentVolume,
    currentMuted,
    onVolumeChange,
    onMuteToggle,
    toggleTransitionSelection,
    onDelete,
}: {
    t: TransitionAsset;
    isSelected: boolean;
    currentVolume: number;
    currentMuted: boolean;
    onVolumeChange: (vol: number) => void;
    onMuteToggle: (muted: boolean) => void;
    toggleTransitionSelection: (t: TransitionAsset) => void;
    onDelete: (t: TransitionAsset) => void;
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    const showPreviewFrame = () => {
        const video = videoRef.current;
        if (!video || !Number.isFinite(video.duration)) return;
        video.currentTime = Math.min(Math.max(video.duration * 0.18, 0.08), 0.45);
    };

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = Math.min(1, currentVolume);
        }
    }, [currentVolume]);

    const handleMouseEnter = () => {
        if (videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(() => {});
        }
    };

    const handleMouseLeave = () => {
        if (videoRef.current) {
            videoRef.current.pause();
            showPreviewFrame();
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        const vol = parseFloat(e.target.value);
        onVolumeChange(vol);

        if (videoRef.current) {
            videoRef.current.volume = Math.min(1, vol);
            if (videoRef.current.paused) {
                videoRef.current.play().catch(() => {});
            }
        }
    };

    const toggleMute = (e: React.MouseEvent) => {
        e.stopPropagation();
        const isNowMuted = !currentMuted;
        onMuteToggle(isNowMuted);

        if (!isNowMuted && videoRef.current && videoRef.current.paused) {
            videoRef.current.play().catch(() => {});
        }
    };

    return (
        <div
            onClick={() => toggleTransitionSelection(t)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={cn(
                'relative flex flex-row items-stretch overflow-hidden rounded-2xl border transition-all duration-200 bg-card cursor-pointer hover:-translate-y-0.5 hover:shadow-xl',
                isSelected
                    ? 'border-primary shadow-[0_0_0_1px_rgba(0,230,118,.18),0_14px_32px_rgba(0,0,0,.28)]'
                    : 'border-border hover:border-primary/50'
            )}
        >
            <div className="flex flex-col flex-1 min-w-0">
                <div className="relative h-36 w-full overflow-hidden bg-black group flex items-center justify-center">
                    <Film className="absolute h-9 w-9 text-primary/20" />
                    <video
                        ref={videoRef}
                        src={`${(window as any).API_BASE_URL || 'http://localhost:3301'}${t.publicUrl}`}
                        className="h-full w-full object-cover opacity-80 transition-all duration-500 group-hover:scale-105 group-hover:opacity-100"
                        loop
                        playsInline
                        muted={currentMuted}
                        preload="metadata"
                        onLoadedMetadata={showPreviewFrame}
                    />

                    {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-primary/20 pointer-events-none">
                            <Check className="h-12 w-12 text-primary drop-shadow-md" />
                        </div>
                    )}
                </div>

                <div className="w-full p-3.5 mt-auto flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <p className="w-full truncate text-sm font-semibold text-foreground" title={t.originalName}>
                                {t.originalName}
                            </p>
                            {t.isBuiltIn && (
                                <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary">
                                    Incluída
                                </span>
                            )}
                        </div>
                        {t.description && (
                            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                                {t.description}
                            </p>
                        )}
                        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{`${t.durationSec.toFixed(1)}s · overlay`}</p>
                    </div>

                    {!t.isBuiltIn && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(t);
                            }}
                            className="p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-md transition-colors shrink-0"
                            title="Deletar Transição"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {!t.isBuiltIn && (
                <div
                    className="w-12 border-l border-border bg-background/50 flex flex-col items-center py-3 px-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={toggleMute}
                        className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-md shadow-sm transition-colors mb-3 shrink-0',
                            currentMuted
                                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                                : 'bg-primary/10 text-primary hover:bg-primary/20'
                        )}
                        title={currentMuted ? 'Desmutar' : 'Mutar'}
                    >
                        {currentMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>

                    <div className="flex-1 w-full flex justify-center py-2 h-24">
                        <input
                            type="range"
                            // @ts-expect-error - orient is a non-standard attribute supported by Firefox
                            orient="vertical"
                            min="0"
                            max="2"
                            step="0.05"
                            value={currentVolume}
                            onChange={handleVolumeChange}
                            disabled={currentMuted}
                            className="w-1.5 h-full cursor-pointer appearance-none rounded-lg bg-secondary accent-primary"
                            style={
                                {
                                    WebkitAppearance: 'slider-vertical',
                                    writingMode: 'bt-lr',
                                } as unknown as React.CSSProperties
                            }
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

interface TransitionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    targetTakeId?: string | null;
}

export const TransitionsModal: React.FC<TransitionsModalProps> = ({ isOpen, onClose, targetTakeId }) => {
    const { adData, updateAdData, mediaTakes, setMediaTakes } = useWizard();

    const targetTake = targetTakeId ? mediaTakes.find((t) => t.id === targetTakeId) : null;
    const isGlobal = !targetTakeId || !targetTake;

    const currentTransition = isGlobal ? adData.globalTransition : targetTake.transition?.asset;
    const currentVolume = isGlobal ? (adData.transitionVolume ?? 1.0) : (targetTake.transition?.volume ?? 1.0);
    const currentMuted = isGlobal ? (adData.transitionMuted ?? false) : (targetTake.transition?.muted ?? false);
    const transitionRotation = adData.transitionRotation ?? 0;

    const [transitions, setTransitions] = useState<TransitionAsset[]>([]);
    const [categories, setCategories] = useState<string[]>(['Essencial']);
    const [activeCategory, setActiveCategory] = useState<string>('Essencial');
    const [isCreatingCategory, setIsCreatingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [itemToDelete, setItemToDelete] = useState<TransitionAsset | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadTransitions = async () => {
        try {
            const res = await fetch(`${(window as any).API_BASE_URL || 'http://localhost:3301'}/api/transitions/list`);
            const data = await res.json();
            if (data.ok) {
                setTransitions(data.transitions);
                const fetchedCategories = Array.from(
                    new Set(data.transitions.map((t: TransitionAsset) => t.category || 'Essencial'))
                ) as string[];
                const preferred = ['Luz & Cinema', 'Movimento & Energia', 'Texturas & Acabamentos', 'Essencial'];
                const orderedCategories = [
                    ...preferred.filter((category) => fetchedCategories.includes(category)),
                    ...fetchedCategories.filter((category) => !preferred.includes(category)),
                ];
                setCategories(orderedCategories);
                setActiveCategory((current) =>
                    orderedCategories.includes(current) ? current : orderedCategories[0] || 'Essencial'
                );
            }
        } catch (err) {
            console.error('Failed to load transitions', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadTransitions();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleCreateCategory = () => {
        const name = newCategoryName.trim();
        if (!name) return;
        if (categories.includes(name)) {
            toast.error('Essa categoria já existe');
            return;
        }
        setCategories((prev) => [...prev, name]);
        setActiveCategory(name);
        setNewCategoryName('');
        setIsCreatingCategory(false);
    };

    const handleDeleteTransition = (t: TransitionAsset) => {
        setItemToDelete(t);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        const t = itemToDelete;

        try {
            const res = await fetch(
                `${(window as any).API_BASE_URL || 'http://localhost:3301'}/api/transitions/${t.id}`,
                {
                    method: 'DELETE',
                }
            );
            const data = await res.json();

            if (data.ok) {
                setTransitions((prev) => prev.filter((item) => item.id !== t.id));
                toast.success('Transição removida!');

                // Limpar seletor se for a atual
                if (currentTransition?.id === t.id) {
                    if (isGlobal) {
                        updateAdData({ globalTransition: null });
                    } else if (targetTakeId) {
                        setMediaTakes((prev) =>
                            prev.map((take) => {
                                if (take.id === targetTakeId) {
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    const { transition, ...rest } = take;
                                    return rest;
                                }
                                return take;
                            })
                        );
                    }
                }
            } else {
                toast.error(data.message || 'Falha ao deletar transição');
            }
        } catch (err) {
            console.error('Erro ao deletar transição:', err);
            toast.error('Erro de conexão ao deletar');
        } finally {
            setItemToDelete(null);
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', activeCategory);

        try {
            const res = await fetch(
                `${(window as any).API_BASE_URL || 'http://localhost:3301'}/api/transitions/upload`,
                {
                    method: 'POST',
                    body: formData,
                }
            );
            const data = await res.json();

            if (data.ok && data.transition) {
                const newTransition = { ...data.transition, category: activeCategory };
                setTransitions((prev) => [...prev, newTransition]);
                toast.success('Video de transição carregado!');
                toggleTransitionSelection(newTransition);
            } else {
                toast.error(data.message || 'Falha ao carregar transição');
            }
        } catch (err) {
            console.error(err);
            toast.error('Erro de conexão ao carregar transição');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const toggleTransitionSelection = (t: TransitionAsset) => {
        if (isGlobal) {
            if (adData.globalTransition?.id === t.id) {
                updateAdData({ globalTransition: null });
            } else {
                updateAdData({ globalTransition: t });
            }
        } else if (targetTakeId) {
            setMediaTakes((prev) =>
                prev.map((take) => {
                    if (take.id === targetTakeId) {
                        if (take.transition?.asset.id === t.id) {
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            const { transition, ...rest } = take;
                            return rest; // Remove transition
                        } else {
                            return {
                                ...take,
                                transition: {
                                    asset: t,
                                    volume: take.transition?.volume ?? 1.0,
                                    muted: take.transition?.muted ?? false,
                                },
                            };
                        }
                    }
                    return take;
                })
            );
        }
    };

    const handleVolumeChange = (vol: number) => {
        if (isGlobal) {
            updateAdData({ transitionVolume: vol, transitionMuted: false });
        } else if (targetTakeId) {
            setMediaTakes((prev) =>
                prev.map((take) =>
                    take.id === targetTakeId
                        ? {
                              ...take,
                              transition: take.transition
                                  ? { ...take.transition, volume: vol, muted: false }
                                  : undefined, // Only adjust volume if a transition is selected
                          }
                        : take
                )
            );
        }
    };

    const handleMuteToggle = (muted: boolean) => {
        if (isGlobal) {
            updateAdData({ transitionMuted: muted });
        } else if (targetTakeId) {
            setMediaTakes((prev) =>
                prev.map((take) =>
                    take.id === targetTakeId
                        ? {
                              ...take,
                              transition: take.transition ? { ...take.transition, muted: muted } : undefined,
                          }
                        : take
                )
            );
        }
    };

    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('pt-BR');
    const activeTransitions = transitions.filter((transition) => {
        const matchesSearch = `${transition.originalName} ${transition.description || ''} ${transition.category || ''}`
            .toLocaleLowerCase('pt-BR')
            .includes(normalizedQuery);

        if (normalizedQuery) return matchesSearch;
        return (transition.category || 'Essencial') === activeCategory;
    });
    const activeLabel = normalizedQuery ? 'Resultados da busca' : activeCategory;
    const selectedCategory = currentTransition?.category || 'Essencial';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="bg-card border border-border/80 w-full max-w-[1320px] h-[min(860px,92vh)] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
                <div className="flex items-center justify-between p-6 border-b border-border shrink-0 bg-card z-10">
                    <div>
                        <h2 className="text-xl font-bold text-foreground">
                            {isGlobal ? 'Transições Visuais (Padrão Global)' : 'Transição (Corte Específico)'}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            {isGlobal
                                ? 'Selecione ou carregue um vídeo de efeito (como Light Leak/Film Burn) para usar entre todos os takes.'
                                : `Selecione um efeito para aplicar APENAS após o arquivo "${targetTake?.fileName}".`}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* MODAL DE DELETAR TRANSIÇÃO CUSTOMIZADO */}
                {itemToDelete && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg">
                        <div className="bg-card w-full max-w-sm rounded-xl border border-border shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                            <div className="p-6 text-center">
                                <div className="w-16 h-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
                                    <Trash2 className="w-8 h-8" />
                                </div>
                                <h3 className="text-xl font-bold text-foreground mb-2">Excluir Efeito?</h3>
                                <p className="text-sm text-muted-foreground">
                                    Você está prestes a deletar permanentemente o efeito:
                                </p>
                                <p className="text-sm font-semibold text-foreground bg-muted/50 p-2 rounded-lg mt-2 mb-6 break-all shadow-sm">
                                    {itemToDelete.originalName}
                                </p>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setItemToDelete(null)}
                                        className="flex-1 px-4 py-2.5 rounded-lg font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={confirmDelete}
                                        className="flex-1 px-4 py-2.5 rounded-lg font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors shadow-lg shadow-destructive/20"
                                    >
                                        Excluir
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="min-h-0 flex-1 p-5 relative">
                    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
                        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/35">
                            <div className="border-b border-border/60 p-4">
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                                    Coleções
                                </p>
                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground/75">
                                    Escolha uma família de efeitos para explorar.
                                </p>
                            </div>

                            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
                                {categories.map((category) => {
                                    const count = transitions.filter(
                                        (transition) => (transition.category || 'Essencial') === category
                                    ).length;
                                    const isActive = !normalizedQuery && activeCategory === category;

                                    return (
                                        <button
                                            key={category}
                                            type="button"
                                            onClick={() => {
                                                setSearchQuery('');
                                                setActiveCategory(category);
                                            }}
                                            className={cn(
                                                'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all',
                                                isActive
                                                    ? 'border-primary/35 bg-primary/10 text-primary shadow-[0_8px_24px_rgba(0,0,0,.18)]'
                                                    : 'border-transparent text-muted-foreground hover:border-border/80 hover:bg-muted/40 hover:text-foreground'
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                                                    isActive ? 'bg-primary/15' : 'bg-muted/70'
                                                )}
                                            >
                                                <Film className="h-4 w-4" />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-bold">{category}</span>
                                                <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wider opacity-65">
                                                    {count} {count === 1 ? 'efeito' : 'efeitos'}
                                                </span>
                                            </span>
                                            {selectedCategory === category && currentTransition && (
                                                <Check className="h-4 w-4 shrink-0 text-primary" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="border-t border-border/60 p-3">
                                {isCreatingCategory ? (
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            value={newCategoryName}
                                            onChange={(event) => setNewCategoryName(event.target.value)}
                                            placeholder="Nome da coleção"
                                            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary/50"
                                            autoFocus
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') handleCreateCategory();
                                                if (event.key === 'Escape') {
                                                    setIsCreatingCategory(false);
                                                    setNewCategoryName('');
                                                }
                                            }}
                                        />
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsCreatingCategory(false);
                                                    setNewCategoryName('');
                                                }}
                                                className="h-9 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:bg-muted/40"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleCreateCategory}
                                                className="h-9 rounded-lg bg-primary text-xs font-black text-primary-foreground hover:bg-primary/90"
                                            >
                                                Criar
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setIsCreatingCategory(true)}
                                        className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs font-bold text-muted-foreground transition-colors hover:border-primary/35 hover:bg-primary/5 hover:text-primary"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Nova coleção
                                    </button>
                                )}
                            </div>
                        </aside>

                        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/20">
                            <div className="space-y-3 border-b border-border/60 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                    <div className="relative min-w-0 flex-1">
                                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <input
                                            value={searchQuery}
                                            onChange={(event) => setSearchQuery(event.target.value)}
                                            placeholder="Buscar por estilo, nome ou uso..."
                                            className="h-11 w-full rounded-xl border border-border bg-background/70 pl-11 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isUploading}
                                        className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-4 text-sm font-bold text-primary transition-colors hover:bg-primary/15 disabled:cursor-wait disabled:opacity-60"
                                    >
                                        {isUploading ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Upload className="h-4 w-4" />
                                        )}
                                        Adicionar efeito
                                    </button>
                                    <input
                                        type="file"
                                        accept="video/mp4,video/quicktime,.mp4,.mov"
                                        className="hidden"
                                        ref={fileInputRef}
                                        onChange={handleUpload}
                                    />
                                </div>

                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-black text-foreground">{activeLabel}</p>
                                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                                            {activeTransitions.length}{' '}
                                            {activeTransitions.length === 1
                                                ? 'efeito disponível'
                                                : 'efeitos disponíveis'}
                                        </p>
                                    </div>
                                    {currentTransition ? (
                                        <div className="max-w-[46%] rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-[10px] font-bold text-primary">
                                            <span className="block truncate">
                                                Selecionado: {currentTransition.originalName}
                                            </span>
                                        </div>
                                    ) : (
                                        <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-bold text-muted-foreground">
                                            Sem efeito
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                                {isLoading ? (
                                    <div className="flex h-full min-h-52 flex-col items-center justify-center gap-3">
                                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                        <p className="text-xs font-semibold text-muted-foreground">
                                            Carregando biblioteca...
                                        </p>
                                    </div>
                                ) : activeTransitions.length === 0 ? (
                                    <div className="flex h-full min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 text-center">
                                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                                            <Sparkles className="h-5 w-5 text-muted-foreground" />
                                        </div>
                                        <p className="text-sm font-bold text-foreground">
                                            {normalizedQuery
                                                ? 'Nenhum efeito encontrado'
                                                : 'Esta coleção ainda está vazia'}
                                        </p>
                                        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                                            {normalizedQuery
                                                ? 'Tente outro nome, estilo ou finalidade.'
                                                : 'Adicione um overlay MP4 ou MOV para começar esta coleção.'}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                        {activeTransitions.map((transition) => (
                                            <TransitionCard
                                                key={transition.id}
                                                t={transition}
                                                currentVolume={currentVolume}
                                                currentMuted={currentMuted}
                                                onVolumeChange={handleVolumeChange}
                                                onMuteToggle={handleMuteToggle}
                                                isSelected={currentTransition?.id === transition.id}
                                                toggleTransitionSelection={toggleTransitionSelection}
                                                onDelete={handleDeleteTransition}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </div>

                {isGlobal && currentTransition && (
                    <div className="flex items-center justify-between gap-4 border-t border-border bg-background/30 px-6 py-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <RotateCw className="h-4 w-4 text-primary" />
                            Orientação da transição
                        </div>
                        <div className="flex rounded-xl border border-border bg-card p-1">
                            {([0, 90, 180, 270] as const).map((rotation) => (
                                <button
                                    key={rotation}
                                    type="button"
                                    onClick={() => updateAdData({ transitionRotation: rotation })}
                                    className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors', transitionRotation === rotation ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
                                >
                                    {rotation}°
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between gap-4 border-t border-border bg-card px-6 py-4">
                    <p className="min-w-0 truncate text-xs text-muted-foreground">
                        {currentTransition
                            ? `O efeito “${currentTransition.originalName}” será aplicado ${isGlobal ? 'entre todos os takes' : 'neste corte'}.`
                            : 'Nenhuma transição selecionada. Os cortes permanecerão secos.'}
                    </p>
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors"
                    >
                        Aplicar
                    </button>
                </div>
            </div>
        </div>
    );
};
