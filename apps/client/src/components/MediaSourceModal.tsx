import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Building2,
    Check,
    CheckSquare,
    ChevronRight,
    FileImage,
    FileVideo,
    Folder,
    Grid2X2,
    HardDrive,
    List,
    Loader2,
    Square,
    Sparkles,
    Trash2,
    UploadCloud,
    UsersRound,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useWizard } from '../context/WizardContext';
import { API_BASE_URL } from '../lib/apiBase';
import { localAuthHeaders } from '../lib/serverAuth';
import { cn } from '../lib/utils';
import type { MediaTake } from '../types';
import { OpsLibrary } from './OpsLibrary';
import { useDownloadJobs } from '../context/DownloadJobsContext';
import { ConfirmDialog } from './ConfirmDialog';

type MediaKind = 'video' | 'image';
type Source = 'computer' | 'shared' | 'ops';

interface MediaSourceModalProps {
    kind: MediaKind;
    onClose: () => void;
}

interface SharedFile {
    id: string;
    name: string;
    relPath: string;
    publicUrl: string;
    filePath?: string;
    type: 'audio' | 'image' | 'video';
    durationSec?: number;
    size?: number;
}

interface SharedListing {
    ok: boolean;
    folders: Array<{ name: string; relPath: string }>;
    files: SharedFile[];
    message?: string;
}

const labelForKind = (kind: MediaKind) => kind === 'video' ? 'vídeos' : 'imagens';

const formatBytes = (value?: number) => {
    const bytes = Number(value || 0);
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const absoluteUrl = (url: string) => /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;

const readVideoDuration = (url: string) => new Promise<number>((resolve, reject) => {
    const video = document.createElement('video');
    const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
    };
    const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('Tempo limite ao ler a duração do vídeo.'));
    }, 15_000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        const duration = Number(video.duration || 0);
        cleanup();
        if (duration > 0) resolve(duration);
        else reject(new Error('Duração inválida.'));
    };
    video.onerror = () => {
        window.clearTimeout(timer);
        cleanup();
        reject(new Error('Não foi possível ler o vídeo.'));
    };
    video.src = url;
});

const SourceButton = ({
    active,
    icon,
    title,
    subtitle,
    onClick,
}: {
    active: boolean;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    onClick: () => void;
}) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            'group flex min-w-[190px] flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all',
            active
                ? 'border-brand-lime/40 bg-brand-lime/10 shadow-[0_0_24px_rgba(0,239,151,0.08)]'
                : 'border-white/8 bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.045]'
        )}
    >
        <span className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors',
            active ? 'bg-brand-lime text-[#07110d]' : 'bg-white/6 text-brand-muted group-hover:text-foreground'
        )}>
            {icon}
        </span>
        <span className="min-w-0">
            <span className="block text-xs font-black text-foreground">{title}</span>
            <span className="mt-0.5 block text-[10px] text-brand-muted">{subtitle}</span>
        </span>
        {active && <Check className="ml-auto h-4 w-4 shrink-0 text-brand-lime" />}
    </button>
);

