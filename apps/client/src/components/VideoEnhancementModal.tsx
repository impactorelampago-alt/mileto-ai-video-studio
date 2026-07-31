import { useEffect, useId, useState } from 'react';
import { Check, Info, RotateCcw, Sparkles, Wand2, X } from 'lucide-react';
import type {
    MediaTake,
    TakeEnhancementSettings,
    TakeSharpnessSettings,
    VideoEnhancementIntensity,
    VideoEnhancementSettings,
} from '../types';
import {
    enhancementPreviewCss,
    normalizeVideoEnhancement,
    resolveTakeEnhancement,
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
    onApplyGlobal: (settings: VideoEnhancementSettings) => void;
    onApplyTake: (
        takeId: string,
        enhancement: TakeEnhancementSettings,
        sharpness: TakeSharpnessSettings
    ) => void;
    onResetAll: () => void;
    onResetTake: (takeId: string) => void;
}

const SharpnessSlider = ({ value, onChange }: { value: number; onChange: (value: number) => void }) => (
    <div>
        <div className="mb-3 flex items-center justify-between">
            <div>
                <p className="text-xs font-black text-foreground">Nitidez</p>
                <p className="mt-0.5 text-[10px] text-brand-muted">Realce conservador de detalhes</p>
            </div>
            <span className="rounded-lg border border-brand-lime/20 bg-brand-lime/10 px-2.5 py-1 font-mono text-xs font-black text-brand-lime">
                {value}
            </span>
        </div>
        <input
            aria-label="Intensidade da nitidez"
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-1.5 w-full cursor-pointer accent-brand-lime"
        />
        <div className="mt-3 grid grid-cols-4 gap-1.5">
            {([0, 25, 50, 75] as const).map((preset) => (
                <button
                    key={preset}
                    type="button"
                    onClick={() => onChange(preset)}
                    className={cn(
                        'rounded-lg border px-1 py-1.5 text-[9px] font-bold transition',
                        value === preset
                            ? 'border-brand-lime/30 bg-brand-lime/10 text-brand-lime'
                            : 'border-white/7 text-brand-muted hover:bg-white/5'
                    )}
                >
                    {preset === 0 ? 'Desligada' : preset === 25 ? 'Suave' : preset === 50 ? 'Média' : 'Forte'}
                </button>
            ))}
        </div>
    </div>
);

