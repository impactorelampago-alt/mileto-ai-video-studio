import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    CheckCircle2,
    Clock3,
    Download,
    Film,
    FolderOpen,
    Image as ImageIcon,
    Loader2,
    Music,
    X,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDownloadJobs, type DownloadJobSnapshot } from '../context/DownloadJobsContext';
import { cn } from '../lib/utils';

type Filter = 'all' | 'active' | 'done';

const destinationLabel = (destination: string) =>
    destination ? destination.split('/').filter(Boolean).join(' / ') : 'Arquivos (raiz)';

const timeLabel = (timestamp: number) =>
    new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));

const statusLabel = (job: DownloadJobSnapshot) => {
    if (job.statusText && job.phase === 'downloading') return job.statusText;
    if (job.phase === 'done') return 'Concluído';
    if (job.phase === 'error') return job.error === 'Download cancelado.' ? 'Cancelado' : 'Falhou';
    return job.step === 'processing'
        ? job.mode === 'video' ? 'Preparando vídeo' : job.mode === 'image' ? 'Salvando imagem' : 'Convertendo para MP3'
        : 'Baixando';
};

export const DownloadQueue = () => {
    const navigate = useNavigate();
    const { jobs, activeCount, cancelJob } = useDownloadJobs();
    const [filter, setFilter] = useState<Filter>('all');
    const [cancellingId, setCancellingId] = useState<string | null>(null);

    const filteredJobs = useMemo(() => jobs.filter((job) => {
        if (filter === 'active') return job.phase === 'downloading';
        if (filter === 'done') return job.phase !== 'downloading';
        return true;
    }), [filter, jobs]);

    const cancel = async (jobId: string) => {
        setCancellingId(jobId);
        try {
            await cancelJob(jobId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível cancelar.');
        } finally {
            setCancellingId(null);
        }
    };

    return (
        <div className="flex flex-col gap-6 py-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-4xl font-black tracking-tight text-foreground md:text-5xl">Atividades</h1>
                        {activeCount > 0 && (
                            <span className="rounded-full border border-brand-lime/20 bg-brand-lime/10 px-2.5 py-1 text-xs font-black text-brand-lime">
                                {activeCount} em andamento
                            </span>
                        )}
                    </div>
                    <p className="mt-2 text-lg text-muted-foreground">
                        Acompanhe downloads, importações e gerações enquanto continua trabalhando no app.
                    </p>
                </div>

                <div className="flex rounded-xl border border-white/10 bg-background p-1">
                    {([
                        ['all', 'Todos'],
                        ['active', 'Em andamento'],
                        ['done', 'Finalizados'],
                    ] as Array<[Filter, string]>).map(([value, label]) => (
                        <button
                            key={value}
                            onClick={() => setFilter(value)}
                            className={cn(
                                'rounded-lg px-3 py-2 text-xs font-bold transition-colors',
                                filter === value
                                    ? 'bg-brand-lime/15 text-brand-lime'
                                    : 'text-brand-muted hover:text-foreground'
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="min-h-[420px] overflow-hidden rounded-2xl border border-black/5 bg-background dark:border-white/5">
                {filteredJobs.length === 0 ? (
                    <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center text-brand-muted">
                        <Download className="h-12 w-12 opacity-40" />
                        <div>
                            <p className="text-sm font-bold text-foreground">
                                {filter === 'active' ? 'Nenhuma atividade em andamento' : 'Nenhuma atividade nesta sessão'}
                            </p>
                            <p className="mt-1 text-xs">Use “Baixar link” em Arquivos para adicionar um novo download.</p>
                        </div>
                        <button
                            onClick={() => navigate('/files')}
                            className="mt-2 rounded-xl bg-brand-lime px-4 py-2.5 text-xs font-black text-[#0a0f12] hover:brightness-110"
                        >
                            Ir para Arquivos
                        </button>
                    </div>
                ) : (
                    <div className="divide-y divide-black/5 dark:divide-white/5">
                        {filteredJobs.map((job) => {
                            const progress = Math.max(0, Math.min(100, Number(job.percent || job.stepPercent || 0)));
                            return (
                                <article key={job.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                                    <div className={cn(
                                        'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border',
                                        job.phase === 'done'
                                            ? 'border-brand-lime/20 bg-brand-lime/10 text-brand-lime'
                                            : job.phase === 'error'
                                              ? 'border-red-500/20 bg-red-500/10 text-red-400'
                                              : 'border-brand-accent/20 bg-brand-accent/10 text-brand-accent'
                                    )}>
                                        {job.phase === 'downloading' ? (
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                        ) : job.phase === 'done' ? (
                                            <CheckCircle2 className="h-5 w-5" />
                                        ) : (
                                            <XCircle className="h-5 w-5" />
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                            <p className="max-w-2xl truncate text-sm font-black text-foreground">
                                                {job.track?.displayName || job.title || 'Preparando download...'}
                                            </p>
                                            <span className={cn(
                                                'text-[10px] font-black uppercase tracking-wider',
                                                job.phase === 'done'
                                                    ? 'text-brand-lime'
                                                    : job.phase === 'error' ? 'text-red-400' : 'text-brand-accent'
                                            )}>
                                                {statusLabel(job)}
                                            </span>
                                        </div>

                                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-muted">
                                            <span className="flex items-center gap-1.5">
                                                {job.mode === 'video' ? <Film className="h-3.5 w-3.5" /> : job.mode === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <Music className="h-3.5 w-3.5" />}
                                                {job.mode === 'video' ? 'Vídeo' : job.mode === 'image' ? 'Imagem' : 'Música'}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <FolderOpen className="h-3.5 w-3.5" /> {destinationLabel(job.destination)}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <Clock3 className="h-3.5 w-3.5" /> {timeLabel(job.startedAt)}
                                            </span>
                                        </div>

                                        {job.phase === 'downloading' && (
                                            <div className="mt-3">
                                                <div className="mb-1.5 flex justify-between text-[10px] font-mono text-brand-muted">
                                                    <span>{job.statusText || (job.step === 'processing' ? 'Processando arquivo' : 'Recebendo dados')}</span>
                                                    <span>{Math.round(progress)}%</span>
                                                </div>
                                                <div className="h-2 overflow-hidden rounded-full bg-black/20 dark:bg-white/5">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-brand-lime to-brand-accent transition-all duration-500"
                                                        style={{ width: `${Math.max(2, progress)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {job.phase === 'error' && job.error && (
                                            <p className="mt-2 text-xs text-red-300">{job.error}</p>
                                        )}
                                    </div>

                                    <div className="shrink-0">
                                        {job.phase === 'downloading' && job.cancellable !== false ? (
                                            <button
                                                onClick={() => void cancel(job.id)}
                                                disabled={cancellingId === job.id}
                                                className="flex items-center gap-1.5 rounded-xl border border-red-500/20 px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                                            >
                                                {cancellingId === job.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                                Cancelar
                                            </button>
                                        ) : job.phase === 'done' ? (
                                            <button
                                                onClick={() => navigate('/files')}
                                                className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-brand-muted hover:bg-white/5 hover:text-foreground"
                                            >
                                                <FolderOpen className="h-3.5 w-3.5" /> Ver arquivos
                                            </button>
                                        ) : null}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>

            <p className="text-center text-[10px] text-brand-muted/60">
                O histórico concluído permanece disponível por 30 minutos nesta sessão. Fechar o Mileto encerra downloads ativos.
            </p>
        </div>
    );
};

export default DownloadQueue;
