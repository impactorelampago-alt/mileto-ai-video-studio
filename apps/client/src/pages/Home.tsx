import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Wand2, Scissors, Clock, Trash2, CheckCircle2, Loader2, HardDrive, Users, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useWizard } from '../context/WizardContext';
import { cn } from '../lib/utils';
import { gatewayApi } from '../lib/gateway';

interface DraftSummary {
    projectId: string;
    title: string;
    updatedAt: string | null;
    exported: boolean;
    mediaCount: number;
    duration: number;
    author?: string | null;
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
    const { startNewDraft, loadDraft, publishDraftToShared, projectId, draftScope } = useWizard();
    const [drafts, setDrafts] = useState<DraftSummary[]>([]);
    const [loadingDrafts, setLoadingDrafts] = useState(true);
    const [resumingId, setResumingId] = useState<string | null>(null);
    const [sharingId, setSharingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [scope, setScope] = useState<'local' | 'shared'>('local');
    const [newDraftTitle, setNewDraftTitle] = useState('');

    const refreshDrafts = useCallback(async () => {
        setLoadingDrafts(true);
        try {
            if (scope === 'shared') {
                const json = await gatewayApi.sharedDrafts();
                setDrafts(json.drafts.map((draft) => ({
                    projectId: draft.id,
                    title: draft.title,
                    updatedAt: draft.updatedAt,
                    exported: false,
                    mediaCount: 0,
                    duration: 0,
                    author: draft.authorName || draft.authorEmail || null,
                })));
                return;
            }
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
    }, [scope]);

    useEffect(() => {
        refreshDrafts();
    }, [refreshDrafts]);

    const handleNewProject = () => {
        startNewDraft({ scope: 'local', title: newDraftTitle });
        setNewDraftTitle('');
        navigate('/wizard/step/1');
    };

    const handleShare = async (event: React.MouseEvent, id: string) => {
        event.stopPropagation();
        if (sharingId) return;
        setSharingId(id);
        const published = await publishDraftToShared(id);
        setSharingId(null);
        if (published) {
            toast.success('Rascunho publicado no Compartilhado. O original continua salvo neste computador.');
        } else {
            toast.error('Não foi possível compartilhar o rascunho. Confira sua conexão e tente novamente.');
        }
    };

    const handleResume = async (id: string) => {
        if (resumingId) return;
        setResumingId(id);
        const lastStep = await loadDraft(id, scope);
        setResumingId(null);
        if (!lastStep) {
            toast.error('Não foi possível abrir este rascunho.');
            return;
        }
        navigate(`/wizard/step/${lastStep}`);
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (deletingId) return;
        if (scope === 'shared') {
            if (!window.confirm('Mover este rascunho compartilhado para a lixeira?')) return;
            setDeletingId(id);
            try {
                await gatewayApi.deleteSharedDraft(id);
                setDrafts((prev) => prev.filter((d) => d.projectId !== id));
                // Um rascunho compartilhado aberto continua sendo observado pelo
                // autosave. Ao apagá-lo, soltamos essa referência para que ele
                // não seja recriado alguns milissegundos depois.
                if (draftScope === 'shared' && projectId === id) startNewDraft({ scope: 'local' });
                toast.success('Rascunho movido para a lixeira por 30 dias.');
            } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Erro ao mover para a lixeira');
            } finally {
                setDeletingId(null);
            }
            return;
        }
        if (!window.confirm('Excluir este rascunho? Essa ação não pode ser desfeita.')) return;
        setDeletingId(id);
        try {
            const res = await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.ok) throw new Error(json.message || 'Falha ao excluir');
            setDrafts((prev) => prev.filter((d) => d.projectId !== id));
            toast.success('Rascunho excluído.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erro ao excluir');
        } finally {
            setDeletingId(null);
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
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <label className="flex-1 max-w-lg space-y-1.5">
                    <span className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        <span>Título do novo rascunho</span>
                        <span className="inline-flex items-center gap-1 normal-case tracking-normal text-brand-lime/80">
                            <HardDrive className="h-3 w-3" /> Salvo localmente
                        </span>
                    </span>
                    <input
                        type="text"
                        value={newDraftTitle}
                        onChange={(event) => setNewDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') handleNewProject();
                        }}
                        placeholder="Ex.: Campanha de julho"
                        className="w-full h-11 rounded-xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-lime/60"
                    />
                </label>
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                            Rascunhos recentes
                        </h3>
                    </div>
                    <div className="inline-flex items-center rounded-xl border border-border bg-card p-1">
                        <button
                            type="button"
                            onClick={() => setScope('local')}
                            className={cn(
                                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                                scope === 'local' ? 'bg-brand-lime/15 text-brand-lime' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <HardDrive className="h-3.5 w-3.5" />
                            Local
                        </button>
                        <button
                            type="button"
                            onClick={() => setScope('shared')}
                            className={cn(
                                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                                scope === 'shared' ? 'bg-brand-accent/15 text-brand-accent' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <Users className="h-3.5 w-3.5" />
                            Compartilhado
                        </button>
                    </div>
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
                            const isSharing = sharingId === d.projectId;
                            const isDeleting = deletingId === d.projectId;
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
                                            disabled={!!deletingId}
                                            className="shrink-0 p-1.5 rounded-lg text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                                            title="Excluir rascunho"
                                            aria-label="Excluir rascunho"
                                        >
                                            {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
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

                                    {scope === 'shared' && d.author && (
                                        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                            <Users className="h-3 w-3" />
                                            Atualizado por {d.author}
                                        </div>
                                    )}

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

                                        <div className="flex items-center gap-2">
                                            {scope === 'local' && (
                                                <button
                                                    type="button"
                                                    onClick={(event) => void handleShare(event, d.projectId)}
                                                    disabled={!!sharingId}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-accent/20 bg-brand-accent/5 px-2.5 py-1.5 text-[10px] font-bold text-brand-accent transition hover:border-brand-accent/40 hover:bg-brand-accent/10 disabled:opacity-45"
                                                    title="Publicar uma cópia no ambiente compartilhado"
                                                >
                                                    {isSharing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
                                                    {isSharing ? 'Compartilhando' : 'Compartilhar'}
                                                </button>
                                            )}
                                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground/70 transition-colors group-hover:text-brand-lime">
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
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
