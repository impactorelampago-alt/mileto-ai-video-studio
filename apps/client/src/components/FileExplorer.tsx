import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    FolderOpen, Folder, FileVideo, FileImage, FileMusic, ChevronDown, ChevronRight,
    Plus, Upload, ArrowDownToLine, Pencil, Scissors, Copy, Trash2, X, Loader2,
    CheckSquare, Square, Check, Play, LayoutGrid, List, HardDrive, Users, RotateCcw, Building2, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { API_BASE_URL as API } from '../lib/apiBase';
import { DownloadModal } from './DownloadModal';
import { ConfirmDialog } from './ConfirmDialog';
import { cn } from '../lib/utils';
import { localAuthHeaders } from '../lib/serverAuth';
import { useDownloadJobs } from '../context/DownloadJobsContext';
import { OpsLibrary } from './OpsLibrary';

// ─── Tipos (espelho do fileExplorerController) ────────────────────────────

interface FileNode {
    name: string;
    relPath: string;
    isCategory: boolean;
    children: FileNode[];
}

interface FileEntry {
    id: string;
    category: string;
    name: string;
    relPath: string;
    publicUrl: string;
    filePath?: string;
    type: 'audio' | 'image' | 'video';
    durationSec?: number;
    createdAt: string;
    size?: number;
    assetCode?: string;
    trashedAt?: string;
    purgeAfter?: string;
    aiGeneration?: {
        conversationId?: string;
        conversationTitle?: string;
        prompt?: string;
        provider?: string;
        model?: string;
        createdAt?: string;
    };
}

interface ListResponse {
    ok: boolean;
    folders: Array<{ name: string; relPath: string }>;
    files: FileEntry[];
    message?: string;
}

interface ClipboardImportResponse {
    ok: boolean;
    imported?: number;
    errors?: string[];
    noFiles?: boolean;
    message?: string;
}

const CATEGORY_LABEL: Record<string, string> = {
    Músicas: 'Músicas', Imagens: 'Imagens', Vídeos: 'Vídeos', 'Geração por IA': 'Geração por IA',
};
const DEFAULT_CATEGORY_NAMES = new Set(['Imagens', 'Músicas', 'Vídeos', 'Geração por IA']);

const ABSOLUTE_URL = (publicUrl: string) => /^https?:\/\//i.test(publicUrl) ? publicUrl : `${API}${publicUrl}`;

