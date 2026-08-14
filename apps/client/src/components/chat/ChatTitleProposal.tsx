import React from 'react';
import { Check, CircleDashed, LoaderCircle, MessageSquareText, Sparkles, WandSparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TitlePlanningProposal } from '../../lib/titlePlanning';
import {
    collectTitleProposalRevisionEdits,
    type TitleProposalRevisionEdit,
} from '../../lib/titleProposalRevision';

export type { TitleProposalRevisionEdit } from '../../lib/titleProposalRevision';

interface ChatTitleProposalProps {
    proposal: TitlePlanningProposal;
    busy?: boolean;
    error?: string | null;
    active: boolean;
    readOnly?: boolean;
    lastInstruction?: string;
    onActivate: () => void;
    onToggle: (id: string) => void;
    onRequestChanges: (edits: TitleProposalRevisionEdit[]) => void;
    onApply: () => void;
}

export const ChatTitleProposal: React.FC<ChatTitleProposalProps> = ({
    proposal,
    busy = false,
    error,
    active,
    readOnly = false,
    lastInstruction,
    onActivate,
    onToggle,
    onRequestChanges,
    onApply,
}) => {
    const proposalRevisionKey = `${proposal.proposalId}:${proposal.revision}`;
    const [revisionDraft, setRevisionDraft] = React.useState<{
        proposalRevisionKey: string;
        values: Record<string, string>;
    }>({ proposalRevisionKey, values: {} });
    const desiredTextBySuggestionId = revisionDraft.proposalRevisionKey === proposalRevisionKey
        ? revisionDraft.values
        : {};

    const selectedCount = proposal.suggestions.filter((item) => item.selected).length;
    const requestedChanges = collectTitleProposalRevisionEdits(
        proposal.suggestions,
        desiredTextBySuggestionId,
    );

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
                            disabled={busy || readOnly}
                            className={cn(
                                'grid h-5 w-5 shrink-0 place-items-center rounded-md border transition disabled:cursor-wait disabled:opacity-50',
                                item.selected
                                    ? 'border-brand-accent bg-brand-accent text-[#07110d]'
                                    : 'border-black/20 text-transparent dark:border-white/20'
                            )}
                            aria-label={item.selected ? `Remover ${item.text}` : `Selecionar ${item.text}`}
                        >
                            <Check className="h-3 w-3" />
                        </button>
                        <div className={cn(
                            'grid min-w-0 flex-1 gap-2',
                            !readOnly && 'sm:grid-cols-[minmax(0,1fr)_minmax(160px,.9fr)]',
                        )}>
                            <div className="min-w-0 self-center">
                                <div className="truncate text-[12px] font-semibold text-foreground" title={item.text}>
                                    {item.text}
                                </div>
                                <div className="mt-0.5 truncate text-[9px] text-brand-muted">
                                    {item.triggerName} · base: “{item.sourceText}”
                                </div>
                            </div>
                            {!readOnly && (
                                <input
                                    value={desiredTextBySuggestionId[item.id] || ''}
                                    onChange={(event) => {
                                        const desiredText = event.target.value;
                                        setRevisionDraft((current) => ({
                                            proposalRevisionKey,
                                            values: {
                                                ...(current.proposalRevisionKey === proposalRevisionKey
                                                    ? current.values
                                                    : {}),
                                                [item.id]: desiredText,
                                            },
                                        }));
                                    }}
                                    disabled={busy}
                                    maxLength={90}
                                    placeholder="Como você quer que fique?"
                                    className="h-9 min-w-0 rounded-lg border border-black/10 bg-black/[.025] px-2.5 text-[10px] text-foreground outline-none transition placeholder:text-brand-muted/70 focus:border-brand-accent/45 focus:bg-brand-accent/[.025] disabled:cursor-wait disabled:opacity-50 dark:border-white/10 dark:bg-white/[.025]"
                                    aria-label={`Mudança desejada para ${item.text}, gatilho ${item.triggerName}`}
                                />
                            )}
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
                {readOnly ? (
                    <div className="rounded-xl border border-black/10 px-3 py-2.5 text-[10px] text-brand-muted dark:border-white/10">
                        Versão anterior preservada no histórico. Continue pela proposta mais recente abaixo.
                    </div>
                ) : busy ? (
                    <div className="flex items-center gap-2 rounded-xl border border-brand-accent/15 bg-brand-accent/[.035] px-3 py-2.5 text-[10px] text-brand-muted">
                        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-accent motion-reduce:animate-none" aria-hidden="true" />
                        Ajuste em andamento no campo principal do chat.
                    </div>
                ) : active ? (
                    <div className="rounded-xl border border-brand-accent/20 bg-brand-accent/[.045] px-3 py-2.5">
                        <div className="flex items-center gap-2 text-[10px] font-semibold text-brand-accent">
                            <MessageSquareText className="h-3.5 w-3.5" />
                            Continue pelo campo principal do chat
                        </div>
                        <p className="mt-1 text-[10px] leading-4 text-brand-muted">
                            Sua próxima mensagem ajustará estes títulos. Para voltar à narração, basta pedir uma nova ou encerrar o modo.
                        </p>
                        {lastInstruction && (
                            <p className="mt-1.5 truncate text-[9px] text-brand-muted" title={lastInstruction}>
                                Último pedido: “{lastInstruction}”
                            </p>
                        )}
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={onActivate}
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-black/10 text-[10px] font-semibold text-foreground transition hover:border-brand-accent/35 hover:text-brand-accent dark:border-white/10"
                    >
                        <MessageSquareText className="h-3.5 w-3.5" /> Continuar ajustando no chat
                    </button>
                )}
                {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
                {!readOnly && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button
                            type="button"
                            disabled={!requestedChanges.length || busy}
                            onClick={() => onRequestChanges(requestedChanges)}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-brand-accent/25 bg-brand-accent/[.045] px-3 text-[10px] font-bold text-brand-accent transition hover:border-brand-accent/45 hover:bg-brand-accent/[.08] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {busy
                                ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                                : <WandSparkles className="h-3.5 w-3.5" />}
                            Fazer essas mudanças
                        </button>
                        <button
                            type="button"
                            disabled={!selectedCount || busy}
                            onClick={onApply}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-brand-accent px-3 text-[10px] font-bold text-[#07110d] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Check className="h-3.5 w-3.5" /> Aplicar títulos selecionados
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
};
