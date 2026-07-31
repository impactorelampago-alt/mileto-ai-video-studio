import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Building2,
    Check,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    ClipboardPaste,
    Copy,
    FileImage,
    FileVideo,
    Folder,
    FolderOpen,
    FolderPlus,
    Grid2X2,
    HardDrive,
    List,
    Loader2,
    Scissors,
    Send,
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
import { PremiumSelect } from './ExportModal';
import { gatewayApi, type OpsCompany, type OpsFolder } from '../lib/gateway';

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

interface FolderNode {
    name: string;
    relPath: string;
    children?: FolderNode[];
}

type ClipboardMode = 'copy' | 'cut';

interface LibraryClipboard {
    mode: ClipboardMode;
    scope: 'local' | 'shared';
    files: SharedFile[];
}

interface TransferBatch {
    target: 'shared' | 'ops';
    files: SharedFile[];
}

const flattenFolders = (node?: FolderNode | null): Array<{ value: string; label: string }> => {
    if (!node) return [];
    const output: Array<{ value: string; label: string }> = [];
    const visit = (current: FolderNode) => {
        if (current.relPath && current.relPath !== '/') {
            output.push({ value: current.relPath, label: current.relPath.split('/').join(' › ') });
        }
        for (const child of current.children || []) visit(child);
    };
    visit(node);
    return output;
};

const findFolderNode = (node: FolderNode | null, relPath: string): FolderNode | null => {
    if (!node) return null;
    if (node.relPath === relPath) return node;
    for (const child of node.children || []) {
        const found = findFolderNode(child, relPath);
        if (found) return found;
    }
    return null;
};

const LibraryFolderTree = ({ root, currentPath, onOpen }: { root: FolderNode | null; currentPath: string; onOpen: (path: string) => void }) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    useEffect(() => {
        const parts = currentPath.split('/').filter(Boolean);
        let cursor = '';
        setExpanded((previous) => {
            const next = new Set(previous);
            for (const part of parts) {
                cursor = cursor ? `${cursor}/${part}` : part;
                next.add(cursor);
            }
            if (root?.relPath) next.add(root.relPath);
            return next;
        });
    }, [currentPath, root?.relPath]);
    if (!root) return <div className="px-2 py-3 text-[10px] text-brand-muted">Carregando pastas...</div>;

    const render = (node: FolderNode, depth: number): React.ReactNode => {
        const children = node.children || [];
        const open = expanded.has(node.relPath);
        const active = currentPath === node.relPath || (node.relPath === '/' && !currentPath);
        return (
            <div key={node.relPath || '/'}>
                <div className={cn('flex items-center gap-1 rounded-lg', active ? 'bg-brand-lime/12 text-brand-lime' : 'text-foreground/65 hover:bg-white/5 hover:text-foreground')} style={{ paddingLeft: `${4 + depth * 12}px` }}>
                    <button type="button" className="grid h-7 w-5 shrink-0 place-items-center" onClick={() => children.length && setExpanded((previous) => {
                        const next = new Set(previous);
                        if (next.has(node.relPath)) next.delete(node.relPath); else next.add(node.relPath);
                        return next;
                    })}>
                        {children.length ? (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : <span className="h-3 w-3" />}
                    </button>
                    <button type="button" onClick={() => { onOpen(node.relPath === '/' ? '' : node.relPath); if (children.length) setExpanded((previous) => new Set(previous).add(node.relPath)); }} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-[10px] font-bold">
                        {active ? <FolderOpen className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-brand-lime/65" />}
                        <span className="truncate">{node.relPath === '/' ? 'Meu computador' : node.name}</span>
                    </button>
                </div>
                {open && children.map((child) => render(child, depth + 1))}
            </div>
        );
    };
    return <div className="space-y-0.5">{render(root, 0)}</div>;
};

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
        title={subtitle}
        className={cn(
            'group flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-left transition-all',
            active
                ? 'border-brand-lime/40 bg-brand-lime/10 shadow-[0_0_24px_rgba(0,239,151,0.08)]'
                : 'border-white/8 bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.045]'
        )}
    >
        <span className={cn(
            'grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5',
            active ? 'bg-brand-lime text-[#07110d]' : 'bg-white/6 text-brand-muted group-hover:text-foreground'
        )}>
            {icon}
        </span>
        <span className="truncate text-[11px] font-black text-foreground">{title}</span>
        {active && <Check className="h-3.5 w-3.5 shrink-0 text-brand-lime" />}
    </button>
);