const LibrarySource = ({ kind, scope, onPicked }: { kind: MediaKind; scope: 'local' | 'shared'; onPicked: () => void }) => {
    const { addMediaTakes } = useWizard();
    const { registerClientJob, updateClientJob } = useDownloadJobs();
    const category = kind === 'video' ? 'Vídeos' : 'Imagens';
    const [path, setPath] = useState(category);
    const [listing, setListing] = useState<SharedListing | null>(null);
    const [loading, setLoading] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    const load = useCallback(async (nextPath: string) => {
        setLoading(true);
        try {
            const headers = scope === 'shared' ? await localAuthHeaders() : undefined;
            const endpoint = scope === 'shared' ? '/api/shared/files/list' : '/api/files/list';
            const response = await fetch(`${API_BASE_URL}${endpoint}?path=${encodeURIComponent(nextPath)}`, { headers });
            const result: SharedListing = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.message || `Falha ao abrir a biblioteca ${scope === 'shared' ? 'compartilhada' : 'local'}.`);
            setPath(nextPath);
            setListing({ ...result, files: (result.files || []).filter((file) => file.type === kind) });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : `Não foi possível abrir a biblioteca ${scope === 'shared' ? 'compartilhada' : 'local'}.`);
        } finally {
            setLoading(false);
        }
    }, [kind, scope]);

    useEffect(() => {
        void load(category);
    }, [category, load]);

    const breadcrumbs = useMemo(() => path.split('/').filter(Boolean), [path]);
    const rootPath = path === 'Geração por IA' || path.startsWith('Geração por IA/') ? 'Geração por IA' : category;
    const selectedFiles = useMemo(
        () => (listing?.files || []).filter((file) => selectedIds.has(file.id || file.relPath)),
        [listing?.files, selectedIds]
    );

    useEffect(() => {
        setSelectionMode(false);
        setSelectedIds(new Set());
    }, [path]);

    const toggleFile = (file: SharedFile) => {
        const id = file.id || file.relPath;
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const confirmSelection = () => {
        if (!selectedFiles.length) return;
        const batch = [...selectedFiles];
        const total = batch.length;
        const activityId = registerClientJob({
            mode: kind,
            title: `${total} ${total === 1 ? (kind === 'image' ? 'imagem' : 'vídeo') : kind === 'image' ? 'imagens' : 'vídeos'}`,
            destination: 'Projeto atual',
            source: 'editor-import',
            statusText: `Lendo biblioteca ${scope === 'shared' ? 'compartilhada' : 'local'}`,
        });
        onPicked();

        void (async () => {
            let completed = 0;
            const takes: MediaTake[] = [];
            const failures: unknown[] = [];
            for (const file of batch) {
                try {
                    const sourceUrl = absoluteUrl(file.publicUrl);
                    let previewUrl = sourceUrl;
                    if (kind === 'video' && scope === 'local' && file.relPath) {
                        const previewResponse = await fetch(`${API_BASE_URL}/api/files/preview-source`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ relPath: file.relPath }),
                        });
                        const preview = await previewResponse.json();
                        if (!previewResponse.ok || !preview.ok || !preview.publicUrl) {
                            throw new Error(preview.message || 'Falha ao preparar o vídeo para o editor.');
                        }
                        previewUrl = absoluteUrl(preview.publicUrl);
                    }
                    const duration = kind === 'image'
                        ? Number(file.durationSec || 3.5)
                        : Number(file.durationSec || 0) || await readVideoDuration(previewUrl);
                    takes.push({
                        id: crypto.randomUUID(),
                        ...(scope === 'shared' && file.id ? { sharedAssetId: file.id } : {}),
                        fileName: file.name,
                        originalDurationSeconds: duration,
                        url: sourceUrl,
                        fileUrl: sourceUrl,
                        proxyUrl: previewUrl,
                        ...(scope === 'local' && file.filePath ? { backendPath: file.filePath } : {}),
                        type: kind,
                        trim: { start: 0, end: duration },
                    });
                } catch (error) {
                    failures.push(error);
                } finally {
                    completed += 1;
                    const percent = Math.round((completed / total) * 100);
                    updateClientJob(activityId, { percent, stepPercent: percent });
                }
            }
            if (takes.length) addMediaTakes(takes);
            updateClientJob(activityId, takes.length ? {
                phase: 'done',
                percent: 100,
                stepPercent: 100,
                completedAt: Date.now(),
                statusText: failures.length ? `${takes.length} adicionada(s), ${failures.length} falhou(aram)` : 'Adicionado ao projeto',
            } : {
                phase: 'error',
                completedAt: Date.now(),
                error: 'Não foi possível ler as mídias selecionadas.',
            });
        })();
    };

    const deleteSelection = async () => {
        if (!selectedFiles.length || deleting) return;
        const batch = [...selectedFiles];
        setConfirmDelete(false);
        setDeleting(true);
        const settled = await Promise.allSettled(batch.map(async (file) => {
            const headers = scope === 'shared'
                ? await localAuthHeaders()
                : { 'Content-Type': 'application/json' };
            const endpoint = scope === 'shared'
                ? `${API_BASE_URL}/api/shared/files/item/${encodeURIComponent(file.id)}`
                : `${API_BASE_URL}/api/files/item`;
            const response = await fetch(endpoint, {
                method: 'DELETE',
                headers,
                ...(scope === 'local'
                    ? { body: JSON.stringify(file.id ? { id: file.id } : { relPath: file.relPath }) }
                    : {}),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.message || `Falha ao apagar ${file.name}.`);
        }));
        const failed = settled.filter((result) => result.status === 'rejected').length;
        const removed = batch.length - failed;
        setSelectedIds(new Set());
        if (removed) toast.success(scope === 'shared'
            ? `${removed} item(ns) enviado(s) para a lixeira.`
            : `${removed} item(ns) apagado(s) do computador.`);
        if (failed) toast.error(`${failed} item(ns) não puderam ser apagados.`);
        await load(path);
        setDeleting(false);
    };

    const uploadLocalFiles = async (files: FileList | null) => {
        if (scope !== 'local' || !files?.length) return;
        setUploading(true);
        const batch = Array.from(files);
        const activityId = registerClientJob({
            mode: kind,
            title: `Enviando ${batch.length} arquivo(s) ao Meu computador`,
            destination: path,
            source: 'editor-import',
            statusText: 'Salvando na biblioteca local',
        });
        let completed = 0;
        const settled = await Promise.allSettled(batch.map(async (file) => {
            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('parent', path);
                const response = await fetch(`${API_BASE_URL}/api/files/upload`, { method: 'POST', body: formData });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.ok) throw new Error(result.message || `Falha ao enviar ${file.name}.`);
            } finally {
                completed += 1;
                const percent = Math.round((completed / batch.length) * 100);
                updateClientJob(activityId, { percent, stepPercent: percent });
            }
        }));
        const failures = settled.filter((result) => result.status === 'rejected');
        updateClientJob(activityId, failures.length === batch.length ? {
            phase: 'error', completedAt: Date.now(), error: 'Nenhum arquivo pôde ser salvo na biblioteca local.',
        } : {
            phase: 'done', percent: 100, stepPercent: 100, completedAt: Date.now(), statusText: failures.length ? 'Envio concluído parcialmente' : 'Salvo em Meu computador',
        });
        setUploading(false);
        await load(path);
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/7 px-5 py-3">
                <div className="flex min-w-0 items-center gap-1 text-xs">
                    <button onClick={() => void load(rootPath)} className="rounded-lg px-2 py-1.5 font-bold text-brand-lime hover:bg-brand-lime/10">{rootPath}</button>
                    {breadcrumbs.slice(1).map((part, index) => {
                        const target = breadcrumbs.slice(0, index + 2).join('/');
                        return (
                            <span key={target} className="flex min-w-0 items-center gap-1">
                                <ChevronRight className="h-3.5 w-3.5 text-brand-muted" />
                                <button onClick={() => void load(target)} className="max-w-[180px] truncate rounded-lg px-2 py-1.5 text-foreground/70 hover:bg-white/5 hover:text-foreground">{part}</button>
                            </span>
                        );
                    })}
                </div>
                <div className="flex items-center gap-2">
                    {scope === 'local' && (
                        <button
                            type="button"
                            onClick={() => void load(path === 'Geração por IA' ? category : 'Geração por IA')}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-black transition',
                                path === 'Geração por IA'
                                    ? 'border-violet-400/30 bg-violet-400/10 text-violet-200'
                                    : 'border-white/10 bg-white/[0.035] text-foreground/70 hover:border-violet-400/25 hover:text-violet-200'
                            )}
                            title="Abrir mídias criadas pelos agentes"
                        >
                            <Sparkles className="h-3.5 w-3.5" />
                            {path === 'Geração por IA' ? `Voltar para ${category}` : 'Geração por IA'}
                        </button>
                    )}
                    {scope === 'local' && (
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] font-black text-foreground/70 transition hover:border-brand-lime/25 hover:text-brand-lime">
                            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                            Enviar do PC
                            <input
                                type="file"
                                multiple
                                disabled={uploading}
                                accept={kind === 'video' ? '.mp4,.mov,.avi,.mkv,.webm,.m4v' : '.jpg,.jpeg,.png,.webp,.gif,.bmp'}
                                className="hidden"
                                onChange={(event) => {
                                    void uploadLocalFiles(event.target.files);
                                    event.currentTarget.value = '';
                                }}
                            />
                        </label>
                    )}
                    {(listing?.files.length || 0) > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                setSelectionMode((active) => !active);
                                setSelectedIds(new Set());
                            }}
                            className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-black', selectionMode ? 'border-brand-lime/30 bg-brand-lime/10 text-brand-lime' : 'border-white/10 text-brand-muted hover:text-foreground')}
                        >
                            {selectionMode ? <X className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
                            {selectionMode ? 'Cancelar' : 'Selecionar'}
                        </button>
                    )}
                    <div className="flex rounded-lg border border-white/10 bg-black/15 p-1">
                        <button onClick={() => setViewMode('grid')} className={cn('rounded-md p-1.5', viewMode === 'grid' ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted')} title="Grade"><Grid2X2 className="h-4 w-4" /></button>
                        <button onClick={() => setViewMode('list')} className={cn('rounded-md p-1.5', viewMode === 'list' ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted')} title="Lista"><List className="h-4 w-4" /></button>
                    </div>
                </div>
            </div>

            {selectionMode && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-lime/15 bg-brand-lime/[0.045] px-5 py-2.5">
                    <button
                        type="button"
                        onClick={() => setSelectedIds(
                            selectedFiles.length === (listing?.files.length || 0)
                                ? new Set()
                                : new Set((listing?.files || []).map((file) => file.id || file.relPath))
                        )}
                        className="inline-flex items-center gap-2 text-[11px] font-bold text-foreground/75"
                    >
                        {selectedFiles.length === (listing?.files.length || 0) ? <CheckSquare className="h-4 w-4 text-brand-lime" /> : <Square className="h-4 w-4" />}
                        {selectedFiles.length === (listing?.files.length || 0) ? 'Desmarcar todos' : 'Selecionar todos'}
                    </button>
                    <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-brand-muted">{selectedFiles.length} selecionado(s)</span>
                        <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            disabled={!selectedFiles.length || deleting}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] font-black text-red-400 transition hover:bg-red-500/15 disabled:opacity-35"
                        >
                            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            Apagar {selectedFiles.length || ''}
                        </button>
                        <button onClick={confirmSelection} disabled={!selectedFiles.length} className="rounded-lg bg-brand-lime px-3 py-2 text-[10px] font-black text-[#06110c] disabled:opacity-35">
                            Adicionar {selectedFiles.length || ''} ao projeto
                        </button>
                    </div>
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 custom-scrollbar" data-media-scroll-region="true">
                {loading ? (
                    <div className="grid h-full place-items-center text-brand-lime"><Loader2 className="h-7 w-7 animate-spin" /></div>
                ) : !listing || (!listing.folders.length && !listing.files.length) ? (
                    <div className="grid h-full place-items-center text-center">
                        <div>
                            <Folder className="mx-auto h-12 w-12 text-brand-muted/30" />
                            <p className="mt-3 text-sm font-bold text-foreground">Esta pasta está vazia</p>
                            <p className="mt-1 text-xs text-brand-muted">Nenhum arquivo compatível foi encontrado.</p>
                        </div>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
                        {listing.folders.map((folder) => (
                            <button key={folder.relPath} onClick={() => void load(folder.relPath)} className="group flex min-h-[155px] flex-col justify-between rounded-2xl border border-white/8 bg-white/[0.025] p-4 text-left transition hover:border-brand-lime/25 hover:bg-brand-lime/[0.035]">
                                <Folder className="h-10 w-10 fill-brand-lime/10 text-brand-lime/70" />
                                <span className="mt-5 truncate text-xs font-bold text-foreground">{folder.name}</span>
                            </button>
                        ))}
                        {listing.files.map((file) => (
                            <article key={file.id || file.relPath} className={cn('group overflow-hidden rounded-2xl border bg-white/[0.025] transition', selectedIds.has(file.id || file.relPath) ? 'border-brand-lime/50 ring-1 ring-brand-lime/20' : 'border-white/8 hover:border-brand-lime/25')}>
                                <div className="relative aspect-video overflow-hidden bg-black/30">
                                    {kind === 'image' ? (
                                        <img src={absoluteUrl(file.publicUrl)} alt="" className="h-full w-full object-cover" loading="lazy" />
                                    ) : (
                                        <video src={absoluteUrl(file.publicUrl)} className="h-full w-full object-cover" preload="metadata" muted />
                                    )}
                                    <span className="absolute left-2 top-2 rounded-md bg-black/65 px-1.5 py-1 text-white">
                                        {kind === 'image' ? <FileImage className="h-3.5 w-3.5" /> : <FileVideo className="h-3.5 w-3.5" />}
                                    </span>
                                    {selectionMode && (
                                        <button type="button" onClick={() => toggleFile(file)} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-black/75 text-white shadow-lg">
                                            {selectedIds.has(file.id || file.relPath) ? <CheckSquare className="h-4 w-4 text-brand-lime" /> : <Square className="h-4 w-4" />}
                                        </button>
                                    )}
                                </div>
                                <div className="p-3">
                                    <p className="truncate text-xs font-bold text-foreground" title={file.name}>{file.name}</p>
                                    <div className="mt-2 flex items-center justify-between gap-2">
                                        <span className="text-[10px] text-brand-muted">{formatBytes(file.size)}</span>
                                        {selectionMode && <span className="text-[10px] font-bold text-brand-lime">{selectedIds.has(file.id || file.relPath) ? 'Selecionado' : 'Marque acima'}</span>}
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-white/8">
                        {listing.folders.map((folder) => (
                            <button key={folder.relPath} onClick={() => void load(folder.relPath)} className="flex w-full items-center gap-3 border-b border-white/6 px-4 py-3 text-left hover:bg-white/4">
                                <Folder className="h-5 w-5 text-brand-lime/70" /><span className="min-w-0 flex-1 truncate text-xs font-bold text-foreground">{folder.name}</span><ChevronRight className="h-4 w-4 text-brand-muted" />
                            </button>
                        ))}
                        {listing.files.map((file) => (
                            <div key={file.id || file.relPath} className={cn('flex items-center gap-3 border-b border-white/6 px-4 py-3 last:border-b-0', selectedIds.has(file.id || file.relPath) ? 'bg-brand-lime/[0.055]' : 'hover:bg-white/[0.025]')}>
                                {selectionMode && (
                                    <button type="button" onClick={() => toggleFile(file)} className="text-brand-muted hover:text-foreground">
                                        {selectedIds.has(file.id || file.relPath) ? <CheckSquare className="h-4 w-4 text-brand-lime" /> : <Square className="h-4 w-4" />}
                                    </button>
                                )}
                                {kind === 'image' ? <FileImage className="h-5 w-5 text-violet-300" /> : <FileVideo className="h-5 w-5 text-brand-lime" />}
                                <span className="min-w-0 flex-1 truncate text-xs font-bold text-foreground">{file.name}</span>
                                <span className="text-[10px] text-brand-muted">{formatBytes(file.size)}</span>
                                {selectionMode && <span className="text-[10px] font-bold text-brand-lime">{selectedIds.has(file.id || file.relPath) ? 'Selecionado' : 'Marcar'}</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {confirmDelete && (
                <ConfirmDialog
                    mode="confirm"
                    title={`Apagar ${selectedFiles.length} ${selectedFiles.length === 1 ? 'arquivo' : 'arquivos'}?`}
                    message={scope === 'shared'
                        ? 'Os itens irão para a lixeira compartilhada e poderão ser restaurados durante o período de retenção.'
                        : 'Os itens serão removidos da biblioteca local deste computador. Essa ação também invalida o uso desses arquivos em projetos.'}
                    confirmLabel={scope === 'shared' ? 'Enviar à lixeira' : 'Apagar arquivos'}
                    onClose={() => setConfirmDelete(false)}
                    onConfirm={() => void deleteSelection()}
                />
            )}
        </div>
    );
};

export const MediaSourceModal = ({ kind, onClose }: MediaSourceModalProps) => {
    const [source, setSource] = useState<Source>('computer');

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[#020607]/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={`Adicionar ${labelForKind(kind)}`}>
            <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0 cursor-default" />
            <section className="relative z-10 flex h-[min(86vh,880px)] w-[min(94vw,1320px)] flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#0a1013] shadow-[0_35px_120px_rgba(0,0,0,0.72),0_0_0_1px_rgba(0,239,151,0.025)]">
                <header className="border-b border-white/8 bg-gradient-to-r from-brand-lime/[0.06] via-transparent to-violet-500/[0.06] px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-brand-lime">
                                {kind === 'video' ? <FileVideo className="h-4 w-4" /> : <FileImage className="h-4 w-4" />}
                                Adicionar ao projeto
                            </div>
                            <h2 className="mt-2 text-2xl font-black text-foreground">Escolha a origem dos {labelForKind(kind)}</h2>
                            <p className="mt-1 text-xs text-brand-muted">O arquivo original permanece no ambiente escolhido.</p>
                        </div>
                        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-white/8 bg-white/5 text-brand-muted transition hover:bg-white/10 hover:text-foreground" title="Fechar">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                        <SourceButton active={source === 'computer'} icon={<HardDrive className="h-5 w-5" />} title="Meu computador" subtitle="Arquivos deste PC" onClick={() => setSource('computer')} />
                        <SourceButton active={source === 'shared'} icon={<UsersRound className="h-5 w-5" />} title="Compartilhado" subtitle="Biblioteca da equipe" onClick={() => setSource('shared')} />
                        <SourceButton active={source === 'ops'} icon={<Building2 className="h-5 w-5" />} title="Mileto Ops" subtitle="Empresas autorizadas" onClick={() => setSource('ops')} />
                    </div>
                </header>

                <div className="min-h-0 flex-1 overflow-hidden">
                    {source === 'computer' && <LibrarySource kind={kind} scope="local" onPicked={onClose} />}
                    {source === 'shared' && <LibrarySource kind={kind} scope="shared" onPicked={onClose} />}
                    {source === 'ops' && <div className="h-full min-h-0 overflow-hidden p-4"><OpsLibrary pickerKind={kind} onPicked={onClose} /></div>}
                </div>
            </section>
        </div>,
        document.body
    );
};

export default MediaSourceModal;
