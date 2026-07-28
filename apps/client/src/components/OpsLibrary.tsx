import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowDownToLine, Building2, Check, ChevronDown, ChevronRight,
    CheckSquare, Crown, FileImage, FileVideo, Folder, Grid2X2, List, Loader2, Music2, Play,
    Search, ShieldCheck, Sparkles, Square, UserRound, UsersRound, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    gatewayApi,
    GatewayError,
    type OpsAsset,
    type OpsCompany,
    type OpsFolder,
    type OpsViewContext,
} from '../lib/gateway';
import { API_BASE_URL } from '../lib/apiBase';
import { localAuthHeaders } from '../lib/serverAuth';
import { useWizard } from '../context/WizardContext';
import type { MediaTake } from '../types';
import { useDownloadJobs } from '../context/DownloadJobsContext';
import { MiletoMediaPlayer } from './MiletoMediaPlayer';

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

const OPS_EDITOR_IMPORT_CONCURRENCY = 3;
const RETRYABLE_MATERIALIZE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

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
    const { addMediaTakes } = useWizard();
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
    const contextRecoveryRef = useRef<Promise<void> | null>(null);
    const [preview, setPreview] = useState<{ asset: OpsAsset; url: string; delivery?: string } | null>(null);
    const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

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
        setContextExpiresAt(Date.now() + Math.max(60, Number(response.data.expiresIn) || 600) * 1000);
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
        const candidates = assets.filter((asset) => asset.capabilities?.thumbnail).slice(0, 40);
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
            let completed = 0;
            const orderedTakes: Array<MediaTake | null> = Array.from({ length: total }, () => null);
            const failures: unknown[] = [];
            let nextIndex = 0;

            const worker = async () => {
                while (nextIndex < total) {
                    const index = nextIndex;
                    nextIndex += 1;
                    try {
                        orderedTakes[index] = await materializeAsset(batch[index]);
                    } catch (error) {
                        failures.push(error);
                    } finally {
                        completed += 1;
                        const percent = Math.round((completed / total) * 100);
                        updateClientJob(activityId, {
                            percent,
                            stepPercent: percent,
                            statusText: `Preparando ${completed} de ${total}`,
                        });
                    }
                }
            };

            await Promise.all(
                Array.from(
                    { length: Math.min(OPS_EDITOR_IMPORT_CONCURRENCY, total) },
                    () => worker()
                )
            );

            const takes = orderedTakes.filter((take): take is MediaTake => take !== null);

            if (takes.length) addMediaTakes(takes);

            if (!takes.length) {
                const firstError = failures[0];
                updateClientJob(activityId, {
                    phase: 'error',
                    completedAt: Date.now(),
                    error: firstError instanceof Error ? firstError.message : 'Não foi possível preparar as mídias.',
                });
                return;
            }

            updateClientJob(activityId, {
                phase: 'done',
                percent: 100,
                stepPercent: 100,
                completedAt: Date.now(),
                statusText: failures.length ? `${takes.length} adicionada(s), ${failures.length} falhou(aram)` : 'Adicionado ao projeto',
            });
            if (failures.length) toast.warning(`${takes.length} mídia(s) adicionada(s); ${failures.length} não puderam ser preparadas.`);
        })();
    };

    const previewAsset = async (asset: OpsAsset) => {
        try {
            const result = await gatewayApi.opsAssetUrl(
                asset.id,
                asset.kind === 'image' ? 'download' : 'stream',
                selectedContext?.contextId
            );
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

    const materializeAsset = async (asset: OpsAsset): Promise<MediaTake> => {
        if (!['video', 'image'].includes(asset.kind)) {
            throw new Error('Por enquanto, somente vídeos e imagens entram como take no editor.');
        }
        const reference = await gatewayApi.createOpsReference(asset.id, selectedContext?.contextId);
        let source: MaterializedOpsSource | null = null;
        let lastError: GatewayError | null = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const response = await fetch(`${API_BASE_URL}/api/ops/cache/materialize`, {
                method: 'POST',
                headers: {
                    ...(await localAuthHeaders()),
                    'Content-Type': 'application/json',
                    ...(selectedContext?.contextId
                        ? { 'X-Ops-View-Context': selectedContext.contextId }
                        : {}),
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
            if (attempt >= 2 || !RETRYABLE_MATERIALIZE_STATUS.has(response.status)) throw lastError;
            await wait(650 * (attempt + 1));
        }

        if (!source) throw lastError || new Error('Falha ao preparar a mídia.');
        const type: MediaTake['type'] = source.type === 'image' ? 'image' : 'video';
        const duration = Number(source.duration || (type === 'image' ? 3.5 : 0));
        return {
            id: crypto.randomUUID(),
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
        <div className="h-full flex flex-col bg-background border border-black/5 dark:border-white/5 rounded-2xl overflow-hidden">
            <header className="relative z-30 flex items-center justify-between gap-4 border-b border-black/5 dark:border-white/5 bg-card/35 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet-400/20 bg-gradient-to-br from-violet-500/20 via-violet-500/10 to-brand-lime/10 text-violet-300 shadow-[0_0_28px_rgba(139,92,246,0.12)]">
                        <ShieldCheck className="h-5 w-5" />
                        <Sparkles className="absolute -right-1 -top-1 h-3.5 w-3.5 text-brand-lime" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-foreground">Biblioteca Mileto Ops</span>
                            <span className="rounded-full border border-brand-lime/20 bg-brand-lime/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-brand-lime">
                                acesso seguro
                            </span>
                        </div>
                        <p className="truncate text-[11px] text-brand-muted">
                            Conteúdo filtrado pela hierarquia e carteira definidas no Ops
                        </p>
                    </div>
                </div>

                {selectedContext && (
                    <div className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => setContextMenuOpen((open) => !open)}
                            aria-haspopup="listbox"
                            aria-expanded={contextMenuOpen}
                            className="group flex min-w-[240px] items-center gap-3 rounded-xl border border-violet-400/20 bg-black/10 px-3 py-2 text-left shadow-[0_12px_35px_rgba(0,0,0,0.16)] transition hover:border-violet-400/40 hover:bg-violet-500/5"
                        >
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300 transition group-hover:bg-violet-500/20">
                                <ViewContextIcon mode={selectedContext.mode} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-bold text-foreground">{selectedContext.label}</span>
                                <span className="block truncate text-[10px] text-brand-muted">{selectedContext.subtitle}</span>
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

            <div className="min-h-0 flex-1 grid grid-cols-[260px_1fr]">
            <aside className="min-h-0 overflow-y-auto overscroll-contain border-r border-black/5 p-3 custom-scrollbar dark:border-white/5">
                <div className="relative mb-3">
                    <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-brand-muted" />
                    <input
                        value={companyQuery}
                        onChange={(event) => setCompanyQuery(event.target.value)}
                        placeholder="Buscar empresa"
                        className="w-full rounded-lg border border-white/10 bg-black/10 py-2 pl-9 pr-3 text-xs outline-none focus:border-brand-accent/50"
                    />
                </div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-brand-muted px-2 mb-1">Empresas permitidas</div>
                <div className="space-y-1">
                    {filteredCompanies.map((company) => (
                        <button
                            key={company.id}
                            onClick={() => void loadCompany(company)}
                            className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition ${
                                selectedCompany?.id === company.id ? 'bg-brand-accent/15 text-brand-accent' : 'hover:bg-white/5 text-foreground/70'
                            }`}
                        >
                            <Building2 className="w-4 h-4 shrink-0" />
                            <span className="truncate">{companyName(company)}</span>
                        </button>
                    ))}
                </div>
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
                                    {selectedFolder && (
                                        <>
                                            <ChevronRight className="h-3.5 w-3.5 text-brand-muted" />
                                            <span className="truncate text-foreground/65">{selectedFolder.name}</span>
                                        </>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
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

                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 custom-scrollbar" data-media-scroll-region="true">
                            {loading ? (
                                <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand-accent" /></div>
                            ) : visibleAssets.length === 0 && (selectedFolder || folders.length === 0) ? (
                                <div className="grid h-full place-items-center text-sm text-brand-muted">Nenhum arquivo encontrado.</div>
                            ) : viewMode === 'grid' ? (
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                                    {!selectedFolder && folders.map((folder) => (
                                        <button
                                            type="button"
                                            key={folder.id}
                                            onClick={() => setSelectedFolder(folder)}
                                            className="group flex min-h-[148px] flex-col justify-between rounded-2xl border border-white/8 bg-card/35 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-lime/25 hover:bg-brand-lime/[0.04]"
                                        >
                                            <div className="grid h-12 w-14 place-items-center rounded-xl border border-amber-300/15 bg-amber-300/10 text-amber-300">
                                                <Folder className="h-7 w-7 fill-current/20" />
                                            </div>
                                            <div className="mt-5 flex items-center justify-between gap-2">
                                                <span className="truncate text-xs font-bold text-foreground">{folder.name}</span>
                                                <ChevronRight className="h-4 w-4 shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-brand-lime" />
                                            </div>
                                        </button>
                                    ))}
                                    {visibleAssets.map((asset) => (
                                        <article key={asset.id} className={`group overflow-hidden rounded-2xl border bg-card/40 transition ${selectedAssetIds.has(asset.id) ? 'border-brand-lime/50 ring-1 ring-brand-lime/20' : 'border-white/10 hover:border-white/20'}`}>
                                            <button onClick={() => void previewAsset(asset)} className="relative block aspect-video w-full bg-black/25">
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
                                            <div className="space-y-2 p-3">
                                                <div className="truncate text-xs font-semibold" title={asset.name}>{asset.name}</div>
                                                <div className="flex justify-between gap-2 text-[10px] text-brand-muted">
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
                                    {!selectedFolder && folders.map((folder) => (
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
                                            <button onClick={() => void previewAsset(asset)} className="flex min-w-0 items-center gap-3 text-left">
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