const ExplorerFolderTree = ({
    root,
    currentPath,
    onOpen,
}: {
    root: FileNode | null;
    currentPath: string;
    onOpen: (path: string) => void;
}) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']));

    useEffect(() => {
        const parts = currentPath.split('/').filter(Boolean);
        const ancestors = new Set<string>(['/']);
        let cursor = '';
        for (const part of parts) {
            cursor = cursor ? `${cursor}/${part}` : part;
            ancestors.add(cursor);
        }
        setExpanded((previous) => new Set([...previous, ...ancestors]));
    }, [currentPath]);

    if (!root) return <div className="px-3 py-4 text-xs text-brand-muted">Carregando pastas...</div>;

    const renderNode = (node: FileNode, depth: number) => {
        const pathValue = node.relPath === '/' ? '' : node.relPath;
        const open = expanded.has(node.relPath);
        const hasChildren = node.children.length > 0;
        const active = currentPath === pathValue;
        return (
            <div key={node.relPath || '/'}>
                <div
                    className={cn(
                        'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
                        active ? 'bg-brand-lime/12 text-brand-lime' : 'text-foreground/70 hover:bg-white/5 hover:text-foreground'
                    )}
                    style={{ paddingLeft: `${Math.max(4, depth * 14 + 4)}px` }}
                >
                    <button
                        type="button"
                        className="grid h-7 w-6 shrink-0 place-items-center rounded-md text-brand-muted hover:bg-white/6 hover:text-foreground"
                        onClick={() => hasChildren && setExpanded((previous) => {
                            const next = new Set(previous);
                            if (next.has(node.relPath)) next.delete(node.relPath);
                            else next.add(node.relPath);
                            return next;
                        })}
                        aria-label={open ? 'Recolher pasta' : 'Expandir pasta'}
                    >
                        {hasChildren ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="h-3.5 w-3.5" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            onOpen(pathValue);
                            if (hasChildren) setExpanded((previous) => new Set(previous).add(node.relPath));
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-[11px] font-bold"
                    >
                        {active ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0 text-brand-lime/65" />}
                        <span className="truncate">{pathValue ? (CATEGORY_LABEL[node.name] || node.name) : 'Arquivos'}</span>
                    </button>
                </div>
                {open && node.children.map((child) => renderNode(child, depth + 1))}
            </div>
        );
    };

    return <div className="space-y-0.5">{renderNode(root, 0)}</div>;
};

// ─── Componente ────────────────────────────────────────────────────────────

export const FileExplorer = () => {
    const [scope, setScope] = useState<'local' | 'shared' | 'ops'>('local');
    const [showingTrash, setShowingTrash] = useState(false);
    const [tree, setTree] = useState<FileNode | null>(null);
    const [currentPath, setCurrentPath] = useState('');
    const [listing, setListing] = useState<ListResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [isDownloadOpen, setIsDownloadOpen] = useState(false);
    const [renaming, setRenaming] = useState<FileEntry | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [moving, setMoving] = useState<FileEntry[] | null>(null); // 1 ou vários
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [preview, setPreview] = useState<FileEntry | null>(null);
    const [busy, setBusy] = useState(false);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const dragDepthRef = useRef(0);
    const completedDownloadIdsRef = useRef(new Set<string>());
    const { jobs: downloadJobs } = useDownloadJobs();
    const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards'); // cards (grid) por padrão
    const [aiLibraryFilter, setAiLibraryFilter] = useState('all');
    // Diálogo de confirmação/prompt unificado (premium). Null = fechado.
    const [dialog, setDialog] = useState<
        | { kind: 'createFolder' }
        | { kind: 'delete'; files: FileEntry[] }
        | null
    >(null);

    const apiPath = useCallback(
        (suffix: string) => `${API}/api/${scope === 'shared' ? 'shared/files' : 'files'}${suffix}`,
        [scope]
    );

    const scopedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
        const authHeaders = scope === 'shared' ? await localAuthHeaders() : {};
        return fetch(url, { ...init, headers: { ...authHeaders, ...(init.headers || {}) } });
    }, [scope]);

    const refreshTree = useCallback(async () => {
        try {
            const res = await scopedFetch(apiPath('/tree'));
            const data = await res.json();
            if (data.ok) setTree(data.root);
        } catch {
            toast.error('Falha ao carregar pastas.');
        }
    }, [apiPath, scopedFetch]);

    const openFolder = useCallback(async (relPath: string) => {
        setCurrentPath(relPath);
        setShowingTrash(false);
        setSelectedIds(new Set()); // trocou de pasta: limpa seleção
        setLoading(true);
        try {
            const res = await scopedFetch(`${apiPath('/list')}?path=${encodeURIComponent(relPath)}`);
            const data: ListResponse = await res.json();
            if (data.ok) setListing(data);
            else toast.error(data.message || 'Falha ao listar.');
        } catch {
            toast.error('Falha ao listar arquivos.');
        } finally {
            setLoading(false);
        }
    }, [apiPath, scopedFetch]);

    const openTrash = useCallback(async () => {
        if (scope !== 'shared') return;
        setShowingTrash(true);
        setCurrentPath('');
        setSelectedIds(new Set());
        setLoading(true);
        try {
            const res = await scopedFetch(apiPath('/trash'));
            const data = await res.json();
            if (!data.ok) throw new Error(data.message);
            setListing({ ok: true, folders: [], files: data.files || [] });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Falha ao abrir a lixeira.');
        } finally {
            setLoading(false);
        }
    }, [apiPath, scope, scopedFetch]);

    useEffect(() => {
        setCurrentPath('');
        setShowingTrash(false);
        if (scope === 'ops') {
            setListing(null);
            setTree(null);
            return;
        }
        void refreshTree();
        void openFolder('');
    }, [scope, refreshTree, openFolder]);

    useEffect(() => {
        setAiLibraryFilter('all');
    }, [currentPath, scope]);

    useEffect(() => {
        const completedIds = downloadJobs
            .filter((job) => job.phase === 'done' && job.track)
            .map((job) => job.id);
        const hasNewCompletion = completedIds.some((id) => !completedDownloadIdsRef.current.has(id));
        completedDownloadIdsRef.current = new Set(completedIds);
        if (hasNewCompletion && scope === 'local') {
            void Promise.all([openFolder(currentPath), refreshTree()]);
        }
    }, [currentPath, downloadJobs, openFolder, refreshTree, scope]);

    // ─── Seleção ──────────────────────────────────────────────────────────

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const isAiLibrary = scope === 'local'
        && (currentPath === 'Geração por IA' || currentPath.startsWith('Geração por IA/'));
    const aiConversations = useMemo(() => {
        const conversations = new Map<string, string>();
        if (!isAiLibrary) return [];
        for (const file of listing?.files || []) {
            const id = file.aiGeneration?.conversationId;
            if (!id) continue;
            conversations.set(id, file.aiGeneration?.conversationTitle?.trim() || `Conversa ${id.slice(0, 8)}`);
        }
        return Array.from(conversations, ([id, label]) => ({ id, label }));
    }, [isAiLibrary, listing?.files]);
    const visibleFiles = useMemo(() => {
        const files = listing?.files || [];
        if (!isAiLibrary || aiLibraryFilter === 'all') return files;
        if (aiLibraryFilter === 'video' || aiLibraryFilter === 'image') {
            return files.filter((file) => file.type === aiLibraryFilter);
        }
        if (aiLibraryFilter.startsWith('conversation:')) {
            const conversationId = aiLibraryFilter.slice('conversation:'.length);
            return files.filter((file) => file.aiGeneration?.conversationId === conversationId);
        }
        return files;
    }, [aiLibraryFilter, isAiLibrary, listing?.files]);

    const allFileIds = visibleFiles.map((f) => f.id);
    const allSelected = allFileIds.length > 0 && allFileIds.every((id) => selectedIds.has(id));

    const toggleSelectAll = () => {
        if (allSelected) {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                allFileIds.forEach((id) => next.delete(id));
                return next;
            });
        } else {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                allFileIds.forEach((id) => next.add(id));
                return next;
            });
        }
    };

    const selectedFiles: FileEntry[] = listing?.files.filter((f) => selectedIds.has(f.id)) ?? [];

    const shareLocalFiles = async (files: FileEntry[]) => {
        if (scope !== 'local' || files.length === 0) return;
        setBusy(true);
        let shared = 0;
        let reused = 0;
        const headers = { ...(await localAuthHeaders()), 'Content-Type': 'application/json' };
        for (const file of files) {
            try {
                const response = await fetch(`${API}/api/shared/files/import-local`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        sourceUrl: ABSOLUTE_URL(file.publicUrl),
                        backendPath: file.filePath,
                        name: file.name,
                        parent: file.category,
                    }),
                });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.message);
                shared++;
                if (result.deduplicated) reused++;
            } catch (error) {
                toast.error(error instanceof Error ? error.message : `Falha ao compartilhar ${file.name}.`);
            }
        }
        setBusy(false);
        setSelectedIds(new Set());
        if (shared) {
            toast.success(
                `${shared} arquivo(s) compartilhado(s), mantendo a cópia local${reused ? `; ${reused} sem duplicar espaço no R2` : ''}.`
            );
        }
    };

    // ─── Ações unitárias ──────────────────────────────────────────────────

    const handleCreateFolder = (name: string) => {
        void doCreateFolder(name);
    };
    const doCreateFolder = async (name: string) => {
        if (scope === 'shared' && !currentPath) {
            toast.error('Escolha Imagens, Músicas, Vídeos ou Geração por IA antes de criar uma subpasta.');
            return;
        }
        try {
            const res = await scopedFetch(apiPath('/folder'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent: currentPath, name }),
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.message);
            toast.success('Pasta criada.');
            void refreshTree();
            void openFolder(currentPath);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Erro ao criar pasta.');
        }
    };

    const uploadFiles = useCallback(async (files: File[]) => {
        if (files.length === 0 || busy || showingTrash) return;
        if (scope === 'shared' && !currentPath) {
            toast.error('Escolha Imagens, Músicas, Vídeos ou Geração por IA antes de enviar.');
            return;
        }

        setBusy(true);
        let sent = 0;
        let deduplicated = 0;
        const failures: string[] = [];

        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('parent', currentPath);
            try {
                const response = await scopedFetch(apiPath('/upload'), { method: 'POST', body: formData });
                const responseText = await response.text();
                let data: { ok?: boolean; deduplicated?: boolean; message?: string };
                try {
                    data = JSON.parse(responseText);
                } catch {
                    throw new Error('O servidor local precisa ser reiniciado para receber arquivos.');
                }
                if (!response.ok || !data.ok) throw new Error(data.message || 'Falha no envio.');
                sent++;
                if (data.deduplicated) deduplicated++;
            } catch (error) {
                failures.push(`${file.name}: ${error instanceof Error ? error.message : 'falha no envio'}`);
            }
        }

        setBusy(false);
        if (sent > 0) {
            toast.success(
                sent === 1
                    ? `"${files.find((file) => !failures.some((failure) => failure.startsWith(`${file.name}:`)))?.name || 'Arquivo'}" enviado.`
                    : `${sent} arquivos enviados${deduplicated ? ` (${deduplicated} sem duplicar espaço)` : ''}.`
            );
            await Promise.all([openFolder(currentPath), refreshTree()]);
        }
        if (failures.length > 0) {
            const firstFailure = failures[0];
            toast.error(
                failures.length === 1
                    ? firstFailure
                    : `${failures.length} arquivo(s) não puderam ser enviados. ${firstFailure}`
            );
        }
    }, [apiPath, busy, currentPath, openFolder, refreshTree, scope, scopedFetch, showingTrash]);

    const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        void uploadFiles(files);
    };

    const pasteFilesFromExplorer = useCallback(async () => {
        if (scope !== 'local' || busy || showingTrash) return;
        try {
            const electronRequire = (window as Window & { require?: (module: string) => unknown }).require;
            if (!electronRequire) return;
            const electron = electronRequire('electron') as {
                ipcRenderer?: { invoke: (channel: string, parent: string) => Promise<ClipboardImportResponse> };
            };
            if (!electron.ipcRenderer) return;

            setBusy(true);
            const result = await electron.ipcRenderer.invoke('files:paste-from-clipboard', currentPath);
            if (result.noFiles) return;
            if (!result.ok) throw new Error(result.message || 'Não foi possível colar os arquivos.');

            const imported = Number(result.imported || 0);
            if (imported > 0) {
                toast.success(imported === 1 ? 'Arquivo colado nesta pasta.' : `${imported} arquivos colados nesta pasta.`);
                await Promise.all([openFolder(currentPath), refreshTree()]);
            }
            if (result.errors?.length) {
                toast.warning(`${result.errors.length} item(ns) ignorado(s). ${result.errors[0]}`);
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível colar os arquivos.');
        } finally {
            setBusy(false);
        }
    }, [busy, currentPath, openFolder, refreshTree, scope, showingTrash]);

    useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (
                target?.matches('input, textarea, select') ||
                target?.isContentEditable ||
                busy ||
                showingTrash
            ) return;

            const clipboardFiles = Array.from(event.clipboardData?.files || []);
            if (clipboardFiles.length > 0) {
                event.preventDefault();
                void uploadFiles(clipboardFiles);
                return;
            }

            if (scope === 'local') void pasteFilesFromExplorer();
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [busy, pasteFilesFromExplorer, scope, showingTrash, uploadFiles]);

    const canReceiveFiles = !busy && !showingTrash && !(scope === 'shared' && !currentPath);

    const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
        if (!canReceiveFiles || !Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        dragDepthRef.current++;
        setIsDraggingFiles(true);
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = canReceiveFiles ? 'copy' : 'none';
    };

    const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        if (!isDraggingFiles) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDraggingFiles(false);
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        if (!canReceiveFiles) return;
        void uploadFiles(Array.from(event.dataTransfer.files));
    };

    const handleRename = async () => {
        if (!renaming) return;
        const name = renameValue.trim();
        if (!name) return;
        try {
            const res = await scopedFetch(apiPath('/rename'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: renaming.id, name }),
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.message);
            toast.success('Renomeado.');
            setRenaming(null);
            void openFolder(currentPath);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Erro ao renomear.');
        }
    };

    // ─── Ações em lote (mover/copiar/excluir) ──────────────────────────────

    const handleMoveBatch = async (destPath: string) => {
        if (!moving) return;
        setBusy(true);
        let ok = 0;
        let projects = 0;
        for (const f of moving) {
            try {
                const res = await scopedFetch(apiPath('/move'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: f.id, destPath }),
                });
                const data = await res.json();
                if (data.ok) { ok++; projects += data.projectsUpdated || 0; }
            } catch { /* continua nos próximos */ }
        }
        setBusy(false);
        setMoving(null);
        setSelectedIds(new Set());
        toast.success(`${ok} de ${moving.length} movido(s)${projects ? ` (${projects} projeto(s) atualizado(s))` : ''}.`);
        void openFolder(currentPath);
    };

    const handleCopyBatch = async (destPath: string) => {
        if (!moving) return;
        setBusy(true);
        let ok = 0;
        for (const f of moving) {
            try {
                const res = await scopedFetch(apiPath('/copy'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: f.id, destPath }),
                });
                const data = await res.json();
                if (data.ok) ok++;
            } catch { /* continua */ }
        }
        setBusy(false);
        setMoving(null);
        toast.success(`${ok} de ${moving.length} copiado(s).`);
        void openFolder(currentPath);
    };

    // Abre o diálogo premium de exclusão. A deleção efetiva roda em doDeleteBatch.
    const requestDelete = (files: FileEntry[]) => {
        setDialog({ kind: 'delete', files });
    };

    const handleDeleteBatch = async (files: FileEntry[]) => {
        const n = files.length;
        setBusy(true);
        let ok = 0;
        let projects = 0;
        for (const f of files) {
            try {
                const url = scope === 'shared'
                    ? `${apiPath('/item')}/${encodeURIComponent(f.id)}`
                    : `${apiPath('/item')}?id=${encodeURIComponent(f.id)}`;
                const res = await scopedFetch(url, { method: 'DELETE' });
                const data = await res.json();
                if (data.ok) { ok++; projects += data.projectsUpdated || 0; }
            } catch { /* continua */ }
        }
        setBusy(false);
        setSelectedIds(new Set());
        toast.success(
            scope === 'shared'
                ? `${ok} de ${n} movido(s) para a lixeira por 30 dias.`
                : `${ok} de ${n} excluído(s)${projects ? ` (${projects} projeto(s) atualizado(s))` : ''}.`
        );
        void openFolder(currentPath);
    };

    // ─── Render: árvore ───────────────────────────────────────────────────

    const restoreItem = async (file: FileEntry) => {
        try {
            const res = await scopedFetch(`${apiPath('/item')}/${encodeURIComponent(file.id)}/restore`, { method: 'POST' });
            const data = await res.json();
            if (!data.ok) throw new Error(data.message);
            toast.success('Arquivo restaurado.');
            void openTrash();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Falha ao restaurar.');
        }
    };

    const restoreSelected = async () => {
        setBusy(true);
        let restored = 0;
        for (const file of selectedFiles) {
            try {
                const res = await scopedFetch(`${apiPath('/item')}/${encodeURIComponent(file.id)}/restore`, { method: 'POST' });
                const data = await res.json();
                if (data.ok) restored++;
            } catch {
                // Continua restaurando os demais itens selecionados.
            }
        }
        setBusy(false);
        setSelectedIds(new Set());
        toast.success(`${restored} de ${selectedFiles.length} restaurado(s).`);
        void openTrash();
    };

    const FileIcon = ({ type }: { type: FileEntry['type'] }) => {
        if (type === 'image') return <FileImage className="w-5 h-5 text-blue-400" />;
        if (type === 'video') return <FileVideo className="w-5 h-5 text-purple-400" />;
        return <FileMusic className="w-5 h-5 text-brand-lime" />;
    };

    const formatSize = (bytes?: number) => {
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    };

    const breadcrumb = currentPath ? currentPath.split('/') : [];

    return (
        <div className="flex flex-col gap-6 py-8">
            {/* Header */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <h1 className="text-4xl md:text-5xl font-black text-foreground tracking-tight">Arquivos</h1>
                    <div className="flex items-center gap-1 rounded-xl border border-black/10 dark:border-white/10 bg-background p-1">
                        <button
                            onClick={() => setScope('local')}
                            className={cn(
                                'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all',
                                scope === 'local' ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted hover:text-foreground'
                            )}
                        >
                            <HardDrive className="w-4 h-4" /> Local
                        </button>
                        <button
                            onClick={() => setScope('shared')}
                            className={cn(
                                'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all',
                                scope === 'shared' ? 'bg-brand-accent/15 text-brand-accent' : 'text-brand-muted hover:text-foreground'
                            )}
                        >
                            <Users className="w-4 h-4" /> Compartilhado
                        </button>
                        <button
                            onClick={() => setScope('ops')}
                            className={cn(
                                'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all',
                                scope === 'ops' ? 'bg-violet-500/15 text-violet-400' : 'text-brand-muted hover:text-foreground'
                            )}
                        >
                            <Building2 className="w-4 h-4" /> Mileto Ops
                        </button>
                    </div>
                </div>
                <p className="text-lg text-muted-foreground">
                    Organize suas músicas, vídeos e imagens em um só lugar.
                </p>
            </div>

            <div className="h-[calc(100vh-260px)] min-h-[400px]">
                {scope === 'ops' ? <OpsLibrary /> : (
                <div
                    className="relative h-full flex flex-col bg-background border border-black/5 dark:border-white/5 rounded-2xl overflow-hidden"
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {isDraggingFiles && (
                        <div className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand-lime bg-background/95 text-center shadow-[0_0_50px_rgba(0,230,118,0.18)] backdrop-blur-sm">
                            <Upload className="h-10 w-10 text-brand-lime" />
                            <div>
                                <p className="font-black text-foreground">Solte para enviar</p>
                                <p className="mt-1 text-xs text-brand-muted">Os arquivos serão adicionados nesta pasta.</p>
                            </div>
                        </div>
                    )}
                    {/* Toolbar */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5 gap-3">
                        {selectedFiles.length > 0 ? (
                            // Toolbar de seleção (ações em lote)
                            <div className="flex items-center gap-2 min-w-0">
                                <button onClick={() => setSelectedIds(new Set())} className="text-xs px-2 py-1 rounded-md hover:bg-white/5 text-brand-muted hover:text-foreground flex items-center gap-1 shrink-0">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                                <span className="text-sm font-bold text-foreground shrink-0">
                                    {selectedFiles.length} selecionado{selectedFiles.length > 1 ? 's' : ''}
                                </span>
                            </div>
                        ) : (
                            // Breadcrumb normal
                            <div className="flex items-center gap-1.5 text-sm text-brand-muted min-w-0 overflow-x-auto">
                                <button onClick={() => void openFolder('')} className="hover:text-foreground shrink-0">Arquivos</button>
                                {showingTrash && (
                                    <span className="flex items-center gap-1.5 shrink-0 text-red-400">
                                        <ChevronRight className="w-3 h-3" />
                                        Lixeira
                                    </span>
                                )}
                                {breadcrumb.map((seg, i) => (
                                    <span key={i} className="flex items-center gap-1.5 shrink-0">
                                        <ChevronRight className="w-3 h-3" />
                                        <span
                                            className="truncate hover:text-foreground cursor-pointer"
                                            onClick={() => void openFolder(breadcrumb.slice(0, i + 1).join('/'))}
                                        >
                                            {CATEGORY_LABEL[seg] || seg}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Toggle de visualização: Lista / Cards */}
                        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-black/5 dark:bg-white/5 shrink-0">
                            <button
                                onClick={() => setViewMode('cards')}
                                title="Visualização em cards"
                                className={cn(
                                    'p-1.5 rounded-md transition-all',
                                    viewMode === 'cards' ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted hover:text-foreground'
                                )}
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                title="Visualização em lista"
                                className={cn(
                                    'p-1.5 rounded-md transition-all',
                                    viewMode === 'list' ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted hover:text-foreground'
                                )}
                            >
                                <List className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            {selectedFiles.length > 0 && showingTrash ? (
                                <button
                                    onClick={() => void restoreSelected()}
                                    disabled={busy}
                                    className="text-xs px-3 py-2 rounded-xl font-bold border bg-brand-lime/10 text-brand-lime border-brand-lime/20 hover:bg-brand-lime/20 flex items-center gap-1.5 disabled:opacity-50"
                                >
                                    <RotateCcw className="w-3.5 h-3.5" /> Restaurar
                                </button>
                            ) : selectedFiles.length > 0 ? (
                                <>
                                    {scope === 'local' && (
                                        <button
                                            onClick={() => void shareLocalFiles(selectedFiles)}
                                            disabled={busy}
                                            className="text-xs px-3 py-2 rounded-xl font-bold border shadow-sm bg-brand-accent/10 text-brand-accent border-brand-accent/20 hover:bg-brand-accent/20 flex items-center gap-1.5 disabled:opacity-50"
                                        >
                                            <Users className="w-3.5 h-3.5" /> Compartilhar
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setMoving(selectedFiles)}
                                        disabled={busy}
                                        className="text-xs px-3 py-2 rounded-xl font-bold border shadow-sm bg-white/5 text-foreground border-white/10 hover:bg-white/10 flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        <Scissors className="w-3.5 h-3.5" /> Mover
                                    </button>
                                    <button
                                        onClick={() => setMoving(selectedFiles)}
                                        disabled={busy}
                                        className="text-xs px-3 py-2 rounded-xl font-bold border shadow-sm bg-white/5 text-foreground border-white/10 hover:bg-white/10 flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        <Copy className="w-3.5 h-3.5" /> Copiar
                                    </button>
                                    <button
                                        onClick={() => requestDelete(selectedFiles)}
                                        disabled={busy}
                                        className="text-xs px-3 py-2 rounded-xl font-bold border shadow-sm bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" /> Excluir
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setDialog({ kind: 'createFolder' })}
                                        disabled={showingTrash || (scope === 'shared' && !currentPath)}
                                        title={scope === 'shared' && !currentPath ? 'Abra uma das pastas padrão para criar uma subpasta.' : 'Criar nova pasta'}
                                        className="cursor-pointer text-xs px-3 py-2 rounded-xl font-bold transition-all border shadow-sm bg-white/5 text-foreground border-white/10 hover:bg-white/10 flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> Nova pasta
                                    </button>
                                    {scope === 'shared' && (
                                        <button
                                            onClick={() => showingTrash ? void openFolder('') : void openTrash()}
                                            className={cn(
                                                'cursor-pointer text-xs px-3 py-2 rounded-xl font-bold transition-all border shadow-sm flex items-center gap-1.5',
                                                showingTrash
                                                    ? 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/20'
                                                    : 'bg-white/5 text-brand-muted border-white/10 hover:bg-white/10 hover:text-foreground'
                                            )}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" /> {showingTrash ? 'Sair da lixeira' : 'Lixeira'}
                                        </button>
                                    )}
                                    {scope === 'local' && <button
                                        onClick={() => setIsDownloadOpen(true)}
                                        className="cursor-pointer text-xs px-3 py-2 rounded-xl font-bold transition-all border shadow-sm bg-brand-lime/10 text-brand-lime border-brand-lime/20 hover:bg-brand-lime/20 flex items-center gap-1.5"
                                    >
                                        <ArrowDownToLine className="w-3.5 h-3.5" /> Baixar link
                                    </button>}
                                    <label className="cursor-pointer text-xs px-3 py-2 rounded-xl font-bold transition-all border shadow-sm bg-brand-accent/10 text-brand-accent border-brand-accent/20 hover:bg-brand-accent/20 flex items-center gap-1.5">
                                        <Upload className="w-3.5 h-3.5" /> Enviar
                                        <input
                                            type="file"
                                            className="hidden"
                                            multiple
                                            accept=".mp4,.mov,.mkv,.avi,.webm,.m4v,.mp3,.wav,.ogg,.m4a,.aac,.flac,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                                            onChange={handleUpload}
                                        />
                                    </label>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
                        <aside className="min-h-0 overflow-y-auto border-r border-black/5 bg-black/[0.018] p-2 custom-scrollbar dark:border-white/5 dark:bg-white/[0.012]">
                            <div className="mb-2 px-2 pt-1 text-[9px] font-black uppercase tracking-[0.18em] text-brand-muted">Pastas</div>
                            <ExplorerFolderTree key={scope} root={tree} currentPath={currentPath} onOpen={(path) => void openFolder(path)} />
                        </aside>
                        <div className="flex min-h-0 min-w-0 flex-col">
                    {isAiLibrary && (
                        <div className="flex items-center gap-2 overflow-x-auto border-b border-black/5 px-4 py-2.5 dark:border-white/5">
                            <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-brand-lime">
                                <Sparkles className="h-3.5 w-3.5" /> Filtrar gerações
                            </span>
                            {[
                                { id: 'all', label: 'Tudo' },
                                { id: 'video', label: 'Vídeos' },
                                { id: 'image', label: 'Imagens' },
                            ].map((filter) => (
                                <button
                                    key={filter.id}
                                    type="button"
                                    onClick={() => setAiLibraryFilter(filter.id)}
                                    className={cn(
                                        'shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors',
                                        aiLibraryFilter === filter.id
                                            ? 'border-brand-lime/40 bg-brand-lime/15 text-brand-lime'
                                            : 'border-black/10 bg-black/5 text-brand-muted hover:text-foreground dark:border-white/10 dark:bg-white/5'
                                    )}
                                >
                                    {filter.label}
                                </button>
                            ))}
                            {aiConversations.map((conversation) => {
                                const id = `conversation:${conversation.id}`;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setAiLibraryFilter(id)}
                                        className={cn(
                                            'shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors',
                                            aiLibraryFilter === id
                                                ? 'border-brand-accent/50 bg-brand-accent/15 text-brand-accent'
                                                : 'border-black/10 bg-black/5 text-brand-muted hover:text-foreground dark:border-white/10 dark:bg-white/5'
                                        )}
                                    >
                                        {conversation.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Lista */}
                    <div className="flex-1 overflow-y-auto">
                        {busy ? (
                            <div className="flex flex-col items-center justify-center h-full gap-2 text-brand-muted">
                                <Loader2 className="w-7 h-7 animate-spin text-brand-accent" />
                                <p className="text-sm">Processando...</p>
                            </div>
                        ) : loading ? (
                            <div className="flex items-center justify-center h-full text-brand-muted">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                        ) : !listing || (listing.folders.length === 0 && visibleFiles.length === 0) ? (
                            <div className="flex flex-col items-center justify-center h-full text-center text-brand-muted gap-2">
                                {isAiLibrary && aiLibraryFilter !== 'all'
                                    ? <Sparkles className="w-10 h-10 opacity-50" />
                                    : <FolderOpen className="w-10 h-10 opacity-50" />}
                                <p className="text-sm">
                                    {isAiLibrary && aiLibraryFilter !== 'all' ? 'Nenhuma geração neste filtro.' : 'Pasta vazia.'}
                                </p>
                                {!showingTrash && !(isAiLibrary && aiLibraryFilter !== 'all') && (
                                    <p className="text-xs opacity-70">Arraste arquivos para cá ou copie no Windows e pressione Ctrl+V.</p>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                {/* Cabeçalho com selecionar-tudo (só se houver arquivos) */}
                                {visibleFiles.length > 0 && (
                                    <div className="flex items-center gap-3 px-3 py-1.5 border-b border-black/5 dark:border-white/5 sticky top-0 bg-background/80 backdrop-blur z-10">
                                        <button onClick={toggleSelectAll} className="text-brand-muted hover:text-foreground shrink-0" title={allSelected ? 'Desmarcar tudo' : 'Selecionar tudo'}>
                                            {allSelected ? <CheckSquare className="w-4 h-4 text-brand-lime" /> : <Square className="w-4 h-4" />}
                                        </button>
                                        <span className="text-[10px] uppercase tracking-widest font-bold text-brand-muted">
                                            {listing.folders.length > 0 && `${listing.folders.length} pasta(s) · `}
                                            {visibleFiles.length} arquivo(s)
                                        </span>
                                    </div>
                                )}

                                {/* Pastas */}
                                {listing.folders.map((f) => {
                                    const isDefaultFolder = currentPath === '' && DEFAULT_CATEGORY_NAMES.has(f.name);
                                    return (
                                        <button
                                            key={f.relPath}
                                            onClick={() => void openFolder(f.relPath)}
                                            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 text-left transition-colors"
                                        >
                                            <span className="w-4 shrink-0" />
                                            <Folder className={cn('w-5 h-5', isDefaultFolder ? 'text-brand-lime' : 'text-foreground/75')} />
                                            <span className={cn('text-sm truncate', isDefaultFolder ? 'text-brand-lime font-semibold' : 'text-foreground')}>
                                                {f.name}
                                            </span>
                                        </button>
                                    );
                                })}

                                {/* Arquivos — modo LISTA */}
                                {viewMode === 'list' && visibleFiles.map((f) => {
                                    const isSelected = selectedIds.has(f.id);
                                    return (
                                        <div
                                            key={f.id}
                                            className={cn(
                                                'group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                                                isSelected ? 'bg-brand-lime/5' : 'hover:bg-white/5'
                                            )}
                                        >
                                            {/* Checkbox de seleção */}
                                            <button
                                                onClick={() => toggleSelect(f.id)}
                                                className="shrink-0 text-brand-muted hover:text-foreground"
                                                title="Selecionar"
                                            >
                                                {isSelected
                                                    ? <CheckSquare className="w-4 h-4 text-brand-lime" />
                                                    : <Square className="w-4 h-4 opacity-50 group-hover:opacity-100" />}
                                            </button>

                                            {renaming?.id === f.id ? (
                                                <>
                                                    <FileIcon type={f.type} />
                                                    <input
                                                        autoFocus
                                                        value={renameValue}
                                                        onChange={(e) => setRenameValue(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') void handleRename();
                                                            if (e.key === 'Escape') setRenaming(null);
                                                        }}
                                                        className="flex-1 bg-black/30 border border-brand-accent/40 rounded-md px-2 py-1 text-sm text-foreground outline-none"
                                                    />
                                                    <button onClick={handleRename} className="text-brand-lime hover:text-brand-accent"><Check className="w-4 h-4" /></button>
                                                    <button onClick={() => setRenaming(null)} className="text-brand-muted hover:text-foreground"><X className="w-4 h-4" /></button>
                                                </>
                                            ) : (
                                                <>
                                                    {/* Ícone + nome: clica pra abrir/assistir (vídeo/imagem) */}
                                                    <button
                                                        onClick={() => (f.type === 'video' || f.type === 'image') ? setPreview(f) : undefined}
                                                        className={cn('flex items-center gap-3 min-w-0 flex-1 text-left', (f.type === 'video' || f.type === 'image') && 'cursor-pointer')}
                                                        title={f.type === 'video' ? 'Assistir' : f.type === 'image' ? 'Visualizar' : f.name}
                                                    >
                                                        <FileIcon type={f.type} />
                                                        {f.type === 'video' && (
                                                            <span className="absolute ml-3.5 mt-4 pointer-events-none">
                                                                <Play className="w-3 h-3 text-white fill-white/80" />
                                                            </span>
                                                        )}
                                                        <span className="text-sm text-foreground truncate">{f.name}</span>
                                                    </button>

                                                    <span className="text-[10px] text-brand-muted font-mono shrink-0">
                                                        {f.durationSec ? `${Math.round(f.durationSec)}s` : ''} {formatSize(f.size)}
                                                    </span>

                                                    {/* Player de áudio inline */}
                                                    {f.type === 'audio' && (
                                                        <audio controls src={ABSOLUTE_URL(f.publicUrl)} className="h-7 w-40 shrink-0" preload="none" />
                                                    )}

                                                    {/* Ações do item (hover) */}
                                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                        {showingTrash ? (
                                                            <button onClick={() => void restoreItem(f)} title="Restaurar" className="p-1 rounded text-brand-lime hover:bg-brand-lime/10">
                                                                <RotateCcw className="w-4 h-4" />
                                                            </button>
                                                        ) : (
                                                            <>
                                                                <button onClick={() => { setRenaming(f); setRenameValue(f.name.replace(/\.[^.]+$/, '')); }} title="Renomear" className="p-1 rounded text-brand-muted hover:text-foreground hover:bg-white/10">
                                                                    <Pencil className="w-4 h-4" />
                                                                </button>
                                                                <button onClick={() => setMoving([f])} title="Mover" className="p-1 rounded text-brand-muted hover:text-foreground hover:bg-white/10">
                                                                    <Scissors className="w-4 h-4" />
                                                                </button>
                                                            </>
                                                        )}
                                                        <a href={ABSOLUTE_URL(f.publicUrl)} download title="Baixar" className="p-1 rounded text-brand-muted hover:text-foreground hover:bg-white/10">
                                                            <ArrowDownToLine className="w-4 h-4" />
                                                        </a>
                                                        {!showingTrash && (
                                                            <button onClick={() => requestDelete([f])} title="Excluir" className="p-1 rounded text-brand-muted hover:text-red-400 hover:bg-red-500/10">
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Arquivos — modo CARDS (grid de thumbnails) */}
                                {viewMode === 'cards' && visibleFiles.length > 0 && (
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-3">
                                        {visibleFiles.map((f) => {
                                            const isSelected = selectedIds.has(f.id);
                                            return (
                                                <div
                                                    key={f.id}
                                                    className={cn(
                                                        'group relative rounded-xl border overflow-hidden cursor-default transition-all',
                                                        isSelected
                                                            ? 'border-brand-lime bg-brand-lime/5 ring-1 ring-brand-lime/40'
                                                            : 'border-black/5 dark:border-white/10 hover:border-brand-accent/40'
                                                    )}
                                                >
                                                    {/* Checkbox flutuante */}
                                                    <button
                                                        onClick={() => toggleSelect(f.id)}
                                                        className={cn(
                                                            'absolute top-2 left-2 z-10 p-1 rounded-md transition-all',
                                                            isSelected
                                                                ? 'bg-brand-lime text-[#0a0f12] opacity-100'
                                                                : 'bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-black/60'
                                                        )}
                                                        title="Selecionar"
                                                    >
                                                        {isSelected ? <Check className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                                    </button>

                                                    {/* Ações flutuantes (hover) */}
                                                    <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {showingTrash ? (
                                                            <button onClick={() => void restoreItem(f)} title="Restaurar" className="p-1 rounded-md bg-black/50 text-brand-lime hover:bg-black/70">
                                                                <RotateCcw className="w-3.5 h-3.5" />
                                                            </button>
                                                        ) : (
                                                            <>
                                                                <button onClick={() => { setRenaming(f); setRenameValue(f.name.replace(/\.[^.]+$/, '')); }} title="Renomear" className="p-1 rounded-md bg-black/50 text-white hover:bg-black/70">
                                                                    <Pencil className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button onClick={() => setMoving([f])} title="Mover" className="p-1 rounded-md bg-black/50 text-white hover:bg-black/70">
                                                                    <Scissors className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button onClick={() => requestDelete([f])} title="Excluir" className="p-1 rounded-md bg-black/50 text-white hover:bg-red-500/70">
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>

                                                    {/* Thumbnail / preview */}
                                                    <button
                                                        onClick={() => (f.type === 'video' || f.type === 'image') ? setPreview(f) : toggleSelect(f.id)}
                                                        className="block w-full aspect-video bg-black/30 dark:bg-white/5 relative"
                                                        title={f.type === 'video' ? 'Assistir' : f.type === 'image' ? 'Visualizar' : f.name}
                                                    >
                                                        {f.type === 'image' ? (
                                                            <img src={ABSOLUTE_URL(f.publicUrl)} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
                                                        ) : f.type === 'video' ? (
                                                            <>
                                                                <video src={ABSOLUTE_URL(f.publicUrl)} className="w-full h-full object-cover" preload="metadata" muted />
                                                                <span className="absolute inset-0 flex items-center justify-center">
                                                                    <span className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center">
                                                                        <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                                                                    </span>
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <span className="absolute inset-0 flex items-center justify-center">
                                                                <FileMusic className="w-9 h-9 text-brand-lime/70" />
                                                            </span>
                                                        )}
                                                        {f.durationSec && (
                                                            <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                                                                {Math.round(f.durationSec)}s
                                                            </span>
                                                        )}
                                                    </button>

                                                    {/* Rodapé: nome + player de áudio */}
                                                    <div className="p-2 flex flex-col gap-1.5">
                                                        {renaming?.id === f.id ? (
                                                            <div className="flex items-center gap-1">
                                                                <input
                                                                    autoFocus
                                                                    value={renameValue}
                                                                    onChange={(e) => setRenameValue(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') void handleRename();
                                                                        if (e.key === 'Escape') setRenaming(null);
                                                                    }}
                                                                    className="flex-1 bg-black/30 border border-brand-accent/40 rounded-md px-1.5 py-1 text-xs text-foreground outline-none min-w-0"
                                                                />
                                                                <button onClick={handleRename} className="text-brand-lime"><Check className="w-3.5 h-3.5" /></button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-foreground truncate" title={f.name}>{f.name}</span>
                                                        )}
                                                        {f.type === 'audio' && (
                                                            <audio controls src={ABSOLUTE_URL(f.publicUrl)} className="h-6 w-full" preload="none" />
                                                        )}
                                                        {f.size && (
                                                            <span className="text-[9px] text-brand-muted font-mono">{formatSize(f.size)}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                        </div>
                    </div>
                </div>
                )}
            </div>

            {isDownloadOpen && (
                <DownloadModal
                    onClose={() => setIsDownloadOpen(false)}
                    onDownloaded={() => { void openFolder(currentPath); void refreshTree(); }}
                    allowVideo
                    defaultDestination={currentPath}
                />
            )}

            {moving && (
                <MoveCopyDialog
                    items={moving}
                    tree={tree}
                    onClose={() => setMoving(null)}
                    onMove={handleMoveBatch}
                    onCopy={handleCopyBatch}
                />
            )}

            {preview && (
                <PreviewModal file={preview} onClose={() => setPreview(null)} />
            )}

            {dialog?.kind === 'createFolder' && (
                <ConfirmDialog
                    mode="prompt"
                    title="Nova pasta"
                    message="Dê um nome para a nova pasta."
                    placeholder="Nome da pasta"
                    confirmLabel="Criar"
                    onClose={() => setDialog(null)}
                    onConfirm={(name) => { setDialog(null); handleCreateFolder(name); }}
                />
            )}
            {dialog?.kind === 'delete' && (
                <ConfirmDialog
                    mode="confirm"
                    title={scope === 'shared'
                        ? (dialog.files.length === 1 ? 'Mover para a lixeira?' : `Mover ${dialog.files.length} arquivos para a lixeira?`)
                        : (dialog.files.length === 1 ? 'Excluir arquivo?' : `Excluir ${dialog.files.length} arquivos?`)}
                    message={scope === 'shared'
                        ? 'O arquivo ficará na lixeira compartilhada por 30 dias e poderá ser restaurado.'
                        : 'Esta ação não pode ser desfeita. Referências em projetos também serão removidas.'}
                    confirmLabel={scope === 'shared' ? 'Mover para lixeira' : 'Excluir'}
                    variant="danger"
                    onClose={() => setDialog(null)}
                    onConfirm={() => { const f = dialog.files; setDialog(null); void handleDeleteBatch(f); }}
                />
            )}
        </div>
    );
};

// ─── Diálogo Mover/Copiar (1 ou vários) ───────────────────────────────────

interface MoveCopyProps {
    items: FileEntry[];
    tree: FileNode | null;
    onClose: () => void;
    onMove: (dest: string) => void;
    onCopy: (dest: string) => void;
}

const MoveCopyDialog = ({ items, tree, onClose, onMove, onCopy }: MoveCopyProps) => {
    const [dest, setDest] = useState('');

    const flatten = (node: FileNode, acc: Array<{ rel: string; label: string }> = []) => {
        if (node.relPath !== '') acc.push({ rel: node.relPath, label: CATEGORY_LABEL[node.name] || node.name });
        for (const c of node.children) flatten(c, acc);
        return acc;
    };
    const options = tree ? flatten(tree) : [];

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="bg-brand-dark/95 border border-brand-accent/30 rounded-3xl w-full max-w-md shadow-[0_0_50px_rgba(0,230,118,0.15)] flex flex-col overflow-hidden relative z-101">
                <div className="flex items-center justify-between px-6 py-5 border-b border-black/10 dark:border-white/10">
                    <h3 className="font-black uppercase tracking-wider text-foreground text-[15px]">
                        Mover / Copiar
                    </h3>
                    <button onClick={onClose} className="p-2 bg-black/5 dark:bg-white/5 hover:bg-red-500/20 rounded-full text-brand-muted hover:text-red-400 transition-all">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 flex flex-col gap-4">
                    <p className="text-sm text-brand-muted">
                        {items.length} arquivo(s) selecionado(s)
                    </p>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-brand-accent">Destino</label>
                        <select
                            value={dest}
                            onChange={(e) => setDest(e.target.value)}
                            className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-brand-accent/50"
                        >
                            <option value="">Arquivos (raiz)</option>
                            {options.map((o) => (
                                <option key={o.rel} value={o.rel}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => onCopy(dest)}
                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-foreground border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all"
                        >
                            <Copy className="w-4 h-4" /> Copiar
                        </button>
                        <button
                            onClick={() => onMove(dest)}
                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-lime px-4 py-3 text-sm font-bold text-[#0a0f12] hover:brightness-110 transition-all"
                        >
                            <Scissors className="w-4 h-4" /> Mover
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Player de preview (vídeo / imagem) ───────────────────────────────────

interface PreviewProps {
    file: FileEntry;
    onClose: () => void;
}

const PreviewModal = ({ file, onClose }: PreviewProps) => {
    return (
        <div
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
            onClick={onClose}
        >
            <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between text-foreground">
                    <span className="text-sm font-bold truncate pr-4">{file.name}</span>
                    <button onClick={onClose} className="p-2 bg-white/10 hover:bg-red-500/20 rounded-full text-foreground hover:text-red-400 transition-all shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                {file.type === 'video' ? (
                    <video
                        src={ABSOLUTE_URL(file.publicUrl)}
                        controls
                        autoPlay
                        className="w-full max-h-[80vh] rounded-2xl bg-black"
                    />
                ) : (
                    <img
                        src={ABSOLUTE_URL(file.publicUrl)}
                        alt={file.name}
                        className="w-full max-h-[80vh] object-contain rounded-2xl bg-black"
                    />
                )}
            </div>
        </div>
    );
};

export default FileExplorer;
