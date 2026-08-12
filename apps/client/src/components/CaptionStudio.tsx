import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWizard } from '../context/WizardContext';
import { Check, ChevronDown, PaintBucket, Search, Settings2, Type } from 'lucide-react';
import { cn } from '../lib/utils';
import type { CaptionStyle } from '../types';
import { HACKER_MATRIX_PRESET_REVISION } from '../lib/captionStyleMigration';

type Preset = { id: string; name: string; revision: number; s: Partial<CaptionStyle> };

const PRESETS: Preset[] = [
    { id: 'yellow-impact', name: 'Amarelo Impacto', revision: 1, s: { activeColor: '#FFFF00', baseColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 1, fontFamily: 'Anton', fontSize: 42, textCase: 'uppercase' } },
    { id: 'flix', name: 'Estilo Flix', revision: 1, s: { activeColor: '#E50914', baseColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 1, fontFamily: 'Bebas Neue', fontSize: 46, textCase: 'uppercase' } },
    { id: 'cyan-clean', name: 'Cyan Clean', revision: 1, s: { activeColor: '#00D1FF', baseColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 1, fontFamily: 'Inter', fontSize: 38, textCase: 'uppercase' } },
    { id: 'cinematic-gold', name: 'Cinematic Gold', revision: 1, s: { activeColor: '#FFD700', baseColor: '#F5F5F5', strokeColor: '#1A1A1A', strokeWidth: 1, fontFamily: 'Playfair Display', fontSize: 50, textCase: 'uppercase' } },
    { id: 'cyberpunk', name: 'Cyberpunk', revision: 1, s: { activeColor: '#FF00FF', baseColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 1, fontFamily: 'Impact', fontSize: 44, textCase: 'uppercase' } },
    { id: 'hacker-matrix', name: 'Hacker Matrix', revision: HACKER_MATRIX_PRESET_REVISION, s: { activeColor: '#00E676', baseColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 1, fontFamily: 'Montserrat', fontSize: 16, verticalPosition: 23, textCase: 'uppercase' } },
    { id: 'minimal', name: 'Minimalista', revision: 1, s: { activeColor: '#FFFFFF', baseColor: '#A0A0A0', strokeColor: '#000000', strokeWidth: 1, fontFamily: 'Roboto', fontSize: 32, textCase: 'uppercase' } },
    { id: 'youtuber-kids', name: 'Youtuber Kids', revision: 1, s: { activeColor: '#FF6B00', baseColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 1, fontFamily: 'Comic Sans MS', fontSize: 40, textCase: 'uppercase' } },
];

const FONTS = ['Poppins', 'Roboto', 'Inter', 'Impact', 'Montserrat', 'Anton', 'Bebas Neue', 'Playfair Display', 'Comic Sans MS'];

const normalizeSearch = (value: string) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

