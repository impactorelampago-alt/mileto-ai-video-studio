import { useEffect, useId, useMemo, useState } from 'react';
import { Check, RotateCcw, Search, SlidersHorizontal, Sparkles, Wand2, X } from 'lucide-react';
import type { MediaTake, TakeSharpnessSettings, VideoEnhancementSettings } from '../types';
import {
    normalizeTakeSharpness,
    normalizeVideoEnhancement,
    enhancementPreviewCss,
    resolveTakeSharpness,
    sharpnessKernel,
    sharpnessLabel,
    VIDEO_ENHANCEMENT_INTENSITIES,
} from '../lib/videoEnhancement';
import { cn } from '../lib/utils';

interface VideoEnhancementModalProps {
    isOpen: boolean;
    takes: MediaTake[];
    settings?: VideoEnhancementSettings;
    targetTakeId?: string | null;
    onClose: () => void;
    onSettingsChange: (settings: VideoEnhancementSettings) => void;
    onTakeChange: (takeId: string, settings: TakeSharpnessSettings) => void;
    onResetAll: () => void;
}

const SharpnessSlider = ({ value, onChange }: { value: number; onChange: (value: number) => void }) => (
    <div className="flex items-center gap-3">
        <input
            aria-label="Intensidade da nitidez"
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-brand-lime"
        />
        <span className="w-10 rounded-lg border border-brand-lime/15 bg-brand-lime/[0.07] px-2 py-1 text-center font-mono text-[10px] font-black text-brand-lime">
            {value}
        </span>
    </div>
);

