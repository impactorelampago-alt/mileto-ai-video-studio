import { useMemo, useState, useSyncExternalStore } from 'react';
import {
    AlertTriangle,
    Check,
    CheckCircle2,
    ChevronDown,
    Clock3,
    Copy,
    History,
    Loader2,
    PauseCircle,
    Trash2,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import {
    clearFinishedOpsJobHistory,
    explainOpsJobFailure,
    getOpsJobHistory,
    opsJobHistoryForScope,
    opsJobHistoryRecordKey,
    opsJobHistoryScope,
    subscribeOpsJobHistory,
    type OpsJobHistoryRecord,
    type OpsJobHistoryStatus,
} from '../lib/opsJobHistory';
import { OPS_EXECUTOR_STAGE_LABELS } from '../lib/opsExecutorActivity';
import { cn } from '../lib/utils';

type Filter = 'all' | 'active' | 'completed' | 'failed';

const FILTERS: Array<[Filter, string]> = [
    ['all', 'Todos'],
    ['active', 'Em andamento'],
    ['completed', 'Concluídos'],
    ['failed', 'Falhas'],
];

const STATUS_LABEL: Record<OpsJobHistoryStatus, string> = {
    requested: 'Solicitado',
    running: 'Em andamento',
    paused: 'Pausado',
    completed: 'Concluído',
    failed: 'Falhou',
};

const EVENT_LABEL = {
    requested: 'Solicitação recebida',
    claimed: 'Trabalho assumido',
    started: 'Produção iniciada',
    progress: 'Progresso atualizado',
    resumed: 'Trabalho retomado',
    paused: 'Trabalho pausado',
    completed: 'Trabalho concluído',
    failed: 'Falha registrada',
} as const;

const EXECUTION_DISPOSITION_LABEL = {
    revision_possible: 'Revisão possível',
    new_execution: 'Execução nova',
    project_original_missing: 'Projeto original ausente',
    new_execution_required: 'Nova execução necessária',
    temporarily_unavailable: 'Indisponibilidade temporária',
} as const;

const dateTime = (value: number) => new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
}).format(new Date(value));

const StatusIcon = ({ status, className }: { status: OpsJobHistoryStatus; className?: string }) => {
    if (status === 'completed') return <CheckCircle2 className={className} />;
    if (status === 'failed') return <XCircle className={className} />;
    if (status === 'paused') return <PauseCircle className={className} />;
    if (status === 'running') return <Loader2 className={cn(className, 'animate-spin motion-reduce:animate-none')} />;
    return <Clock3 className={className} />;
};

const statusClasses = (status: OpsJobHistoryStatus) => {
    if (status === 'completed') return 'border-brand-lime/20 bg-brand-lime/10 text-brand-lime';
    if (status === 'failed') return 'border-red-500/20 bg-red-500/10 text-red-300';
    if (status === 'paused') return 'border-amber-400/20 bg-amber-400/10 text-amber-200';
    if (status === 'running') return 'border-brand-accent/20 bg-brand-accent/10 text-brand-accent';
    return 'border-white/10 bg-white/5 text-brand-muted';
};

const matchesFilter = (record: OpsJobHistoryRecord, filter: Filter) => {
    if (filter === 'active') return record.status === 'requested' || record.status === 'running' || record.status === 'paused';
    if (filter === 'completed') return record.status === 'completed';
    if (filter === 'failed') return record.status === 'failed';
    return true;
};