export const VideoEnhancementModal = ({
    isOpen,
    takes,
    settings,
    targetTakeId,
    onClose,
    onApplyGlobal,
    onApplyTake,
    onResetAll,
    onResetTake,
}: VideoEnhancementModalProps) => {
    const normalizedGlobal = normalizeVideoEnhancement(settings);
    const targetTake = targetTakeId ? takes.find((take) => take.id === targetTakeId) : undefined;
    const singleTakeMode = Boolean(targetTake);
    const previewTake = targetTake || takes[0];
    const [enabled, setEnabled] = useState(false);
    const [intensity, setIntensity] = useState<VideoEnhancementIntensity>('balanced');
    const [sharpness, setSharpness] = useState(0);
    const [showOriginal, setShowOriginal] = useState(false);
    const previewFilterId = `mileto-enhancement-modal-${useId().replace(/:/g, '')}`;

    useEffect(() => {
        if (!isOpen) return;
        setShowOriginal(false);
        if (targetTake) {
            const takeSettings = resolveTakeEnhancement(targetTake, normalizedGlobal);
            setEnabled(takeSettings.enabled);
            setIntensity(takeSettings.intensity);
            setSharpness(resolveTakeSharpness(targetTake, normalizedGlobal));
            return;
        }
        setEnabled(normalizedGlobal.enabled);
        setIntensity(normalizedGlobal.intensity);
        setSharpness(normalizedGlobal.globalSharpness);
    }, [
        isOpen,
        targetTakeId,
        targetTake?.enhancement?.mode,
        targetTake?.enhancement?.enabled,
        targetTake?.enhancement?.intensity,
        targetTake?.sharpness?.mode,
        targetTake?.sharpness?.amount,
        normalizedGlobal.enabled,
        normalizedGlobal.intensity,
        normalizedGlobal.globalSharpness,
    ]);

    if (!isOpen) return null;

    const draftSettings: VideoEnhancementSettings = {
        enabled,
        intensity,
        globalSharpness: sharpness,
    };
    const previewFilter = showOriginal
        ? 'none'
        : enhancementPreviewCss(draftSettings, sharpness, previewFilterId);

    const apply = () => {
        if (singleTakeMode && targetTake) {
            onApplyTake(
                targetTake.id,
                {
                    mode: enabled ? 'custom' : 'off',
                    enabled,
                    intensity,
                },
                {
                    mode: sharpness > 0 ? 'custom' : 'off',
                    amount: sharpness,
                }
            );
        } else {
            onApplyGlobal(draftSettings);
        }
        onClose();
    };

    const reset = () => {
        if (singleTakeMode && targetTake) onResetTake(targetTake.id);
        else onResetAll();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[#020705]/90 p-4 backdrop-blur-xl">
            <svg aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
                <filter id={previewFilterId} colorInterpolationFilters="sRGB">
                    <feConvolveMatrix
                        order="3"
                        kernelMatrix={sharpnessKernel(sharpness)}
                        divisor="1"
                        bias="0"
                        targetX="1"
                        targetY="1"
                        edgeMode="duplicate"
                        preserveAlpha="true"
                    />
                </filter>
            </svg>

            <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[26px] border border-brand-lime/20 bg-[#0b1113] shadow-[0_30px_120px_rgba(0,0,0,.75),0_0_55px_rgba(0,230,118,.08)]">
                <header className="flex items-center justify-between border-b border-white/7 px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-brand-lime/20 bg-brand-lime/10 text-brand-lime">
                            <Wand2 className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-brand-lime">
                                {singleTakeMode ? 'Ajuste individual' : 'Ajuste em massa'}
                            </p>
                            <h2 className="mt-0.5 truncate text-lg font-black text-foreground">
                                {singleTakeMode ? 'Aprimorar este take' : 'Aprimorar todos os takes'}
                            </h2>
                            <p className="mt-0.5 truncate text-[10px] text-brand-muted">
                                {singleTakeMode ? targetTake?.fileName : `${takes.length} ${takes.length === 1 ? 'take será ajustado' : 'takes serão ajustados'}`}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/7 bg-white/[0.035] text-brand-muted transition hover:bg-white/10 hover:text-foreground"
                        aria-label="Fechar"
                    >
                        <X className="h-4.5 w-4.5" />
                    </button>
                </header>

                <div className="grid min-h-0 flex-1 lg:grid-cols-[330px_minmax(0,1fr)]">
                    <section className="min-h-0 space-y-4 overflow-y-auto border-b border-white/7 p-5 lg:border-b-0 lg:border-r">
                        <button
                            type="button"
                            onClick={() => setEnabled((current) => !current)}
                            className={cn(
                                'flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition-all',
                                enabled
                                    ? 'border-brand-lime/35 bg-brand-lime/10'
                                    : 'border-white/8 bg-white/[0.025] hover:border-white/15'
                            )}
                        >
                            <span className="flex items-center gap-3">
                                <span className={cn('grid h-9 w-9 place-items-center rounded-xl', enabled ? 'bg-brand-lime text-[#06100c]' : 'bg-white/5 text-brand-muted')}>
                                    <Sparkles className="h-4 w-4" />
                                </span>
                                <span>
                                    <span className="block text-xs font-black text-foreground">Correção automática</span>
                                    <span className="mt-0.5 block text-[9px] text-brand-muted">Cor, contraste e ruído</span>
                                </span>
                            </span>
                            <span className={cn('relative h-6 w-11 rounded-full transition', enabled ? 'bg-brand-lime' : 'bg-white/10')}>
                                <span className={cn('absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all', enabled ? 'left-6' : 'left-1')} />
                            </span>
                        </button>

                        <div className={cn('transition-opacity', !enabled && 'opacity-40')}>
                            <p className="mb-2 text-[9px] font-black uppercase tracking-[0.16em] text-brand-muted">Intensidade</p>
                            <div className="grid grid-cols-3 gap-2">
                                {VIDEO_ENHANCEMENT_INTENSITIES.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        disabled={!enabled}
                                        onClick={() => setIntensity(option.id)}
                                        title={option.description}
                                        className={cn(
                                            'relative rounded-xl border px-2 py-3 text-center text-[10px] font-black transition',
                                            intensity === option.id
                                                ? 'border-brand-lime/30 bg-brand-lime/[0.08] text-brand-lime'
                                                : 'border-white/7 bg-white/[0.02] text-brand-muted hover:bg-white/[0.045]'
                                        )}
                                    >
                                        {option.label}
                                        {intensity === option.id && <Check className="absolute right-1.5 top-1.5 h-3 w-3" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                            <SharpnessSlider value={sharpness} onChange={setSharpness} />
                        </div>

                        <div className="flex items-start gap-2 rounded-xl border border-brand-lime/12 bg-brand-lime/[0.04] p-3 text-[9px] leading-relaxed text-brand-muted">
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-lime" />
                            {singleTakeMode
                                ? 'Somente este take será alterado. Os outros permanecem como estão.'
                                : 'O padrão será aplicado a todos os takes e substituirá ajustes individuais anteriores.'}
                        </div>
                    </section>

                    <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
                        {previewTake ? (
                            <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-2xl border border-white/8 bg-black shadow-inner">
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
                                        src={previewTake.proxyUrl || previewTake.url}
                                        alt={previewTake.fileName}
                                        className={cn('h-full w-full', previewTake.objectFit === 'contain' ? 'object-contain' : 'object-cover')}
                                        style={{ filter: previewFilter }}
                                    />
                                )}

                                <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-linear-to-b from-black/80 to-transparent p-3">
                                    <p className="truncate text-[10px] font-bold text-white/80">{previewTake.fileName}</p>
                                    <div className="flex shrink-0 rounded-lg border border-white/15 bg-black/60 p-1 backdrop-blur-md">
                                        <button
                                            type="button"
                                            onClick={() => setShowOriginal(true)}
                                            className={cn('rounded-md px-2.5 py-1 text-[8px] font-black uppercase tracking-wider transition', showOriginal ? 'bg-white text-black' : 'text-white/60 hover:text-white')}
                                        >
                                            Original
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowOriginal(false)}
                                            className={cn('rounded-md px-2.5 py-1 text-[8px] font-black uppercase tracking-wider transition', !showOriginal ? 'bg-brand-lime text-[#06100c]' : 'text-white/60 hover:text-white')}
                                        >
                                            Melhorado
                                        </button>
                                    </div>
                                </div>

                                {!showOriginal && (
                                    <div className="absolute bottom-3 left-3 flex gap-2">
                                        <span className="rounded-lg border border-brand-lime/25 bg-[#04100b]/80 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-brand-lime backdrop-blur-md">
                                            {enabled ? intensity : 'Correção desligada'}
                                        </span>
                                        <span className="rounded-lg border border-brand-lime/25 bg-[#04100b]/80 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-brand-lime backdrop-blur-md">
                                            Nitidez {sharpnessLabel(sharpness)} · {sharpness}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="grid min-h-[280px] flex-1 place-items-center rounded-2xl border border-dashed border-white/8 text-xs text-brand-muted">
                                Adicione um take para visualizar a melhoria.
                            </div>
                        )}

                        <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-xl border border-white/7 bg-white/[0.025] p-3 text-center">
                                <p className="text-[8px] font-black uppercase tracking-wider text-brand-muted">Escopo</p>
                                <p className="mt-1 text-[10px] font-black text-foreground">{singleTakeMode ? '1 take' : `${takes.length} takes`}</p>
                            </div>
                            <div className="rounded-xl border border-white/7 bg-white/[0.025] p-3 text-center">
                                <p className="text-[8px] font-black uppercase tracking-wider text-brand-muted">Correção</p>
                                <p className="mt-1 text-[10px] font-black text-foreground">{enabled ? intensity : 'Desligada'}</p>
                            </div>
                            <div className="rounded-xl border border-white/7 bg-white/[0.025] p-3 text-center">
                                <p className="text-[8px] font-black uppercase tracking-wider text-brand-muted">Nitidez</p>
                                <p className="mt-1 text-[10px] font-black text-foreground">{sharpness}</p>
                            </div>
                        </div>
                    </section>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/7 bg-black/15 px-5 py-4">
                    <button
                        type="button"
                        onClick={reset}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/8 px-3.5 py-2.5 text-[9px] font-black uppercase tracking-wider text-brand-muted transition hover:border-red-400/20 hover:bg-red-400/[0.06] hover:text-red-300"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {singleTakeMode ? 'Usar padrão global' : 'Restaurar todos'}
                    </button>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={onClose} className="rounded-xl border border-white/8 px-4 py-2.5 text-[9px] font-black uppercase tracking-wider text-brand-muted hover:bg-white/5">
                            Cancelar
                        </button>
                        <button type="button" onClick={apply} disabled={!previewTake} className="rounded-xl bg-brand-lime px-5 py-2.5 text-[10px] font-black uppercase tracking-wider text-[#06100c] shadow-[0_12px_35px_rgba(0,230,118,.2)] transition hover:brightness-110 disabled:opacity-40">
                            {singleTakeMode ? 'Aplicar neste take' : 'Aplicar em todos'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};
