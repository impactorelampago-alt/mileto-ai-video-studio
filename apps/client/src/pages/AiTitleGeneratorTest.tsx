import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Building2,
    Captions,
    Check,
    ChevronDown,
    ChevronUp,
    CirclePlus,
    Loader2,
    Palette,
    Plus,
    RotateCcw,
    Save,
    Search,
    Sparkles,
    Timer,
    WandSparkles,
} from 'lucide-react';
import { DynamicTitleRenderer } from '../components/DynamicTitleRenderer';
import { EditableTitleOverlay } from '../components/EditableTitleOverlay';
import { TextAnimationPicker } from '../components/TextAnimationPicker';
import { useAuth } from '../context/AuthContext';
import { useWizard } from '../context/WizardContext';
import {
    TITLE_MODEL_CATALOG as TITLE_MODELS,
    TITLE_MODEL_LIBRARIES as TITLE_LIBRARIES,
    TITLE_MODEL_LIBRARY_NOTES as LIBRARY_NOTES,
    type TitleModelDefinition,
    type TitleModelLibrary,
} from '../lib/titleModelCatalog';
import { cn, generateId } from '../lib/utils';
import { TITLE_EDITOR_PORTRAIT_PREVIEW_WIDTH } from '../lib/titlePreviewGeometry';
import type { TitleHook } from '../types';
import type { BrandPalette } from '../types';
import {
    gatewayApi,
    GatewayError,
    type AiTitleColorRule,
    type AiTitleGeneratorConfig,
    type AiTitleLayout,
    type AiTitleTypeRule,
    type TitleVideoFormat,
} from '../lib/gateway';
import {
    defaultLayouts,
    titleGeneratorConfigToEditor,
    titleGeneratorEditorToConfig,
    type TitleTriggerEditor,
} from '../lib/titleGeneratorEditor';
import { toast } from 'sonner';
import { loadOpsBrandDirectory, opsProjectCompanyName } from '../lib/opsProjectBrand';
import { normalizeBrandPalette } from '../lib/brandPalette';
import type { OpsCompany } from '../lib/gateway';
import { limitTitleWords } from '../lib/titleText';
import { captionSafeTopPercent } from '../lib/titleSafeArea';

type ColorMode = 'ops' | 'custom';
type TitleLibrary = TitleModelLibrary;
type PrototypeTitleModel = TitleModelDefinition;

const TITLE_PREVIEW_CAPTION_STORAGE_KEY = 'mileto_ai_title_preview_caption_v1';
const TITLE_GENERATOR_DRAFT_STORAGE_PREFIX = 'mileto_ai_title_generator_draft_v1';
const TITLE_PREVIEW_IMAGE_SRC = `${import.meta.env.BASE_URL}title-preview-store.webp`;

interface StoredTitleGeneratorDraft {
    version: 1;
    baseUpdatedAt: string | null;
    config: AiTitleGeneratorConfig;
}

const readTitleGeneratorDraft = (storageKey: string): StoredTitleGeneratorDraft | null => {
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null') as StoredTitleGeneratorDraft | null;
        return parsed?.version === 1 && Array.isArray(parsed.config?.triggers) ? parsed : null;
    } catch {
        return null;
    }
};

const removeTitleGeneratorDraft = (storageKey: string) => {
    try {
        localStorage.removeItem(storageKey);
    } catch {
        // A persistência local não pode interromper o editor.
    }
};

const initialPreviewCaptionVisibility = () => {
    try {
        return localStorage.getItem(TITLE_PREVIEW_CAPTION_STORAGE_KEY) !== 'hidden';
    } catch {
        return true;
    }
};

interface ModelSettings {
    enabled: boolean;
    colorMode: ColorMode;
    paletteSlot: AiTitleColorRule['paletteSlot'];
    primaryColor: string;
    secondaryColor: string;
    animationId: AiTitleTypeRule['animationId'];
    durationSec: number;
    posX: number;
    posY: number;
    scale: number;
    scaleX?: number;
    scaleY?: number;
    textBoxWidthPct?: number;
    layouts: Record<TitleVideoFormat, AiTitleLayout>;
}

interface TriggerPrototype {
    id: string;
    name: string;
    hint: string;
    examples: string[];
    sample: string;
    enabled: boolean;
    maxWords: number;
    maxOccurrences: number;
    color: AiTitleColorRule;
    models: Record<string, ModelSettings>;
}

const makeInitialOpenLibraries = (): Record<TitleLibrary, boolean> => ({
    'Call to Action (CTA)': false,
    'Biblioteca Premium': true,
    'Localização': false,
});

const initialModelSettings = (modelId: string): ModelSettings => {
    const model = TITLE_MODELS.find((item) => item.id === modelId) || TITLE_MODELS[0];
    return {
        enabled: true,
        colorMode: 'custom',
        paletteSlot: 'rotate',
        primaryColor: model.primaryColor,
        secondaryColor: model.secondaryColor,
        animationId: 'pop',
        durationSec: 2.5,
        posX: 50,
        posY: 55,
        scale: 0.62,
        textBoxWidthPct: 78,
        layouts: defaultLayouts(),
    };
};

const seededModels = (...modelIds: string[]) => Object.fromEntries(
    modelIds.map((modelId) => [modelId, initialModelSettings(modelId)])
);

const makeInitialTriggers = (): TriggerPrototype[] => [
    {
        id: 'scarcity',
        enabled: true,
        maxWords: 3,
        maxOccurrences: 2,
        color: { mode: 'brand', paletteSlot: 'primary', primary: '#00e676', secondary: '#07110d' },
        name: 'Escassez e urgência',
        hint: 'Prazo, quantidade, vagas, lote ou estoque limitado.',
        examples: ['Somente até sábado', 'Últimas 8 unidades', '3 vagas'],
        sample: 'SOMENTE ATÉ SÁBADO',
        models: seededModels('premium-urgency-pulse', 'premium-coupon-ticket'),
    },
    {
        id: 'region',
        enabled: true,
        maxWords: 3,
        maxOccurrences: 1,
        color: { mode: 'brand', paletteSlot: 'tertiary', primary: '#00e676', secondary: '#07110d' },
        name: 'Região',
        hint: 'Cidade, estado, país, bairro ou área atendida.',
        examples: ['Casimiro de Abreu', 'Rio de Janeiro', 'Todo o Brasil'],
        sample: 'CASIMIRO DE ABREU',
        models: seededModels('loc-pin-viagem', 'loc-minimal-urbano'),
    },
    {
        id: 'cta',
        enabled: true,
        maxWords: 3,
        maxOccurrences: 1,
        color: { mode: 'brand', paletteSlot: 'primary', primary: '#00e676', secondary: '#07110d' },
        name: 'CTA',
        hint: 'Ação esperada depois que a pessoa assistir ao trecho.',
        examples: ['Clique no botão', 'Chame no WhatsApp', 'Saiba mais'],
        sample: 'CLIQUE NO BOTÃO',
        models: seededModels('cta-whatsapp', 'cta-tap'),
    },
    {
        id: 'price',
        enabled: true,
        maxWords: 3,
        maxOccurrences: 2,
        color: { mode: 'brand', paletteSlot: 'secondary', primary: '#00e676', secondary: '#07110d' },
        name: 'Preço',
        hint: 'Valor, desconto, parcela, condição ou economia.',
        examples: ['R$ 199', '12x sem juros', '50% OFF'],
        sample: 'R$ 199',
        models: seededModels('premium-price-tag', 'premium-sale-spotlight'),
    },
    {
        id: 'benefit',
        enabled: true,
        maxWords: 4,
        maxOccurrences: 2,
        color: { mode: 'brand', paletteSlot: 'rotate', primary: '#00e676', secondary: '#07110d' },
        name: 'Benefício / bônus',
        hint: 'Benefício concreto, bônus, transformação ou diferencial dito na narração.',
        examples: ['Exame por nossa conta', 'Bônus incluso', 'Entrega grátis'],
        sample: 'EXAME POR NOSSA CONTA',
        models: seededModels('premium-benefit-badge', 'premium-product-launch'),
    },
    {
        id: 'product',
        enabled: true,
        maxWords: 5,
        maxOccurrences: 1,
        color: { mode: 'brand', paletteSlot: 'primary', primary: '#00e676', secondary: '#07110d' },
        name: 'Produto / oferta central',
        hint: 'Produto, serviço ou oferta central explicitamente apresentados, sem confundir com preço ou urgência.',
        examples: ['Óculos completo', 'Armação mais lentes', 'Consultoria personalizada'],
        sample: 'ÓCULOS COMPLETO',
        models: seededModels('premium-product-launch', 'premium-creator-caption'),
    },
    {
        id: 'differentiator',
        enabled: true,
        maxWords: 5,
        maxOccurrences: 1,
        color: { mode: 'brand', paletteSlot: 'rotate', primary: '#00e676', secondary: '#07110d' },
        name: 'Diferencial / prova',
        hint: 'Qualidade, mecanismo, personalização, garantia ou prova concreta realmente pronunciada.',
        examples: ['Do seu jeito', 'Atendimento personalizado', 'Qualidade comprovada'],
        sample: 'DO SEU JEITO',
        models: seededModels('premium-benefit-badge', 'premium-outline-echo'),
    },
    {
        id: 'audience',
        enabled: true,
        maxWords: 5,
        maxOccurrences: 1,
        color: { mode: 'brand', paletteSlot: 'secondary', primary: '#00e676', secondary: '#07110d' },
        name: 'Público / necessidade',
        hint: 'Público, necessidade ou problema explícito ao qual a oferta responde. Não deduza perfis não mencionados.',
        examples: ['Para quem precisa', 'Seu segundo óculos', 'Quem busca economia'],
        sample: 'PARA QUEM PRECISA',
        models: seededModels('premium-split-block', 'premium-kinetic-punch'),
    },
];

