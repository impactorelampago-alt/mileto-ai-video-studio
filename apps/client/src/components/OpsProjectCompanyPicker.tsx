import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Building2, Check, ChevronDown, Loader2, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useWizard } from '../context/WizardContext';
import { useAuth } from '../context/AuthContext';
import { OpsViewContextPicker } from './OpsViewContextPicker';
import {
    isRealOpsCompany,
    bindTitlesToBrandPalette,
    loadOpsBrandDirectory,
    opsProjectCompanyName,
    opsViewContextIdentity,
} from '../lib/opsProjectBrand';
import { normalizeBrandPalette } from '../lib/brandPalette';
import type { OpsCompany, OpsViewContext } from '../lib/gateway';
import type { OpsProjectCompany } from '../types';

export interface OpsCompanyRequirementState {
    loading: boolean;
    required: boolean;
    linked: boolean;
    selected: boolean;
    autoSelected: boolean;
}

interface Props {
    onRequirementChange?: (state: OpsCompanyRequirementState) => void;
}

const searchableName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const defaultCompany = (companies: OpsCompany[], organizationName?: string | null) => {
    const preferred = [organizationName, 'Impacto Relâmpago'].filter(Boolean).map((name) => searchableName(String(name)));
    return companies.find((company) => preferred.some((name) => searchableName(opsProjectCompanyName(company)) === name))
        || companies.find((company) => searchableName(opsProjectCompanyName(company)).includes('impacto'))
        || companies[0]
        || null;
};