export const OpsHistory = () => {
    const { user } = useAuth();
    const snapshot = useSyncExternalStore(subscribeOpsJobHistory, getOpsJobHistory, getOpsJobHistory);
    const scope = opsJobHistoryScope(user?.orgId, user?.id);
    const records = useMemo(() => opsJobHistoryForScope(snapshot, scope), [scope, snapshot]);
    const [filter, setFilter] = useState<Filter>('all');
    const [visibleCount, setVisibleCount] = useState(25);
    const [expandedRecordKey, setExpandedRecordKey] = useState<string | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);
    const [copiedRecordKey, setCopiedRecordKey] = useState<string | null>(null);

    const filtered = useMemo(
        () => records.filter((record) => matchesFilter(record, filter)),
        [filter, records],
    );
    const visible = filtered.slice(0, visibleCount);
    const runningCount = records.filter((record) => record.status === 'requested' || record.status === 'running' || record.status === 'paused').length;
    const completedCount = records.filter((record) => record.status === 'completed').length;
    const failedCount = records.filter((record) => record.status === 'failed').length;

    const selectFilter = (next: Filter) => {
        setFilter(next);
        setVisibleCount(25);
    };

    const copyDiagnostic = async (record: OpsJobHistoryRecord) => {
        const recordKey = opsJobHistoryRecordKey(record);
        const explanation = explainOpsJobFailure(record.errorCode, record.message);
        const value = [
            `Trabalho: ${record.projectTitle}`,
            `Job: ${record.jobId}`,
            record.projectId ? `Projeto: ${record.projectId}` : '',
            `Revisão: ${record.revision || 1}`,
            `Status: ${STATUS_LABEL[record.status]}`,
            `Etapa: ${OPS_EXECUTOR_STAGE_LABELS[record.stage]}`,
            `Atualizado em: ${dateTime(record.updatedAt)}`,
            record.errorCode ? `Código: ${record.errorCode}` : '',
            record.errorStage ? `Etapa da falha: ${OPS_EXECUTOR_STAGE_LABELS[record.errorStage]}` : '',
            record.errorPhase ? `Fase: ${record.errorPhase}` : '',
            record.errorRequestId ? `Request ID: ${record.errorRequestId}` : '',
            record.errorRetryable ? 'Retentativa automática: permitida' : '',
            record.executionDisposition ? `Decisão: ${EXECUTION_DISPOSITION_LABEL[record.executionDisposition]}` : '',
            record.assetId ? `Arquivo entregue: ${record.assetId}` : '',
            `Descrição: ${explanation.detail}`,
            explanation.action ? `Ação sugerida: ${explanation.action}` : '',
        ].filter(Boolean).join('\n');
        try {
            await navigator.clipboard.writeText(value);
            setCopiedRecordKey(recordKey);
            window.setTimeout(() => setCopiedRecordKey((current) => current === recordKey ? null : current), 1_800);
            toast.success('Diagnóstico copiado.');
        } catch {
            toast.error('Não foi possível copiar o diagnóstico.');
        }
    };

    return (
        <div className="flex flex-col gap-6 py-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-4xl font-black tracking-tight text-foreground md:text-5xl">Histórico do Ops</h1>
                        {runningCount > 0 && (
                            <span className="rounded-full border border-brand-accent/20 bg-brand-accent/10 px-2.5 py-1 text-xs font-black text-brand-accent">
                                {runningCount} em andamento
                            </span>
                        )}
                    </div>
                    <p className="mt-2 max-w-3xl text-base text-muted-foreground md:text-lg">
                        Solicitações recebidas, etapas executadas, conclusões e falhas do Mileto Ops neste computador.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {records.some((record) => record.status === 'completed' || record.status === 'failed') && (
                        <button
                            type="button"
                            onClick={() => setConfirmClear(true)}
                            className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-xs font-black text-red-300 hover:bg-red-500/10"
                        >
                            <Trash2 className="h-3.5 w-3.5" /> Limpar finalizados
                        </button>
                    )}
                    <div className="flex rounded-xl border border-white/10 bg-background p-1">
                        {FILTERS.map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => selectFilter(value)}
                                className={cn(
                                    'rounded-lg px-3 py-2 text-xs font-bold transition-colors',
                                    filter === value ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted hover:text-foreground',
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                {[
                    ['Em andamento', runningCount, 'text-brand-accent'],
                    ['Concluídos', completedCount, 'text-brand-lime'],
                    ['Falhas', failedCount, 'text-red-300'],
                ].map(([label, value, color]) => (
                    <div key={String(label)} className="rounded-2xl border border-white/5 bg-card/50 px-5 py-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-muted">{label}</p>
                        <p className={cn('mt-2 text-3xl font-black', String(color))}>{value}</p>
                    </div>
                ))}
            </div>

            {confirmClear && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                            <p className="text-sm font-black text-foreground">Apagar conclusões e falhas deste histórico?</p>
                            <p className="mt-1 text-xs text-brand-muted">Trabalhos solicitados, em andamento ou pausados serão preservados.</p>
                        </div>
                        <div className="flex gap-2 self-end sm:self-auto">
                            <button type="button" onClick={() => setConfirmClear(false)} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-brand-muted hover:bg-white/5">Manter</button>
                            <button
                                type="button"
                                onClick={() => {
                                    clearFinishedOpsJobHistory(scope);
                                    setConfirmClear(false);
                                    toast.success('Histórico finalizado apagado.');
                                }}
                                className="rounded-xl bg-red-500 px-3 py-2 text-xs font-black text-white hover:bg-red-400"
                            >
                                Apagar finalizados
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="min-h-[430px] overflow-hidden rounded-2xl border border-black/5 bg-background dark:border-white/5">
                {visible.length === 0 ? (
                    <div className="flex min-h-[430px] flex-col items-center justify-center gap-3 px-6 text-center text-brand-muted">
                        <History className="h-12 w-12 opacity-40" />
                        <div>
                            <p className="text-sm font-black text-foreground">
                                {records.length ? 'Nenhum trabalho neste filtro' : 'Nenhum trabalho recebido do Ops neste computador'}
                            </p>
                            <p className="mt-1 text-xs">Os próximos trabalhos aparecerão aqui desde a solicitação até a conclusão ou falha.</p>
                        </div>
                    </div>
                ) : (
                    <div className="divide-y divide-black/5 dark:divide-white/5">
                        {visible.map((record) => {
                            const recordKey = opsJobHistoryRecordKey(record);
                            const expanded = expandedRecordKey === recordKey;
                            const explanation = explainOpsJobFailure(record.errorCode, record.message);
                            return (
                                <article key={recordKey} className="p-5">
                                    <button
                                        type="button"
                                        onClick={() => setExpandedRecordKey(expanded ? null : recordKey)}
                                        className="flex w-full items-start gap-4 text-left"
                                        aria-expanded={expanded}
                                    >
                                        <div className={cn('mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl border', statusClasses(record.status))}>
                                            <StatusIcon status={record.status} className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                <p className="max-w-3xl truncate text-sm font-black text-foreground">{record.projectTitle}</p>
                                                <span className={cn('rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', statusClasses(record.status))}>
                                                    {STATUS_LABEL[record.status]}
                                                </span>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-muted">
                                                <span>{record.companyName || 'Mileto Ops'}</span>
                                                <span>{OPS_EXECUTOR_STAGE_LABELS[record.stage]}</span>
                                                <span>{Math.round(record.percent)}%</span>
                                                <span>{dateTime(record.updatedAt)}</span>
                                            </div>
                                            <p className={cn('mt-2 line-clamp-2 text-xs leading-relaxed', record.status === 'failed' ? 'text-red-200' : 'text-foreground/70')}>
                                                {record.status === 'failed' ? explanation.title : record.message}
                                            </p>
                                        </div>
                                        <ChevronDown className={cn('mt-2 h-4 w-4 shrink-0 text-brand-muted transition-transform', expanded && 'rotate-180')} />
                                    </button>

                                    {expanded && (
                                        <div className="ml-0 mt-5 grid gap-4 border-t border-white/5 pt-5 lg:ml-15 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
                                            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div>
                                                        <p className="text-xs font-black uppercase tracking-wider text-foreground">{explanation.title}</p>
                                                        <p className="mt-2 text-xs leading-relaxed text-brand-muted">{explanation.detail}</p>
                                                        {explanation.action && <p className="mt-3 text-xs font-bold leading-relaxed text-amber-200">{explanation.action}</p>}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => void copyDiagnostic(record)}
                                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-[10px] font-black text-brand-muted hover:bg-white/5 hover:text-foreground"
                                                    >
                                                        {copiedRecordKey === recordKey ? <Check className="h-3.5 w-3.5 text-brand-lime" /> : <Copy className="h-3.5 w-3.5" />}
                                                        {copiedRecordKey === recordKey ? 'Copiado' : 'Copiar'}
                                                    </button>
                                                </div>
                                                <dl className="mt-4 grid gap-2 text-[10px] sm:grid-cols-2">
                                                    <div><dt className="text-brand-muted">Job</dt><dd className="mt-0.5 break-all font-mono text-foreground/70">{record.jobId}</dd></div>
                                                    <div><dt className="text-brand-muted">Projeto</dt><dd className="mt-0.5 break-all font-mono text-foreground/70">{record.projectId || '—'}</dd></div>
                                                    <div><dt className="text-brand-muted">Código técnico</dt><dd className="mt-0.5 break-all font-mono text-foreground/70">{record.errorCode || '—'}</dd></div>
                                                    <div><dt className="text-brand-muted">Revisão</dt><dd className="mt-0.5 text-foreground/70">{record.revision || 1}</dd></div>
                                                    <div><dt className="text-brand-muted">Decisão de execução</dt><dd className="mt-0.5 text-foreground/70">{record.executionDisposition ? EXECUTION_DISPOSITION_LABEL[record.executionDisposition] : '—'}</dd></div>
                                                    <div><dt className="text-brand-muted">Pode tentar novamente</dt><dd className="mt-0.5 text-foreground/70">{record.errorCode ? (record.errorRetryable ? 'Sim' : 'Não automaticamente') : '—'}</dd></div>
                                                    <div><dt className="text-brand-muted">Etapa da falha</dt><dd className="mt-0.5 text-foreground/70">{record.errorStage ? OPS_EXECUTOR_STAGE_LABELS[record.errorStage] : '—'}</dd></div>
                                                    <div><dt className="text-brand-muted">Fase técnica</dt><dd className="mt-0.5 break-all font-mono text-foreground/70">{record.errorPhase || '—'}</dd></div>
                                                    <div><dt className="text-brand-muted">Request ID</dt><dd className="mt-0.5 break-all font-mono text-foreground/70">{record.errorRequestId || '—'}</dd></div>
                                                    <div><dt className="text-brand-muted">Recebido</dt><dd className="mt-0.5 text-foreground/70">{dateTime(record.requestedAt)}</dd></div>
                                                    <div><dt className="text-brand-muted">Finalizado</dt><dd className="mt-0.5 text-foreground/70">{record.completedAt ? dateTime(record.completedAt) : '—'}</dd></div>
                                                </dl>
                                            </div>

                                            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                                                <p className="text-xs font-black uppercase tracking-wider text-foreground">Linha do tempo</p>
                                                <ol className="mt-4 space-y-3">
                                                    {[...record.events].reverse().map((event) => (
                                                        <li key={event.id} className="flex gap-3">
                                                            <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-lime/70" />
                                                            <div className="min-w-0">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <p className="text-[11px] font-black text-foreground/80">{EVENT_LABEL[event.kind]}</p>
                                                                    <span className="text-[9px] text-brand-muted">{dateTime(event.createdAt)}</span>
                                                                </div>
                                                                <p className="mt-0.5 text-[10px] text-brand-muted">{OPS_EXECUTOR_STAGE_LABELS[event.stage]} · {Math.round(event.percent)}%</p>
                                                                {event.message && <p className="mt-1 text-[10px] leading-relaxed text-foreground/60">{event.message}</p>}
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ol>
                                            </div>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>

            {filtered.length > visible.length && (
                <button
                    type="button"
                    onClick={() => setVisibleCount((count) => count + 25)}
                    className="self-center rounded-xl border border-white/10 px-5 py-2.5 text-xs font-black text-brand-muted hover:bg-white/5 hover:text-foreground"
                >
                    Mostrar mais 25
                </button>
            )}

            <div className="flex items-start gap-2 rounded-xl border border-amber-300/10 bg-amber-300/5 px-4 py-3 text-[10px] leading-relaxed text-amber-100/80">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Este histórico registra até 200 trabalhos executados neste computador. Trabalhos antigos ou feitos em outro executor dependerão da futura sincronização de histórico do Mileto Ops.
            </div>
        </div>
    );
};

export default OpsHistory;