const DEFAULT_TRIGGER_COPY_MIGRATIONS: Record<string, { sample: string; legacySamples: string[]; examples: string[]; legacyExamples: string[] }> = {
    scarcity: {
        sample: 'SOMENTE ATÉ SÁBADO',
        legacySamples: ['SÓ ATÉ SEXTA'],
        examples: ['Somente até sábado', 'Últimas 8 unidades', '3 vagas'],
        legacyExamples: ['Só até sexta', 'Últimas 8 unidades', '3 vagas'],
    },
    region: {
        sample: 'CASIMIRO DE ABREU',
        legacySamples: ['BELO HORIZONTE • MG'],
        examples: ['Casimiro de Abreu', 'Rio de Janeiro', 'Todo o Brasil'],
        legacyExamples: ['Belo Horizonte', 'Minas Gerais', 'Todo o Brasil'],
    },
    cta: {
        sample: 'CLIQUE NO BOTÃO',
        legacySamples: ['CHAME AGORA NO WHATSAPP', 'CLIQUE AQUI'],
        examples: ['Clique no botão', 'Chame no WhatsApp', 'Saiba mais'],
        legacyExamples: ['Clique aqui', 'Chame no WhatsApp', 'Saiba mais'],
    },
    price: {
        sample: 'R$ 199',
        legacySamples: ['POR APENAS R$ 99'],
        examples: ['R$ 199', '12x sem juros', '50% OFF'],
        legacyExamples: ['Por R$ 99', '12x sem juros', '50% OFF'],
    },
    benefit: {
        sample: 'EXAME POR NOSSA CONTA',
        legacySamples: ['ENTREGA GRÁTIS'],
        examples: ['Exame por nossa conta', 'Bônus incluso', 'Entrega grátis'],
        legacyExamples: ['Entrega grátis', 'Bônus incluso', 'Economize tempo'],
    },
};

const normalizeTriggerCopy = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');

const migrateDefaultTriggerCopy = (trigger: TriggerPrototype): TriggerPrototype => {
    const migration = DEFAULT_TRIGGER_COPY_MIGRATIONS[trigger.id];
    if (!migration) return trigger;
    const normalizedSample = normalizeTriggerCopy(trigger.sample);
    const usesLegacySample = !normalizedSample
        || normalizedSample === normalizeTriggerCopy(trigger.name)
        || migration.legacySamples.some((sample) => normalizeTriggerCopy(sample) === normalizedSample);
    const usesLegacyExamples = trigger.examples.length === 0
        || JSON.stringify(trigger.examples) === JSON.stringify(migration.legacyExamples);
    if (!usesLegacySample && !usesLegacyExamples) return trigger;
    return {
        ...trigger,
        ...(usesLegacySample ? { sample: migration.sample } : {}),
        ...(usesLegacyExamples ? { examples: migration.examples } : {}),
    };
};

const searchableCompanyName = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

