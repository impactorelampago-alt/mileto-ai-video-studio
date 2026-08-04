import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Wand2, Scissors, Clock, Trash2, CheckCircle2, Loader2, HardDrive, Users, Share2, Pencil, Film, Check, X, Copy, Play } from 'lucide-react';
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
    cover?: { url: string; type: 'image' | 'video' } | null;
}

const API_BASE = (window as unknown as { API_BASE_URL?: string }).API_BASE_URL || 'http://localhost:3301';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null;

const resolveCoverUrl = (value: string): string => {
    if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
    return `${API_BASE}${value.startsWith('/') ? value : `/${value}`}`;
};

const getSharedDraftCover = (data: UnknownRecord): { url: string; type: 'image' | 'video' } | null => {
    const takes = Array.isArray(data.mediaTakes) ? data.mediaTakes.filter(isRecord) : [];
    const take = takes.find((entry) => entry.type === 'image' || entry.type === 'video');
    if (!take) return null;

    const rawUrl = [take.proxyUrl, take.fileUrl, take.url].find(
        (candidate): candidate is string =>
            typeof candidate === 'string' &&
            candidate.trim().length > 0 &&
            (/^https?:\/\//i.test(candidate) || candidate.startsWith('/') || candidate.startsWith('data:'))
    );
    if (!rawUrl) return null;
    return { url: resolveCoverUrl(rawUrl), type: take.type === 'image' ? 'image' : 'video' };
};

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
    const { startNewDraft, loadDraft, publishDraftToShared, projectId, draftScope, updateAdData } = useWizard();
    const [drafts, setDrafts] = useState<DraftSummary[]>([]);
    const [loadingDrafts, setLoadingDrafts] = useState(true);
    const [resumingId, setResumingId] = useState<string | null>(null);
    const [sharingId, setSharingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState('');
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [scope, setScope] = useState<'local' | 'shared'>('local');
    const [newDraftTitle, setNewDraftTitle] = useState('');

    // Rascunhos locais cuja mídia é do Mileto Ops guardam só a referência (externalMedia),
    // sem URL — então o servidor não gera capa. Resolvemos a capa aqui, sob demanda, pedindo
    // ao gateway uma URL de mídia (best-effort; se falhar, o card usa o placeholder).
    const resolveOpsCovers = useCallback(async (list: DraftSummary[]) => {
        for (const draft of list.slice(0, 12)) {
            if (draft.cover) continue;
            try {
                const detail = await fetch(`${API_BASE}/api/projects/${draft.projectId}`).then((r) => r.json());
                if (!detail?.ok || !isRecord(detail.data)) continue;
                const takes: UnknownRecord[] = Array.isArray(detail.data.mediaTakes)
                    ? (detail.data.mediaTakes as unknown[]).filter(isRecord)
                    : [];
                const visual = takes.find((t) => t.type === 'video' || t.type === 'image');
                const ext = visual && isRecord(visual.externalMedia) ? visual.externalMedia : null;
                const assetId = typeof ext?.assetId === 'string' ? ext.assetId : null;
                if (!assetId) continue;
                const vtype: 'image' | 'video' = visual?.type === 'image' ? 'image' : 'video';
                const media = await gatewayApi.opsAssetUrl(assetId, vtype === 'image' ? 'thumbnail' : 'stream');
                if (media?.url) {
                    setDrafts((prev) =>
                        prev.map((d) =>
                            d.projectId === draft.projectId && !d.cover ? { ...d, cover: { url: media.url, type: vtype } } : d
                        )
                    );
                }
            } catch {
                /* capa é complementar — nunca bloqueia a lista */
            }
        }
    }, []);

    const refreshDrafts = useCallback(async (): Promise<boolean> => {
        setLoadingDrafts(true);
        try {
            if (scope === 'shared') {
                const json = await gatewayApi.sharedDrafts();
                const hydratedDrafts = await Promise.all(json.drafts.map(async (draft) => {
                    let data: UnknownRecord | null = null;
                    try {
                        const detail = await gatewayApi.sharedDraft(draft.id);
                        data = detail.ok && isRecord(detail.data) ? detail.data : null;
                    } catch {
                        // Uma capa ausente nÃ£o deve impedir que o rascunho apareÃ§a.
                    }
                    const takes = data && Array.isArray(data.mediaTakes) ? data.mediaTakes.filter(isRecord) : [];
                    const duration = takes.reduce((total, take) => {
                        const trim = isRecord(take.trim) ? take.trim : null;
                        const start = typeof trim?.start === 'number' ? trim.start : 0;
                        const end = typeof trim?.end === 'number' ? trim.end : 0;
                        return total + Math.max(0, end - start);
                    }, 0);
                    let cover = data ? getSharedDraftCover(data) : null;
                    // Rascunhos compartilhados guardam a referência segura da mídia,
                    // não a URL temporária. Resolve somente a primeira capa visual.
                    if (!cover) {
                        const firstVisual = takes.find((take) => take.type === 'image' || take.type === 'video');
                        const sharedAssetId = typeof firstVisual?.sharedAssetId === 'string' ? firstVisual.sharedAssetId : null;
                        if (sharedAssetId) {
                            try {
                                const asset = await gatewayApi.sharedAsset(sharedAssetId);
                                if (asset.publicUrl && (asset.type === 'image' || asset.type === 'video')) {
                                    cover = { url: resolveCoverUrl(asset.publicUrl), type: asset.type };
                                }
                            } catch {
                                // A miniatura é complementar; nunca bloqueia a lista de rascunhos.
                            }
                        }
                    }
                    const projectTitle = data && isRecord(data.adData) && typeof data.adData.title === 'string'
                        ? data.adData.title.trim()
                        : '';
                    return {
                        projectId: draft.id,
                        title: projectTitle || draft.title,
                        updatedAt: draft.updatedAt,
                        exported: data?.exported === true,
                        mediaCount: takes.length,
                        duration,
                        cover,
                        author: draft.authorName || draft.authorEmail || null,
                    };
                }));
                setDrafts(hydratedDrafts);
                return true;
            }
            const res = await fetch(`${API_BASE}/api/projects`);
            const json = await res.json();
            if (json.ok && Array.isArray(json.drafts)) {
                setDrafts(json.drafts);
                void resolveOpsCovers(json.drafts);
                return true;
            }
            return false;
        } catch (err) {
            console.error('Failed to load drafts', err);
            return false;
        } finally {
            setLoadingDrafts(false);
        }
    }, [scope, resolveOpsCovers]);

    useEffect(() => {
        let cancelled = false;
        let retryTimer: number | undefined;

        // O Electron cria a janela antes do servidor local terminar de abrir.
        // Sem nova tentativa, a Home fica vazia até o usuário trocar de página.
        const loadWithRetry = async (attempt: number) => {
            const loaded = await refreshDrafts();
            if (!loaded && !cancelled && attempt < 6) {
                retryTimer = window.setTimeout(() => void loadWithRetry(attempt + 1), 800);
            }
        };

        void loadWithRetry(0);
        return () => {
            cancelled = true;
            if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        };
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

    const beginRename = (event: React.MouseEvent, draft: DraftSummary) => {
        event.stopPropagation();
        setEditingId(draft.projectId);
        setEditingTitle(draft.title === 'Rascunho sem tÃ­tulo' ? '' : draft.title);
    };

    const cancelRename = (event?: React.SyntheticEvent) => {
        event?.stopPropagation();
        setEditingId(null);
        setEditingTitle('');
    };

    const handleRename = async (event: React.SyntheticEvent, id: string) => {
        event.preventDefault();
        event.stopPropagation();
        const title = editingTitle.trim();
        if (!title) {
            toast.error('Informe um tÃ­tulo para o rascunho.');
            return;
        }
        if (renamingId) return;

        setRenamingId(id);
        try {
            let existingData: UnknownRecord;
            if (scope === 'shared') {
                const result = await gatewayApi.sharedDraft(id);
                if (!result.ok || !isRecord(result.data)) throw new Error('NÃ£o foi possÃ­vel abrir o rascunho compartilhado.');
                existingData = result.data;
            } else {
                const response = await fetch(`${API_BASE}/api/projects/${id}`);
                const result = await response.json() as { ok?: boolean; data?: unknown; message?: string };
                if (!response.ok || !result.ok || !isRecord(result.data)) {
                    throw new Error(result.message || 'NÃ£o foi possÃ­vel abrir o rascunho local.');
                }
                existingData = result.data;
            }

            const existingAdData = isRecord(existingData.adData) ? existingData.adData : {};
            const nextData: UnknownRecord = {
                ...existingData,
                title,
                adData: { ...existingAdData, title },
                updatedAt: new Date().toISOString(),
                // Maior que uma revisÃ£o normal de autosave, evitando que uma
                // gravaÃ§Ã£o atrasada volte com o nome antigo.
                saveRevision: Date.now() * 1000,
            };

            if (scope === 'shared') {
                await gatewayApi.saveSharedDraft(id, title, nextData);
            } else {
                const response = await fetch(`${API_BASE}/api/projects/${id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: nextData }),
                });
                const result = await response.json() as { ok?: boolean; message?: string };
                if (!response.ok || !result.ok) throw new Error(result.message || 'NÃ£o foi possÃ­vel salvar o novo tÃ­tulo.');
            }

            setDrafts((previous) => previous.map((draft) => (
                draft.projectId === id ? { ...draft, title, updatedAt: nextData.updatedAt as string } : draft
            )));
            if (projectId === id && draftScope === scope) updateAdData({ title });
            cancelRename();
            toast.success('TÃ­tulo do rascunho atualizado.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel renomear o rascunho.');
        } finally {
            setRenamingId(null);
        }
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

    const handleDuplicate = async (event: React.MouseEvent, id: string) => {
        event.stopPropagation();
        if (duplicatingId || scope !== 'local') return;
        setDuplicatingId(id);
        try {
            const res = await fetch(`${API_BASE}/api/projects/${id}/duplicate`, { method: 'POST' });
            const json = await res.json();
            if (!json.ok) throw new Error(json.message || 'Falha ao duplicar');
            toast.success('Projeto duplicado.');
            await refreshDrafts();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erro ao duplicar');
        } finally {
            setDuplicatingId(null);
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
                            const isEditing = editingId === d.projectId;
                            const isRenaming = renamingId === d.projectId;
                            return (
                                <div
                                    key={d.projectId}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => handleResume(d.projectId)}
                                    onKeyDown={(e) => {
                                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                                            e.preventDefault();
                                            void handleResume(d.projectId);
                                        }
                                    }}
                                    className={cn(
                                        'group relative flex min-h-[166px] overflow-hidden rounded-2xl border border-border bg-card text-left transition-all cursor-pointer hover:border-brand-lime/50 hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(0,230,118,0.08)]',
                                        isLoading && 'opacity-60 pointer-events-none'
                                    )}
                                >
                                    <div className="relative aspect-[9/16] w-[84px] shrink-0 overflow-hidden bg-black sm:w-[94px]" aria-hidden="true">
                                        {d.cover?.type === 'image' ? (
                                            <img src={d.cover.url} alt="" className="h-full w-full object-cover" />
                                        ) : d.cover?.type === 'video' ? (
                                            <video
                                                src={`${d.cover.url}#t=0.001`}
                                                preload="metadata"
                                                muted
                                                playsInline
                                                onLoadedMetadata={(event) => {
                                                    // Solicita um frame real do vídeo para a capa, sem iniciar reprodução.
                                                    event.currentTarget.currentTime = 0.001;
                                                }}
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-brand-lime/10 via-foreground/[0.04] to-black">
                                                <Film className="h-7 w-7 text-muted-foreground/45" />
                                                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                                                    {d.mediaCount} take{d.mediaCount === 1 ? '' : 's'}
                                                </span>
                                            </div>
                                        )}
                                        {/* Play ao passar o mouse */}
                                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                                            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-black shadow-lg">
                                                <Play className="h-4 w-4 translate-x-[1px] fill-current" />
                                            </span>
                                        </div>
                                        {/* Duração */}
                                        {d.duration > 0 && (
                                            <span className="absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                                                {formatDuration(d.duration)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="min-w-0 flex flex-1 flex-col p-4">
                                        <div className="mb-3 flex items-start justify-between gap-2">
                                        {isEditing ? (
                                            <form
                                                className="flex min-w-0 flex-1 items-center gap-1"
                                                onClick={(event) => event.stopPropagation()}
                                                onSubmit={(event) => void handleRename(event, d.projectId)}
                                            >
                                                <input
                                                    autoFocus
                                                    value={editingTitle}
                                                    onChange={(event) => setEditingTitle(event.target.value)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Escape') cancelRename(event);
                                                    }}
                                                    aria-label="Título do rascunho"
                                                    className="min-w-0 flex-1 rounded-lg border border-brand-lime/50 bg-background px-2 py-1 text-sm font-bold text-foreground outline-none focus:border-brand-lime"
                                                />
                                                <button
                                                    type="submit"
                                                    disabled={isRenaming}
                                                    className="rounded-lg p-1.5 text-brand-lime transition-colors hover:bg-brand-lime/10 disabled:opacity-50"
                                                    title="Salvar título"
                                                    aria-label="Salvar título"
                                                >
                                                    {isRenaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={cancelRename}
                                                    disabled={isRenaming}
                                                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
                                                    title="Cancelar"
                                                    aria-label="Cancelar edição"
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </form>
                                        ) : (
                                            <h4 className="text-sm font-bold text-foreground line-clamp-2 leading-tight flex-1">
                                                {d.title}
                                            </h4>
                                        )}
                                        {!isEditing && (
                                            <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100">
                                                <button
                                                    type="button"
                                                    onClick={(event) => beginRename(event, d)}
                                                    className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-brand-lime/10 hover:text-brand-lime"
                                                    title="Editar título"
                                                    aria-label="Editar título"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </button>
                                                {scope === 'local' && (
                                                    <button
                                                        type="button"
                                                        onClick={(event) => void handleDuplicate(event, d.projectId)}
                                                        disabled={!!duplicatingId}
                                                        className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-brand-accent/10 hover:text-brand-accent disabled:opacity-50"
                                                        title="Duplicar projeto"
                                                        aria-label="Duplicar projeto"
                                                    >
                                                        {duplicatingId === d.projectId ? (
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        ) : (
                                                            <Copy className="h-3.5 w-3.5" />
                                                        )}
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(event) => handleDelete(event, d.projectId)}
                                                    disabled={!!deletingId}
                                                    className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                                                    title="Excluir rascunho"
                                                    aria-label="Excluir rascunho"
                                                >
                                                    {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                                </button>
                                            </div>
                                        )}
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

                                    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
                                        {d.exported ? (
                                            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-lime">
                                                <CheckCircle2 className="w-3 h-3" />
                                                Exportado
                                            </span>
                                        ) : (
                                            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400/80">
                                                <Clock className="w-3 h-3" />
                                                Em progresso
                                            </span>
                                        )}

                                        <div className="ml-auto flex shrink-0 items-center gap-2">
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
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
