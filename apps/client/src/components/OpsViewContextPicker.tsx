import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, ChevronDown, Check, Loader2, UsersRound, UserRound, Crown } from 'lucide-react';
import type { OpsViewContext } from '../lib/gateway';

// Ícone da "visão" (dono / equipe / pessoa) — espelha o do OpsLibrary.
export const ViewContextIcon = ({ mode, className = 'w-4 h-4' }: { mode: OpsViewContext['mode']; className?: string }) => {
    if (mode === 'team') return <UsersRound className={className} />;
    if (mode === 'profile') return <UserRound className={className} />;
    return <Crown className={className} />;
};

/**
 * Seletor rico de "Visualizar conteúdo como" (avatar + nome em bold + função em light),
 * agrupado em "Visão" (dono/todos) e "Pessoas no seu alcance". Reaproveitável.
 */
export const OpsViewContextPicker = ({
    contexts,
    value,
    onChange,
    loading = false,
}: {
    contexts: OpsViewContext[];
    value: string | null;
    onChange: (_contextId: string) => void;
    loading?: boolean;
}) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = contexts.find((c) => c.contextId === value) || contexts[0];

    useEffect(() => {
        if (!open) return;
        const onDoc = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    if (!selected) return null;
    const visions = contexts.filter((c) => c.mode !== 'profile');
    const people = contexts.filter((c) => c.mode === 'profile');
    const choose = (c: OpsViewContext) => {
        onChange(c.contextId);
        setOpen(false);
    };

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
                className="group flex w-full items-center gap-2 rounded-xl border border-violet-400/20 bg-black/20 px-3 py-2.5 text-left transition hover:border-violet-400/40 hover:bg-violet-500/5"
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300 [&>svg]:h-4 [&>svg]:w-4">
                    <ViewContextIcon mode={selected.mode} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs font-bold text-foreground">{selected.label}</span>
                    <span className="truncate text-[10px] text-brand-muted">{selected.subtitle}</span>
                </span>
                {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-brand-lime" />
                ) : (
                    <ChevronDown className={`h-4 w-4 shrink-0 text-brand-muted transition ${open ? 'rotate-180' : ''}`} />
                )}
            </button>

            {open && (
                <div
                    role="listbox"
                    aria-label="Visualizar conteúdo como"
                    className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-violet-400/20 bg-[#0b1115]/98 shadow-[0_28px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                >
                    <div className="border-b border-white/7 bg-gradient-to-r from-violet-500/10 via-transparent to-brand-lime/5 px-4 py-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-white">
                            <ShieldCheck className="h-4 w-4 text-brand-lime" />
                            Visualizar conteúdo como
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                            O Mileto Ops libera somente pessoas dentro do seu alcance.
                        </p>
                    </div>

                    <div className="custom-scrollbar max-h-[320px] overflow-y-auto p-2">
                        <div className="px-2 pb-1 pt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">Visão</div>
                        {visions.map((c) => {
                            const active = selected.contextId === c.contextId;
                            return (
                                <button
                                    key={c.contextId}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    onClick={() => choose(c)}
                                    className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                                        active ? 'border-brand-lime/25 bg-brand-lime/10' : 'border-transparent hover:border-white/8 hover:bg-white/5'
                                    }`}
                                >
                                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${active ? 'bg-brand-lime text-black' : 'bg-white/7 text-white/60'}`}>
                                        <ViewContextIcon mode={c.mode} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-bold text-white">{c.label}</span>
                                        <span className="block truncate text-[10px] text-white/40">{c.subtitle}</span>
                                    </span>
                                    {active && <Check className="h-4 w-4 text-brand-lime" />}
                                </button>
                            );
                        })}

                        {people.length > 0 && (
                            <>
                                <div className="mx-2 my-2 h-px bg-white/7" />
                                <div className="px-2 pb-1 pt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                                    Pessoas no seu alcance
                                </div>
                                {people.map((c) => {
                                    const active = selected.contextId === c.contextId;
                                    return (
                                        <button
                                            key={c.contextId}
                                            type="button"
                                            role="option"
                                            aria-selected={active}
                                            onClick={() => choose(c)}
                                            className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                                                active ? 'border-violet-400/25 bg-violet-500/10' : 'border-transparent hover:border-white/8 hover:bg-white/5'
                                            }`}
                                        >
                                            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black uppercase ${active ? 'bg-violet-400 text-black' : 'bg-violet-500/15 text-violet-200'}`}>
                                                {c.label.slice(0, 1)}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-xs font-bold text-white">{c.label}</span>
                                                <span className="block truncate text-[10px] text-white/40">{c.subtitle}</span>
                                            </span>
                                            {active && <Check className="h-4 w-4 text-violet-300" />}
                                        </button>
                                    );
                                })}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
