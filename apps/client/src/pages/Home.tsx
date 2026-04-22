import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Film, ArrowRight, Wand2, Scissors, Clock, Trash2, CheckCircle2, Loader2 } from 'lucide-react';
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
                    Escolha como você quer criar seu vídeo hoje.
                </p>
            </div>

            {/* Two creation modes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* AI Mode */}
                <button
                    onClick={handleNewProject}
                    className="group relative overflow-hidden rounded-2xl border-2 border-brand-lime/40 bg-linear-to-br from-brand-lime/10 via-card to-card p-8 text-left transition-all duration-300 hover:border-brand-lime hover:shadow-[0_0_40px_rgba(0,230,118,0.2)] hover:-translate-y-1"
                >
                    <div className="absolute top-4 right-4 flex items-center gap-1 px-2 py-1 rounded-full bg-brand-lime/20 border border-brand-lime/40">
                        <Sparkles className="w-3 h-3 text-brand-lime" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-brand-lime">
                            Recomendado
                        </span>
                    </div>

                    <div className="mb-6 w-16 h-16 rounded-2xl bg-brand-lime/15 border border-brand-lime/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        <Wand2 className="w-8 h-8 text-brand-lime" />
                    </div>

                    <h2 className="text-2xl font-black text-foreground mb-2">
                        Criação com IA
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                        Escreva um roteiro e deixe a Mileto gerar narração, legendas, títulos e montar seu vídeo automaticamente em 4 passos.
                    </p>

                    <ul className="space-y-2 mb-8">
                        {[
                            'Narração TTS automática',
                            'Legendas sincronizadas (Whisper)',
                            'Títulos gerados por IA',
                            'Fluxo guiado de 4 etapas',
                        ].map((feat) => (
                            <li key={feat} className="flex items-center gap-2 text-sm text-foreground/80">
                                <div className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                                {feat}
                            </li>
                        ))}
                    </ul>

                    <div className="flex items-center gap-2 text-brand-lime font-bold text-sm group-hover:gap-3 transition-all">
                        Começar com IA
                        <ArrowRight className="w-4 h-4" />
                    </div>
                </button>

                {/* Manual Mode */}
                <button
                    onClick={() => navigate('/editor')}
                    className="group relative overflow-hidden rounded-2xl border-2 border-border bg-card p-8 text-left transition-all duration-300 hover:border-foreground/40 hover:shadow-[0_0_40px_rgba(255,255,255,0.05)] hover:-translate-y-1"
                >
                    <div className="mb-6 w-16 h-16 rounded-2xl bg-foreground/5 border border-border flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        <Film className="w-8 h-8 text-foreground" />
                    </div>

                    <h2 className="text-2xl font-black text-foreground mb-2">
                        Edição Manual
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                        Editor completo com timeline multi-track. Controle total sobre cortes, transições, áudio e efeitos.
                    </p>

                    <ul className="space-y-2 mb-8">
                        {[
                            'Timeline multi-track',
                            'Cortes e recortes precisos',
                            'Transições personalizáveis',
                            'Controle profissional',
                        ].map((feat) => (
                            <li key={feat} className="flex items-center gap-2 text-sm text-foreground/80">
                                <div className="w-1.5 h-1.5 rounded-full bg-foreground/60" />
                                {feat}
                            </li>
                        ))}
                    </ul>

                    <div className="flex items-center gap-2 text-foreground font-bold text-sm group-hover:gap-3 transition-all">
                        Abrir Editor
                        <ArrowRight className="w-4 h-4" />
                    </div>
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