const FontPicker: React.FC<{ value: string; onChange: (_font: string) => void }> = ({ value, onChange }) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const visibleFonts = useMemo(
        () => FONTS.filter((font) => normalizeSearch(font).includes(normalizeSearch(query))),
        [query]
    );

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', escape);
        const frame = requestAnimationFrame(() => searchRef.current?.focus());
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', escape);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                className={cn(
                    'flex w-full items-center gap-3 rounded-xl border bg-black/[0.03] px-3 py-2.5 text-left transition dark:bg-black/25',
                    open
                        ? 'border-brand-accent/45 ring-2 ring-brand-accent/8'
                        : 'border-black/10 hover:border-brand-accent/30 dark:border-white/8'
                )}
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-accent/10 text-brand-accent">
                    <Type className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" style={{ fontFamily: value }}>
                    {value}
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-brand-muted transition', open && 'rotate-180 text-brand-accent')} />
            </button>

            {open && (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[80] overflow-hidden rounded-2xl border border-brand-accent/25 bg-[#0b1115]/98 shadow-[0_24px_70px_rgba(0,0,0,.62)] backdrop-blur-xl">
                    <div className="border-b border-white/7 p-2.5">
                        <label className="flex h-9 items-center gap-2 rounded-xl border border-white/9 bg-black/25 px-3 transition focus-within:border-brand-accent/40">
                            <Search className="h-3.5 w-3.5 shrink-0 text-brand-accent/70" />
                            <input
                                ref={searchRef}
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Buscar fonte"
                                className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
                            />
                        </label>
                    </div>
                    <div role="listbox" aria-label="Fonte da legenda" className="custom-scrollbar max-h-56 overflow-y-auto p-2">
                        {visibleFonts.map((font) => {
                            const active = font === value;
                            return (
                                <button
                                    key={font}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    onClick={() => {
                                        onChange(font);
                                        setOpen(false);
                                        setQuery('');
                                    }}
                                    className={cn(
                                        'mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                                        active
                                            ? 'border-brand-accent/30 bg-brand-accent/10 text-white'
                                            : 'border-transparent text-white/75 hover:border-white/8 hover:bg-white/5 hover:text-white'
                                    )}
                                >
                                    <span className="min-w-0 flex-1 truncate text-sm" style={{ fontFamily: font }}>{font}</span>
                                    {active && <Check className="h-4 w-4 shrink-0 text-brand-accent" />}
                                </button>
                            );
                        })}
                        {visibleFonts.length === 0 && (
                            <p className="px-3 py-5 text-center text-xs text-white/40">Nenhuma fonte encontrada.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

/** Slider estilizado: trilha preenchida em verde da marca + thumb com glow. */
const Slider: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit: string;
    onChange: (v: number) => void;
}> = ({ label, value, min, max, step, unit, onChange }) => {
    const pct = Math.round(((value - min) / (max - min)) * 100);
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">{label}</label>
                <span className="font-mono text-[10px] tabular-nums text-foreground">
                    {value}
                    {unit}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-brand-accent [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,230,118,0.7)] [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125"
                style={{ background: `linear-gradient(to right, hsl(var(--brand-accent)) ${pct}%, rgba(125,135,145,0.2) ${pct}%)` }}
            />
        </div>
    );
};

export const CaptionStudio: React.FC = () => {
    const { adData, updateAdData, captionStyle, setCaptionStyle } = useWizard();

    if (!adData.captions || !captionStyle) return null;

    const handleTextChange = (segmentIndex: number, newText: string) => {
        const newSegments = [...adData.captions!.segments];
        const oldSegment = newSegments[segmentIndex];

        // 1. Split the new text into an array of words
        const newWords = newText.split(/\s+/).filter((w) => w.length > 0);

        // 2. Distribui a duração do segmento igualmente entre as novas palavras — mapear por
        // índice faz palavras curtas ficarem com pausas longas quando a contagem muda.
        const segmentDuration = oldSegment.end - oldSegment.start;
        const timePerWord = newWords.length > 0 ? segmentDuration / newWords.length : 0;

        const updatedWords = newWords.map((wordText, i) => ({
            text: wordText,
            start: oldSegment.start + i * timePerWord,
            end: oldSegment.start + (i + 1) * timePerWord,
        }));

        // 3. Salva a string crua + o array reconstruído com tempos
        newSegments[segmentIndex] = { ...oldSegment, text: newText, words: updatedWords };

        updateAdData({ captions: { ...adData.captions!, segments: newSegments } });
    };

    const updateStyle = (updates: Partial<CaptionStyle>) => {
        setCaptionStyle({ ...captionStyle, ...updates });
    };

    const colors: Array<{ label: string; key: 'activeColor' | 'baseColor' | 'strokeColor'; value: string }> = [
        { label: 'Destaque', key: 'activeColor', value: captionStyle.activeColor },
        { label: 'Letra', key: 'baseColor', value: captionStyle.baseColor },
        { label: 'Borda', key: 'strokeColor', value: captionStyle.strokeColor },
    ];

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-black/5 bg-brand-card shadow-xl dark:border-white/8">
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-black/5 bg-black/[0.03] px-4 py-3 dark:border-white/5 dark:bg-white/[0.03]">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-accent/12">
                    <Settings2 className="h-4 w-4 text-brand-accent" />
                </div>
                <div className="min-w-0">
                    <h3 className="text-sm font-bold leading-tight text-foreground">Estúdio de Legendas</h3>
                    <p className="truncate text-[10px] text-brand-muted">Aparência e texto das legendas</p>
                </div>
            </div>

            <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-3.5">
                {/* Presets */}
                <section className="space-y-2.5">
                    <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-muted">
                        <PaintBucket className="h-3.5 w-3.5 text-brand-accent" />
                        Presets rápidos
                    </h4>
                    <div className="grid grid-cols-4 gap-2">
                        {PRESETS.map((p) => {
                            const active = captionStyle.id === p.id;
                            const previewActiveColor =
                                p.id === 'hacker-matrix'
                                    ? adData.brandPalette?.primary || p.s.activeColor
                                    : p.s.activeColor;
                            return (
                                <button
                                    key={p.name}
                                    type="button"
                                    title={p.name}
                                    onClick={() =>
                                        updateStyle({
                                            id: p.id,
                                            name: p.name,
                                            presetRevision: p.revision,
                                            ...p.s,
                                            ...(p.id === 'hacker-matrix' && adData.brandPalette?.primary
                                                ? { activeColor: adData.brandPalette.primary }
                                                : {}),
                                        })
                                    }
                                    className={cn(
                                        'group flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-all',
                                        active
                                            ? 'border-brand-accent bg-brand-accent/10 shadow-[0_0_14px_rgba(0,230,118,0.15)]'
                                            : 'border-black/5 bg-black/[0.03] hover:border-brand-accent/40 hover:bg-black/5 dark:border-white/8 dark:bg-black/25 dark:hover:bg-white/5'
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'text-xl font-black leading-none',
                                            (p.s.textCase ?? 'uppercase') === 'lowercase' ? 'lowercase' : 'uppercase'
                                        )}
                                        style={{
                                            fontFamily: p.s.fontFamily,
                                            color: p.s.baseColor,
                                            WebkitTextStroke: `1px ${p.s.strokeColor}`,
                                            paintOrder: 'stroke fill',
                                        }}
                                    >
                                        A<span style={{ color: previewActiveColor }}>a</span>
                                    </span>
                                    <span className="w-full truncate text-center text-[8px] font-bold uppercase tracking-wide text-brand-muted/70">
                                        {p.name}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>

                {/* Fonte */}
                <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between">
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">Fonte</label>
                        <span className="font-mono text-[10px] text-foreground/60">{captionStyle.fontFamily || 'Poppins'}</span>
                    </div>
                    <FontPicker
                        value={captionStyle.fontFamily || 'Montserrat'}
                        onChange={(fontFamily) => updateStyle({ fontFamily })}
                    />
                </div>

                <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">Caixa do texto</label>
                    <div className="grid grid-cols-2 gap-1 rounded-xl border border-black/10 bg-black/[0.03] p-1 dark:border-white/8 dark:bg-black/25">
                        <button
                            type="button"
                            onClick={() => updateStyle({ textCase: 'uppercase' })}
                            className={cn(
                                'rounded-lg px-3 py-2 text-[10px] font-bold transition',
                                (captionStyle.textCase ?? 'uppercase') === 'uppercase'
                                    ? 'bg-brand-accent text-[#07110d] shadow-sm'
                                    : 'text-brand-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5'
                            )}
                        >
                            MAIÚSCULAS
                        </button>
                        <button
                            type="button"
                            onClick={() => updateStyle({ textCase: 'lowercase' })}
                            className={cn(
                                'rounded-lg px-3 py-2 text-[10px] font-bold transition',
                                captionStyle.textCase === 'lowercase'
                                    ? 'bg-brand-accent text-[#07110d] shadow-sm'
                                    : 'text-brand-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5'
                            )}
                        >
                            minúsculas
                        </button>
                    </div>
                </div>

                {/* Ajustes */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Slider label="Tamanho" value={captionStyle.fontSize} min={8} max={80} step={2} unit="px" onChange={(v) => updateStyle({ fontSize: v })} />
                    <Slider label="Contorno" value={captionStyle.strokeWidth} min={0} max={12} step={1} unit="px" onChange={(v) => updateStyle({ strokeWidth: v })} />
                    <div className="col-span-2">
                        <Slider label="Altura (posição)" value={captionStyle.verticalPosition ?? 23} min={5} max={85} step={1} unit="%" onChange={(v) => updateStyle({ verticalPosition: v })} />
                    </div>
                </div>
                <p className="rounded-lg border border-brand-accent/12 bg-brand-accent/[0.045] px-3 py-2 text-[9px] leading-relaxed text-brand-muted">
                    No preview, clique na legenda para arrastar a altura ou redimensionar pelos cantos.
                </p>

                {/* Cores */}
                <section className="space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">Cores</h4>
                    <div className="grid grid-cols-3 gap-2">
                        {colors.map((c) => (
                            <label
                                key={c.key}
                                className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-black/5 bg-black/[0.03] p-2 transition hover:border-brand-accent/30 dark:border-white/8 dark:bg-black/25"
                            >
                                <span className="text-[9px] font-bold uppercase tracking-wider text-brand-muted/80">{c.label}</span>
                                <div
                                    className="relative h-8 w-full overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10"
                                    style={{ backgroundColor: c.value }}
                                >
                                    <input
                                        type="color"
                                        value={c.value}
                                        onChange={(e) => updateStyle({ [c.key]: e.target.value } as Partial<CaptionStyle>)}
                                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    />
                                </div>
                                <span className="font-mono text-[9px] uppercase text-foreground/50">{c.value}</span>
                            </label>
                        ))}
                    </div>
                </section>

                {/* Texto da legenda */}
                <section className="space-y-2 border-t border-black/5 pt-4 dark:border-white/5">
                    <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-muted">
                        <Type className="h-3.5 w-3.5 text-brand-accent" />
                        Texto da legenda
                    </h4>
                    <div className="space-y-2">
                        {adData.captions.segments.map((segment, index) => (
                            <div key={segment.id} className="group relative">
                                <span className="absolute left-2.5 top-2.5 z-10 rounded bg-black/40 px-1 font-mono text-[9px] font-bold text-brand-accent/80">
                                    {segment.start.toFixed(1)}s
                                </span>
                                <textarea
                                    className="min-h-[56px] w-full resize-none rounded-lg border border-black/10 bg-black/[0.03] py-2.5 pl-12 pr-3 text-sm text-foreground outline-none transition focus:border-brand-accent/50 dark:border-white/8 dark:bg-black/25"
                                    value={segment.text}
                                    onChange={(e) => handleTextChange(index, e.target.value)}
                                />
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
};