export const VideoEnhancementModal = ({
    isOpen,
    takes,
    settings,
    targetTakeId,
    onClose,
    onSettingsChange,
    onTakeChange,
    onResetAll,
}: VideoEnhancementModalProps) => {
    const normalized = normalizeVideoEnhancement(settings);
    const [query, setQuery] = useState('');
    const [showOriginal, setShowOriginal] = useState(false);
    const previewFilterId = `mileto-enhancement-modal-${useId().replace(/:/g, '')}`;

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setShowOriginal(false);
        if (!targetTakeId) return;
        const timer = window.setTimeout(() => {
            document.getElementById(`enhancement-take-${targetTakeId}`)?.scrollIntoView({ block: 'center' });
        }, 80);
        return () => window.clearTimeout(timer);
    }, [isOpen, targetTakeId]);

    const visibleTakes = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
        if (!normalizedQuery) return takes;
        return takes.filter((take) => take.fileName.toLocaleLowerCase('pt-BR').includes(normalizedQuery));
    }, [query, takes]);
    const previewTake = takes.find((take) => take.id === targetTakeId) || takes[0];
    const previewSharpness = previewTake ? resolveTakeSharpness(previewTake, normalized) : 0;
    const previewFilter = showOriginal
        ? 'none'
        : enhancementPreviewCss(normalized, previewSharpness, previewFilterId);

    if (!isOpen) return null;

    const updateGlobal = (patch: Partial<VideoEnhancementSettings>) => {
        onSettingsChange(normalizeVideoEnhancement({ ...normalized, ...patch }));
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#020705]/88 p-4 backdrop-blur-xl">
            <svg aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
                <filter id={previewFilterId} colorInterpolationFilters="sRGB">
                    <feConvolveMatrix
                        order="3"
                        kernelMatrix={sharpnessKernel(previewSharpness)}
                        divisor="1"
                        bias="0"
                        targetX="1"
                        targetY="1"
                        edgeMode="duplicate"
                        preserveAlpha="true"
                    />
                </filter>
            </svg>
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-brand-lime/20 bg-[#0b1113] shadow-[0_30px_120px_rgba(0,0,0,.72),0_0_55px_rgba(0,230,118,.08)]">
                <header className="flex items-center justify-between border-b border-white/7 px-6 py-5">
                    <div className="flex items-center gap-4">
                        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-brand-lime/20 bg-brand-lime/10 text-brand-lime shadow-[0_0_28px_rgba(0,230,118,.12)]">
                            <Wand2 className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-lime">Tratamento visual</p>
                            <h2 className="mt-1 text-xl font-black text-foreground">Melhorar automaticamente</h2>
                            <p className="mt-1 text-xs text-brand-muted">Ajustes não destrutivos, salvos no projeto e aplicados na exportação.</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="grid h-10 w-10 place-items-center rounded-xl border border-white/7 bg-white/[0.035] text-brand-muted transition hover:bg-white/10 hover:text-foreground"
                        aria-label="Fechar"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>

                <div className="grid min-h-0 flex-1 lg:grid-cols-[340px_minmax(0,1fr)]">
                    <section className="overflow-y-auto border-b border-white/7 p-5 lg:border-b-0 lg:border-r">
                        <button
                            type="button"
                            onClick={() => updateGlobal({ enabled: !normalized.enabled })}
                            className={cn(
                                'flex w-full items-center justify-between rounded-2xl border p-4 text-left transition-all',
                                normalized.enabled
                                    ? 'border-brand-lime/35 bg-brand-lime/10 shadow-[0_0_26px_rgba(0,230,118,.08)]'
                                    : 'border-white/8 bg-white/[0.025] hover:border-white/15'
                            )}
                        >
                            <span className="flex items-center gap-3">
                                <span className={cn('grid h-10 w-10 place-items-center rounded-xl', normalized.enabled ? 'bg-brand-lime text-[#06100c]' : 'bg-white/5 text-brand-muted')}>
                                    <Sparkles className="h-4 w-4" />
                                </span>
                                <span>
                                    <span className="block text-sm font-black text-foreground">Correção automática</span>
                                    <span className="mt-0.5 block text-[10px] text-brand-muted">Cor, contraste e redução de ruído</span>
                                </span>
                            </span>
                            <span className={cn('relative h-6 w-11 rounded-full transition', normalized.enabled ? 'bg-brand-lime' : 'bg-white/10')}>
                                <span className={cn('absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all', normalized.enabled ? 'left-6' : 'left-1')} />
                            </span>
                        </button>

                        <div className={cn('mt-5 transition-opacity', !normalized.enabled && 'opacity-45')}>
                            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-brand-muted">Intensidade da melhoria</p>
                            <div className="grid gap-2">
                                {VIDEO_ENHANCEMENT_INTENSITIES.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        disabled={!normalized.enabled}
                                        onClick={() => updateGlobal({ intensity: option.id })}
                                        className={cn(
                                            'flex items-center justify-between rounded-xl border px-3.5 py-3 text-left transition',
                                            normalized.intensity === option.id
                                                ? 'border-brand-lime/30 bg-brand-lime/[0.08]'
                                                : 'border-white/7 bg-white/[0.02] hover:bg-white/[0.045]'
                                        )}
                                    >
                                        <span>
                                            <span className="block text-xs font-bold text-foreground">{option.label}</span>
                                            <span className="mt-0.5 block text-[9px] text-brand-muted">{option.description}</span>
                                        </span>
                                        {normalized.intensity === option.id && <Check className="h-4 w-4 text-brand-lime" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="mt-6 rounded-2xl border border-white/8 bg-black/20 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-black text-foreground">Nitidez em todos os takes</p>
                                    <p className="mt-1 text-[10px] text-brand-muted">Padrão global: {sharpnessLabel(normalized.globalSharpness)}</p>
                                </div>
                                <SlidersHorizontal className="h-4 w-4 text-brand-lime" />
                            </div>
                            <SharpnessSlider value={normalized.globalSharpness} onChange={(value) => updateGlobal({ globalSharpness: value })} />
                            <div className="mt-3 grid grid-cols-4 gap-1.5">
                                {[0, 25, 50, 75].map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => updateGlobal({ globalSharpness: value })}
                                        className={cn(
                                            'rounded-lg border px-1 py-1.5 text-[9px] font-bold transition',
                                            normalized.globalSharpness === value
                                                ? 'border-brand-lime/30 bg-brand-lime/10 text-brand-lime'
                                                : 'border-white/7 text-brand-muted hover:bg-white/5'
                                        )}
                                    >
                                        {value === 0 ? 'Desligada' : value === 25 ? 'Suave' : value === 50 ? 'Média' : 'Forte'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section className="flex min-h-0 flex-col p-5">
                        {previewTake && (
                            <div className="relative mb-4 h-40 shrink-0 overflow-hidden rounded-2xl border border-white/8 bg-black shadow-inner">
                                {previewTake.type === 'video' ? (
                                    <video
                                        key={previewTake.id}
                                        src={previewTake.proxyUrl || previewTake.url}
                                        muted
                                        loop
                                        autoPlay
                                        playsInline
                                        className={cn('h-full w-full', previewTake.objectFit === 'contain' ? 'object-contain' : 'object-cover')}
                                        style={{ filter: previewFilter }}
                                    />
                                ) : (
                                    <img
                                        src={previewTake.url}
                                        alt={previewTake.fileName}
                                        className={cn('h-full w-full', previewTake.objectFit === 'contain' ? 'object-contain' : 'object-cover')}
                                        style={{ filter: previewFilter }}
                                    />
                                )}
                                <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-linear-to-b from-black/75 to-transparent p-3">
                                    <p className="max-w-[55%] truncate text-[10px] font-bold text-white/80">{previewTake.fileName}</p>
                                    <div className="flex rounded-lg border border-white/15 bg-black/55 p-1 backdrop-blur-md">
                                        <button
                                            type="button"
                                            onClick={() => setShowOriginal(true)}
                                            className={cn('rounded-md px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition', showOriginal ? 'bg-white text-black' : 'text-white/60 hover:text-white')}
                                        >
                                            Original
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowOriginal(false)}
                                            className={cn('rounded-md px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition', !showOriginal ? 'bg-brand-lime text-[#06100c]' : 'text-white/60 hover:text-white')}
                                        >
                                            Melhorado
                                        </button>
                                    </div>
                                </div>
                                {!showOriginal && (
                                    <span className="absolute bottom-3 left-3 rounded-lg border border-brand-lime/25 bg-[#04100b]/75 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-brand-lime backdrop-blur-md">
                                        Prévia ativa · nitidez {previewSharpness}
                                    </span>
                                )}
                            </div>
                        )}

                        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                            <div>
                                <p className="text-sm font-black text-foreground">Ajuste por take</p>
                                <p className="mt-1 text-[10px] text-brand-muted">Cada take pode herdar, desligar ou substituir a nitidez global.</p>
                            </div>
                            <label className="flex h-10 min-w-[220px] items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-3 text-brand-muted focus-within:border-brand-lime/30">
                                <Search className="h-4 w-4" />
                                <input
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Buscar take..."
                                    className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-brand-muted/55"
                                />
                            </label>
                        </div>

                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                            {visibleTakes.map((take, index) => {
                                const local = normalizeTakeSharpness(take.sharpness);
                                const resolved = resolveTakeSharpness(take, normalized);
                                return (
                                    <article
                                        id={`enhancement-take-${take.id}`}
                                        key={take.id}
                                        className={cn(
                                            'rounded-2xl border bg-white/[0.018] p-3 transition',
                                            targetTakeId === take.id ? 'border-brand-lime/40 shadow-[0_0_24px_rgba(0,230,118,.08)]' : 'border-white/7'
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-white/8 bg-black">
                                                {take.type === 'video' ? (
                                                    <video src={take.proxyUrl || take.url} className="h-full w-full object-cover opacity-80" />
                                                ) : (
                                                    <img src={take.url} alt="" className="h-full w-full object-cover opacity-80" />
                                                )}
                                                <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-mono text-[8px] text-white/65">{String(index + 1).padStart(2, '0')}</span>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="truncate text-xs font-bold text-foreground">{take.fileName}</p>
                                                    <span className="shrink-0 text-[9px] font-black uppercase tracking-wider text-brand-lime">{sharpnessLabel(resolved)} · {resolved}</span>
                                                </div>
                                                <div className="mt-2 grid grid-cols-3 gap-1.5">
                                                    {([
                                                        ['inherit', 'Usar global'],
                                                        ['off', 'Desligar'],
                                                        ['custom', 'Personalizar'],
                                                    ] as const).map(([mode, label]) => (
                                                        <button
                                                            key={mode}
                                                            type="button"
                                                            onClick={() => onTakeChange(take.id, { mode, amount: mode === 'custom' ? resolved : local.amount })}
                                                            className={cn(
                                                                'rounded-lg border px-2 py-1.5 text-[9px] font-bold transition',
                                                                local.mode === mode
                                                                    ? 'border-brand-lime/25 bg-brand-lime/10 text-brand-lime'
                                                                    : 'border-white/7 text-brand-muted hover:bg-white/5'
                                                            )}
                                                        >
                                                            {label}
                                                        </button>
                                                    ))}
                                                </div>
                                                {local.mode === 'custom' && (
                                                    <div className="mt-3">
                                                        <SharpnessSlider
                                                            value={local.amount}
                                                            onChange={(amount) => onTakeChange(take.id, { mode: 'custom', amount })}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                            {visibleTakes.length === 0 && (
                                <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-white/8 text-xs text-brand-muted">Nenhum take encontrado.</div>
                            )}
                        </div>
                    </section>
                </div>

                <footer className="flex items-center justify-between gap-4 border-t border-white/7 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onResetAll}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-[10px] font-black uppercase tracking-wider text-brand-muted transition hover:border-red-400/20 hover:bg-red-400/[0.06] hover:text-red-300"
                        >
                            <RotateCcw className="h-3.5 w-3.5" /> Restaurar original
                        </button>
                        <p className="hidden text-[10px] text-brand-muted sm:block">Os arquivos originais permanecem intactos.</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-xl bg-brand-lime px-6 py-3 text-xs font-black uppercase tracking-wider text-[#06100c] shadow-[0_12px_35px_rgba(0,230,118,.2)] transition hover:brightness-110">Concluir ajustes</button>
                </footer>
            </div>
        </div>
    );
};
