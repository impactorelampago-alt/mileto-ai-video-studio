import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoveRight, Radio, Sparkles, Zap } from 'lucide-react';
import { cn } from '../lib/utils';

interface TextAnimationPickerProps {
    value: string;
    onChange: (value: string) => void;
}

const ANIMATIONS = [
    { id: 'pop', name: 'Impacto elástico', note: 'Entrada forte', icon: Zap, preview: 'anim-title-pop' },
    { id: 'fade', name: 'Esmaecer suave', note: 'Elegante e limpo', icon: Sparkles, preview: 'anim-title-fade' },
    { id: 'slide', name: 'Deslize rápido', note: 'Movimento lateral', icon: MoveRight, preview: 'anim-title-slide' },
    { id: 'blink', name: 'Pulso piscante', note: 'Pisca para chamar atenção', icon: Radio, preview: 'animate-[pulse_420ms_ease-in-out_infinite]' },
    { id: 'none', name: 'Estático', note: 'Sem movimento', icon: Sparkles, preview: '' },
] as const;

export const TextAnimationPicker = ({ value, onChange }: TextAnimationPickerProps) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = ANIMATIONS.find((animation) => animation.id === value) || ANIMATIONS[0];
    const SelectedIcon = selected.icon;

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={(event) => {
                    event.stopPropagation();
                    setOpen((current) => !current);
                }}
                className={cn(
                    'group flex h-12 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all',
                    open
                        ? 'border-brand-accent/45 bg-brand-accent/10 shadow-[0_0_18px_rgba(0,230,118,0.12)]'
                        : 'border-black/10 bg-brand-card/55 hover:border-brand-accent/25 dark:border-white/10'
                )}
            >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                    <SelectedIcon className={cn('h-3.5 w-3.5', selected.preview)} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-bold text-foreground">{selected.name}</span>
                    <span className="block truncate text-[8px] font-semibold uppercase tracking-wider text-brand-muted">{selected.note}</span>
                </span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-brand-accent transition-transform', open && 'rotate-180')} />
            </button>

            {open && (
                <div
                    role="listbox"
                    aria-label="Animação do texto"
                    className="mt-2 grid grid-cols-1 gap-1.5 rounded-2xl border border-brand-accent/20 bg-[#091113] p-2 shadow-[0_18px_50px_rgba(0,0,0,0.55),0_0_28px_rgba(0,230,118,0.06)]"
                    onClick={(event) => event.stopPropagation()}
                >
                    {ANIMATIONS.map((animation) => {
                        const Icon = animation.icon;
                        const active = animation.id === selected.id;
                        return (
                            <button
                                key={animation.id}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => {
                                    onChange(animation.id);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-all',
                                    active
                                        ? 'border-brand-lime/35 bg-linear-to-r from-brand-lime/15 to-brand-accent/5 text-brand-lime'
                                        : 'border-white/5 bg-white/[0.025] text-foreground/75 hover:border-brand-accent/25 hover:bg-brand-accent/[0.055] hover:text-foreground'
                                )}
                            >
                                <span className={cn('grid h-7 w-7 place-items-center rounded-lg bg-black/25', active && 'shadow-[0_0_14px_rgba(0,230,118,0.18)]')}>
                                    <Icon className={cn('h-3.5 w-3.5', animation.preview)} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[10px] font-black">{animation.name}</span>
                                    <span className="block text-[8px] text-brand-muted">{animation.note}</span>
                                </span>
                                {active && <span className="h-1.5 w-1.5 rounded-full bg-brand-lime shadow-[0_0_8px_currentColor]" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
