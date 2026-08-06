import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Download, Film, HardDrive, Search, Users, Building2, Loader2, X, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import type { MediaTake } from '../types';
import { useWizard } from '../context/WizardContext';
import { useExportJobs } from '../context/ExportJobsContext';
import { API_BASE_URL } from '../lib/apiBase';
import { gatewayApi, type OpsCompany, type OpsFolder } from '../lib/gateway';
import { localAuthHeaders } from '../lib/serverAuth';
import { bindTitlesToBrandPalette, resolveOpsProjectBrand } from '../lib/opsProjectBrand';

type DestinationKind = 'local' | 'shared' | 'ops';
type FolderOption = { label: string; value: string };
type SelectOption = { label: string; value: string };
const flattenFolders = (node: { name: string; relPath: string; children?: unknown[] }, prefix = ''): FolderOption[] => {
    const path = node.relPath === '/' ? '' : node.relPath;
    const children = Array.isArray(node.children) ? node.children as Array<{ name: string; relPath: string; children?: unknown[] }> : [];
    return [...(path ? [{ value: path, label: `${prefix}${node.name}` }] : []), ...children.flatMap((child) => flattenFolders(child, `${prefix}${path ? '— ' : ''}`))];
};

export const PremiumSelect = ({
    value,
    options,
    placeholder,
    onChange,
    searchable = false,
    searchPlaceholder = 'Buscar...',
    emptyLabel = 'Nenhum resultado encontrado.',
}: {
    value: string;
    options: SelectOption[];
    placeholder: string;
    onChange: (_value: string) => void;
    searchable?: boolean;
    searchPlaceholder?: string;
    emptyLabel?: string;
}) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = options.find((option) => option.value === value);
    const visibleOptions = options.filter((option) => option.label.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')));

    // Fecha ao clicar fora (evita dois dropdowns abertos ao mesmo tempo)
    useEffect(() => {
        if (!open) return;
        const onDoc = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    return (
        <div ref={rootRef} className="relative min-w-0">
            <button
                type="button"
                onClick={() => { setOpen((current) => !current); setQuery(''); }}
                className={cn('flex w-full items-center justify-between gap-2 rounded-xl border bg-black/50 px-3 py-3 text-left text-xs font-semibold transition', open ? 'border-brand-accent/70 shadow-[0_0_18px_rgba(0,230,118,0.13)]' : 'border-white/10 hover:border-white/20')}
            >
                <span className={cn('truncate', selected ? 'text-foreground' : 'text-brand-muted')}>{selected?.label || placeholder}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-brand-accent transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-brand-accent/25 bg-[#0b1214] shadow-[0_18px_40px_rgba(0,0,0,.65)] ring-1 ring-white/5">
                    {searchable && <div className="border-b border-white/8 p-2"><div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2.5 py-2"><Search className="h-3.5 w-3.5 text-brand-accent" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-brand-muted" /></div></div>}
                    <div className="max-h-48 overflow-y-auto p-1.5">
                        {visibleOptions.length ? visibleOptions.map((option) => <button type="button" key={option.value} onClick={() => { onChange(option.value); setOpen(false); }} className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition', option.value === value ? 'bg-brand-accent/15 text-brand-accent' : 'text-foreground/85 hover:bg-white/7 hover:text-foreground')}><span className="truncate">{option.label}</span>{option.value === value && <Check className="h-3.5 w-3.5 shrink-0" />}</button>) : <p className="px-2.5 py-4 text-center text-xs text-brand-muted">{emptyLabel}</p>}
                    </div>
                </div>
            )}
        </div>
    );
};

interface ExportModalProps {
    onClose: () => void;
    mediaTakes: MediaTake[];
    masterAudioUrl?: string;
    transitionPath?: string;
    transitionRotation?: 0 | 90 | 180 | 270;
}

export const ExportModal = ({ onClose, mediaTakes, masterAudioUrl, transitionPath, transitionRotation = 0 }: ExportModalProps) => {
    const { adData, captionStyle, projectId, saveProject, updateAdData } = useWizard();
    const { isExporting, startExport } = useExportJobs();
    const navigate = useNavigate();
    // O título do projeto é a fonte única para o rascunho e para o MP4.
    // Evita que o nome exibido na biblioteca e o arquivo exportado divirjam.
    const exportFileName = adData.title?.trim() || 'MeuVideo_Mileto';
    const [fps, setFps] = useState(30);
    const [starting, setStarting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [destinationKind, setDestinationKind] = useState<DestinationKind>('local');
    const [libraryFolders, setLibraryFolders] = useState<FolderOption[]>([]);
    const [destinationFolder, setDestinationFolder] = useState('Vídeos');
    const [companies, setCompanies] = useState<OpsCompany[]>([]);
    const [opsCompanyId, setOpsCompanyId] = useState('');
    const [opsFolders, setOpsFolders] = useState<OpsFolder[]>([]);
    const [opsFolderId, setOpsFolderId] = useState('');
    const [opsViewContextId, setOpsViewContextId] = useState<string | null>(null);
    const [targetDims, setTargetDims] = useState({ w: 1080, h: 1920 });

    useEffect(() => {
        let cancelled = false;
        const probe = (url: string): Promise<{ w: number; h: number } | null> =>
            new Promise((resolve) => {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.muted = true;
                video.onloadedmetadata = () => resolve({ w: video.videoWidth, h: video.videoHeight });
                video.onerror = () => resolve(null);
                video.src = url;
            });

        const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

        void (async () => {
            const dimensions = await Promise.all(
                mediaTakes.filter((take) => take.type === 'video').map((take) => probe(take.fileUrl || take.url))
            );
            const valid = dimensions.filter((item): item is { w: number; h: number } => !!item?.w && !!item?.h);
            if (cancelled) return;

            // O overlay (títulos, legendas e CTA) é SEMPRE desenhado numa caixa com a proporção
            // do formato — 9:16 no retrato, 1:1 no quadrado — exatamente igual ao preview. Se a
            // saída sair com outra proporção (ex.: dimensões cruas da fonte, que raramente são
            // 9:16 exato), o overlay é esticado/cortado e o vídeo não bate com o preview.
            // Por isso travamos a saída NA proporção do formato; a resolução vem do maior lado
            // da fonte, limitada a 1080p (padrão de anúncio vertical).
            const isSquare = adData.format === '1:1';
            const longestSide = valid.length
                ? Math.max(...valid.map((item) => Math.max(item.w, item.h)))
                : 1920;
            const base = Math.min(1920, Math.max(1080, longestSide));
            setTargetDims(
                isSquare ? { w: even(base), h: even(base) } : { w: even((base * 9) / 16), h: even(base) }
            );
        })();

        return () => {
            cancelled = true;
        };
    }, [mediaTakes, adData.format]);

    const takesDuration = mediaTakes.reduce((total, take) => total + (take.trim.end - take.trim.start), 0);
    const totalDuration = Number(adData.narrationDuration || 0) > 0 ? Number(adData.narrationDuration) : takesDuration;

    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainder = Math.floor(seconds % 60);
        return `${minutes}m ${remainder}s`;
    };

    useEffect(() => {
        if (destinationKind === 'ops') return;
        void (async () => {
            try {
                const isShared = destinationKind === 'shared';
                const response = await fetch(`${API_BASE_URL}/api/${isShared ? 'shared/files' : 'files'}/tree`, { headers: isShared ? await localAuthHeaders() : {} });
                const data = await response.json();
                if (!response.ok || !data.ok) throw new Error(data.message);
                const folders = flattenFolders(data.root).filter((folder) => folder.value.startsWith('Vídeos'));
                setLibraryFolders(folders);
                setDestinationFolder((current) => folders.some((folder) => folder.value === current) ? current : (folders[0]?.value || 'Vídeos'));
            } catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Não foi possível carregar as pastas.'); }
        })();
    }, [destinationKind]);

    useEffect(() => {
        if (destinationKind !== 'ops') return;
        void (async () => {
            try {
                const contexts = await gatewayApi.opsViewContexts();
                const context = contexts.data.contexts.find((item) => item.contextId === contexts.data.defaultContextId) || contexts.data.contexts[0];
                setOpsViewContextId(context?.contextId || null);
                const response = await gatewayApi.opsCompanies('', context?.contextId);
                setCompanies(response.data);
                setOpsCompanyId((current) => current || response.data[0]?.id || '');
            } catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Não foi possível carregar as empresas do Mileto Ops.'); }
        })();
    }, [destinationKind]);

    useEffect(() => {
        if (destinationKind !== 'ops' || !opsCompanyId) return;
        void gatewayApi.opsFolders(opsCompanyId, opsViewContextId).then((response) => {
            setOpsFolders(response.data); setOpsFolderId((current) => current || response.data[0]?.id || '');
        }).catch((error) => setErrorMsg(error instanceof Error ? error.message : 'Não foi possível carregar as pastas da empresa.'));
    }, [destinationKind, opsCompanyId, opsViewContextId]);

    const handleFinishWithoutExport = useCallback(async () => {
        setStarting(true);
        const saved = await saveProject({ lastStep: 4 });
        setStarting(false);
        if (!saved) {
            toast.error('Não foi possível salvar o rascunho. Nenhuma edição foi descartada.');
            return;
        }
        toast.success('Edição concluída sem exportar. Você pode retomá-la quando quiser.');
        onClose();
        navigate('/');
    }, [navigate, onClose, saveProject]);

    const handleExport = useCallback(async () => {
        if (starting || isExporting) {
            setErrorMsg('Já existe uma exportação em andamento. Acompanhe pelo sino de atividades.');
            return;
        }
        if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
            setErrorMsg('A duração final do projeto é inválida. Confira a narração e os takes.');
            return;
        }

        setStarting(true);
        setErrorMsg('');
        if (destinationKind === 'ops' && !opsCompanyId) {
            setStarting(false);
            setErrorMsg('Selecione a empresa de destino no Mileto Ops.');
            return;
        }
        let exportAdData = adData;
        if (adData.opsCompany?.id) {
            try {
                const resolvedBrand = await resolveOpsProjectBrand(adData.opsCompany);
                if (resolvedBrand.required) {
                    exportAdData = {
                        ...adData,
                        brandPalette: resolvedBrand.palette,
                        brandPaletteUpdatedAt: resolvedBrand.paletteUpdatedAt,
                    };
                    exportAdData = {
                        ...exportAdData,
                        dynamicTitles: bindTitlesToBrandPalette(exportAdData),
                    };
                    updateAdData({
                        brandPalette: exportAdData.brandPalette,
                        brandPaletteUpdatedAt: exportAdData.brandPaletteUpdatedAt,
                        dynamicTitles: exportAdData.dynamicTitles,
                    });
                }
            } catch (error) {
                setStarting(false);
                setErrorMsg(error instanceof Error ? error.message : 'Não foi possível atualizar a paleta no Mileto Ops.');
                return;
            }
        }
        const saved = await saveProject({ lastStep: 4 });
        if (!saved) {
            setStarting(false);
            setErrorMsg('Não foi possível salvar o projeto antes da exportação. Nenhuma edição foi descartada.');
            return;
        }

        const jobId = startExport({
            fileName: exportFileName,
            outputFolder: destinationKind === 'local' ? `Biblioteca local › ${destinationFolder}` : destinationKind === 'shared' ? `Compartilhado › ${destinationFolder}` : 'Mileto Ops',
            fps,
            totalDuration,
            targetDims,
            mediaTakes: [...mediaTakes],
            masterAudioUrl,
            transitionPath,
            transitionRotation,
            adData: {
                ...exportAdData,
                dynamicTitles: [...(exportAdData.dynamicTitles || [])],
                captions: exportAdData.captions ? { ...exportAdData.captions, segments: [...exportAdData.captions.segments] } : undefined,
            },
            captionStyle: captionStyle ? { ...captionStyle } : null,
            projectId,
            destination: { kind: destinationKind, folderPath: destinationFolder, companyId: opsCompanyId, opsFolderId: opsFolderId || null, viewContextId: opsViewContextId },
        });
        setStarting(false);
        if (!jobId) {
            setErrorMsg('Já existe uma exportação em andamento. Acompanhe pelo sino de atividades.');
            return;
        }

        toast.success('Exportação iniciada em segundo plano. Acompanhe o progresso pelo sino.');
        onClose();
        navigate('/');
    }, [
        adData,
        captionStyle,
        exportFileName,
        fps,
        isExporting,
        masterAudioUrl,
        mediaTakes,
        navigate,
        onClose,
        destinationFolder,
        destinationKind,
        opsCompanyId,
        opsFolderId,
        opsViewContextId,
        projectId,
        saveProject,
        startExport,
        starting,
        targetDims,
        totalDuration,
        transitionPath,
        transitionRotation,
        updateAdData,
    ]);

    return createPortal(
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
            <div className="relative z-101 flex w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-brand-accent/30 bg-brand-dark/95 shadow-[0_0_50px_rgba(0,230,118,0.15)] ring-1 ring-white/5">
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[20px_20px] opacity-20" />
                <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-white/10 bg-brand-card/50 px-6 py-5">
                    <div className="flex items-center gap-4">
                        <div className="rounded-xl border border-brand-accent/20 bg-brand-accent/10 p-2.5 shadow-[0_0_15px_rgba(0,230,118,0.2)]">
                            <Film className="h-6 w-6 text-brand-accent" />
                        </div>
                        <div>
                            <h3 className="text-[15px] font-black uppercase tracking-wider text-foreground">
                                Exportar Vídeo
                            </h3>
                            <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-brand-muted">
                                {formatDuration(totalDuration)} • {mediaTakes.length}{' '}
                                {mediaTakes.length === 1 ? 'clipe' : 'clipes'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={starting}
                        className="rounded-full bg-white/5 p-2 text-brand-muted transition hover:bg-red-500/20 hover:text-red-400 disabled:opacity-40"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="relative z-10 flex flex-col gap-6 p-8">
                    <div className="flex flex-col gap-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-brand-accent">
                            Título do projeto e nome do arquivo
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="text"
                                value={exportFileName}
                                readOnly
                                aria-readonly="true"
                                className="flex-1 cursor-default rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm font-semibold text-foreground outline-none"
                            />
                            <span className="rounded-xl border border-white/5 bg-white/5 px-3 py-3 font-mono text-xs font-bold text-brand-muted">
                                .MP4
                            </span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-brand-muted">
                            Para alterar o nome do MP4, edite o título do projeto na etapa 1.
                        </p>
                    </div>

                    <div className="flex flex-col gap-2.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-brand-accent">Destino da exportação</label>
                        <div className="grid grid-cols-3 gap-2">
                            {([['local', HardDrive, 'Local'], ['shared', Users, 'Compartilhado'], ['ops', Building2, 'Mileto Ops']] as const).map(([kind, Icon, label]) => <button key={kind} onClick={() => { setDestinationKind(kind); setErrorMsg(''); }} className={cn('flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-[10px] font-bold transition', destinationKind === kind ? 'border-brand-accent bg-brand-accent/10 text-brand-accent' : 'border-white/10 bg-black/30 text-brand-muted hover:text-foreground')}><Icon className="h-4 w-4" />{label}</button>)}
                        </div>
                        {destinationKind === 'ops' ? <div className="grid grid-cols-2 gap-2"><PremiumSelect value={opsCompanyId} placeholder="Selecionar empresa" searchable searchPlaceholder="Buscar empresa..." options={companies.map((company) => ({ value: company.id, label: company.name || company.nome || 'Empresa sem nome' }))} onChange={(value) => { setOpsCompanyId(value); setOpsFolderId(''); }} /><PremiumSelect value={opsFolderId} placeholder="Pasta raiz" searchable searchPlaceholder="Buscar pasta..." options={[{ value: '', label: 'Pasta raiz' }, ...opsFolders.map((folder) => ({ value: folder.id, label: folder.name }))]} onChange={setOpsFolderId} /></div> : <PremiumSelect value={destinationFolder} placeholder="Selecionar pasta" searchable searchPlaceholder="Buscar pasta..." options={libraryFolders} onChange={setDestinationFolder} />}
                        <p className="text-[11px] text-brand-muted">{destinationKind === 'local' ? 'O MP4 será salvo diretamente na biblioteca deste programa.' : destinationKind === 'shared' ? 'O MP4 será enviado para a pasta compartilhada da equipe.' : 'Escolha a empresa e a pasta que receberão o vídeo no Mileto Ops.'}</p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-brand-accent">
                            Taxa de quadros
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            {[24, 30, 60].map((value) => (
                                <button
                                    key={value}
                                    onClick={() => setFps(value)}
                                    className={cn(
                                        'rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-wider transition',
                                        fps === value
                                            ? 'border-brand-accent bg-brand-accent/10 text-brand-accent'
                                            : 'border-white/10 bg-black/30 text-brand-muted hover:text-foreground'
                                    )}
                                >
                                    {value} FPS
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-brand-accent/10 bg-brand-accent/5 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-brand-muted">
                        <span>{masterAudioUrl ? 'Áudio master incluído' : 'Exportação sem áudio'}</span>
                        <span className="text-brand-lime">
                            {targetDims.w}×{targetDims.h}
                        </span>
                    </div>

                    {errorMsg && (
                        <div className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300">
                            <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {errorMsg}
                        </div>
                    )}

                    <div className="rounded-xl border border-brand-lime/15 bg-brand-lime/[0.055] px-4 py-3 text-[11px] leading-relaxed text-foreground/70">
                        Ao iniciar, você voltará ao Início. O vídeo continuará sendo processado e o progresso aparecerá
                        no sino de atividades.
                    </div>
                </div>

                <div className="relative z-10 flex shrink-0 justify-end gap-4 border-t border-white/10 bg-brand-card/80 px-8 py-5">
                    <button
                        onClick={() => void handleFinishWithoutExport()}
                        disabled={starting}
                        className="rounded-xl border border-white/10 bg-white/5 px-5 py-3.5 text-[10px] font-bold uppercase tracking-wider text-brand-muted hover:text-foreground disabled:opacity-40"
                    >
                        Concluir sem exportar
                    </button>
                    <button
                        onClick={() => void handleExport()}
                        disabled={starting || isExporting}
                        className="flex items-center gap-3 rounded-xl bg-linear-to-r from-brand-lime to-brand-accent px-8 py-3.5 text-xs font-black uppercase tracking-widest text-[#0a0f12] transition hover:shadow-[0_0_25px_rgba(0,230,118,0.4)] disabled:opacity-45"
                    >
                        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {starting
                            ? 'Salvando projeto...'
                            : isExporting
                              ? 'Exportação em andamento'
                              : 'Exportar em segundo plano'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
