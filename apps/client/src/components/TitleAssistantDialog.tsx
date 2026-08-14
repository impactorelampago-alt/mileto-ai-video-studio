import { useState } from 'react';
import { Check, CircleAlert, Loader2, RefreshCw, Sparkles, WandSparkles, X } from 'lucide-react';
import type { TitleHook } from '../types';
import { cn } from '../lib/utils';

interface TitleAssistantDialogProps {
    open: boolean;
    busy: boolean;
    progress?: string;
    error?: string;
    warning?: string;
    source?: 'ai' | 'local' | 'none';
    titles: TitleHook[];
    instruction: string;
    onInstructionChange: (value: string) => void;
    onChangeTitle: (id: string, updates: Partial<TitleHook>) => void;
    onRefine: () => void;
    onApply: () => void;
    onClose: () => void;
}

const titleTime = (value: number) => `${Math.max(0, value).toFixed(1).replace('.', ',')}s`;

export const TitleAssistantDialog = ({
    open,
    busy,
    progress,
    error,
    warning,
    source,
    titles,
    instruction,
    onInstructionChange,
    onChangeTitle,
    onRefine,
    onApply,
    onClose,
}: TitleAssistantDialogProps) => {
    const [edits, setEdits] = useState<Record<string, string>>({});
    if (!open) return null;
    const activeCount = titles.filter((title) => title.isActive).length;
    const pendingEdits = Object.entries(edits).filter(
        ([id, value]) => value.trim().length > 0 && titles.some((title) => title.id === id),
    );
    const applyPendingEdits = () => {
        pendingEdits.forEach(([id, value]) => onChangeTitle(id, { text: value.trim().slice(0, 120) }));
        setEdits({});
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="title-assistant-heading"
                className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b1110] shadow-2xl"
            >
                <header className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-brand-accent">
                            <Sparkles className="h-3.5 w-3.5" /> Assistente temporário
                        </div>
                        <h3 id="title-assistant-heading" className="mt-1 text-lg font-bold text-foreground">
                            Revise os títulos antes de aplicar
                        </h3>
                        <p className="mt-1 text-[11px] leading-4 text-brand-muted">
                            O preview é temporário. Nada entra no projeto até sua confirmação.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={busy ? 'Cancelar geração de títulos' : 'Fechar sem aplicar'}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-brand-muted transition hover:border-white/20 hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </header>

                <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    {busy && !titles.length ? (
                        <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-white/10 bg-white/[.02] p-8 text-center">
                            <div>
                                <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand-accent" />
                                <p className="mt-3 text-xs font-semibold text-foreground">{progress || 'Criando propostas…'}</p>
                                <p className="mt-1 text-[10px] text-brand-muted">Você pode cancelar sem alterar o projeto.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="mb-3 flex items-center justify-between gap-3 px-1">
                                <span className="text-[10px] font-bold uppercase tracking-[.14em] text-brand-muted">
                                    {titles.length} sugestão{titles.length === 1 ? '' : 'ões'} · {activeCount} selecionada{activeCount === 1 ? '' : 's'}
                                </span>
                                {source && (
                                    <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-semibold text-brand-muted">
                                        {source === 'ai' ? 'IA' : source === 'local' ? 'Fallback local' : 'Sem títulos'}
                                    </span>
                                )}
                            </div>

                            {titles.map((title) => (
                                <article
                                    key={title.id}
                                    className={cn(
                                        'flex items-start gap-3 rounded-xl border px-3 py-3 transition',
                                        title.isActive
                                            ? 'border-brand-accent/25 bg-brand-accent/[.045]'
                                            : 'border-white/7 bg-white/[.015] opacity-65'
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onChangeTitle(title.id, { isActive: !title.isActive })}
                                        aria-label={title.isActive ? `Remover ${title.text}` : `Selecionar ${title.text}`}
                                        className={cn(
                                            'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition',
                                            title.isActive
                                                ? 'border-brand-accent bg-brand-accent text-[#07110d]'
                                                : 'border-white/20 text-transparent'
                                        )}
                                    >
                                        <Check className="h-3 w-3" />
                                    </button>
                                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(150px,.9fr)]">
                                        <div className="min-w-0 self-center">
                                            <input
                                                value={title.text}
                                                onChange={(event) => onChangeTitle(title.id, { text: event.target.value })}
                                                maxLength={120}
                                                aria-label="Editar texto do título"
                                                className="w-full bg-transparent text-[12px] font-semibold text-foreground outline-none placeholder:text-brand-muted"
                                            />
                                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-brand-muted">
                                                {title.triggerId && <span>{title.triggerId}</span>}
                                                <span>{titleTime(title.startSec)}–{titleTime(title.startSec + title.durationSec)}</span>
                                                {title.sourceText && <span className="truncate">Base: “{title.sourceText}”</span>}
                                            </div>
                                        </div>
                                        <input
                                            value={edits[title.id] ?? ''}
                                            onChange={(event) => setEdits((current) => ({ ...current, [title.id]: event.target.value }))}
                                            disabled={busy}
                                            maxLength={90}
                                            placeholder="Como você quer que fique?"
                                            aria-label={`Mudança desejada para ${title.text}`}
                                            className="h-9 min-w-0 self-center rounded-lg border border-white/10 bg-white/[.025] px-2.5 text-[10px] text-foreground outline-none transition placeholder:text-brand-muted/70 focus:border-brand-accent/45 focus:bg-brand-accent/[.03] disabled:cursor-wait disabled:opacity-50"
                                        />
                                    </div>
                                </article>
                            ))}

                            {pendingEdits.length > 0 && (
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={applyPendingEdits}
                                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-brand-accent/25 bg-brand-accent/[.05] px-3 text-[10px] font-bold text-brand-accent transition hover:border-brand-accent/45 hover:bg-brand-accent/[.09] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <WandSparkles className="h-3.5 w-3.5" /> Fazer essas mudanças ({pendingEdits.length})
                                </button>
                            )}

                            {!titles.length && !busy && (
                                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-[11px] text-brand-muted">
                                    Nenhuma sugestão segura foi encontrada. Você pode pedir outro ajuste.
                                </div>
                            )}
                        </div>
                    )}

                    {(warning || error) && (
                        <div className={cn(
                            'mt-3 flex gap-2 rounded-xl border px-3 py-2.5 text-[10px] leading-4',
                            error
                                ? 'border-red-400/20 bg-red-500/[.06] text-red-300'
                                : 'border-amber-300/20 bg-amber-300/[.05] text-amber-100'
                        )}>
                            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{error || warning}</span>
                        </div>
                    )}

                    <div className="mt-4 rounded-xl border border-white/8 bg-white/[.02] p-3">
                        <label htmlFor="title-assistant-instruction" className="text-[10px] font-bold uppercase tracking-[.14em] text-brand-muted">
                            O que você quer ajustar?
                        </label>
                        <textarea
                            id="title-assistant-instruction"
                            value={instruction}
                            onChange={(event) => onInstructionChange(event.target.value)}
                            maxLength={1_000}
                            rows={2}
                            placeholder="Ex.: deixe o CTA mais curto; preserve o preço; troque o segundo título…"
                            className="mt-2 w-full resize-none bg-transparent text-[11px] leading-5 text-foreground outline-none placeholder:text-brand-muted/70"
                        />
                        <div className="mt-2 flex justify-end">
                            <button
                                type="button"
                                disabled={busy || !instruction.trim()}
                                onClick={onRefine}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[10px] font-semibold text-foreground transition hover:border-brand-accent/35 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                Ajustar com IA
                            </button>
                        </div>
                    </div>
                </div>

                <footer className="flex items-center justify-between gap-3 border-t border-white/8 px-4 py-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-9 rounded-lg px-3 text-[10px] font-semibold text-brand-muted transition hover:bg-white/5 hover:text-foreground"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        disabled={busy || activeCount === 0}
                        onClick={onApply}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-accent px-4 text-[10px] font-bold text-[#07110d] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Check className="h-3.5 w-3.5" /> Aplicar títulos
                    </button>
                </footer>
            </section>
        </div>
    );
};