const OpsCompanySelect = ({
    companies,
    value,
    onChange,
}: {
    companies: OpsCompany[];
    value: string | null;
    onChange: (_companyId: string) => void;
}) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = companies.find((company) => company.id === value) || null;
    const visible = companies.filter((company) => searchableName(opsProjectCompanyName(company)).includes(searchableName(query)));

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-haspopup="listbox"
                aria-expanded={open}
                className="group flex w-full items-center gap-2 rounded-xl border border-brand-lime/25 bg-black/20 px-3 py-2.5 text-left transition hover:border-brand-lime/50 hover:bg-brand-lime/[0.055]"
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-lime/12 text-brand-lime"><Building2 className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-foreground">{selected ? opsProjectCompanyName(selected) : 'Escolha uma empresa'}</span>
                    <span className="block truncate text-[10px] text-brand-muted">{selected ? 'Marca e paleta do projeto' : 'A agência será usada como padrão'}</span>
                </span>
                {selected && (() => {
                    const colors = normalizeBrandPalette(selected.palette);
                    return colors ? <span className="mr-1 flex shrink-0 -space-x-1">{[colors.primary, colors.secondary, colors.tertiary].map((color) => <span key={color} className="h-4 w-4 rounded-full border-2 border-[#0b1115]" style={{ backgroundColor: color }} />)}</span> : null;
                })()}
                <ChevronDown className={`h-4 w-4 shrink-0 text-brand-muted transition ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div role="listbox" aria-label="Empresa do projeto" className="absolute left-0 right-0 top-[calc(100%+8px)] z-[60] overflow-hidden rounded-2xl border border-brand-lime/25 bg-[#0b1115]/98 shadow-[0_28px_80px_rgba(0,0,0,.6),0_0_36px_rgba(0,230,118,.06)] backdrop-blur-xl">
                    <div className="border-b border-white/7 bg-linear-to-r from-brand-lime/10 via-transparent to-violet-500/5 px-4 py-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-white"><Building2 className="h-4 w-4 text-brand-lime" /> Empresa e marca do projeto</div>
                        <p className="mt-1 text-[10px] text-white/40">A paleta permanece sincronizada com o Mileto Ops.</p>
                    </div>
                    <div className="p-2">
                        {companies.length > 6 && (
                            <label className="mb-2 flex h-9 items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-3"><Search className="h-3.5 w-3.5 text-white/35" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/25" /></label>
                        )}
                        <div className="custom-scrollbar max-h-[300px] overflow-y-auto">
                            {visible.map((company) => {
                                const active = company.id === selected?.id;
                                const palette = normalizeBrandPalette(company.palette);
                                return (
                                    <button key={company.id} type="button" role="option" aria-selected={active} onClick={() => { onChange(company.id); setOpen(false); setQuery(''); }} className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active ? 'border-brand-lime/30 bg-brand-lime/10' : 'border-transparent hover:border-white/8 hover:bg-white/5'}`}>
                                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black uppercase ${active ? 'bg-brand-lime text-[#07110d]' : 'bg-brand-lime/10 text-brand-lime'}`}>{opsProjectCompanyName(company).slice(0, 1)}</span>
                                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-white">{opsProjectCompanyName(company)}</span><span className="block truncate text-[10px] text-white/40">Empresa autorizada no Ops</span></span>
                                        {palette && <span className="flex shrink-0 -space-x-1">{[palette.primary, palette.secondary, palette.tertiary].map((color) => <span key={color} className="h-4 w-4 rounded-full border-2 border-[#0b1115]" style={{ backgroundColor: color }} />)}</span>}
                                        {active && <Check className="h-4 w-4 shrink-0 text-brand-lime" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const OpsProjectCompanyPicker = ({ onRequirementChange }: Props) => {
    const { adData, updateAdData, captionStyle, setCaptionStyle } = useWizard();
    const { user } = useAuth();
    const navigate = useNavigate();
    const adDataRef = useRef(adData);
    adDataRef.current = adData;
    const captionStyleRef = useRef(captionStyle);
    captionStyleRef.current = captionStyle;
    const autoSelectedIdRef = useRef<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [required, setRequired] = useState(false);
    const [linked, setLinked] = useState(false);
    const [contexts, setContexts] = useState<OpsViewContext[]>([]);
    const [context, setContext] = useState<OpsViewContext | null>(null);
    const [companies, setCompanies] = useState<OpsCompany[]>([]);
    const [error, setError] = useState('');
    const [autoSelected, setAutoSelected] = useState(false);
    const storedSelection = useMemo<OpsProjectCompany | null>(() => adData.opsCompany ? {
        id: adData.opsCompany.id,
        name: adData.opsCompany.name,
        viewContextIdentity: adData.opsCompany.viewContextIdentity,
        viewContextLabel: adData.opsCompany.viewContextLabel,
    } : null, [
        adData.opsCompany?.id,
        adData.opsCompany?.name,
        adData.opsCompany?.viewContextIdentity,
        adData.opsCompany?.viewContextLabel,
    ]);

    useEffect(() => {
        onRequirementChange?.({ loading, required, linked, selected: Boolean(adData.opsCompany?.id), autoSelected });
    }, [adData.opsCompany?.id, autoSelected, linked, loading, onRequirementChange, required]);

    const applyCompanySelection = useCallback((company: OpsCompany, selectedContext: OpsViewContext, automatic: boolean) => {
        const palette = normalizeBrandPalette(company.palette);
        const currentAdData = adDataRef.current;
        const nextAdData = { ...currentAdData, brandPalette: palette, brandPaletteUpdatedAt: palette ? company.paletteUpdatedAt ?? null : null };
        autoSelectedIdRef.current = automatic ? company.id : null;
        setAutoSelected(automatic);
        updateAdData({
            opsCompany: {
                id: company.id,
                name: opsProjectCompanyName(company),
                viewContextIdentity: opsViewContextIdentity(selectedContext),
                viewContextLabel: selectedContext.label,
            },
            brandPalette: palette,
            brandPaletteUpdatedAt: palette ? company.paletteUpdatedAt ?? null : null,
            dynamicTitles: bindTitlesToBrandPalette(nextAdData),
        });
        const currentCaptionStyle = captionStyleRef.current;
        if (
            palette &&
            currentCaptionStyle &&
            (currentCaptionStyle.activeColor !== palette.primary ||
                currentCaptionStyle.baseColor !== '#FFFFFF' ||
                currentCaptionStyle.strokeColor !== '#000000')
        ) {
            setCaptionStyle({
                ...currentCaptionStyle,
                activeColor: palette.primary,
                baseColor: '#FFFFFF',
                strokeColor: '#000000',
            });
        }
        return palette;
    }, [setCaptionStyle, updateAdData]);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const directory = await loadOpsBrandDirectory(storedSelection);
            setRequired(directory.required);
            setLinked(directory.linked);
            setContexts(directory.contexts);
            setContext(directory.context);
            setCompanies(directory.companies);
            if (storedSelection?.id && directory.context) {
                const selected = directory.companies.find((company) => company.id === storedSelection.id);
                if (selected) {
                    applyCompanySelection(selected, directory.context, autoSelectedIdRef.current === selected.id);
                }
            } else if (directory.required && directory.linked && directory.context) {
                const fallback = defaultCompany(directory.companies, user?.orgName);
                if (fallback) applyCompanySelection(fallback, directory.context, true);
            }
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Não foi possível carregar as empresas do Mileto Ops.';
            // Se não conseguimos confirmar o status, falhamos fechado: a pessoa
            // enxerga o problema e não avança sem o contexto de marca obrigatório.
            setRequired(true);
            setLinked(false);
            setContexts([]);
            setContext(null);
            setCompanies([]);
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [applyCompanySelection, storedSelection, user?.orgName]);

    useEffect(() => { void load(); }, [load]);

    const chooseContext = async (nextContext: OpsViewContext) => {
        // A empresa escolhida manualmente não pode ser trocada só por mudar a
        // visão: ela é preservada quando existe nesta visão e só muda por uma
        // nova escolha manual.
        const previousCompanyId = adDataRef.current.opsCompany?.id || null;
        const previousWasManual = Boolean(previousCompanyId) && !autoSelected;
        setContext(nextContext);
        setLoading(true);
        setError('');
        try {
            const response = await import('../lib/gateway').then(({ gatewayApi }) => gatewayApi.opsCompanies('', nextContext.contextId));
            const available = response.data.filter(isRealOpsCompany);
            setCompanies(available);
            const preserved = previousCompanyId
                ? available.find((company) => company.id === previousCompanyId)
                : null;
            if (preserved) {
                applyCompanySelection(preserved, nextContext, false);
            } else if (previousWasManual) {
                // A empresa escolhida não está disponível nesta visão. Limpamos para
                // pedir uma nova escolha, sem cair silenciosamente na agência.
                autoSelectedIdRef.current = null;
                setAutoSelected(false);
                updateAdData({ opsCompany: null, brandPalette: null, brandPaletteUpdatedAt: null });
            } else {
                const fallback = defaultCompany(available, user?.orgName);
                if (fallback) applyCompanySelection(fallback, nextContext, true);
                else {
                    autoSelectedIdRef.current = null;
                    setAutoSelected(false);
                    updateAdData({ opsCompany: null, brandPalette: null, brandPaletteUpdatedAt: null });
                }
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Não foi possível trocar o contexto do Ops.');
        } finally {
            setLoading(false);
        }
    };

    const chooseCompany = (companyId: string) => {
        const company = companies.find((candidate) => candidate.id === companyId);
        if (!company || !context) return;
        const palette = applyCompanySelection(company, context, false);
        if (!palette) toast.warning('Esta empresa ainda não possui uma paleta válida no Mileto Ops.');
    };

    const selectedCompany = useMemo(
        () => companies.find((company) => company.id === adData.opsCompany?.id) || null,
        [adData.opsCompany?.id, companies]
    );
    return (
        <div className="grid shrink-0 items-end gap-3 rounded-2xl border border-brand-lime/20 bg-[linear-gradient(115deg,rgba(0,230,118,.07),rgba(7,15,18,.72)_48%,rgba(139,92,246,.055))] p-3 shadow-[0_18px_50px_rgba(0,0,0,.18)] lg:grid-cols-[minmax(230px,.8fr)_minmax(280px,1fr)_minmax(300px,1.1fr)]">
            <div className="flex items-center justify-between gap-3 self-center">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-lime/10 text-brand-lime"><Building2 className="h-4 w-4" /></span>
                    <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-wider text-brand-lime">Empresa / marca do projeto</p><p className="truncate text-[9px] text-brand-muted">{required ? 'Obrigatória porque o Mileto Ops está integrado.' : 'Ative a integração para usar a marca do Ops.'}</p></div>
                </div>
                {selectedCompany && <Check className="h-4 w-4 shrink-0 text-brand-lime" />}
            </div>

            {loading ? (
                <div className="flex h-10 items-center justify-center gap-2 text-[10px] text-brand-muted"><Loader2 className="h-4 w-4 animate-spin" /> Consultando o Mileto Ops…</div>
            ) : error ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-[10px] leading-relaxed text-red-200"><span className="flex min-w-0 gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></span><button type="button" onClick={() => void load()} className="shrink-0 rounded-lg border border-red-200/20 px-2 py-1 font-black uppercase">Tentar novamente</button></div>
            ) : !required ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/15 p-3 text-[10px] text-brand-muted"><span>O Mileto Ops ainda não está conectado nesta agência.</span><button type="button" onClick={() => navigate('/integrations')} className="shrink-0 rounded-lg border border-brand-lime/25 px-2 py-1 font-black uppercase text-brand-lime">Abrir integrações</button></div>
            ) : !linked ? (
                <div className="flex gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-[10px] leading-relaxed text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Seu usuário precisa ser vinculado ao Ops em Integrações antes de criar o vídeo.</div>
            ) : (
                <>
                    <div className="min-w-0">
                        <p className="mb-1 pl-1 text-[9px] font-bold uppercase tracking-wider text-brand-muted">Visualizar como</p>
                        <OpsViewContextPicker
                            contexts={contexts}
                            value={context?.contextId || null}
                            onChange={(contextId) => {
                                const next = contexts.find((item) => item.contextId === contextId);
                                if (next) void chooseContext(next);
                            }}
                        />
                    </div>
                    <div className="min-w-0">
                        <p className="mb-1 pl-1 text-[9px] font-bold uppercase tracking-wider text-brand-muted">Empresa do projeto</p>
                        <OpsCompanySelect companies={companies} value={adData.opsCompany?.id || null} onChange={chooseCompany} />
                    </div>
                </>
            )}
        </div>
    );
};
