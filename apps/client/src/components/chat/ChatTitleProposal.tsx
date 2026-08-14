import React from 'react';
import { Check, CircleDashed, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TitlePlanningProposal } from '../../lib/titlePlanning';

interface ChatTitleProposalProps {
    proposal: TitlePlanningProposal;
    busy?: boolean;
    error?: string | null;
    instruction: string;
    onInstructionChange: (value: string) => void;
    onRefine: () => void;
    onToggle: (id: string) => void;
    onEdit: (id: string, value: string) => void;
    onApply: () => void;
}

export const ChatTitleProposal: React.FC<ChatTitleProposalProps> = ({
    proposal,
    busy = false,
    error,
    instruction,
    onInstructionChange,
    onRefine,
    onToggle,
    onEdit,
    onApply,
}) => {
    const selectedCount = proposal.suggestions.filter((item) => item.selected).length;
    return (
        <section className="mt-3 overflow-hidden rounded-2xl border border-black/10 bg-brand-card/75 dark:border-white/10">
            <header className="flex items-start justify-between gap-3 border-b border-black/5 px-4 py-3 dark:border-white/5">
                <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-brand-accent">
                        <Sparkles className="h-3.5 w-3.5" /> Sugestões de títulos
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-brand-muted">
                        {proposal.summary || 'Escolha e ajuste antes de levar os textos ao projeto.'}
                    </p>
                </div>
                <span className="shrink-0 rounded-full border border-black/10 px-2 py-1 text-[9px] font-semibold text-brand-muted dark:border-white/10">
                    {selectedCount} selecionado{selectedCount === 1 ? '' : 's'}
                </span>
            </header>

            <div className="space-y-2 px-3 py-3">
                {proposal.suggestions.map((item) => (
                    <div
                        key={item.id}
                        className={cn(
                            'flex items-center gap-2 rounded-xl border px-2.5 py-2 transition',
                            item.selected
                                ? 'border-brand-accent/30 bg-brand-accent/[.055]'
                                : 'border-black/5 bg-black/[.02] opacity-70 dark:border-white/5 dark:bg-white/[.02]'
                        )}
                    >
                        <button
                            type="button"
                            onClick={() => onToggle(item.id)}
                            className={cn(
                                'grid h-5 w-5 shrink-0 place-items-center rounded-md border transition',
                                item.selected
                                    ? 'border-brand-accent bg-brand-accent text-[#07110d]'
                                    : 'border-black/20 text-transparent dark:border-white/20'
                            )}
                            aria-label={item.selected ? `Remover ${item.text}` : `Selecionar ${item.text}`}
                        >
                            <Check className="h-3 w-3" />
                        </button>
                        <div className="min-w-0 flex-1">
                            <input
                                value={item.text}
                                onChange={(event) => onEdit(item.id, event.target.value)}
                                maxLength={90}
                                className="w-full bg-transparent text-[12px] font-semibold text-foreground outline-none"
                                aria-label={`Texto do gatilho ${item.triggerName}`}
                            />
                            <div className="mt-0.5 truncate text-[9px] text-brand-muted">
                                {item.triggerName} · base: “{item.sourceText}”
                            </div>
                        </div>
                    </div>
                ))}

                {!proposal.suggestions.length && (
                    <p className="rounded-xl border border-dashed border-black/10 px-3 py-4 text-center text-[11px] text-brand-muted dark:border-white/10">
                        Nenhum fato da narração sustentou um título ainda. Peça um ajuste sem inventar informações.
                    </p>
                )}
            </div>

            <div className="border-t border-black/5 px-3 py-3 dark:border-white/5">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[.14em] text-brand-muted">
                    Gatilhos configurados
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {proposal.triggers.map((trigger) => (
                        <span
                            key={trigger.id}
                            className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-medium',
                                trigger.status === 'found'
                                    ? 'border-brand-accent/25 bg-brand-accent/[.06] text-brand-accent'
                                    : 'border-black/10 text-brand-muted dark:border-white/10'
                            )}
                            title={trigger.status === 'found'
                                ? `${trigger.suggestionCount} sugestão(ões) encontrada(s)`
                                : 'Nenhuma evidência encontrada nesta narração'}
                        >
                            {trigger.status === 'found'
                                ? <Check className="h-2.5 w-2.5" />
                                : <CircleDashed className="h-2.5 w-2.5" />}
                            {trigger.name}
                        </span>
                    ))}
                </div>
            </div>

            <div className="border-t border-black/5 p-3 dark:border-white/5">
                <div className="flex gap-2">
                    <input
                        value={instruction}
                        onChange={(event) => onInstructionChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey && instruction.trim() && !busy) {
                                event.preventDefault();
                                onRefine();
                            }
                        }}
                        placeholder="Ex.: faltou um CTA; deixe o preço mais direto…"
                        maxLength={1_000}
                        className="min-w-0 flex-1 rounded-xl border border-black/10 bg-black/[.02] px-3 py-2 text-[11px] text-foreground outline-none transition focus:border-brand-accent/40 dark:border-white/10 dark:bg-white/[.02]"
                    />
                    <button
                        type="button"
                        disabled={busy || !instruction.trim()}
                        onClick={onRefine}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-black/10 px-3 text-[10px] font-semibold text-foreground transition hover:border-brand-accent/35 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
                    >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Ajustar
                    </button>
                </div>
                {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
                <button
                    type="button"
                    disabled={!selectedCount || busy}
                    onClick={onApply}
                    className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-brand-accent px-4 text-[10px] font-bold text-[#07110d] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <Check className="h-3.5 w-3.5" /> Aplicar títulos selecionados
                </button>
            </div>
        </section>
    );
};