const LibrarySource = ({ kind, scope, onPicked }: { kind: MediaKind; scope: 'local' | 'shared'; onPicked: () => void }) => {
    const { addMediaTakes } = useWizard();
    const { registerClientJob, updateClientJob } = useDownloadJobs();
    const category = kind === 'video' ? 'Vídeos' : 'Imagens';
    const homePath = scope === 'local' ? '' : category;
    const homeLabel = scope === 'local' ? 'Meu computador' : category;
    const [path, setPath] = useState(homePath);
    const [listing, setListing] = useState<SharedListing | null>(null);
    const [loading, setLoading] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [clipboard, setClipboard] = useState<LibraryClipboard | null>(null);
    const [pasting, setPasting] = useState(false);
    const [transferBatch, setTransferBatch] = useState<TransferBatch | null>(null);
    const [transferring, setTransferring] = useState(false);
    const [sharedFolders, setSharedFolders] = useState<Array<{ value: string; label: string }>>([]);
    const [sharedDestination, setSharedDestination] = useState(category);
    const [opsCompanies, setOpsCompanies] = useState<OpsCompany[]>([]);
    const [opsCompanyId, setOpsCompanyId] = useState('');
    const [opsFolders, setOpsFolders] = useState<OpsFolder[]>([]);
    const [opsFolderId, setOpsFolderId] = useState('');
    const [opsViewContextId, setOpsViewContextId] = useState<string | null>(null);
    const [folderTree, setFolderTree] = useState<FolderNode | null>(null);

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
        void load(homePath);
    }, [homePath, load]);

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const headers = scope === 'shared' ? await localAuthHeaders() : undefined;
                const endpoint = scope === 'shared' ? '/api/shared/files/tree' : '/api/files/tree';
                const response = await fetch(`${API_BASE_URL}${endpoint}`, { headers });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.message || 'Falha ao carregar pastas.');
                if (!active) return;
                const root = result.root as FolderNode;
                setFolderTree(scope === 'shared' ? findFolderNode(root, category) : root);
            } catch {
                if (active) setFolderTree(null);
            }
        })();
        return () => { active = false; };
    }, [category, scope]);

    const breadcrumbs = useMemo(() => path.split('/').filter(Boolean), [path]);
    const homeParts = useMemo(() => homePath.split('/').filter(Boolean), [homePath]);
    const visibleBreadcrumbs = useMemo(() => breadcrumbs.slice(homeParts.length), [breadcrumbs, homeParts.length]);
    const aiLibraryActive = path === 'Geração por IA' || path.startsWith('Geração por IA/');
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

    const selectFileFromCard = (file: SharedFile) => {
        // O card inteiro é o alvo de seleção. Antes, somente o quadradinho que
        // aparecia após clicar em “Selecionar” funcionava, o que fazia o arquivo
        // parecer apenas uma miniatura sem ação.
        if (!selectionMode) setSelectionMode(true);
        toggleFile(file);
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

    const createFolder = async (name: string) => {
        setCreateFolderOpen(false);
        try {
            const headers = scope === 'shared'
                ? { ...(await localAuthHeaders()), 'Content-Type': 'application/json' }
                : { 'Content-Type': 'application/json' };
            const endpoint = scope === 'shared' ? '/api/shared/files/folder' : '/api/files/folder';
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ parent: path, name }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.message || 'Não foi possível criar a pasta.');
            toast.success(`Pasta “${name}” criada.`);
            await load(path);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível criar a pasta.');
        }
    };

    const armClipboard = (mode: ClipboardMode) => {
        if (!selectedFiles.length) return;
        setClipboard({ mode, scope, files: [...selectedFiles] });
        setSelectionMode(false);
        setSelectedIds(new Set());
        toast.success(`${selectedFiles.length} item(ns) ${mode === 'copy' ? 'copiado(s)' : 'recortado(s)'}. Abra a pasta de destino e clique em Colar.`);
    };

    const pasteClipboard = async () => {
        if (!clipboard?.files.length || clipboard.scope !== scope || pasting) return;
        setPasting(true);
        try {
            const headers = scope === 'shared'
                ? { ...(await localAuthHeaders()), 'Content-Type': 'application/json' }
                : { 'Content-Type': 'application/json' };
            const operation = clipboard.mode === 'copy' ? 'copy' : 'move';
            const settled = await Promise.allSettled(clipboard.files.map(async (file) => {
                const endpoint = scope === 'shared'
                    ? `${API_BASE_URL}/api/shared/files/${operation}`
                    : `${API_BASE_URL}/api/files/${operation}`;
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ id: file.id || undefined, relPath: file.relPath, destPath: path }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.ok) throw new Error(result.message || `Falha ao ${operation === 'copy' ? 'copiar' : 'mover'} ${file.name}.`);
            }));
            const failed = settled.filter((result) => result.status === 'rejected').length;
            const completed = clipboard.files.length - failed;
            if (completed) toast.success(`${completed} item(ns) ${operation === 'copy' ? 'copiado(s)' : 'movido(s)'} para esta pasta.`);
            if (failed) toast.error(`${failed} item(ns) não puderam ser ${operation === 'copy' ? 'copiados' : 'movidos'}.`);
            if (clipboard.mode === 'cut' && failed === 0) setClipboard(null);
            await load(path);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível colar os arquivos.');
        } finally {
            setPasting(false);
        }
    };

    const openTransfer = async (target: TransferBatch['target']) => {
        if (!selectedFiles.length || scope !== 'local') return;
        const batch = [...selectedFiles];
        setTransferBatch({ target, files: batch });
        setTransferring(false);
        try {
            if (target === 'shared') {
                const response = await fetch(`${API_BASE_URL}/api/shared/files/tree`, { headers: await localAuthHeaders() });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.message || 'Não foi possível listar as pastas compartilhadas.');
                const folders = flattenFolders(result.root).filter((folder) => folder.value === category || folder.value.startsWith(`${category}/`));
                setSharedFolders(folders);
                setSharedDestination(folders.some((folder) => folder.value === category) ? category : (folders[0]?.value || category));
                return;
            }

            const invalid = batch.filter((file) => !file.name.toLowerCase().endsWith('.mp4'));
            if (invalid.length) {
                setTransferBatch(null);
                throw new Error('O envio ao Mileto Ops aceita somente vídeos MP4. Remova arquivos MOV ou de imagem da seleção.');
            }
            const contexts = await gatewayApi.opsViewContexts();
            const context = contexts.data.contexts.find((item) => item.contextId === contexts.data.defaultContextId) || contexts.data.contexts[0];
            setOpsViewContextId(context?.contextId || null);
            const companies = await gatewayApi.opsCompanies('', context?.contextId);
            setOpsCompanies(companies.data);
            const companyId = companies.data[0]?.id || '';
            setOpsCompanyId(companyId);
            setOpsFolderId('');
            if (companyId) {
                const folders = await gatewayApi.opsFolders(companyId, context?.contextId);
                setOpsFolders(folders.data);
            } else {
                setOpsFolders([]);
            }
        } catch (error) {
            setTransferBatch(null);
            toast.error(error instanceof Error ? error.message : 'Não foi possível preparar a transferência.');
        }
    };

    const changeOpsCompany = async (companyId: string) => {
        setOpsCompanyId(companyId);
        setOpsFolderId('');
        setOpsFolders([]);
        if (!companyId) return;
        try {
            const response = await gatewayApi.opsFolders(companyId, opsViewContextId);
            setOpsFolders(response.data);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível listar as pastas da empresa.');
        }
    };

    const transferSelection = async () => {
        if (!transferBatch?.files.length || transferring) return;
        if (transferBatch.target === 'ops' && !opsCompanyId) {
            toast.error('Selecione a empresa de destino no Mileto Ops.');
            return;
        }
        setTransferring(true);
        try {
            const headers = { ...(await localAuthHeaders()), 'Content-Type': 'application/json' };
            const destinationLabel = transferBatch.target === 'shared' ? 'Compartilhado' : 'Mileto Ops';
            let reused = 0;
            const settled = await Promise.allSettled(transferBatch.files.map(async (file) => {
                const endpoint = transferBatch.target === 'shared'
                    ? `${API_BASE_URL}/api/shared/files/import-local`
                    : `${API_BASE_URL}/api/ops/files/import-local`;
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        ...headers,
                        ...(transferBatch.target === 'ops' && opsViewContextId ? { 'X-Ops-View-Context': opsViewContextId } : {}),
                    },
                    body: JSON.stringify(transferBatch.target === 'shared' ? {
                        sourceUrl: absoluteUrl(file.publicUrl),
                        backendPath: file.filePath,
                        name: file.name,
                        parent: sharedDestination,
                    } : {
                        sourceUrl: absoluteUrl(file.publicUrl),
                        backendPath: file.filePath,
                        fileName: file.name,
                        companyId: opsCompanyId,
                        folderId: opsFolderId,
                    }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.ok) throw new Error(result.message || `Falha ao enviar ${file.name}.`);
                if (result.deduplicated) reused += 1;
            }));
            const failed = settled.filter((result) => result.status === 'rejected').length;
            const completed = transferBatch.files.length - failed;
            if (completed) {
                toast.success(`${completed} item(ns) enviado(s) para ${destinationLabel}${reused ? `; ${reused} sem duplicar espaço` : ''}.`);
            }
            if (failed) {
                const first = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
                toast.error(`${failed} item(ns) falharam. ${first?.reason instanceof Error ? first.reason.message : ''}`.trim());
            } else {
                setTransferBatch(null);
                setSelectionMode(false);
                setSelectedIds(new Set());
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível transferir os arquivos.');
        } finally {
            setTransferring(false);
        }
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/7 px-4 py-2">
                <div className="flex min-w-0 items-center gap-1 text-xs">
                    <button onClick={() => void load(homePath)} className="rounded-lg px-2 py-1.5 font-bold text-brand-lime hover:bg-brand-lime/10">{homeLabel}</button>
                    {visibleBreadcrumbs.map((part, index) => {
                        const target = breadcrumbs.slice(0, homeParts.length + index + 1).join('/');
                        return (
                            <span key={target} className="flex min-w-0 items-center gap-1">
                                <ChevronRight className="h-3.5 w-3.5 text-brand-muted" />
                                <button onClick={() => void load(target)} className="max-w-[180px] truncate rounded-lg px-2 py-1.5 text-foreground/70 hover:bg-white/5 hover:text-foreground">{part}</button>
                            </span>
                        );
                    })}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setCreateFolderOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] font-black text-foreground/70 transition hover:border-brand-lime/25 hover:text-brand-lime"
                    >
                        <FolderPlus className="h-3.5 w-3.5" />
                        Nova pasta
                    </button>
                    {clipboard?.scope === scope && clipboard.files.length > 0 && (
                        <button
                            type="button"
                            onClick={() => void pasteClipboard()}
                            disabled={pasting}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-lime/30 bg-brand-lime/10 px-3 py-2 text-[10px] font-black text-brand-lime transition hover:bg-brand-lime/15 disabled:opacity-40"
                            title={`${clipboard.files.length} item(ns) prontos para colar`}
                        >
                            {pasting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
                            Colar {clipboard.files.length}
                        </button>
                    )}
                    {scope === 'local' && (
                        <button
                            type="button"
                            onClick={() => void load(aiLibraryActive ? homePath : 'Geração por IA')}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-black transition',
                                aiLibraryActive
                                    ? 'border-violet-400/30 bg-violet-400/10 text-violet-200'
                                    : 'border-white/10 bg-white/[0.035] text-foreground/70 hover:border-violet-400/25 hover:text-violet-200'
                            )}
                            title="Abrir mídias criadas pelos agentes"
                        >
                            <Sparkles className="h-3.5 w-3.5" />
                            {aiLibraryActive ? `Voltar para ${homeLabel}` : 'Geração por IA'}
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

            <div className="grid min-h-0 flex-1 grid-cols-[190px_minmax(0,1fr)]">
                <aside className="min-h-0 overflow-y-auto border-r border-white/7 bg-black/[0.08] p-2 custom-scrollbar">
                    <div className="mb-1 px-2 pt-1 text-[9px] font-black uppercase tracking-[0.16em] text-brand-muted">Pastas</div>
                    <LibraryFolderTree key={scope} root={folderTree} currentPath={path} onOpen={(nextPath) => void load(nextPath)} />
                </aside>
                <div className="flex min-h-0 min-w-0 flex-col">
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
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="text-[10px] font-bold text-brand-muted">{selectedFiles.length} selecionado(s)</span>
                        <button
                            type="button"
                            onClick={() => armClipboard('copy')}
                            disabled={!selectedFiles.length}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] font-black text-foreground/75 transition hover:border-brand-lime/25 hover:text-brand-lime disabled:opacity-35"
                        >
                            <Copy className="h-3.5 w-3.5" /> Copiar
                        </button>
                        <button
                            type="button"
                            onClick={() => armClipboard('cut')}
                            disabled={!selectedFiles.length}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] font-black text-foreground/75 transition hover:border-amber-400/25 hover:text-amber-300 disabled:opacity-35"
                        >
                            <Scissors className="h-3.5 w-3.5" /> Recortar
                        </button>
                        {scope === 'local' && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => void openTransfer('shared')}
                                    disabled={!selectedFiles.length || transferring}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-accent/25 bg-brand-accent/10 px-3 py-2 text-[10px] font-black text-brand-accent transition hover:bg-brand-accent/15 disabled:opacity-35"
                                >
                                    <UsersRound className="h-3.5 w-3.5" /> Enviar ao Compartilhado
                                </button>
                                {kind === 'video' && (
                                    <button
                                        type="button"
                                        onClick={() => void openTransfer('ops')}
                                        disabled={!selectedFiles.length || transferring}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-400/10 px-3 py-2 text-[10px] font-black text-violet-200 transition hover:bg-violet-400/15 disabled:opacity-35"
                                    >
                                        <Building2 className="h-3.5 w-3.5" /> Enviar ao Mileto Ops
                                    </button>
                                )}
                            </>
                        )}
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

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 custom-scrollbar" data-media-scroll-region="true">
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
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(138px,1fr))] gap-2">
                        {listing.folders.map((folder) => (
                            <button key={folder.relPath} onClick={() => void load(folder.relPath)} className="group flex min-h-[108px] flex-col justify-between rounded-xl border border-white/8 bg-white/[0.025] p-3 text-left transition hover:border-brand-lime/25 hover:bg-brand-lime/[0.035]">
                                <Folder className="h-8 w-8 fill-brand-lime/10 text-brand-lime/70" />
                                <span className="mt-3 truncate text-[11px] font-bold text-foreground">{folder.name}</span>
                            </button>
                        ))}
                        {listing.files.map((file) => (
                            <button
                                type="button"
                                key={file.id || file.relPath}
                                aria-pressed={selectedIds.has(file.id || file.relPath)}
                                onClick={() => selectFileFromCard(file)}
                                className={cn('group w-full cursor-pointer overflow-hidden rounded-xl border bg-white/[0.025] text-left transition focus:outline-none focus:ring-2 focus:ring-brand-lime/35', selectedIds.has(file.id || file.relPath) ? 'border-brand-lime/50 ring-1 ring-brand-lime/20' : 'border-white/8 hover:border-brand-lime/25')}
                            >
                                <div className="relative aspect-video overflow-hidden bg-black/30">
                                    {kind === 'image' ? (
                                        <img src={absoluteUrl(file.publicUrl)} alt="" className="h-full w-full object-cover" loading="lazy" />
                                    ) : (
                                        <video src={absoluteUrl(file.publicUrl)} className="h-full w-full object-cover" preload="metadata" muted />
                                    )}
                                    <span className="absolute left-2 top-2 rounded-md bg-black/65 px-1.5 py-1 text-white">
                                        {kind === 'image' ? <FileImage className="h-3.5 w-3.5" /> : <FileVideo className="h-3.5 w-3.5" />}
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg border bg-black/75 text-white shadow-lg transition',
                                            selectionMode || selectedIds.has(file.id || file.relPath)
                                                ? 'border-brand-lime/35 opacity-100'
                                                : 'border-white/15 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                                        )}
                                    >
                                        {selectedIds.has(file.id || file.relPath) ? <CheckSquare className="h-4 w-4 text-brand-lime" /> : <Square className="h-4 w-4" />}
                                    </span>
                                </div>
                                <div className="p-2.5">
                                    <p className="truncate text-[11px] font-bold text-foreground" title={file.name}>{file.name}</p>
                                    <div className="mt-1.5 flex items-center justify-between gap-2">
                                        <span className="text-[9px] text-brand-muted">{formatBytes(file.size)}</span>
                                        <span className="text-[9px] font-bold text-brand-lime">{selectedIds.has(file.id || file.relPath) ? 'Selecionado' : 'Usar'}</span>
                                    </div>
                                </div>
                            </button>
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
                            <button
                                type="button"
                                key={file.id || file.relPath}
                                onClick={() => selectFileFromCard(file)}
                                aria-pressed={selectedIds.has(file.id || file.relPath)}
                                className={cn('flex w-full items-center gap-3 border-b border-white/6 px-4 py-3 text-left last:border-b-0', selectedIds.has(file.id || file.relPath) ? 'bg-brand-lime/[0.055]' : 'hover:bg-white/[0.025]')}
                            >
                                {selectedIds.has(file.id || file.relPath) ? <CheckSquare className="h-4 w-4 text-brand-lime" /> : <Square className="h-4 w-4 text-brand-muted" />}
                                {kind === 'image' ? <FileImage className="h-5 w-5 text-violet-300" /> : <FileVideo className="h-5 w-5 text-brand-lime" />}
                                <span className="min-w-0 flex-1 truncate text-xs font-bold text-foreground">{file.name}</span>
                                <span className="text-[10px] text-brand-muted">{formatBytes(file.size)}</span>
                                <span className="text-[10px] font-bold text-brand-lime">{selectedIds.has(file.id || file.relPath) ? 'Selecionado' : 'Usar'}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
                </div>
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
            {createFolderOpen && (
                <ConfirmDialog
                    mode="prompt"
                    title="Nova pasta"
                    message={`Crie uma pasta dentro de ${path || homeLabel}.`}
                    placeholder="Nome da pasta"
                    confirmLabel="Criar pasta"
                    onClose={() => setCreateFolderOpen(false)}
                    onConfirm={(name) => void createFolder(name)}
                />
            )}
            {transferBatch && (
                <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
                    <div className="relative w-full max-w-lg overflow-visible rounded-3xl border border-brand-accent/30 bg-[#0b1214] shadow-[0_0_60px_rgba(0,230,118,0.16)] ring-1 ring-white/5">
                        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-size-[20px_20px] opacity-25" />
                        <header className="relative flex items-start justify-between gap-4 border-b border-white/8 px-6 py-5">
                            <div className="flex items-center gap-3">
                                <span className={cn('grid h-11 w-11 place-items-center rounded-2xl border', transferBatch.target === 'shared' ? 'border-brand-accent/25 bg-brand-accent/10 text-brand-accent' : 'border-violet-400/25 bg-violet-400/10 text-violet-200')}>
                                    {transferBatch.target === 'shared' ? <UsersRound className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
                                </span>
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-lime">Transferência segura</p>
                                    <h3 className="mt-1 text-base font-black text-foreground">
                                        Enviar para {transferBatch.target === 'shared' ? 'Compartilhado' : 'Mileto Ops'}
                                    </h3>
                                    <p className="mt-1 text-[11px] text-brand-muted">{transferBatch.files.length} arquivo(s); os originais permanecerão no computador.</p>
                                </div>
                            </div>
                            <button type="button" onClick={() => !transferring && setTransferBatch(null)} className="rounded-full border border-white/8 bg-white/5 p-2 text-brand-muted hover:border-red-400/25 hover:text-red-300"><X className="h-4 w-4" /></button>
                        </header>
                        <div className="relative space-y-4 px-6 py-5">
                            {transferBatch.target === 'shared' ? (
                                <div>
                                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-brand-accent">Pasta compartilhada</label>
                                    <PremiumSelect
                                        value={sharedDestination}
                                        options={sharedFolders}
                                        placeholder="Selecionar pasta"
                                        searchable
                                        searchPlaceholder="Buscar pasta..."
                                        onChange={setSharedDestination}
                                    />
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-violet-200">Empresa</label>
                                        <PremiumSelect
                                            value={opsCompanyId}
                                            options={opsCompanies.map((company) => ({ value: company.id, label: company.name || company.nome || 'Empresa sem nome' }))}
                                            placeholder="Selecionar empresa"
                                            searchable
                                            searchPlaceholder="Buscar empresa..."
                                            onChange={(value) => void changeOpsCompany(value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-violet-200">Pasta no Mileto Ops</label>
                                        <PremiumSelect
                                            value={opsFolderId}
                                            options={[{ value: '', label: 'Pasta raiz' }, ...opsFolders.map((folder) => ({ value: folder.id, label: folder.name }))]}
                                            placeholder="Pasta raiz"
                                            searchable
                                            searchPlaceholder="Buscar pasta..."
                                            onChange={setOpsFolderId}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                        <footer className="relative flex gap-3 border-t border-white/8 px-6 py-5">
                            <button type="button" disabled={transferring} onClick={() => setTransferBatch(null)} className="flex-1 rounded-xl border border-white/10 px-4 py-3 text-xs font-black uppercase tracking-wider text-foreground/80 hover:bg-white/5 disabled:opacity-40">Cancelar</button>
                            <button
                                type="button"
                                disabled={transferring || (transferBatch.target === 'shared' ? !sharedDestination : !opsCompanyId)}
                                onClick={() => void transferSelection()}
                                className="flex-[1.4] inline-flex items-center justify-center gap-2 rounded-xl bg-brand-lime px-4 py-3 text-xs font-black uppercase tracking-wider text-[#06110c] shadow-[0_0_25px_rgba(0,230,118,0.18)] transition hover:brightness-110 disabled:opacity-40"
                            >
                                {transferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                {transferring ? 'Enviando...' : 'Confirmar envio'}
                            </button>
                        </footer>
                    </div>
                </div>
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
            <section className="relative z-10 flex h-[min(94vh,980px)] w-[min(97vw,1540px)] flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#0a1013] shadow-[0_35px_120px_rgba(0,0,0,0.72),0_0_0_1px_rgba(0,239,151,0.025)]">
                <header className="border-b border-white/8 bg-gradient-to-r from-brand-lime/[0.06] via-transparent to-violet-500/[0.06] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex min-w-[220px] items-center gap-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-brand-lime/20 bg-brand-lime/10 text-brand-lime">
                                {kind === 'video' ? <FileVideo className="h-4 w-4" /> : <FileImage className="h-4 w-4" />}
                            </span>
                            <div className="min-w-0">
                                <h2 className="truncate text-base font-black text-foreground">Adicionar {labelForKind(kind)}</h2>
                                <p className="truncate text-[10px] text-brand-muted">Escolha a origem e selecione os arquivos.</p>
                            </div>
                        </div>
                        <div className="ml-auto flex w-full max-w-[540px] gap-1.5 sm:w-auto sm:min-w-[430px]">
                            <SourceButton active={source === 'computer'} icon={<HardDrive className="h-5 w-5" />} title="Meu computador" subtitle="Arquivos deste PC" onClick={() => setSource('computer')} />
                            <SourceButton active={source === 'shared'} icon={<UsersRound className="h-5 w-5" />} title="Compartilhado" subtitle="Biblioteca da equipe" onClick={() => setSource('shared')} />
                            <SourceButton active={source === 'ops'} icon={<Building2 className="h-5 w-5" />} title="Mileto Ops" subtitle="Empresas autorizadas" onClick={() => setSource('ops')} />
                        </div>
                        <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/8 bg-white/5 text-brand-muted transition hover:bg-white/10 hover:text-foreground" title="Fechar">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </header>

                <div className="min-h-0 flex-1 overflow-hidden">
                    {source === 'computer' && <LibrarySource kind={kind} scope="local" onPicked={onClose} />}
                    {source === 'shared' && <LibrarySource kind={kind} scope="shared" onPicked={onClose} />}
                    {source === 'ops' && <div className="h-full min-h-0 overflow-hidden p-2"><OpsLibrary pickerKind={kind} onPicked={onClose} /></div>}
                </div>
            </section>
        </div>,
        document.body
    );
};

export default MediaSourceModal;