const PreviewCompanySelect = ({
    companies,
    value,
    onChange,
}: {
    companies: OpsCompany[];
    value: string;
    onChange: (_company: OpsCompany) => void;
}) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = companies.find((company) => company.id === value) || companies[0] || null;
    const visibleCompanies = useMemo(() => {
        const normalizedQuery = searchableCompanyName(query.trim());
        if (!normalizedQuery) return companies;
        return companies.filter((company) => searchableCompanyName(opsProjectCompanyName(company)).includes(normalizedQuery));
    }, [companies, query]);
    const selectedPalette = normalizeBrandPalette(selected?.palette);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setOpen(false);
                setQuery('');
            }
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, [open]);

    const choose = (company: OpsCompany) => {
        onChange(company);
        setOpen(false);
        setQuery('');
    };

    return (
        <div
            ref={rootRef}
            className="relative mt-3"
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    setOpen(false);
                    setQuery('');
                }
            }}
        >
            <p className="mb-1.5 text-[8px] font-black uppercase tracking-wider text-brand-muted">Empresa para testar a paleta</p>
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                className={cn(
                    'group flex min-h-11 w-full items-center gap-2.5 rounded-xl border bg-black/25 px-2.5 py-2 text-left outline-none transition',
                    open
                        ? 'border-brand-lime/45 bg-brand-lime/[0.07] shadow-[0_0_0_3px_rgba(0,230,118,.06)]'
                        : 'border-white/10 hover:border-brand-lime/30 hover:bg-white/[0.035]'
                )}
            >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-brand-lime/15 bg-brand-lime/10 text-brand-lime">
                    <Building2 className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-bold normal-case tracking-normal text-foreground">
                        {selected ? opsProjectCompanyName(selected) : 'Selecione uma empresa'}
                    </span>
                    <span className="mt-0.5 block truncate text-[8px] font-medium normal-case tracking-normal text-brand-muted">
                        Paleta sincronizada com o Mileto Ops
                    </span>
                </span>
                {selectedPalette && (
                    <span className="flex shrink-0 -space-x-1">
                        {[selectedPalette.primary, selectedPalette.secondary, selectedPalette.tertiary].map((color) => (
                            <span key={color} className="h-3.5 w-3.5 rounded-full border-2 border-[#0b1115]" style={{ backgroundColor: color }} />
                        ))}
                    </span>
                )}
                <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-brand-muted transition-transform', open && 'rotate-180 text-brand-lime')} />
            </button>

            {open && (
                <div
                    role="listbox"
                    aria-label="Empresas disponíveis para testar a paleta"
                    className="absolute right-0 top-[calc(100%+8px)] z-[80] w-full overflow-hidden rounded-2xl border border-brand-lime/25 bg-[#0a1013]/98 shadow-[0_24px_70px_rgba(0,0,0,.72),0_0_32px_rgba(0,230,118,.08)] backdrop-blur-xl"
                >
                    <div className="border-b border-white/7 bg-linear-to-r from-brand-lime/10 via-transparent to-violet-500/5 p-2.5">
                        <label className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 transition focus-within:border-brand-lime/40 focus-within:bg-brand-lime/[0.04]">
                            <Search className="h-3.5 w-3.5 shrink-0 text-brand-lime/70" />
                            <input
                                autoFocus
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Buscar empresa..."
                                aria-label="Buscar empresa"
                                className="min-w-0 flex-1 bg-transparent text-[10px] font-medium text-white outline-none placeholder:text-white/25"
                            />
                            {query && <span className="text-[8px] font-bold text-white/30">{visibleCompanies.length}</span>}
                        </label>
                    </div>
                    <div className="custom-scrollbar max-h-64 overflow-y-auto p-1.5">
                        {visibleCompanies.map((company) => {
                            const active = company.id === selected?.id;
                            const palette = normalizeBrandPalette(company.palette);
                            return (
                                <button
                                    key={company.id}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    onClick={() => choose(company)}
                                    className={cn(
                                        'mb-1 flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition last:mb-0',
                                        active
                                            ? 'border-brand-lime/30 bg-brand-lime/10'
                                            : 'border-transparent hover:border-white/8 hover:bg-white/5'
                                    )}
                                >
                                    <span className={cn(
                                        'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-black uppercase',
                                        active ? 'bg-brand-lime text-[#07110d]' : 'bg-brand-lime/10 text-brand-lime'
                                    )}>
                                        {opsProjectCompanyName(company).slice(0, 1)}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[10px] font-bold text-white">{opsProjectCompanyName(company)}</span>
                                        <span className="block truncate text-[8px] text-white/35">Empresa autorizada no Ops</span>
                                    </span>
                                    {palette && (
                                        <span className="flex shrink-0 -space-x-1">
                                            {[palette.primary, palette.secondary, palette.tertiary].map((color) => (
                                                <span key={color} className="h-3.5 w-3.5 rounded-full border-2 border-[#0b1115]" style={{ backgroundColor: color }} />
                                            ))}
                                        </span>
                                    )}
                                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-brand-lime" />}
                                </button>
                            );
                        })}
                        {visibleCompanies.length === 0 && (
                            <div className="px-3 py-8 text-center">
                                <Search className="mx-auto mb-2 h-5 w-5 text-white/15" />
                                <p className="text-[10px] font-bold text-white/45">Nenhuma empresa encontrada</p>
                                <p className="mt-1 text-[8px] text-white/25">Tente buscar por outro nome.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const configToPrototype = (config: AiTitleGeneratorConfig, format: TitleVideoFormat): TriggerPrototype[] => {
    const editor = titleGeneratorConfigToEditor(config).map((trigger) => ({
        ...trigger,
        models: Object.fromEntries(Object.entries(trigger.models).map(([modelId, settings]) => {
            const layout = settings.layouts[format] || settings.layouts['9:16'];
            return [modelId, {
                ...settings,
                posX: layout.posX,
                posY: layout.posY,
                scale: layout.scale,
                scaleX: layout.scaleX,
                scaleY: layout.scaleY,
                textBoxWidthPct: layout.textBoxWidthPct,
            }];
        })),
    })).map((trigger) => migrateDefaultTriggerCopy(trigger as TriggerPrototype)) as TriggerPrototype[];

    const needsIdMigration = Number(config.version) < 2 || editor.some((trigger) => ['hook', 'offer', 'local'].includes(trigger.id));
    const needsTriggerMigration = Number(config.version) < 3;
    if (!needsIdMigration && !needsTriggerMigration) return editor;

    const migrated = editor
        .filter((trigger) => trigger.id !== 'hook')
        .map((trigger) => trigger.id === 'offer'
            ? { ...trigger, id: 'price', name: 'Preço' }
            : trigger.id === 'local'
              ? { ...trigger, id: 'region', name: 'Região' }
              : trigger);
    const migratedById = new Map(migrated.map((trigger) => [trigger.id, trigger]));
    const defaults = makeInitialTriggers();
    const knownIds = new Set(defaults.map((trigger) => trigger.id));
    return [
        ...defaults.map((fallback) => {
            const current = migratedById.get(fallback.id);
            return current ? { ...fallback, ...current, id: fallback.id, name: fallback.name } : fallback;
        }),
        ...migrated.filter((trigger) => !knownIds.has(trigger.id)),
    ];
};

const prototypeToEditor = (triggers: TriggerPrototype[], format: TitleVideoFormat): TitleTriggerEditor[] =>
    triggers.map((trigger) => ({
        ...trigger,
        models: Object.fromEntries(Object.entries(trigger.models).map(([modelId, settings]) => [modelId, {
            ...settings,
            layouts: {
                ...settings.layouts,
                [format]: {
                    ...settings.layouts[format],
                    posX: settings.posX,
                    posY: settings.posY,
                    scale: settings.scale,
                    scaleX: settings.scaleX ?? 1,
                    scaleY: settings.scaleY ?? 1,
                    textBoxWidthPct: settings.textBoxWidthPct ?? 78,
                },
            },
        }])),
    }));

const layoutFingerprint = (config: AiTitleGeneratorConfig) => JSON.stringify(
    config.triggers.map((trigger) => ({
        id: trigger.id,
        maxWords: trigger.maxWords,
        titleTypes: trigger.titleTypes.map((type) => ({
            styleId: type.styleId,
            layouts: type.layouts,
        })),
    }))
);

const isHexColor = (value: string | undefined): value is string => !!value && /^#[0-9a-f]{6}$/i.test(value);

const contrastColor = (hex: string) => {
    const value = hex.replace('#', '');
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? '#07110d' : '#ffffff';
};

const animationPreviewClass = (animationId: string) => {
    if (animationId === 'pop') return 'anim-title-pop';
    if (animationId === 'fade') return 'anim-title-fade';
    if (animationId === 'slide') return 'anim-title-slide';
    if (animationId === 'blink') return 'animate-[pulse_420ms_ease-in-out_infinite]';
    return '';
};

const ColorField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
    <label className="min-w-0 text-[9px] font-bold text-foreground/55">
        {label}
        <span className="mt-1 flex items-center gap-2">
            <input
                type="color"
                value={isHexColor(value) ? value : '#00e676'}
                onChange={(event) => onChange(event.target.value)}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
            />
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-2 font-mono text-[10px] uppercase text-foreground outline-none focus:border-brand-lime/50"
            />
        </span>
    </label>
);

export const AiTitleGeneratorTest = () => {
    const { user } = useAuth();
    const { adData } = useWizard();
    const [triggers, setTriggers] = useState<TriggerPrototype[]>(makeInitialTriggers);
    const triggersRef = useRef(triggers);
    const [selectedTriggerId, setSelectedTriggerId] = useState('scarcity');
    const [activeModelId, setActiveModelId] = useState('premium-urgency-pulse');
    const [openLibraries, setOpenLibraries] = useState<Record<TitleLibrary, boolean>>(makeInitialOpenLibraries);
    const [newTriggerName, setNewTriggerName] = useState('');
    const [isCreatingTrigger, setIsCreatingTrigger] = useState(false);
    const [config, setConfig] = useState<AiTitleGeneratorConfig | null>(null);
    const [usesDefault, setUsesDefault] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [savedFingerprint, setSavedFingerprint] = useState('');
    const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null);
    const [previewCompanies, setPreviewCompanies] = useState<OpsCompany[]>([]);
    const [previewCompanyId, setPreviewCompanyId] = useState(adData.opsCompany?.id || '');
    const [previewPalette, setPreviewPalette] = useState<BrandPalette | null>(adData.brandPalette || null);
    const [showPreviewCaption, setShowPreviewCaption] = useState(initialPreviewCaptionVisibility);
    // O monitor desta tela é fixo em 9:16. Usar silenciosamente o formato do
    // último projeto fazia o editor mostrar uma geometria e salvar em outra.
    const format: TitleVideoFormat = '9:16';
    const draftStorageKey = `${TITLE_GENERATOR_DRAFT_STORAGE_PREFIX}:${user?.orgId ?? user?.id ?? 'local'}`;
    const commitTriggers = useCallback((updater: (current: TriggerPrototype[]) => TriggerPrototype[]) => {
        setTriggers((current) => {
            const next = updater(current);
            triggersRef.current = next;
            return next;
        });
    }, []);

    useEffect(() => {
        triggersRef.current = triggers;
    }, [triggers]);

    // Também corrige o estado preservado pelo Fast Refresh durante o desenvolvimento.
    // Textos personalizados não são tocados: apenas nome genérico, padrão antigo ou vazio.
    useEffect(() => {
        commitTriggers((current) => {
            const migrated = current.map(migrateDefaultTriggerCopy);
            return JSON.stringify(migrated) === JSON.stringify(current) ? current : migrated;
        });
    }, [commitTriggers]);

    const applyConfig = useCallback((
        next: AiTitleGeneratorConfig,
        defaultState: boolean,
        savedBase: AiTitleGeneratorConfig = next
    ) => {
        const editor = configToPrototype(next, format);
        const savedEditor = configToPrototype(savedBase, format);
        setConfig(next);
        triggersRef.current = editor;
        setTriggers(editor);
        setUsesDefault(defaultState);
        setSelectedTriggerId(editor[0]?.id || 'scarcity');
        const firstModel = TITLE_MODELS.find((model) => editor[0]?.models[model.id]?.enabled);
        setActiveModelId(firstModel?.id || '');
        setSavedFingerprint(JSON.stringify({ config: savedBase, editor: savedEditor }));
    }, [format]);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            const data = await gatewayApi.aiTitleGenerator();
            setServerUpdatedAt(data.updatedAt);
            const draft = readTitleGeneratorDraft(draftStorageKey);
            if (draft && draft.baseUpdatedAt === data.updatedAt) {
                applyConfig(draft.config, false, data.config);
            } else {
                if (draft) removeTitleGeneratorDraft(draftStorageKey);
                applyConfig(data.config, data.usesDefault);
            }
        } catch (error) {
            setLoadError(error instanceof GatewayError ? error.message : 'Não foi possível carregar as regras do gerador.');
        } finally {
            setLoading(false);
        }
    }, [applyConfig, draftStorageKey]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        let cancelled = false;
        void loadOpsBrandDirectory(adData.opsCompany).then((directory) => {
            if (cancelled || !directory.required || !directory.linked) return;
            setPreviewCompanies(directory.companies);
            const selected = directory.companies.find((company) => company.id === adData.opsCompany?.id) || directory.companies[0];
            if (selected) {
                setPreviewCompanyId(selected.id);
                setPreviewPalette(normalizeBrandPalette(selected.palette));
            }
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [adData.opsCompany]);

    const currentFingerprint = useMemo(() => JSON.stringify({ config, editor: triggers }), [config, triggers]);
    const dirty = Boolean(config) && currentFingerprint !== savedFingerprint;

    useEffect(() => {
        if (loading || !config) return;
        if (!dirty) {
            removeTitleGeneratorDraft(draftStorageKey);
            return;
        }
        const timer = window.setTimeout(() => {
            try {
                const draftConfig = titleGeneratorEditorToConfig(config, prototypeToEditor(triggers, format));
                const draft: StoredTitleGeneratorDraft = {
                    version: 1,
                    baseUpdatedAt: serverUpdatedAt,
                    config: draftConfig,
                };
                localStorage.setItem(draftStorageKey, JSON.stringify(draft));
            } catch {
                // A persistência local não pode interromper o editor.
            }
        }, 120);
        return () => window.clearTimeout(timer);
    }, [config, dirty, draftStorageKey, format, loading, serverUpdatedAt, triggers]);

    const save = async () => {
        if (!config) return;
        const snapshot = triggersRef.current;
        const invalid = snapshot.find((trigger) => trigger.enabled && !Object.values(trigger.models).some((model) => model.enabled));
        if (invalid) {
            toast.error(`Marque pelo menos um modelo para ${invalid.name}.`);
            return;
        }
        setSaving(true);
        try {
            // O ref recebe cada movimento no mesmo instante; o clique nunca salva
            // o render anterior ainda enfileirado pelo React.
            const payload = titleGeneratorEditorToConfig(config, prototypeToEditor(snapshot, format));
            const data = await gatewayApi.saveAiTitleGenerator(payload);
            if (layoutFingerprint(data.config) !== layoutFingerprint(payload)) {
                throw new Error('O servidor não confirmou a posição e o tamanho enviados. A edição foi mantida neste computador; tente salvar novamente.');
            }
            removeTitleGeneratorDraft(draftStorageKey);
            setServerUpdatedAt(data.updatedAt);
            // O servidor devolve a configuração normalizada. Reaplicar essa resposta
            // reconstruía todo o editor e fazia o preview saltar para a geometria
            // normalizada/default logo depois do clique em salvar. A edição que acabou
            // de ser enviada já é a fonte exata da posição, escala e largura visual;
            // mantenha-a montada e troque apenas a base persistida retornada pela API.
            setConfig(data.config);
            setUsesDefault(false);
            setSavedFingerprint(JSON.stringify({ config: data.config, editor: snapshot }));
            toast.success('Gerador de Títulos salvo para toda a equipe.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o Gerador de Títulos.');
        } finally {
            setSaving(false);
        }
    };

    const selectedTrigger = triggers.find((trigger) => trigger.id === selectedTriggerId) || triggers[0];
    const enabledModels = TITLE_MODELS.filter((model) => selectedTrigger.models[model.id]?.enabled);
    const effectiveActiveModelId = selectedTrigger.models[activeModelId]?.enabled
        ? activeModelId
        : enabledModels[0]?.id || '';
    const activeModel = TITLE_MODELS.find((model) => model.id === effectiveActiveModelId);
    const activeSettings = effectiveActiveModelId ? selectedTrigger.models[effectiveActiveModelId] : undefined;

    const opsColors = useMemo(() => {
        const palette = previewPalette || adData.brandPalette;
        const candidates = [palette?.primary, palette?.secondary, palette?.tertiary, ...(palette?.all || [])]
            .filter(isHexColor);
        return Array.from(new Set(candidates));
    }, [adData.brandPalette, previewPalette]);

    const previewColors = activeModel && activeSettings
        ? activeSettings.colorMode === 'ops' && opsColors.length
            ? [opsColors[0], opsColors[1] || contrastColor(opsColors[0])]
            : [activeSettings.primaryColor || activeModel.primaryColor, activeSettings.secondaryColor || activeModel.secondaryColor]
        : ['#00e676', '#ffffff'];

    const previewTitle: TitleHook | null = activeModel && activeSettings
        ? {
              id: `prototype-${activeModel.id}`,
              text: limitTitleWords(selectedTrigger.sample, selectedTrigger.maxWords),
              startSec: 0,
              durationSec: activeSettings.durationSec,
              isActive: true,
              posX: activeSettings.posX,
              posY: activeSettings.posY,
              scale: activeSettings.scale,
              scaleX: activeSettings.scaleX,
              scaleY: activeSettings.scaleY,
              textBoxWidthPct: activeSettings.textBoxWidthPct,
              maxWords: selectedTrigger.maxWords,
              styleId: activeModel.id,
              primaryColor: previewColors[0],
              secondaryColor: previewColors[1],
              animationId: activeSettings.animationId,
              fontFamily: activeModel.fontFamily,
              hasSound: false,
          }
        : null;

    const togglePreviewCaption = () => {
        setShowPreviewCaption((current) => {
            const next = !current;
            try {
                localStorage.setItem(TITLE_PREVIEW_CAPTION_STORAGE_KEY, next ? 'visible' : 'hidden');
            } catch {
                // Preferência visual não pode interromper o editor.
            }
            return next;
        });
    };

    const selectTrigger = (trigger: TriggerPrototype) => {
        setSelectedTriggerId(trigger.id);
        const firstEnabled = TITLE_MODELS.find((model) => trigger.models[model.id]?.enabled);
        setActiveModelId(firstEnabled?.id || '');
        if (firstEnabled) {
            setOpenLibraries((current) => ({ ...current, [firstEnabled.library]: true }));
        }
    };

    const toggleModel = (model: PrototypeTitleModel, enabled: boolean) => {
        commitTriggers((current) => current.map((trigger) => {
            if (trigger.id !== selectedTrigger.id) return trigger;
            return {
                ...trigger,
                models: {
                    ...trigger.models,
                    [model.id]: {
                        ...(trigger.models[model.id] || initialModelSettings(model.id)),
                        enabled,
                    },
                },
            };
        }));

        if (enabled) {
            setActiveModelId(model.id);
        } else if (effectiveActiveModelId === model.id) {
            setActiveModelId(enabledModels.find((item) => item.id !== model.id)?.id || '');
        }
    };

    const patchModelSettings = (modelId: string, patch: Partial<ModelSettings>) => {
        commitTriggers((current) => current.map((trigger) => {
            if (trigger.id !== selectedTrigger.id) return trigger;
            const settings = trigger.models[modelId];
            if (!settings) return trigger;
            const layoutPatch: Partial<AiTitleLayout> = {
                ...(patch.posX != null ? { posX: patch.posX } : {}),
                ...(patch.posY != null ? { posY: patch.posY } : {}),
                ...(patch.scale != null ? { scale: patch.scale } : {}),
                ...(patch.scaleX != null ? { scaleX: patch.scaleX } : {}),
                ...(patch.scaleY != null ? { scaleY: patch.scaleY } : {}),
                ...(patch.textBoxWidthPct != null ? { textBoxWidthPct: patch.textBoxWidthPct } : {}),
            };
            const geometryChanged = Object.keys(layoutPatch).length > 0;
            return {
                ...trigger,
                models: {
                    ...trigger.models,
                    [modelId]: {
                        ...settings,
                        ...patch,
                        ...(geometryChanged ? {
                            layouts: {
                                ...settings.layouts,
                                [format]: { ...settings.layouts[format], ...layoutPatch },
                            },
                        } : {}),
                    },
                },
            };
        }));
    };

    const patchSelectedTrigger = (patch: Partial<TriggerPrototype>) => {
        commitTriggers((current) => current.map((trigger) => (
            trigger.id === selectedTrigger.id ? { ...trigger, ...patch } : trigger
        )));
    };

    const handleOverlayChange = (_id: string, updates: Partial<TitleHook>) => {
        if (typeof updates.text === 'string') patchSelectedTrigger({ sample: updates.text });
        if (!effectiveActiveModelId) return;
        patchModelSettings(effectiveActiveModelId, {
            ...(updates.posX != null ? { posX: updates.posX } : {}),
            ...(updates.posY != null ? { posY: updates.posY } : {}),
            ...(updates.scale != null ? { scale: updates.scale } : {}),
            ...(updates.scaleX != null ? { scaleX: updates.scaleX } : {}),
            ...(updates.scaleY != null ? { scaleY: updates.scaleY } : {}),
            ...(updates.textBoxWidthPct != null ? { textBoxWidthPct: updates.textBoxWidthPct } : {}),
        });
    };

    const createTrigger = () => {
        const name = newTriggerName.trim();
        if (!name) return;
        const trigger: TriggerPrototype = {
            id: `custom-${generateId()}`,
            enabled: true,
            maxWords: 3,
            maxOccurrences: 1,
            color: { mode: 'brand', paletteSlot: 'rotate', primary: '#00e676', secondary: '#07110d' },
            name,
            hint: 'Gatilho personalizado da sua agência.',
            examples: ['Adicione seus exemplos depois'],
            sample: name.toLocaleUpperCase('pt-BR'),
            models: {},
        };
        commitTriggers((current) => [...current, trigger]);
        setNewTriggerName('');
        setIsCreatingTrigger(false);
        selectTrigger(trigger);
    };

    const resetPrototype = async () => {
        setSaving(true);
        try {
            const data = await gatewayApi.saveAiTitleGenerator(null);
            removeTitleGeneratorDraft(draftStorageKey);
            setServerUpdatedAt(data.updatedAt);
            applyConfig(data.config, true);
            setOpenLibraries(makeInitialOpenLibraries());
            setNewTriggerName('');
            setIsCreatingTrigger(false);
            toast.success('Gerador restaurado para o padrão Mileto.');
        } catch (error) {
            toast.error(error instanceof GatewayError ? error.message : 'Não foi possível restaurar o padrão.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="flex min-h-[480px] items-center justify-center gap-2 text-sm text-brand-muted"><Loader2 className="h-5 w-5 animate-spin" /> Carregando Gerador de Títulos…</div>;
    if (loadError || !config) return <div className="flex min-h-[480px] flex-col items-center justify-center gap-4 text-center"><p className="max-w-lg text-sm text-red-300">{loadError || 'Configuração indisponível.'}</p><button type="button" onClick={() => void load()} className="rounded-xl border border-brand-lime/30 px-4 py-2 text-xs font-bold text-brand-lime">Tentar novamente</button></div>;

    return (
        <section className="flex min-h-[calc(100vh-8.5rem)] w-full flex-none flex-col" aria-label="Gerador de Títulos">
            <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-brand-lime">
                        <Sparkles className="h-4 w-4" /> IA · Gerador de Títulos
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-foreground md:text-4xl">Gatilhos e modelos visuais</h1>
                    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                        Escolha um gatilho, marque os títulos que combinam e configure cada modelo dentro do próprio cartão.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void resetPrototype()}
                        disabled={saving || (usesDefault && !dirty)}
                        className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-[10px] font-black uppercase tracking-wider text-foreground/70 transition hover:border-brand-lime/30 hover:text-brand-lime"
                    >
                        <RotateCcw className="h-3.5 w-3.5" /> Usar padrão
                    </button>
                    <button type="button" onClick={() => void save()} disabled={saving || !dirty} className="flex h-9 items-center gap-2 rounded-xl bg-brand-lime px-4 text-[10px] font-black uppercase tracking-wider text-[#07110d] transition disabled:opacity-40">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar para a equipe</button>
                </div>
            </header>

            <details className="mb-4 rounded-2xl border border-white/8 bg-card/45 px-4 py-3">
                <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.16em] text-brand-lime">Regras gerais de extração</summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_150px]">
                    <label className="text-[9px] font-bold text-brand-muted">Orientação para a IA<textarea value={config.extractionPrompt} onChange={(event) => setConfig((current) => current ? { ...current, extractionPrompt: event.target.value } : current)} className="mt-1 min-h-20 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-xs font-normal text-foreground outline-none focus:border-brand-lime/40" /></label>
                    <label className="text-[9px] font-bold text-brand-muted" title="A cobertura de gancho, oferta/benefício e CTA pode acrescentar títulos além desta base.">Quantidade base por vídeo<input type="number" min={1} max={12} value={config.maxTitles} onChange={(event) => setConfig((current) => current ? { ...current, maxTitles: Number(event.target.value) } : current)} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-foreground outline-none focus:border-brand-lime/40" /></label>
                </div>
            </details>

            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-white/8 bg-card/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand-lime/20 bg-brand-lime/10 text-brand-lime">
                        <Captions className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-xs font-black text-foreground">Legenda de referência no preview</p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                            Reserva o espaço da legenda padrão para facilitar o posicionamento dos títulos. Não entra no vídeo final.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={showPreviewCaption}
                    onClick={togglePreviewCaption}
                    className={cn(
                        'flex h-9 shrink-0 items-center justify-between gap-3 rounded-xl border px-3 text-[10px] font-black uppercase tracking-wider transition sm:min-w-32',
                        showPreviewCaption
                            ? 'border-brand-lime/35 bg-brand-lime/10 text-brand-lime'
                            : 'border-white/10 bg-black/20 text-foreground/45 hover:border-white/20 hover:text-foreground/70'
                    )}
                >
                    <span>{showPreviewCaption ? 'Visível' : 'Oculta'}</span>
                    <span
                        aria-hidden="true"
                        className={cn(
                            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                            showPreviewCaption
                                ? 'border-brand-lime bg-brand-lime'
                                : 'border-white/10 bg-white/10'
                        )}
                    >
                        <span
                            className={cn(
                                'absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow-sm transition-transform duration-200',
                                showPreviewCaption ? 'translate-x-4 bg-[#07110d]' : 'translate-x-0 bg-white/55'
                            )}
                        />
                    </span>
                </button>
            </div>

            <div className="grid min-h-[680px] flex-1 gap-4 xl:grid-cols-[minmax(235px,.72fr)_minmax(520px,1.6fr)_minmax(270px,.74fr)]">
                <aside className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-card/55 shadow-xl">
                    <div className="border-b border-white/8 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-lime">1 · Gatilhos</p>
                                <p className="mt-1 text-xs text-muted-foreground">Selecione um por vez</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsCreatingTrigger((current) => !current)}
                                className="grid h-9 w-9 place-items-center rounded-xl border border-brand-lime/25 bg-brand-lime/10 text-brand-lime transition hover:bg-brand-lime/20"
                                aria-label="Criar gatilho"
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                        </div>
                        {isCreatingTrigger && (
                            <form
                                className="mt-3 rounded-xl border border-brand-lime/25 bg-black/20 p-2"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    createTrigger();
                                }}
                            >
                                <input
                                    autoFocus
                                    value={newTriggerName}
                                    onChange={(event) => setNewTriggerName(event.target.value)}
                                    placeholder="Nome do novo gatilho"
                                    className="h-9 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-xs text-foreground outline-none placeholder:text-foreground/25 focus:border-brand-lime/50"
                                />
                                <button
                                    type="submit"
                                    disabled={!newTriggerName.trim()}
                                    className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-brand-lime text-[10px] font-black uppercase tracking-wider text-[#07110d] disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                    <CirclePlus className="h-3.5 w-3.5" /> Adicionar gatilho
                                </button>
                            </form>
                        )}
                    </div>

                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                        {triggers.map((trigger) => {
                            const selected = trigger.id === selectedTrigger.id;
                            const count = Object.values(trigger.models).filter((settings) => settings.enabled).length;
                            return (
                                <article
                                    key={trigger.id}
                                    className={cn(
                                        'group w-full overflow-hidden rounded-2xl border text-left transition-all',
                                        selected
                                            ? 'border-brand-lime/55 bg-brand-lime/[0.11] shadow-[0_0_24px_rgba(0,230,118,.08)]'
                                            : 'border-white/7 bg-black/10 hover:border-brand-lime/25 hover:bg-brand-lime/[0.045]'
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            const card = event.currentTarget.parentElement;
                                            selectTrigger(trigger);
                                            window.requestAnimationFrame(() => {
                                                card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                            });
                                        }}
                                        className="w-full p-3 text-left"
                                    >
                                        <span className="flex items-start gap-3">
                                            <span className={cn(
                                                'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border',
                                                selected ? 'border-brand-lime bg-brand-lime text-[#07110d]' : 'border-white/20 text-transparent'
                                            )}>
                                                <Check className="h-3 w-3" />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className={cn('block text-sm font-black', selected ? 'text-brand-lime' : 'text-foreground')}>{trigger.name}</span>
                                                <span className="mt-1 block text-[9px] leading-relaxed text-muted-foreground">{trigger.hint}</span>
                                                <span className="mt-2 flex flex-wrap gap-1">
                                                    {trigger.examples.map((example) => (
                                                        <span key={example} className="rounded-full border border-white/8 bg-black/20 px-2 py-1 text-[7px] font-bold text-foreground/48">{example}</span>
                                                    ))}
                                                </span>
                                                <span className="mt-2 block text-[8px] font-black uppercase tracking-wider text-brand-lime/60">
                                                    {count} {count === 1 ? 'título marcado' : 'títulos marcados'}
                                                </span>
                                                <span className="mt-2 flex flex-wrap gap-1.5">
                                                    <span className="rounded-full border border-brand-lime/20 bg-brand-lime/[0.07] px-2 py-1 text-[7px] font-black uppercase tracking-wide text-brand-lime/75">
                                                        Máx. {trigger.maxWords} {trigger.maxWords === 1 ? 'palavra' : 'palavras'}
                                                    </span>
                                                    <span className="rounded-full border border-brand-lime/20 bg-brand-lime/[0.07] px-2 py-1 text-[7px] font-black uppercase tracking-wide text-brand-lime/75">
                                                        Máx. {trigger.maxOccurrences} {trigger.maxOccurrences === 1 ? 'título' : 'títulos'}
                                                    </span>
                                                </span>
                                            </span>
                                        </span>
                                    </button>
                                    {selected && (
                                        <div className="space-y-2 border-t border-brand-lime/15 bg-black/15 p-3">
                                            <label className="block text-[8px] font-bold uppercase tracking-wider text-brand-muted">Quando identificar<textarea value={selectedTrigger.hint} onChange={(event) => patchSelectedTrigger({ hint: event.target.value })} className="mt-1 min-h-16 w-full resize-none rounded-xl border border-white/8 bg-black/20 p-2 text-[9px] font-normal normal-case tracking-normal text-foreground outline-none focus:border-brand-lime/35" /></label>
                                            <label className="block text-[8px] font-bold uppercase tracking-wider text-brand-muted">Texto de exemplo do título<input value={selectedTrigger.sample} maxLength={120} onChange={(event) => patchSelectedTrigger({ sample: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-black/20 px-2 text-[9px] font-normal uppercase tracking-normal text-foreground outline-none focus:border-brand-lime/35" /></label>
                                            <label className="block text-[8px] font-bold uppercase tracking-wider text-brand-muted">Exemplos<input value={selectedTrigger.examples.join(', ')} onChange={(event) => patchSelectedTrigger({ examples: event.target.value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 8) })} className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-black/20 px-2 text-[9px] font-normal normal-case tracking-normal text-foreground outline-none" /></label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <label className="text-[8px] font-bold uppercase leading-tight tracking-wider text-brand-muted">Máx. palavras por título<input type="number" min={1} max={12} value={selectedTrigger.maxWords} onChange={(event) => patchSelectedTrigger({ maxWords: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-black/20 px-2 text-xs text-foreground outline-none focus:border-brand-lime/35" /></label>
                                                <label className="text-[8px] font-bold uppercase leading-tight tracking-wider text-brand-muted">Máx. títulos por gatilho<input type="number" min={1} max={6} value={selectedTrigger.maxOccurrences} onChange={(event) => patchSelectedTrigger({ maxOccurrences: Math.max(1, Math.min(6, Number(event.target.value) || 1)) })} className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-black/20 px-2 text-xs text-foreground outline-none focus:border-brand-lime/35" /></label>
                                            </div>
                                            {selectedTrigger.id.startsWith('custom-') && <button type="button" onClick={() => { const remaining = triggersRef.current.filter((item) => item.id !== selectedTrigger.id); triggersRef.current = remaining; setTriggers(remaining); selectTrigger(remaining[0]); }} className="text-[8px] font-black uppercase tracking-wider text-red-300 hover:text-red-200">Excluir gatilho personalizado</button>}
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </aside>

                <main className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-card/55 shadow-xl">
                    <div className="border-b border-white/8 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-lime">2 · Títulos da Etapa 4</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Todos ficam disponíveis. As marcações abaixo pertencem a <strong className="text-foreground">{selectedTrigger.name}</strong>.
                                </p>
                            </div>
                            <span className="rounded-full border border-brand-lime/20 bg-brand-lime/8 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-brand-lime">
                                {enabledModels.length} {enabledModels.length === 1 ? 'selecionado' : 'selecionados'}
                            </span>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        <div className="space-y-3">
                            {TITLE_LIBRARIES.map((library) => {
                                const libraryModels = TITLE_MODELS.filter((model) => model.library === library);
                                const isOpen = openLibraries[library];
                                const selectedInLibrary = libraryModels.filter((model) => selectedTrigger.models[model.id]?.enabled).length;
                                return (
                                    <section key={library}>
                                        <button
                                            type="button"
                                            onClick={() => setOpenLibraries((current) => ({ ...current, [library]: !current[library] }))}
                                            className={cn(
                                                'group flex min-h-14 w-full items-center justify-between border border-brand-lime/25 bg-brand-dark/85 px-4 py-3 text-left shadow-sm transition-colors hover:border-brand-lime/45 hover:bg-brand-lime/[.055]',
                                                isOpen ? 'rounded-t-xl border-b-brand-lime/10' : 'rounded-xl'
                                            )}
                                            aria-expanded={isOpen}
                                        >
                                            <span className="flex min-w-0 items-center gap-3">
                                                {isOpen
                                                    ? <ChevronUp className="h-5 w-5 shrink-0 text-brand-lime" />
                                                    : <ChevronDown className="h-5 w-5 shrink-0 text-brand-lime" />}
                                                <span className="min-w-0">
                                                    <span className="block text-[11px] font-black uppercase tracking-wider text-brand-lime">{library}</span>
                                                    <span className="mt-0.5 block truncate text-[8px] font-semibold text-muted-foreground">{LIBRARY_NOTES[library]}</span>
                                                </span>
                                            </span>
                                            <span className="ml-3 shrink-0 rounded-full border border-brand-lime/20 bg-brand-lime/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-wider text-brand-lime">
                                                {selectedInLibrary
                                                    ? `${selectedInLibrary} ${selectedInLibrary === 1 ? 'marcado' : 'marcados'}`
                                                    : `${libraryModels.length} modelos`}
                                            </span>
                                        </button>

                                        {isOpen && (
                                            <div className="rounded-b-xl border border-t-0 border-brand-lime/20 bg-brand-dark/40 p-3 animate-in slide-in-from-top-2 duration-200">
                                                <div className="grid items-start gap-2 sm:grid-cols-2">
                                                    {libraryModels.map((model) => {
                                const settings = selectedTrigger.models[model.id];
                                const enabled = !!settings?.enabled;
                                const active = enabled && model.id === effectiveActiveModelId;
                                const modelColors = settings?.colorMode === 'ops' && opsColors.length
                                    ? [opsColors[0], opsColors[1] || contrastColor(opsColors[0])]
                                    : [settings?.primaryColor || model.primaryColor, settings?.secondaryColor || model.secondaryColor];
                                const modelPreviewTitle: TitleHook = {
                                    id: `model-preview-${model.id}`,
                                    text: model.sample,
                                    startSec: 0,
                                    durationSec: 3,
                                    isActive: true,
                                    posX: 50,
                                    posY: 50,
                                    scale: 1,
                                    styleId: model.id,
                                    primaryColor: enabled ? modelColors[0] : model.primaryColor,
                                    secondaryColor: enabled ? modelColors[1] : model.secondaryColor,
                                    animationId: 'none',
                                    fontFamily: model.fontFamily,
                                    hasSound: false,
                                };
                                return (
                                    <article
                                        key={model.id}
                                        className={cn(
                                            'overflow-hidden rounded-2xl border transition-all',
                                            active
                                                ? 'border-brand-lime/60 bg-brand-lime/[0.08] shadow-[0_0_22px_rgba(0,230,118,.08)] sm:col-span-2'
                                                : enabled
                                                  ? 'border-brand-lime/25 bg-brand-lime/[0.035]'
                                                  : 'border-white/7 bg-black/10 hover:border-white/15'
                                        )}
                                    >
                                        <div className="flex min-h-24 items-stretch">
                                            <label className="grid w-11 shrink-0 cursor-pointer place-items-center border-r border-white/7 bg-black/15">
                                                <input
                                                    type="checkbox"
                                                    checked={enabled}
                                                    onChange={(event) => toggleModel(model, event.target.checked)}
                                                    className="peer sr-only"
                                                />
                                                <span className="grid h-5 w-5 place-items-center rounded-md border border-white/20 text-transparent transition peer-checked:border-brand-lime peer-checked:bg-brand-lime peer-checked:text-[#07110d]">
                                                    <Check className="h-3.5 w-3.5" />
                                                </span>
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => enabled ? setActiveModelId(model.id) : toggleModel(model, true)}
                                                className="min-w-0 flex-1 p-3 text-left"
                                            >
                                                <span className="flex items-start justify-between gap-2">
                                                    <span className="min-w-0">
                                                        <span className={cn('block truncate text-xs font-black', active ? 'text-brand-lime' : 'text-foreground')}>{model.name}</span>
                                                        <span className="mt-0.5 block text-[8px] font-black uppercase tracking-wider text-foreground/35">{model.library}</span>
                                                    </span>
                                                    <span className="flex shrink-0 -space-x-1">
                                                        <span className="h-4 w-4 rounded-full border border-black/50" style={{ backgroundColor: model.primaryColor }} />
                                                        <span className="h-4 w-4 rounded-full border border-black/50" style={{ backgroundColor: model.secondaryColor }} />
                                                    </span>
                                                </span>
                                                <span className="mt-2 line-clamp-2 block text-[9px] leading-relaxed text-muted-foreground">{model.description}</span>
                                                {active && <span className="mt-2 inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider text-brand-lime"><Sparkles className="h-3 w-3" /> Configurando este título</span>}
                                                <span className="mt-3 flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border border-white/6 bg-[radial-gradient(circle_at_center,rgba(255,255,255,.06),transparent_70%)] px-2">
                                                    <span
                                                        className="origin-center"
                                                        style={{ transform: `scale(${model.library === 'Call to Action (CTA)' ? 0.4 : model.library === 'Localização' ? 0.35 : 0.36})` }}
                                                    >
                                                        <DynamicTitleRenderer title={modelPreviewTitle} previewMode />
                                                    </span>
                                                </span>
                                            </button>
                                        </div>

                                        {active && settings && (
                                            <div className="border-t border-brand-lime/15 bg-black/15 p-3">
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase tracking-wider text-brand-lime">Configuração de {model.name}</p>
                                                        <p className="mt-0.5 text-[8px] text-muted-foreground">Cores, animação e duração exclusivas deste título.</p>
                                                    </div>
                                                    <span className="rounded-full border border-white/8 px-2 py-1 text-[8px] font-bold text-foreground/45">{model.group}</span>
                                                </div>

                                                <div className="grid gap-3 lg:grid-cols-[1.15fr_.85fr]">
                                                    <div className="rounded-xl border border-white/8 bg-black/15 p-2.5">
                                                        <div className="mb-2 flex items-center gap-1.5 text-[9px] font-black text-foreground"><Palette className="h-3.5 w-3.5 text-brand-lime" /> Cores deste título</div>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => patchModelSettings(model.id, { colorMode: 'ops' })}
                                                                className={cn('rounded-lg border px-2 py-2 text-left transition', settings.colorMode === 'ops' ? 'border-brand-lime/45 bg-brand-lime/12' : 'border-white/8 bg-black/15')}
                                                            >
                                                                <span className={cn('block text-[8px] font-black', settings.colorMode === 'ops' ? 'text-brand-lime' : 'text-foreground/60')}>Paleta da empresa</span>
                                                                <span className="mt-0.5 block text-[7px] text-muted-foreground">Mileto Ops</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => patchModelSettings(model.id, { colorMode: 'custom' })}
                                                                className={cn('rounded-lg border px-2 py-2 text-left transition', settings.colorMode === 'custom' ? 'border-brand-lime/45 bg-brand-lime/12' : 'border-white/8 bg-black/15')}
                                                            >
                                                                <span className={cn('block text-[8px] font-black', settings.colorMode === 'custom' ? 'text-brand-lime' : 'text-foreground/60')}>Personalizado</span>
                                                                <span className="mt-0.5 block text-[7px] text-muted-foreground">Escolher cores</span>
                                                            </button>
                                                        </div>
                                                        {settings.colorMode === 'ops' ? (
                                                            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-white/7 bg-black/15 px-2 py-2">
                                                                <span className="min-w-0 text-[7px] leading-relaxed text-muted-foreground">
                                                                    {opsColors.length ? 'Paleta atual da empresa no Ops.' : 'Sem paleta Ops; exibindo as cores originais da Etapa 4.'}
                                                                </span>
                                                                <span className="flex shrink-0 -space-x-1">
                                                                    {modelColors.slice(0, 5).map((color) => <span key={color} className="h-5 w-5 rounded-full border-2 border-[#101716]" style={{ backgroundColor: color }} title={color} />)}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <div className="mt-2 grid grid-cols-2 gap-2">
                                                                <ColorField label="Principal" value={settings.primaryColor} onChange={(primaryColor) => patchModelSettings(model.id, { primaryColor })} />
                                                                <ColorField label="Secundária" value={settings.secondaryColor} onChange={(secondaryColor) => patchModelSettings(model.id, { secondaryColor })} />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="rounded-xl border border-white/8 bg-black/15 p-2.5">
                                                        <div className="mb-2 flex items-center gap-1.5 text-[9px] font-black text-foreground"><WandSparkles className="h-3.5 w-3.5 text-brand-lime" /> Movimento deste título</div>
                                                        <span className="mb-1 block text-[8px] font-bold text-foreground/50">Animação</span>
                                                        <TextAnimationPicker value={settings.animationId} onChange={(animationId) => patchModelSettings(model.id, { animationId: animationId as AiTitleTypeRule['animationId'] })} />
                                                        <label className="mt-2 block text-[8px] font-bold text-foreground/50">
                                                            <span className="mb-1 flex items-center gap-1"><Timer className="h-3 w-3" /> Duração</span>
                                                            <span className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-card/55 px-2">
                                                                <input
                                                                    type="range"
                                                                    min="0.5"
                                                                    max="8"
                                                                    step="0.5"
                                                                    value={settings.durationSec}
                                                                    onChange={(event) => patchModelSettings(model.id, { durationSec: Number(event.target.value) })}
                                                                    className="min-w-0 flex-1 accent-[#00e676]"
                                                                />
                                                                <span className="shrink-0 font-mono text-[9px] text-brand-lime">{settings.durationSec.toFixed(1)}s</span>
                                                            </span>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </article>
                                );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </section>
                                );
                            })}
                        </div>
                    </div>
                </main>

                <aside className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-card/55 shadow-xl xl:sticky xl:top-0 xl:h-[calc(100dvh-6rem)] xl:self-start">
                    <div className="border-b border-white/8 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-lime">3 · Preview</p>
                        <p className="mt-1 text-xs text-muted-foreground">Arraste e redimensione no próprio vídeo.</p>
                        {previewCompanies.length > 0 && (
                            <PreviewCompanySelect
                                companies={previewCompanies}
                                value={previewCompanyId}
                                onChange={(company) => {
                                    setPreviewCompanyId(company.id);
                                    setPreviewPalette(normalizeBrandPalette(company.palette));
                                }}
                            />
                        )}
                    </div>

                    <div className="flex min-h-0 flex-1 items-start justify-center p-3">
                        <div
                            className="shrink-0 overflow-hidden rounded-[1.6rem] border border-white/12 bg-[#080d0f] shadow-[0_28px_70px_rgba(0,0,0,.45)]"
                            style={{ width: TITLE_EDITOR_PORTRAIT_PREVIEW_WIDTH }}
                        >
                            <div className="flex h-8 items-center justify-between px-3 text-[8px] font-black uppercase tracking-[0.16em] text-foreground/55">
                                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-brand-lime shadow-[0_0_8px_#00e676]" /> Monitor de corte</span>
                                <span>{format}</span>
                            </div>
                            <div
                                className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-white/8 bg-[#151b1d]"
                            >
                                <img
                                    src={TITLE_PREVIEW_IMAGE_SRC}
                                    alt="Apresentadora mostrando o interior de uma loja"
                                    className="absolute inset-0 h-full w-full object-cover"
                                    draggable={false}
                                />
                                <div className="absolute inset-0 bg-black/12" />
                                <div className="absolute inset-x-0 bottom-0 h-[55%] bg-linear-to-t from-black/60 via-black/16 to-transparent" />

                                {showPreviewCaption && (
                                    <div className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-5" style={{ bottom: '23%' }}>
                                        <div
                                            className="flex max-w-full flex-wrap justify-center text-center font-black uppercase leading-[1.2] tracking-wide"
                                            style={{
                                                fontFamily: 'Montserrat',
                                                fontSize: '20px',
                                                WebkitTextStroke: '1px #000000',
                                                paintOrder: 'stroke fill',
                                                textShadow: '0 6px 12px rgba(0,0,0,.8)',
                                            }}
                                        >
                                            <span className="mx-1.5 text-white">SEU NEGÓCIO EM</span>
                                            <span className="mx-1.5 text-brand-lime">DESTAQUE</span>
                                        </div>
                                    </div>
                                )}

                                {previewTitle ? (
                                    <EditableTitleOverlay
                                        title={previewTitle}
                                        selected
                                        editingEnabled
                                        onSelect={() => undefined}
                                        onChange={handleOverlayChange}
                                        onDelete={() => activeModel && toggleModel(activeModel, false)}
                                        captionSafeTopPct={
                                            showPreviewCaption
                                                ? captionSafeTopPercent(
                                                      { fontSize: 20, strokeWidth: 1, verticalPosition: 23 },
                                                      format
                                                  )
                                                : undefined
                                        }
                                    >
                                <div
                                    key={`${previewTitle.styleId}-${previewTitle.animationId || 'none'}`}
                                    className={cn('origin-center', animationPreviewClass(previewTitle.animationId || 'none'))}
                                >
                                            <DynamicTitleRenderer title={previewTitle} timeElapsed={0.45} previewMode />
                                        </div>
                                    </EditableTitleOverlay>
                                ) : (
                                    <div className="absolute inset-0 grid place-items-center p-8 text-center">
                                        <div>
                                            <WandSparkles className="mx-auto h-8 w-8 text-white/15" />
                                            <p className="mt-3 text-[10px] font-black uppercase tracking-wider text-white/30">Marque um título</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </section>
    );
};
