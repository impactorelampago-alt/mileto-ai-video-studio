import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Wand2, Scissors, Clock, Trash2, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useWizard } from '../context/WizardContext';
import { cn } from '../lib/utils';

interface DraftSummary {
    projectId: string;
    title: string;
    updatedAt: string | null;
    exported: boolean;
    mediaCount: number;
    duration: number;
}

const API_BASE = (window as unknown as { API_BASE_URL?: string }).API_BASE_URL || 'http://localhost:3301';

const formatRelative = (iso: string | null): string => {
    if (!iso) return 'Data desconhecida';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return 'Data desconhecida';
    const diffMs = Date.now() - then;
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return 'agora mesmo';
    const min = Math.floor(sec / 60);
    if (min < 60) return `há ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `há ${hr} h`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `há ${day} d`;
    return new Date(iso).toLocaleDateString('pt-BR');
};

const formatDuration = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

export const Home = () => {
    const navigate = useNavigate();
    const { startNewDraft, loadDraft } = useWizard();
    const [drafts, setDrafts] = useState<DraftSummary[]>([]);
    const [loadingDrafts, setLoadingDrafts] = useState(true);
    const [resumingId, setResumingId] = useState<string | null>(null);

    const refreshDrafts = useCallback(async () => {
        setLoadingDrafts(true);
        try {
            const res = await fetch(`${API_BASE}/api/projects`);
            const json = await res.json();
            if (json.ok && Array.isArray(json.drafts)) {
                setDrafts(json.drafts);
            }
        } catch (err) {
            console.error('Failed to load drafts', err);
        } finally {
            setLoadingDrafts(false);
        }
    }, []);

    useEffect(() => {
        refreshDrafts();
    }, [refreshDrafts]);

    const handleNewProject = () => {
        startNewDraft();
        navigate('/wizard/step/1');
    };

    const handleResume = async (id: string) => {
        if (resumingId) return;
        setResumingId(id);
        const ok = await loadDraft(id);
        setResumingId(null);
        if (!ok) {
            toast.error('Não foi possível abrir este rascunho.');
            return;
        }
        navigate('/wizard/step/1');
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!window.confirm('Excluir este rascunho? Essa ação não pode ser desfeita.')) return;
        try {
            const res = await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.ok) throw new Error(json.message || 'Falha ao excluir');
            setDrafts((prev) => prev.filter((d) => d.projectId !== id));
            toast.success('Rascunho excluído.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erro ao excluir');
        }
    };

    return (
        <div className="flex flex-col gap-10 py-8">
            {/* Hero */}
            <div className="flex flex-col gap-2">
                <h1 className="text-4xl md:text-5xl font-black text-foreground tracking-tight">
                    Bem-vindo de volta{' '}
                    <span className="inline-block" role="img" aria-label="wave">
                        👋
                    </span>
                </h1>
                <p className="text-lg text-muted-foreground">
                    Escreva um roteiro e deixe a Mileto montar seu vídeo em 4 passos.
                </p>
            </div>

            {/* Criar */}
            <div>
                <button
                    onClick={handleNewProject}
                    className="group inline-flex items-center gap-2.5 rounded-xl bg-brand-lime px-5 py-3 text-sm font-bold text-[#0a0f12] transition-all hover:brightness-110 hover:shadow-[0_0_30px_rgba(0,230,118,0.25)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-lime"
                >
                    <Wand2 className="w-4 h-4" />
                    Criar
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </button>
            </div>

            {/* Rascunhos recentes */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                        Rascunhos recentes
                    </h3>
                </div>

                {loadingDrafts ? (
                    <div className="rounded-2xl border border-dashed border-border bg-card/50 py-10 flex items-center justify-center gap-3 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Carregando rascunhos...</span>
                    </div>
                ) : drafts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 flex flex-col items-center justify-center gap-3">
                        <div className="w-14 h-14 rounded-full bg-foreground/5 flex items-center justify-center">
                            <Scissors className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <p className="text-base font-bold text-foreground">Nenhum projeto ainda</p>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            Seus projetos aparecerão aqui. Cada vídeo exportado ou interrompido no meio é salvo automaticamente como rascunho.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {drafts.map((d) => {
                            const isLoading = resumingId === d.projectId;
                            return (
                                <div
                                    key={d.projectId}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => handleResume(d.projectId)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') handleResume(d.projectId);
                                    }}
                                    className={cn(
                                        'group relative rounded-2xl border border-border bg-card p-5 text-left transition-all cursor-pointer hover:border-brand-lime/50 hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(0,230,118,0.08)]',
                                        isLoading && 'opacity-60 pointer-events-none'
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2 mb-3">
                                        <h4 className="text-sm font-bold text-foreground line-clamp-2 leading-tight flex-1">
                                            {d.title}
                                        </h4>
                                        <button
                                            type="button"
                                            onClick={(e) => handleDelete(e, d.projectId)}
                                            className="shrink-0 p-1.5 rounded-lg text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                                            title="Excluir rascunho"
                                            aria-label="Excluir rascunho"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-medium">
                                        <span>{formatRelative(d.updatedAt)}</span>
                                        <span className="opacity-40">•</span>
                                        <span>{d.mediaCount} take{d.mediaCount === 1 ? '' : 's'}</span>
                                        {d.duration > 0 && (
                                            <>
                                                <span className="opacity-40">•</span>
                                                <span>{formatDuration(d.duration)}</span>
                                            </>
                                        )}
                                    </div>

                                    <div className="mt-4 flex items-center justify-between">
                                        {d.exported ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-lime">
                                                <CheckCircle2 className="w-3 h-3" />
                                                Exportado
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400/80">
                                                <Clock className="w-3 h-3" />
                                                Em progresso
                                            </span>
                                        )}

                                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground/70 group-hover:text-brand-lime transition-colors">
                                            {isLoading ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <>
                                                    Retomar
                                                    <ArrowRight className="w-3 h-3" />
                                                </>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
