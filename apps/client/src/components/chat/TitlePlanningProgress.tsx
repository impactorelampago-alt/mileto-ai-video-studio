import React from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';

export type TitlePlanningProgressPhase = 'routing' | 'generating' | 'refining';

interface TitlePlanningProgressProps {
    phase: TitlePlanningProgressPhase;
    className?: string;
}

const PHASE_COPY: Record<TitlePlanningProgressPhase, { title: string; detail: string }> = {
    routing: {
        title: 'Entendendo seu pedido',
        detail: 'Identificando se o ajuste é nos títulos ou na narração.',
    },
    generating: {
        title: 'Criando sugestões de títulos',
        detail: 'Analisando a narração e os gatilhos configurados.',
    },
    refining: {
        title: 'Ajustando os títulos',
        detail: 'Aplicando suas orientações sem alterar a narração.',
    },
};

export const TitlePlanningProgress: React.FC<TitlePlanningProgressProps> = ({
    phase,
    className,
}) => {
    const copy = PHASE_COPY[phase];

    return (
        <section
            className={cn(
                'relative overflow-hidden rounded-2xl border border-brand-accent/20 bg-brand-card/80 px-4 py-3',
                className,
            )}
            aria-live="polite"
            aria-atomic="true"
        >
            <style>{`
                @keyframes titlePlanningProgressSweep {
                    0% { transform: translateX(-120%); }
                    55% { transform: translateX(105%); }
                    100% { transform: translateX(245%); }
                }
            `}</style>

            <div className="flex items-center gap-3">
                <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand-accent/20 bg-brand-accent/[.06] text-brand-accent"
                    aria-hidden="true"
                >
                    {phase === 'routing'
                        ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                        : <Sparkles className="h-4 w-4" />}
                </span>

                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-foreground">{copy.title}</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-brand-muted">{copy.detail}</p>
                </div>

                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[.12em] text-brand-accent/80">
                    IA
                </span>
            </div>

            <div
                className="relative mt-3 h-1 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/[.07]"
                role="progressbar"
                aria-label="Progresso do planejamento de títulos"
                aria-valuetext={`${copy.title}. ${copy.detail}`}
            >
                <span
                    className="absolute inset-y-0 left-0 w-[42%] rounded-full bg-brand-accent/85 animate-[titlePlanningProgressSweep_1.45s_ease-in-out_infinite] motion-reduce:translate-x-0 motion-reduce:animate-none"
                    aria-hidden="true"
                />
            </div>
        </section>
    );
};
