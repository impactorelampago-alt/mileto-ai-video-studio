import React, { useState, useEffect, useRef } from 'react';
import { useWizard } from '../context/WizardContext';
import {
    X,
    Upload,
    Loader2,
    Volume2,
    VolumeX,
    Check,
    Plus,
    ChevronDown,
    ChevronRight,
    Sparkles,
    Trash2,
} from 'lucide-react';
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
            videoRef.current.currentTime = 0;
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
                'relative flex flex-row items-stretch overflow-hidden rounded-xl border-2 transition-all bg-card cursor-pointer',
                isSelected
                    ? 'border-primary shadow-[0_0_15px_rgba(34,197,94,0.2)]'
                    : 'border-border hover:border-primary/50'
            )}
        >
            <div className="flex flex-col flex-1 min-w-0">
                <div className={cn('relative h-40 w-full bg-black/50 group flex items-center justify-center', '')}>
                    <video
                        ref={videoRef}
                        src={`${((window as any).API_BASE_URL || 'http://localhost:3301')}${t.publicUrl}`}
                        className="h-full w-full object-contain opacity-80 transition-opacity duration-300 group-hover:opacity-100"
                        loop
                        playsInline
                        muted={currentMuted}
                    />

                    {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-primary/20 pointer-events-none">
                            <Check className="h-12 w-12 text-primary drop-shadow-md" />
                        </div>
                    )}
                </div>

                <div className="w-full p-3 mt-auto flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <p className="w-full truncate text-sm font-medium text-foreground" title={t.originalName}>
                            {t.originalName}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{`${t.durationSec.toFixed(1)}s`}</p>
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

    const [transitions, setTransitions] = useState<TransitionAsset[]>([]);
    const [categories, setCategories] = useState<string[]>(['Essencial']);
    const [activeCategory, setActiveCategory] = useState<string>('Essencial');
    const [isCreatingCategory, setIsCreatingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [itemToDelete, setItemToDelete] = useState<TransitionAsset | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadTransitions = async () => {
        try {
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/transitions/list`);
            const data = await res.json();
            if (data.ok) {
                setTransitions(data.transitions);
                const fetchedCategories = Array.from(
                    new Set(data.transitions.map((t: TransitionAsset) => t.category || 'Essencial'))
                ) as string[];
                const orderedCategories = ['Essencial', ...fetchedCategories.filter((c) => c !== 'Essencial')];
                setCategories(orderedCategories);
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
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/transitions/${t.id}`, {
                method: 'DELETE',
            });
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
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/transitions/upload`, {
                method: 'POST',
                body: formData,
            });
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

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="bg-card border border-border w-full max-w-3xl rounded-lg shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
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

                <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-4 relative">
                    {/* Sanfona de Categorias */}
                    {categories.map((cat) => {
                        const isExpanded = activeCategory === cat;
                        const catTransitions = transitions.filter((t) => (t.category || 'Essencial') === cat);

                        return (
                            <div
                                key={cat}
                                className={cn(
                                    'border rounded-xl overflow-hidden transition-all duration-300',
                                    isExpanded
                                        ? 'border-primary/40 shadow-[0_4px_20px_rgba(34,197,94,0.05)]'
                                        : 'border-border/50 hover:border-border'
                                )}
                            >
                                {/* Categoria Header (Clickable) */}
                                <button
                                    onClick={() => setActiveCategory(isExpanded ? '' : cat)}
                                    className={cn(
                                        'w-full flex items-center justify-between p-4 bg-card hover:bg-muted/30 transition-colors text-left outline-none',
                                        isExpanded && 'bg-muted/30 border-b border-border/50'
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <div
                                            className={cn(
                                                'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                                                isExpanded
                                                    ? 'bg-primary/20 text-primary'
                                                    : 'bg-muted text-muted-foreground'
                                            )}
                                        >
                                            {isExpanded ? (
                                                <ChevronDown className="w-5 h-5" />
                                            ) : (
                                                <ChevronRight className="w-5 h-5" />
                                            )}
                                        </div>
                                        <div>
                                            <h3
                                                className={cn(
                                                    'font-bold text-lg',
                                                    isExpanded ? 'text-primary' : 'text-foreground'
                                                )}
                                            >
                                                {cat}
                                            </h3>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {catTransitions.length} transições
                                            </p>
                                        </div>
                                    </div>

                                    {/* Adicionar Efeito Rápido (Header) */}
                                    {isExpanded && (
                                        <div
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                fileInputRef.current?.click();
                                            }}
                                            className="px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-md text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                                        >
                                            <Upload className="w-4 h-4" />
                                            Upload
                                        </div>
                                    )}
                                </button>

                                {/* Categoria Body (Conteúdo da Sanfona) */}
                                {isExpanded && (
                                    <div className="p-5 bg-background/50">
                                        <input
                                            type="file"
                                            accept="video/mp4,video/quicktime,.mp4,.mov"
                                            className="hidden"
                                            ref={fileInputRef}
                                            onChange={handleUpload}
                                        />

                                        {isLoading || isUploading ? (
                                            <div className="flex justify-center p-8">
                                                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                            </div>
                                        ) : catTransitions.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-10 px-4 border-2 border-dashed border-border/50 rounded-xl bg-card">
                                                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                                                    <Sparkles className="w-6 h-6 text-muted-foreground opacity-50 block" />
                                                </div>
                                                <p className="text-muted-foreground text-center text-sm font-medium">
                                                    Pasta Vazia
                                                </p>
                                                <p className="text-muted-foreground/60 text-center text-xs mt-1">
                                                    Clique em <strong className="text-primary/70">Upload</strong> acima
                                                    para carregar.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                                {catTransitions.map((t) => (
                                                    <TransitionCard
                                                        key={t.id}
                                                        t={t}
                                                        currentVolume={currentVolume}
                                                        currentMuted={currentMuted}
                                                        onVolumeChange={handleVolumeChange}
                                                        onMuteToggle={handleMuteToggle}
                                                        isSelected={currentTransition?.id === t.id}
                                                        toggleTransitionSelection={toggleTransitionSelection}
                                                        onDelete={handleDeleteTransition}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Criar Nova Categoria */}
                    <div className="mt-2">
                        {isCreatingCategory ? (
                            <div className="flex items-center gap-3 bg-card rounded-xl p-3 border border-border shadow-sm">
                                <input
                                    type="text"
                                    value={newCategoryName}
                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                    placeholder="Nome da Categoria..."
                                    className="bg-background text-sm px-4 py-2 rounded-lg outline-none border border-border focus:border-primary/50 text-foreground flex-1"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleCreateCategory();
                                        if (e.key === 'Escape') {
                                            setIsCreatingCategory(false);
                                            setNewCategoryName('');
                                        }
                                    }}
                                />
                                <button
                                    onClick={handleCreateCategory}
                                    className="px-4 py-2 bg-primary rounded-lg text-primary-foreground font-bold hover:bg-primary/90 transition-colors flex items-center gap-2"
                                >
                                    <Check className="w-4 h-4" />
                                    Criar
                                </button>
                                <button
                                    onClick={() => {
                                        setIsCreatingCategory(false);
                                        setNewCategoryName('');
                                    }}
                                    className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsCreatingCategory(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl text-sm font-bold text-muted-foreground hover:bg-muted/30 hover:text-foreground border-2 border-dashed border-border/50 hover:border-border transition-all outline-none"
                            >
                                <Plus className="w-5 h-5" />
                                Adicionar Nova Categoria
                            </button>
                        )}
                    </div>
                </div>

                <div className="p-6 border-t border-border flex justify-end bg-card">
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
