import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    AlertTriangle, ArrowDownToLine, Building2, Check, ChevronDown, ChevronRight,
    CheckSquare, Crown, FileImage, FileVideo, Folder, FolderOpen, Grid2X2, Library, List, Loader2, Music2, Play,
    Search, ShieldCheck, Sparkles, Square, Upload, UserRound, UsersRound, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    gatewayApi,
    GatewayError,
    type OpsAsset,
    type OpsCompany,
    type OpsExternalReference,
    type OpsFolder,
    type OpsMediaUrl,
    type OpsViewContext,
} from '../lib/gateway';
import { API_BASE_URL } from '../lib/apiBase';
import { localAuthHeaders } from '../lib/serverAuth';
import { useWizard } from '../context/WizardContext';
import type { MediaTake } from '../types';
import { useDownloadJobs } from '../context/DownloadJobsContext';
import { MiletoMediaPlayer } from './MiletoMediaPlayer';
import { normalizeBrandPalette } from '../lib/brandPalette';

const absoluteLocalUrl = (url?: string | null) => {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
};

const formatBytes = (value?: number | null) => {
    const bytes = Number(value || 0);
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const companyName = (company: OpsCompany) => company.name || company.nome || 'Empresa sem nome';
const contextIdentity = (context: OpsViewContext) =>
    `${context.mode}:${context.label.trim().toLocaleLowerCase('pt-BR')}:${context.subtitle.trim().toLocaleLowerCase('pt-BR')}`;
const isViewContextError = (error: unknown) =>
    error instanceof GatewayError &&
    ['view_context_forbidden', 'ops_view_context_invalid', 'ops_view_contexts_invalid'].includes(error.code || '');

const OPS_EDITOR_IMPORT_CONCURRENCY = 4;
const OPS_EDITOR_PREVIEW_CONCURRENCY = 6;
const OPS_EDITOR_IMPORT_ATTEMPTS = 5;
const RETRYABLE_MATERIALIZE_STATUS = new Set([401, 403, 408, 409, 425, 429, 500, 502, 503, 504]);
const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const remoteVideoDuration = (url: string, fallback: number) => new Promise<number>((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (value: number) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        video.removeAttribute('src');
        video.load();
        resolve(Number.isFinite(value) && value > 0 ? value : fallback);
    };
    const timeout = window.setTimeout(() => finish(fallback), 12_000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish(Number(video.duration));
    video.onerror = () => finish(fallback);
    video.src = url;
    video.load();
});

const ViewContextIcon = ({ mode, className = 'w-4 h-4' }: { mode: OpsViewContext['mode']; className?: string }) => {
    if (mode === 'team') return <UsersRound className={className} />;
    if (mode === 'profile') return <UserRound className={className} />;
    return <Crown className={className} />;
};

interface OpsLibraryProps {
    pickerKind?: 'video' | 'image';
    onPicked?: () => void;
}

interface MaterializedOpsSource {
    type?: MediaTake['type'];
    duration?: number;
    fileName?: string;
    url?: string;
    proxyUrl?: string;
    path?: string;
    externalMedia?: MediaTake['externalMedia'];
}

export const OpsLibrary = ({ pickerKind, onPicked }: OpsLibraryProps = {}) => {
    const { addMediaTakes, setMediaTakes, updateAdData } = useWizard();
    const { registerJob, registerClientJob, updateClientJob } = useDownloadJobs();
    const [ready, setReady] = useState(false);
    const [linked, setLinked] = useState(false);
    const [viewContexts, setViewContexts] = useState<OpsViewContext[]>([]);
    const [selectedContext, setSelectedContext] = useState<OpsViewContext | null>(null);
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [contextExpiresAt, setContextExpiresAt] = useState(0);
    const [companies, setCompanies] = useState<OpsCompany[]>([]);
    const [companyQuery, setCompanyQuery] = useState('');
    const [selectedCompany, setSelectedCompany] = useState<OpsCompany | null>(null);
    const [folders, setFolders] = useState<OpsFolder[]>([]);
    const [selectedFolder, setSelectedFolder] = useState<OpsFolder | null>(null);
    const [assetQuery, setAssetQuery] = useState('');
    const [assets, setAssets] = useState<OpsAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
    const selectedContextRef = useRef<OpsViewContext | null>(null);
    const contextExpiresAtRef = useRef(0);
    const contextRecoveryRef = useRef<Promise<void> | null>(null);
    const [preview, setPreview] = useState<{ asset: OpsAsset; url: string; delivery?: string } | null>(null);
    const previewUrlCacheRef = useRef(new Map<string, { source: OpsMediaUrl; expiresAt: number }>());
    const previewRequestRef = useRef(new Map<string, Promise<OpsMediaUrl>>());
    const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);

    const resetNavigation = useCallback(() => {
        setCompanies([]);
        setSelectedCompany(null);
        setFolders([]);
        setSelectedFolder(null);
        setAssets([]);
        setAssetQuery('');
        setCompanyQuery('');
        setThumbnailUrls({});
        setPreview(null);
        previewUrlCacheRef.current.clear();
        previewRequestRef.current.clear();
    }, []);

    const loadAuthorizedContexts = useCallback(async () => {
        const response = await gatewayApi.opsViewContexts();
        const available = Array.isArray(response.data?.contexts) ? response.data.contexts : [];
        if (!available.length) throw new Error('O Mileto Ops não devolveu opções de visualização.');

        const previous = selectedContextRef.current;
        const previousIdentity = previous ? contextIdentity(previous) : null;
        const matching = previousIdentity
            ? available.find((context) => contextIdentity(context) === previousIdentity)
            : null;
        const fallback =
            available.find((context) => context.contextId === response.data.defaultContextId) ||
            available.find((context) => context.mode === 'self') ||
            available[0];
        const next = matching || fallback;

        setViewContexts(available);
        setSelectedContext(next);
        selectedContextRef.current = next;
        const expiresAt = Date.now() + Math.max(60, Number(response.data.expiresIn) || 600) * 1000;
        setContextExpiresAt(expiresAt);
        contextExpiresAtRef.current = expiresAt;
        return { context: next, selectionRemoved: Boolean(previous && !matching) };
    }, []);

    const loadCompanies = useCallback(async () => {
        setLoading(true);
        try {
            const status = await gatewayApi.opsConnection();
            setReady(status.enabled && status.connection?.status === 'active');
            setLinked(status.userLink?.status === 'confirmed');
            if (!status.enabled || status.connection?.status !== 'active' || status.userLink?.status !== 'confirmed') {
                resetNavigation();
                setViewContexts([]);
                setSelectedContext(null);
                selectedContextRef.current = null;
                return;
            }
            const { context, selectionRemoved } = await loadAuthorizedContexts();
            resetNavigation();
            const response = await gatewayApi.opsCompanies('', context.contextId);
            setCompanies(Array.isArray(response.data) ? response.data : []);
            if (selectionRemoved) {
                toast.warning('Seu acesso no Mileto Ops mudou. Voltamos para Minha conta.');
            }
        } catch (error) {
            toast.error(error instanceof GatewayError ? error.message : 'Não foi possível abrir a biblioteca do Ops.');
        } finally {
            setLoading(false);
        }
    }, [loadAuthorizedContexts, resetNavigation]);

    useEffect(() => {
        void loadCompanies();
    }, [loadCompanies]);

    useEffect(() => {
        if (!contextExpiresAt || !ready || !linked) return;
        const delay = Math.max(15_000, contextExpiresAt - Date.now() - 30_000);
        const timer = window.setTimeout(() => void loadCompanies(), delay);
        return () => window.clearTimeout(timer);
    }, [contextExpiresAt, linked, loadCompanies, ready]);

    const recoverViewContext = useCallback(async (error: unknown) => {
        if (!isViewContextError(error)) return false;
        if (!contextRecoveryRef.current) {
            toast.warning('Sua permissão no Mileto Ops mudou. Atualizamos as opções disponíveis.');
            contextRecoveryRef.current = loadCompanies().finally(() => {
                contextRecoveryRef.current = null;
            });
        }
        await contextRecoveryRef.current;
        return true;
    }, [loadCompanies]);

    const chooseViewContext = async (context: OpsViewContext) => {
        setContextMenuOpen(false);
        if (selectedContext?.contextId === context.contextId) return;
        setLoading(true);
        resetNavigation();
        setSelectedContext(context);
        selectedContextRef.current = context;
        try {
            const response = await gatewayApi.opsCompanies('', context.contextId);
            setCompanies(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            if (!(await recoverViewContext(error))) {
                toast.error(error instanceof GatewayError ? error.message : 'Não foi possível trocar a visualização.');
            }
        } finally {
            setLoading(false);
        }
    };

    const loadCompany = async (company: OpsCompany) => {
        setSelectedCompany(company);
        if (company.kind !== 'archive') {
            const brandPalette = normalizeBrandPalette(company.palette);
            updateAdData({
                brandPalette,
                brandPaletteUpdatedAt: brandPalette ? company.paletteUpdatedAt ?? null : null,
            });
        }
        setSelectedFolder(null);
        setAssetQuery('');
        setLoading(true);
        try {
            const folderResponse = await gatewayApi.opsFolders(company.id, selectedContext?.contextId);
            setFolders(Array.isArray(folderResponse.data) ? folderResponse.data : []);
            setAssets([]);
        } catch (error) {
            if (!(await recoverViewContext(error))) {
                toast.error(error instanceof GatewayError ? error.message : 'Não foi possível listar os arquivos da empresa.');
            }
        } finally {
            setLoading(false);
        }
    };

    const loadAssets = useCallback(async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await gatewayApi.opsAssets(selectedCompany.id, {
                // v0.1.2: ausência = busca global; "root" = arquivos realmente
                // soltos; UUID = somente a pasta aberta. O explorer nunca omite.
                folderId: selectedFolder?.id || 'root',
                q: assetQuery.trim(),
                viewContextId: selectedContext?.contextId,
            });
            setAssets(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            if (!(await recoverViewContext(error))) {
                toast.error(error instanceof GatewayError ? error.message : 'Não foi possível pesquisar no Mileto Ops.');
            }
        } finally {
            setLoading(false);
        }
    }, [assetQuery, recoverViewContext, selectedCompany, selectedContext?.contextId, selectedFolder]);

    // Upload de MP4 direto na área do Ops: sobe pra biblioteca local (aparece "aqui")
    // e em seguida envia pro acervo do Ops (aparece "lá"), na empresa/pasta abertas.
    const uploadToOps = async (file: File) => {
        if (!selectedCompany) {
            toast.error('Abra uma empresa antes de enviar.');
            return;
        }
        if (!file.name.toLowerCase().endsWith('.mp4')) {
            toast.error('O Mileto Ops aceita somente vídeos MP4.');
            return;
        }
        setUploading(true);
        const toastId = toast.loading(`Enviando "${file.name}"...`);
        try {
            // 1) biblioteca local (aparece em Arquivos › Local)
            const form = new FormData();
            form.append('file', file);
            const localRes = await fetch(`${API_BASE_URL}/api/files/upload`, {
                method: 'POST',
                headers: { ...(await localAuthHeaders()) },
                body: form,
            });
            const localData = await localRes.json().catch(() => ({}));
            if (!localRes.ok || !localData.ok) throw new Error(localData.message || 'Falha ao salvar localmente.');
            const entry = localData.entry;

            // 2) acervo do Ops (empresa/pasta abertas)
            const opsRes = await fetch(`${API_BASE_URL}/api/ops/files/import-local`, {
                method: 'POST',
                headers: {
                    ...(await localAuthHeaders()),
                    'Content-Type': 'application/json',
                    ...(selectedContext?.contextId ? { 'X-Ops-View-Context': selectedContext.contextId } : {}),
                },
                body: JSON.stringify({
                    sourceUrl: absoluteLocalUrl(entry?.publicUrl),
                    backendPath: entry?.filePath,
                    fileName: entry?.name || file.name,
                    companyId: selectedCompany.id,
                    folderId: selectedFolder?.id || '',
                }),
            });
            const opsData = await opsRes.json().catch(() => ({}));
            if (!opsRes.ok || !opsData.ok) throw new Error(opsData.message || 'Falha ao enviar ao Mileto Ops.');

            toast.success(`"${file.name}" enviado ao Mileto Ops e salvo em Arquivos.`, { id: toastId });
            void loadAssets();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Falha no envio.', { id: toastId });
        } finally {
            setUploading(false);
            if (uploadInputRef.current) uploadInputRef.current.value = '';
        }
    };

    useEffect(() => {
        if (!selectedCompany) return;
        const timer = window.setTimeout(() => void loadAssets(), 300);
        return () => window.clearTimeout(timer);
    }, [assetQuery, loadAssets, selectedCompany, selectedFolder]);

    useEffect(() => {
        setSelectionMode(false);
        setSelectedAssetIds(new Set());
    }, [selectedCompany?.id, selectedFolder?.id]);

    useEffect(() => {
        let cancelled = false;
        // Só pede thumbnail de quem tem o flag. Depois do contrato v0.1.3, vídeos com poster
        // persistido entram aqui automaticamente; itens ainda sem backfill continuam no fallback.
        const candidates = assets.filter((asset) => asset.capabilities?.thumbnail).slice(0, 80);
        if (!candidates.length) {
            setThumbnailUrls({});
            return;
        }
        void Promise.all(
            candidates.map(async (asset) => {
                try {
                    const result = await gatewayApi.opsAssetUrl(asset.id, 'thumbnail', selectedContext?.contextId);
                    return [asset.id, result.url] as const;
                } catch (error) {
                    if (isViewContextError(error)) void recoverViewContext(error);
                    return null;
                }
            })
        ).then((rows) => {
            if (cancelled) return;
            setThumbnailUrls(Object.fromEntries(rows.filter((row): row is readonly [string, string] => !!row)));
        });
        return () => {
            cancelled = true;
        };
    }, [assets, recoverViewContext, selectedContext?.contextId]);

    const filteredCompanies = useMemo(() => {
        const query = companyQuery.trim().toLocaleLowerCase('pt-BR');
        if (!query) return companies;
        return companies.filter((company) => companyName(company).toLocaleLowerCase('pt-BR').includes(query));
    }, [companies, companyQuery]);

    // O Acervo da agência (kind: "archive") é destacado no topo, separado das empresas.
    const archiveCompanies = useMemo(() => filteredCompanies.filter((c) => c.kind === 'archive'), [filteredCompanies]);
    const regularCompanies = useMemo(() => filteredCompanies.filter((c) => c.kind !== 'archive'), [filteredCompanies]);

    // ── Árvore de pastas do Ops (o Ops manda parentId por pasta; montamos o aninhamento aqui) ──
    const childFolders = useCallback(
        (parentId: string | null) => folders.filter((folder) => (folder.parentId ?? null) === parentId),
        [folders]
    );
    // Caminho (ancestrais) da pasta aberta, p/ o breadcrumb navegável.
    const folderPath = useMemo(() => {
        if (!selectedFolder) return [] as OpsFolder[];
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        const chain: OpsFolder[] = [];
        const seen = new Set<string>();
        let cur: OpsFolder | undefined = selectedFolder;
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            chain.unshift(cur);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return chain;
    }, [folders, selectedFolder]);
    // Nó recursivo da sidebar (indenta por profundidade).
    const renderFolderNode = (folder: OpsFolder, depth: number): ReactNode => {
        const kids = childFolders(folder.id);
        return (
            <div key={folder.id}>
                <button
                    type="button"
                    onClick={() => setSelectedFolder(folder)}
                    style={{ paddingLeft: `${8 + depth * 12}px` }}
                    className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[11px] transition ${selectedFolder?.id === folder.id ? 'bg-brand-lime/10 text-brand-lime' : 'text-foreground/60 hover:bg-white/5 hover:text-foreground'}`}
                >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-amber-300/80" />
                    <span className="truncate">{folder.name}</span>
                </button>
                {kids.map((kid) => renderFolderNode(kid, depth + 1))}
            </div>
        );
    };

    const renderCompany = (company: OpsCompany) => {
        const expanded = selectedCompany?.id === company.id;
        const isArchive = company.kind === 'archive';
        return (
            <div key={company.id}>
                <button
                    onClick={() => void loadCompany(company)}
                    className={`w-full flex items-center gap-1 rounded-lg px-1 py-1.5 text-left text-xs transition ${
                        expanded
                            ? 'bg-brand-accent/12 text-brand-accent'
                            : isArchive
                              ? 'text-brand-accent/90 hover:bg-brand-accent/10'
                              : 'hover:bg-white/5 text-foreground/70'
                    }`}
                >
                    <span className="grid h-6 w-5 shrink-0 place-items-center text-brand-muted">
                        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </span>
                    {isArchive ? <Library className="w-4 h-4 shrink-0" /> : <Building2 className="w-4 h-4 shrink-0" />}
                    <span className="truncate font-bold">{companyName(company)}</span>
                </button>
                {expanded && (
                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/7 pl-2">
                        <button
                            type="button"
                            onClick={() => setSelectedFolder(null)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition ${!selectedFolder ? 'bg-brand-lime/10 text-brand-lime' : 'text-foreground/60 hover:bg-white/5 hover:text-foreground'}`}
                        >
                            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{isArchive ? 'Todo o acervo' : 'Pastas da empresa'}</span>
                        </button>
                        {childFolders(null).map((folder) => renderFolderNode(folder, 0))}
                    </div>
                )}
            </div>
        );
    };

    const visibleAssets = useMemo(() => {
        const assetsFromCurrentFolder = selectedFolder
            ? assets.filter((asset) => asset.folderId === selectedFolder.id)
            : assets.filter((asset) => asset.folderId === null);

        return pickerKind
            ? assetsFromCurrentFolder.filter((asset) => asset.kind === pickerKind)
            : assetsFromCurrentFolder;
    }, [assets, pickerKind, selectedFolder]);

    const selectedAssets = useMemo(
        () => visibleAssets.filter((asset) => selectedAssetIds.has(asset.id)),
        [selectedAssetIds, visibleAssets]
    );

    const toggleAssetSelection = (assetId: string) => {
        setSelectedAssetIds((current) => {
            const next = new Set(current);
            if (next.has(assetId)) next.delete(assetId);
            else next.add(assetId);
            return next;
        });
    };

    const leaveSelectionMode = () => {
        setSelectionMode(false);
        setSelectedAssetIds(new Set());
    };

    const confirmSelection = () => {
        if (!selectedAssets.length) return;

        if (!pickerKind) {
            const batch = [...selectedAssets];
            leaveSelectionMode();
            void Promise.all(batch.map((asset) => downloadAsset(asset)));
            return;
        }

        const batch = [...selectedAssets];
        const total = batch.length;
        const activityId = registerClientJob({
            mode: pickerKind,
            title: `${total} ${total === 1 ? 'mídia' : 'mídias'} do Mileto Ops`,
            destination: 'Projeto atual',
            source: 'editor-import',
            statusText: 'Preparando para o editor',
        });

        leaveSelectionMode();
        onPicked?.();

        void (async () => {
            const orderedTakes: Array<MediaTake | null> = Array.from({ length: total }, () => null);
            const preparedReferences: Array<OpsExternalReference | null> = Array.from({ length: total }, () => null);
            const placeholderDurations = new Map<string, number>();
            const failures: Array<{ asset: OpsAsset; error: unknown }> = [];
            const previewFailures: Array<{ asset: OpsAsset; error: unknown }> = [];
            let nextIndex = 0;

            const previewWorker = async () => {
                while (nextIndex < total) {
                    const index = nextIndex;
                    nextIndex += 1;
                    const asset = batch[index];
                    try {
                        const contextId = await ensureFreshOpsContext();
                        const reference = await gatewayApi.createOpsReference(asset.id, contextId);
                        preparedReferences[index] = reference;
                        const media = await gatewayApi.opsAssetUrl(
                            asset.id,
                            asset.kind === 'image' ? 'download' : 'stream',
                            contextId
                        );
                        const type: MediaTake['type'] = asset.kind === 'image' ? 'image' : 'video';
                        const declaredDuration = Number(asset.durationMs || 0) / 1000;
                        const fallbackDuration = type === 'image' ? 3.5 : Math.max(1, declaredDuration || 5);
                        const duration = type === 'video' && declaredDuration <= 0
                            ? await remoteVideoDuration(media.url, fallbackDuration)
                            : fallbackDuration;
                        const takeId = crypto.randomUUID();
                        placeholderDurations.set(takeId, duration);
                        orderedTakes[index] = {
                            id: takeId,
                            fileName: asset.name,
                            originalDurationSeconds: duration,
                            url: media.url,
                            fileUrl: media.url,
                            proxyUrl: media.url,
                            externalMedia: {
                                source: 'mileto_ops',
                                referenceId: reference.id,
                                connectionId: reference.connectionId,
                                accountId: reference.accountId,
                                companyId: reference.companyId,
                                folderId: reference.folderId,
                                assetId: reference.assetId,
                                mid: reference.mid,
                                version: reference.version,
                                checksum: reference.checksum,
                                opsUpdatedAt: reference.opsUpdatedAt,
                            },
                            type,
                            trim: { start: 0, end: duration },
                        };
                    } catch (error) {
                        previewFailures.push({ asset, error });
                    }
                }
            };

            await Promise.all(
                Array.from(
                    { length: Math.min(OPS_EDITOR_PREVIEW_CONCURRENCY, total) },
                    () => previewWorker()
                )
            );

            const immediateTakes = orderedTakes.filter((take): take is MediaTake => take !== null);
            if (immediateTakes.length) addMediaTakes(immediateTakes);
            updateClientJob(activityId, {
                percent: 10,
                stepPercent: 10,
                statusText: `${immediateTakes.length} de ${total} na timeline · preparando originais`,
            });

            let completed = 0;
            nextIndex = 0;
            const materializeWorker = async () => {
                while (nextIndex < total) {
                    const index = nextIndex;
                    nextIndex += 1;
                    const asset = batch[index];
                    const placeholder = orderedTakes[index];
                    try {
                        const take = await materializeAsset(
                            asset,
                            preparedReferences[index],
                            placeholder?.id || crypto.randomUUID()
                        );
                        orderedTakes[index] = take;
                        if (placeholder) {
                            const placeholderDuration = placeholderDurations.get(placeholder.id) || placeholder.originalDurationSeconds;
                            setMediaTakes((current) => current.map((existing) => {
                                if (existing.id !== placeholder.id) return existing;
                                const keptEnd = Math.abs(existing.trim.end - placeholderDuration) < 0.05
                                    ? take.originalDurationSeconds
                                    : Math.min(existing.trim.end, take.originalDurationSeconds);
                                return {
                                    ...existing,
                                    url: take.url,
                                    fileUrl: take.fileUrl,
                                    proxyUrl: take.proxyUrl,
                                    backendPath: take.backendPath,
                                    externalMedia: take.externalMedia,
                                    originalDurationSeconds: take.originalDurationSeconds,
                                    trim: {
                                        start: Math.min(existing.trim.start, Math.max(0, keptEnd - 0.05)),
                                        end: keptEnd,
                                    },
                                };
                            }));
                        } else {
                            addMediaTakes([take]);
                        }
                    } catch (error) {
                        failures.push({ asset, error });
                    } finally {
                        completed += 1;
                        const percent = 10 + Math.round((completed / total) * 90);
                        updateClientJob(activityId, {
                            percent,
                            stepPercent: percent,
                            statusText: `${immediateTakes.length} na timeline · originais ${completed} de ${total}`,
                        });
                    }
                }
            };

            await Promise.all(
                Array.from(
                    { length: Math.min(OPS_EDITOR_IMPORT_CONCURRENCY, total) },
                    () => materializeWorker()
                )
            );

            const takes = orderedTakes.filter((take): take is MediaTake => take !== null);

            if (!takes.length) {
                const firstError = failures[0]?.error || previewFailures[0]?.error;
                updateClientJob(activityId, {
                    phase: 'error',
                    completedAt: Date.now(),
                    error: firstError instanceof Error ? firstError.message : 'Não foi possível preparar as mídias.',
                });
                return;
            }

            updateClientJob(activityId, {
                phase: failures.length ? 'error' : 'done',
                percent: 100,
                stepPercent: 100,
                completedAt: Date.now(),
                statusText: failures.length ? `${takes.length} adicionada(s), ${failures.length} falhou(aram)` : 'Adicionado ao projeto',
                ...(failures.length ? {
                    error: `${failures.length} arquivo(s) ainda não puderam ser preparados: ${failures.slice(0, 3).map(({ asset }) => asset.name).join(', ')}${failures.length > 3 ? '…' : ''}`,
                } : {}),
            });
            if (failures.length) toast.error(`${takes.length} mídia(s) adicionada(s); ${failures.length} continuam pendentes após novas tentativas.`);
        })();
    };

    const resolvePreviewSource = async (asset: OpsAsset) => {
        const kind = asset.kind === 'image' ? 'download' : 'stream';
        const cacheKey = `${selectedContext?.contextId || 'default'}:${asset.id}:${kind}`;
        const cached = previewUrlCacheRef.current.get(cacheKey);
        if (cached && cached.expiresAt > Date.now() + 15_000) return cached.source;

        const pending = previewRequestRef.current.get(cacheKey);
        if (pending) return pending;

        const request = gatewayApi.opsAssetUrl(asset.id, kind, selectedContext?.contextId)
            .then((source) => {
                const declaredExpiry = source.expiresAt ? Date.parse(source.expiresAt) : Number.NaN;
                previewUrlCacheRef.current.set(cacheKey, {
                    source,
                    expiresAt: Number.isFinite(declaredExpiry) ? declaredExpiry : Date.now() + 5 * 60_000,
                });
                return source;
            })
            .finally(() => previewRequestRef.current.delete(cacheKey));
        previewRequestRef.current.set(cacheKey, request);
        return request;
    };

    const warmPreviewSource = (asset: OpsAsset) => {
        if (asset.kind !== 'video') return;
        void resolvePreviewSource(asset).catch(() => undefined);
    };

    const previewAsset = async (asset: OpsAsset) => {
        try {
            const result = await resolvePreviewSource(asset);
            setPreview({ asset, url: result.url, delivery: result.delivery });
        } catch (error) {
            if (!(await recoverViewContext(error))) {
                toast.error(error instanceof GatewayError ? error.message : 'Prévia indisponível.');
            }
        }
    };

    const downloadAsset = async (asset: OpsAsset) => {
        try {
            const result = await gatewayApi.opsAssetUrl(asset.id, 'download', selectedContext?.contextId);
            const mode = asset.kind === 'audio' ? 'audio' : asset.kind === 'image' ? 'image' : 'video';
            const destination = mode === 'audio' ? 'Músicas' : mode === 'image' ? 'Imagens' : 'Vídeos';
            const response = await fetch(`${API_BASE_URL}/api/download/ops`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: result.url,
                    name: asset.name,
                    mode,
                    destination,
                    sizeBytes: asset.sizeBytes || null,
                    checksum: asset.checksum || null,
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok || !data.jobId) {
                throw new Error(data.message || 'Não foi possível iniciar o download interno.');
            }
            registerJob(data.jobId, { mode, title: asset.name, destination });
            toast.success('Download adicionado à fila. Você pode acompanhar pelo sino.');
        } catch (error) {
            if (!(await recoverViewContext(error))) {
                toast.error(error instanceof GatewayError ? error.message : 'Download indisponível.');
            }
        }
    };

    const ensureFreshOpsContext = async () => {
        if (!selectedContextRef.current || Date.now() >= contextExpiresAtRef.current - 45_000) {
            if (!contextRecoveryRef.current) {
                contextRecoveryRef.current = loadAuthorizedContexts()
                    .then(() => undefined)
                    .finally(() => {
                        contextRecoveryRef.current = null;
                    });
            }
            await contextRecoveryRef.current;
        }
        return selectedContextRef.current?.contextId;
    };

    const materializeAsset = async (
        asset: OpsAsset,
        existingReference: OpsExternalReference | null = null,
        takeId: string = crypto.randomUUID()
    ): Promise<MediaTake> => {
        if (!['video', 'image'].includes(asset.kind)) {
            throw new Error('Por enquanto, somente vídeos e imagens entram como take no editor.');
        }
        let source: MaterializedOpsSource | null = null;
        let lastError: GatewayError | null = null;

        for (let attempt = 0; attempt < OPS_EDITOR_IMPORT_ATTEMPTS; attempt += 1) {
            try {
                // O contexto do Ops expira em poucos minutos. Uma importação com dezenas
                // de vídeos pode atravessar esse limite, então renovamos sem interromper a fila.
                const contextId = await ensureFreshOpsContext();
                const reference = existingReference || await gatewayApi.createOpsReference(asset.id, contextId);
                const response = await fetch(`${API_BASE_URL}/api/ops/cache/materialize`, {
                    method: 'POST',
                    headers: {
                        ...(await localAuthHeaders()),
                        'Content-Type': 'application/json',
                        ...(contextId ? { 'X-Ops-View-Context': contextId } : {}),
                    },
                    body: JSON.stringify({ referenceId: reference.id }),
                });
                const result = await response.json().catch(() => ({}));
                if (response.ok && result.ok && result.source) {
                    source = result.source as MaterializedOpsSource;
                    break;
                }

                lastError = new GatewayError(
                    response.status,
                    result.message || 'Falha ao preparar a mídia.',
                    typeof result.code === 'string' ? result.code : null
                );
                if (isViewContextError(lastError) || [401, 403].includes(response.status)) {
                    contextExpiresAtRef.current = 0;
                }
                if (attempt >= OPS_EDITOR_IMPORT_ATTEMPTS - 1 || !RETRYABLE_MATERIALIZE_STATUS.has(response.status)) {
                    throw lastError;
                }
            } catch (error) {
                lastError = error instanceof GatewayError
                    ? error
                    : new GatewayError(0, error instanceof Error ? error.message : 'Falha ao preparar a mídia.');
                if (isViewContextError(lastError) || [401, 403].includes(lastError.status)) {
                    contextExpiresAtRef.current = 0;
                }
                if (lastError.status > 0 && !RETRYABLE_MATERIALIZE_STATUS.has(lastError.status)) throw lastError;
                if (attempt >= OPS_EDITOR_IMPORT_ATTEMPTS - 1) throw lastError;
            }
            await wait(Math.min(8_000, 900 * 2 ** attempt));
        }

        if (!source) throw lastError || new Error('Falha ao preparar a mídia.');
        const type: MediaTake['type'] = source.type === 'image' ? 'image' : 'video';
        const duration = Number(source.duration || (type === 'image' ? 3.5 : 0));
        return {
            id: takeId,
            fileName: source.fileName || asset.name,
            originalDurationSeconds: duration,
            url: absoluteLocalUrl(source.url),
            fileUrl: absoluteLocalUrl(source.url),
            proxyUrl: absoluteLocalUrl(source.proxyUrl),
            backendPath: source.path,
            externalMedia: source.externalMedia,
            type,
            trim: { start: 0, end: duration },
        };
    };

    if (loading && !ready && companies.length === 0) {
        return <div className="h-full grid place-items-center text-brand-muted"><Loader2 className="w-6 h-6 animate-spin" /></div>;
    }

    if (!ready || !linked) {
        return (
            <div className="h-full grid place-items-center p-8">
                <div className="max-w-lg rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-center">
                    <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
                    <h2 className="font-bold text-foreground">Biblioteca do Mileto Ops indisponível</h2>
                    <p className="text-sm text-foreground/50 mt-2">
                        {!ready
                            ? 'O dono precisa conectar a conta na tela Minha Conta.'
                            : 'Seu usuário precisa ser vinculado a um funcionário do Ops pelo dono da conta.'}
                    </p>
                    <button onClick={() => void loadCompanies()} className="mt-4 text-xs font-bold text-brand-lime">
                        Atualizar estado
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-background border border-black/5 dark:border-white/5 rounded-xl overflow-hidden">
            <header className="relative z-30 flex items-center justify-between gap-3 border-b border-black/5 dark:border-white/5 bg-card/35 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0" title="Conteúdo filtrado pela hierarquia e carteira definidas no Ops">
                    <div className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-violet-400/20 bg-gradient-to-br from-violet-500/20 to-brand-lime/10 text-violet-300">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <Sparkles className="absolute -right-1 -top-1 h-2.5 w-2.5 text-brand-lime" />
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-bold text-foreground">Mileto Ops</span>
                        <span className="rounded-full border border-brand-lime/20 bg-brand-lime/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-brand-lime">seguro</span>
                    </div>
                </div>

                {selectedContext && (
                    <div className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => setContextMenuOpen((open) => !open)}
                            aria-haspopup="listbox"
                            aria-expanded={contextMenuOpen}
                            className="group flex min-w-[180px] max-w-[260px] items-center gap-2 rounded-lg border border-violet-400/20 bg-black/10 px-2.5 py-1.5 text-left transition hover:border-violet-400/40 hover:bg-violet-500/5"
                        >
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-violet-500/15 text-violet-300 transition group-hover:bg-violet-500/20 [&>svg]:h-3.5 [&>svg]:w-3.5">
                                <ViewContextIcon mode={selectedContext.mode} />
                            </span>
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                <span className="truncate text-[11px] font-bold text-foreground">{selectedContext.label}</span>
                                <span className="truncate text-[9px] text-brand-muted">· {selectedContext.subtitle}</span>
                            </span>
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin text-brand-lime" />
                            ) : (
                                <ChevronDown className={`h-4 w-4 text-brand-muted transition ${contextMenuOpen ? 'rotate-180' : ''}`} />
                            )}
                        </button>

                        {contextMenuOpen && (
                            <>
                                <button
                                    type="button"
                                    aria-label="Fechar seletor"
                                    onClick={() => setContextMenuOpen(false)}
                                    className="fixed inset-0 z-40 cursor-default"
                                />
                                <div
                                    role="listbox"
                                    aria-label="Visualizar conteúdo como"
                                    className="absolute right-0 top-[calc(100%+10px)] z-50 w-[340px] overflow-hidden rounded-2xl border border-violet-400/20 bg-[#0b1115]/98 shadow-[0_28px_80px_rgba(0,0,0,0.55),0_0_0_1px_rgba(139,92,246,0.05)] backdrop-blur-xl"
                                >
                                    <div className="border-b border-white/7 bg-gradient-to-r from-violet-500/10 via-transparent to-brand-lime/5 px-4 py-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-white">
                                            <ShieldCheck className="h-4 w-4 text-brand-lime" />
                                            Visualizar conteúdo como
                                        </div>
                                        <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                                            O Mileto Ops libera somente pessoas dentro do seu alcance.
                                        </p>
                                    </div>

                                    <div className="max-h-[420px] overflow-y-auto p-2">
                                        <div className="px-2 pb-1 pt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                                            Visão
                                        </div>
                                        {viewContexts.filter((context) => context.mode !== 'profile').map((context) => {
                                            const active = selectedContext.contextId === context.contextId;
                                            return (
                                                <button
                                                    type="button"
                                                    role="option"
                                                    aria-selected={active}
                                                    key={context.contextId}
                                                    onClick={() => void chooseViewContext(context)}
                                                    className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                                                        active
                                                            ? 'border-brand-lime/25 bg-brand-lime/10'
                                                            : 'border-transparent hover:border-white/8 hover:bg-white/5'
                                                    }`}
                                                >
                                                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${active ? 'bg-brand-lime text-black' : 'bg-white/7 text-white/60'}`}>
                                                        <ViewContextIcon mode={context.mode} />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-bold text-white">{context.label}</span>
                                                        <span className="block truncate text-[10px] text-white/40">{context.subtitle}</span>
                                                    </span>
                                                    {active && <Check className="h-4 w-4 text-brand-lime" />}
                                                </button>
                                            );
                                        })}

                                        {viewContexts.some((context) => context.mode === 'profile') && (
                                            <>
                                                <div className="mx-2 my-2 h-px bg-white/7" />
                                                <div className="px-2 pb-1 pt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                                                    Pessoas no seu alcance
                                                </div>
                                                {viewContexts.filter((context) => context.mode === 'profile').map((context) => {
                                                    const active = selectedContext.contextId === context.contextId;
                                                    return (
                                                        <button
                                                            type="button"
                                                            role="option"
                                                            aria-selected={active}
                                                            key={context.contextId}
                                                            onClick={() => void chooseViewContext(context)}
                                                            className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                                                                active
                                                                    ? 'border-violet-400/25 bg-violet-500/10'
                                                                    : 'border-transparent hover:border-white/8 hover:bg-white/5'
                                                            }`}
                                                        >
                                                            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black uppercase ${active ? 'bg-violet-400 text-black' : 'bg-violet-500/15 text-violet-200'}`}>
                                                                {context.label.slice(0, 1)}
                                                            </span>
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate text-xs font-bold text-white">{context.label}</span>
                                                                <span className="block truncate text-[10px] text-white/40">{context.subtitle}</span>
                                                            </span>
                                                            {active && <Check className="h-4 w-4 text-violet-300" />}
                                                        </button>
                                                    );
                                                })}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </header>

            <div className="min-h-0 flex-1 grid grid-cols-[210px_1fr]">
            <aside className="min-h-0 overflow-y-auto overscroll-contain border-r border-black/5 p-2 custom-scrollbar dark:border-white/5">
                <div className="relative mb-2">
                    <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-brand-muted" />
                    <input
                        value={companyQuery}
                        onChange={(event) => setCompanyQuery(event.target.value)}
                        placeholder="Buscar empresa"
                        className="w-full rounded-lg border border-white/10 bg-black/10 py-2 pl-9 pr-3 text-[11px] outline-none focus:border-brand-accent/50"
                    />
                </div>
                {archiveCompanies.length > 0 && (
                    <>
                        <div className="text-[10px] uppercase tracking-wider font-bold text-brand-accent px-2 mb-1 flex items-center gap-1">
                            <Library className="h-3 w-3" /> Acervo da agência
                        </div>
                        <div className="space-y-1 mb-3">{archiveCompanies.map(renderCompany)}</div>
                    </>
                )}
                <div className="text-[10px] uppercase tracking-wider font-bold text-brand-muted px-2 mb-1">Empresas permitidas</div>
                <div className="space-y-1">{regularCompanies.map(renderCompany)}</div>
            </aside>

            <section className="min-h-0 min-w-0 flex flex-col overflow-hidden">
                {!selectedCompany ? (
                    <div className="h-full grid place-items-center text-center text-brand-muted p-8">
                        <div><Building2 className="w-10 h-10 mx-auto opacity-40 mb-2" /><p className="text-sm">Escolha uma empresa para abrir os arquivos.</p></div>
                    </div>
                ) : (
                    <>
                        <div className="space-y-3 border-b border-black/5 px-4 py-3 dark:border-white/5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2 text-sm">
                                    <button onClick={() => setSelectedFolder(null)} className="truncate font-bold hover:text-brand-accent">
                                        {companyName(selectedCompany)}
                                    </button>
                                    {folderPath.map((folder, index) => {
                                        const last = index === folderPath.length - 1;
                                        return (
                                            <span key={folder.id} className="flex min-w-0 items-center gap-2">
                                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-brand-muted" />
                                                {last ? (
                                                    <span className="truncate text-foreground/65">{folder.name}</span>
                                                ) : (
                                                    <button
                                                        onClick={() => setSelectedFolder(folder)}
                                                        className="truncate text-foreground/65 hover:text-brand-accent"
                                                    >
                                                        {folder.name}
                                                    </button>
                                                )}
                                            </span>
                                        );
                                    })}
                                </div>
                                <div className="flex items-center gap-2">
                                    {!pickerKind && selectedCompany && (
                                        <>
                                            <input
                                                ref={uploadInputRef}
                                                type="file"
                                                accept="video/mp4,.mp4"
                                                className="hidden"
                                                onChange={(event) => {
                                                    const file = event.target.files?.[0];
                                                    if (file) void uploadToOps(file);
                                                }}
                                            />
                                            <button
                                                type="button"
                                                disabled={uploading}
                                                onClick={() => uploadInputRef.current?.click()}
                                                title={selectedFolder ? `Enviar MP4 para ${selectedFolder.name}` : 'Enviar MP4 para a raiz da empresa'}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-[10px] font-black text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-40"
                                            >
                                                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                                {uploading ? 'Enviando...' : 'Enviar MP4'}
                                            </button>
                                        </>
                                    )}
                                    {selectedFolder && visibleAssets.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => selectionMode ? leaveSelectionMode() : setSelectionMode(true)}
                                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-black transition ${selectionMode ? 'border-brand-lime/30 bg-brand-lime/12 text-brand-lime' : 'border-white/10 bg-white/[0.025] text-brand-muted hover:text-foreground'}`}
                                        >
                                            {selectionMode ? <X className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
                                            {selectionMode ? 'Cancelar seleção' : 'Selecionar'}
                                        </button>
                                    )}
                                    <div className="flex rounded-lg border border-white/10 bg-black/10 p-1">
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('grid')}
                                        className={`rounded-md p-1.5 ${viewMode === 'grid' ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted hover:text-foreground'}`}
                                        title="Visualização em grade"
                                    >
                                        <Grid2X2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('list')}
                                        className={`rounded-md p-1.5 ${viewMode === 'list' ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted hover:text-foreground'}`}
                                        title="Visualização em lista"
                                    >
                                        <List className="h-3.5 w-3.5" />
                                    </button>
                                    </div>
                                </div>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-brand-muted" />
                                <input
                                    value={assetQuery}
                                    onChange={(event) => setAssetQuery(event.target.value)}
                                    disabled={!selectedFolder}
                                    placeholder={!selectedFolder
                                        ? 'Abra uma pasta para pesquisar arquivos'
                                        : pickerKind
                                            ? `Buscar ${pickerKind === 'image' ? 'imagens' : 'vídeos'} nesta pasta`
                                            : 'Buscar arquivos nesta pasta'}
                                    className="w-full rounded-lg border border-white/10 bg-black/10 py-2 pl-9 pr-3 text-xs outline-none focus:border-brand-accent/50 disabled:cursor-not-allowed disabled:opacity-45"
                                />
                            </div>
                            {selectionMode && (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-lime/20 bg-brand-lime/[0.055] px-3 py-2.5">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedAssetIds(
                                            selectedAssets.length === visibleAssets.length
                                                ? new Set()
                                                : new Set(visibleAssets.map((asset) => asset.id))
                                        )}
                                        className="inline-flex items-center gap-2 text-[11px] font-bold text-foreground/75 hover:text-foreground"
                                    >
                                        {selectedAssets.length === visibleAssets.length ? <CheckSquare className="h-4 w-4 text-brand-lime" /> : <Square className="h-4 w-4" />}
                                        {selectedAssets.length === visibleAssets.length ? 'Desmarcar todos' : 'Selecionar todos'}
                                    </button>
                                    <div className="flex items-center gap-3">
                                        <span className="text-[10px] font-bold text-brand-muted">{selectedAssets.length} selecionado(s)</span>
                                        <button
                                            type="button"
                                            onClick={confirmSelection}
                                            disabled={!selectedAssets.length}
                                            className="rounded-lg bg-brand-lime px-3 py-2 text-[10px] font-black text-[#06110c] shadow-[0_0_18px_rgba(0,239,151,0.12)] disabled:cursor-not-allowed disabled:opacity-35"
                                        >
                                            {pickerKind ? `Adicionar ${selectedAssets.length || ''} ao projeto` : `Baixar ${selectedAssets.length || ''}`}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 custom-scrollbar" data-media-scroll-region="true">
                            {loading ? (
                                <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand-accent" /></div>
                            ) : visibleAssets.length === 0 && childFolders(selectedFolder?.id ?? null).length === 0 ? (
                                <div className="grid h-full place-items-center text-sm text-brand-muted">Nenhum arquivo encontrado.</div>
                            ) : viewMode === 'grid' ? (
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(145px,1fr))] gap-2">
                                    {childFolders(selectedFolder?.id ?? null).map((folder) => (
                                        <button
                                            type="button"
                                            key={folder.id}
                                            onClick={() => setSelectedFolder(folder)}
                                            className="group flex min-h-[108px] flex-col justify-between rounded-xl border border-white/8 bg-card/35 p-3 text-left transition hover:-translate-y-0.5 hover:border-brand-lime/25 hover:bg-brand-lime/[0.04]"
                                        >
                                            <div className="grid h-9 w-10 place-items-center rounded-lg border border-amber-300/15 bg-amber-300/10 text-amber-300">
                                                <Folder className="h-5 w-5 fill-current/20" />
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-2">
                                                <span className="truncate text-[11px] font-bold text-foreground">{folder.name}</span>
                                                <ChevronRight className="h-4 w-4 shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-brand-lime" />
                                            </div>
                                        </button>
                                    ))}
                                    {visibleAssets.map((asset) => (
                                        <article key={asset.id} className={`group overflow-hidden rounded-xl border bg-card/40 transition ${selectedAssetIds.has(asset.id) ? 'border-brand-lime/50 ring-1 ring-brand-lime/20' : 'border-white/10 hover:border-white/20'}`}>
                                            <button onPointerEnter={() => warmPreviewSource(asset)} onFocus={() => warmPreviewSource(asset)} onClick={() => void previewAsset(asset)} className="relative block aspect-video w-full bg-black/25">
                                                {thumbnailUrls[asset.id] ? (
                                                    <img src={thumbnailUrls[asset.id]} alt="" className="h-full w-full object-cover" />
                                                ) : asset.kind === 'image' ? (
                                                    <FileImage className="absolute inset-0 m-auto h-10 w-10 text-sky-400/60" />
                                                ) : asset.kind === 'audio' ? (
                                                    <Music2 className="absolute inset-0 m-auto h-10 w-10 text-brand-lime/60" />
                                                ) : (
                                                    <FileVideo className="absolute inset-0 m-auto h-10 w-10 text-violet-400/60" />
                                                )}
                                                <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                                                    <span className="rounded-full border border-white/15 bg-black/70 p-2.5"><Play className="h-4 w-4 fill-white text-white" /></span>
                                                </span>
                                                {selectionMode && (
                                                    <span
                                                        role="checkbox"
                                                        aria-checked={selectedAssetIds.has(asset.id)}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            toggleAssetSelection(asset.id);
                                                        }}
                                                        className="absolute left-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-black/75 text-white shadow-lg"
                                                    >
                                                        {selectedAssetIds.has(asset.id) ? <CheckSquare className="h-4 w-4 text-brand-lime" /> : <Square className="h-4 w-4" />}
                                                    </span>
                                                )}
                                            </button>
                                            <div className="space-y-1.5 p-2.5">
                                                <div className="truncate text-[11px] font-semibold" title={asset.name}>{asset.name}</div>
                                                <div className="flex justify-between gap-2 text-[9px] text-brand-muted">
                                                    <span className="capitalize">{asset.kind}</span><span>{formatBytes(asset.sizeBytes)}</span>
                                                </div>
                                                <div className="flex gap-1.5">
                                                    <button onClick={() => void downloadAsset(asset)} className={`${pickerKind ? '' : 'flex-1 justify-center'} inline-flex items-center gap-1.5 rounded-lg border border-white/10 p-1.5 text-[10px] font-bold text-brand-muted hover:text-foreground`} title="Baixar para Arquivos">
                                                        <ArrowDownToLine className="h-3.5 w-3.5" /> {!pickerKind && 'Baixar'}
                                                    </button>
                                                </div>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <div className="overflow-hidden rounded-xl border border-white/8">
                                    <div className="grid grid-cols-[minmax(0,1fr)_100px_120px] gap-3 border-b border-white/8 bg-white/[0.025] px-4 py-2 text-[9px] font-black uppercase tracking-wider text-brand-muted">
                                        <span>Nome</span><span>Tipo</span><span className="text-right">Ações</span>
                                    </div>
                                    {childFolders(selectedFolder?.id ?? null).map((folder) => (
                                        <button
                                            type="button"
                                            key={folder.id}
                                            onClick={() => setSelectedFolder(folder)}
                                            className="grid w-full grid-cols-[minmax(0,1fr)_100px_120px] items-center gap-3 border-b border-white/5 px-4 py-3 text-left hover:bg-white/[0.035]"
                                        >
                                            <span className="flex min-w-0 items-center gap-3"><Folder className="h-5 w-5 shrink-0 text-amber-300" /><span className="truncate text-xs font-semibold">{folder.name}</span></span>
                                            <span className="text-[10px] text-brand-muted">Pasta</span>
                                            <span className="flex justify-end"><ChevronRight className="h-4 w-4 text-brand-muted" /></span>
                                        </button>
                                    ))}
                                    {visibleAssets.map((asset) => (
                                        <div key={asset.id} className={`grid grid-cols-[minmax(0,1fr)_100px_120px] items-center gap-3 border-b px-4 py-2.5 last:border-0 ${selectedAssetIds.has(asset.id) ? 'border-brand-lime/10 bg-brand-lime/[0.055]' : 'border-white/5 hover:bg-white/[0.025]'}`}>
                                            <button onPointerEnter={() => warmPreviewSource(asset)} onFocus={() => warmPreviewSource(asset)} onClick={() => void previewAsset(asset)} className="flex min-w-0 items-center gap-3 text-left">
                                                {selectionMode && (
                                                    <span
                                                        role="checkbox"
                                                        aria-checked={selectedAssetIds.has(asset.id)}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            toggleAssetSelection(asset.id);
                                                        }}
                                                        className="text-brand-muted hover:text-foreground"
                                                    >
                                                        {selectedAssetIds.has(asset.id) ? <CheckSquare className="h-4 w-4 text-brand-lime" /> : <Square className="h-4 w-4" />}
                                                    </span>
                                                )}
                                                <span className="relative grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/30">
                                                    {thumbnailUrls[asset.id] ? <img src={thumbnailUrls[asset.id]} alt="" className="h-full w-full object-cover" /> : asset.kind === 'image' ? <FileImage className="h-5 w-5 text-sky-300" /> : <FileVideo className="h-5 w-5 text-violet-300" />}
                                                </span>
                                                <span className="min-w-0"><span className="block truncate text-xs font-semibold">{asset.name}</span><span className="mt-0.5 block text-[10px] text-brand-muted">{formatBytes(asset.sizeBytes)}</span></span>
                                            </button>
                                            <span className="text-[10px] capitalize text-brand-muted">{asset.kind}</span>
                                            <span className="flex justify-end gap-1.5">
                                                <button onClick={() => void downloadAsset(asset)} className="rounded-lg border border-white/10 p-1.5 text-brand-muted hover:text-foreground" title="Baixar para Arquivos"><ArrowDownToLine className="h-3.5 w-3.5" /></button>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </section>
            </div>

            {preview && (
                <div className="fixed inset-0 z-100 grid place-items-center bg-black/90 p-5" onClick={() => setPreview(null)}>
                    <div className="relative max-w-5xl w-full" onClick={(event) => event.stopPropagation()}>
                        <button onClick={() => setPreview(null)} className="absolute -top-11 right-0 rounded-full bg-white/10 p-2 text-white"><X className="w-5 h-5" /></button>
                        {preview.asset.kind === 'image' ? (
                            <img src={preview.url} alt={preview.asset.name} className="w-full max-h-[80vh] object-contain rounded-xl bg-black" />
                        ) : preview.delivery === 'hls' ? (
                            <div className="rounded-xl border border-white/10 bg-card p-8 text-center">
                                <p className="text-sm text-foreground/70">Esta entrega usa HLS e não pode ser reproduzida diretamente neste dispositivo.</p>
                            </div>
                        ) : (
                            <MiletoMediaPlayer src={preview.url} title={preview.asset.name} />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OpsLibrary;
