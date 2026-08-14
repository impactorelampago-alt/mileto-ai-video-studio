import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
    MessageSquare,
    X,
    Maximize2,
    Minimize2,
    Plus,
    FolderPlus,
    Trash2,
    Edit3,
    ChevronDown,
    ChevronRight,
    Send,
    Square,
    Bot,
    User,
    FolderOpen,
    GripVertical,
    Check,
    Wand2,
    Target,
    Image as ImageIcon,
    Video,
    Sparkles,
    PanelLeftClose,
    FileText,
    Save,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import * as chatApi from '../../lib/chatApi';
import { useWizard } from '../../context/WizardContext';
import { AdData, ChatAgentId, ChatFolder, ChatSession, ChatMessage } from '../../types';
import { narrationContractFromChatScript } from '../../lib/narrationContract';
import { invalidatedNarrationDerivatives } from '../../lib/narrationState';
import { planNarrationTitles, titlePlanningNarrationKey, type TitlePlanningProposal } from '../../lib/titlePlanning';
import { classifyChatTitleModeIntent } from '../../lib/chatTitleMode';
import { ChatTitleProposal } from './ChatTitleProposal';
import { TitlePlanningProgress, type TitlePlanningProgressPhase } from './TitlePlanningProgress';
import {
    extractChatNarration as extractScript,
    extractChatNarrationTitle as extractProjectTitle,
    extractFishDirectionTags,
    hasChatNarrationDelivery as hasFinalScript,
    parseChatNarrationDelivery,
    parseStructuredChatResult as parseStructuredResult,
    stripChatNarrationMarkers as stripMarkers,
    uniqueFishDirectionTags,
} from '../../lib/chatNarrationDelivery';

interface SavedChatScript {
    id: string;
    title: string;
    content: string;
    createdAt: number;
    updatedAt: number;
}

interface ChatTitlePlanState {
    proposal?: TitlePlanningProposal;
    busy: boolean;
    error?: string;
    lastInstruction?: string;
    phase: TitlePlanningProgressPhase;
    sessionId: string;
    script: string;
    narrationKey: string;
}

const SAVED_CHAT_SCRIPTS_STORAGE_KEY = 'mileto_chat_saved_scripts_v1';

const readSavedChatScripts = (): SavedChatScript[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(SAVED_CHAT_SCRIPTS_STORAGE_KEY) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is SavedChatScript => Boolean(
            item
            && typeof item.id === 'string'
            && typeof item.title === 'string'
            && typeof item.content === 'string'
        ));
    } catch {
        return [];
    }
};

type MiletoTier = 'lite' | 'mileto' | 'ultra';
const MILETO_TIERS: { id: MiletoTier; label: string; model: string; description: string }[] = [
    { id: 'lite', label: 'Mileto Lite', model: 'mileto-lite', description: 'Mais rápido e econômico' },
    { id: 'mileto', label: 'Mileto', model: 'mileto-plus', description: 'Equilíbrio recomendado' },
    { id: 'ultra', label: 'Mileto Ultra', model: 'mileto-ultra', description: 'Máxima profundidade' },
];

const ACTIVE_CHAT_AGENT_ID: ChatAgentId = 'prompt_sales';
// Apenas para identificar respostas antigas sem reativar os cargos no Chat.
const HISTORICAL_AGENT_LABELS: Record<ChatAgentId, string> = {
    director: 'Mileto Diretor',
    prompt_sales: 'Narração e Vendas',
    image_director: 'Diretor de Imagens',
    video_director: 'Diretor de Vídeos',
};
const historicalAgentLabel = (id?: ChatAgentId) => HISTORICAL_AGENT_LABELS[id || ACTIVE_CHAT_AGENT_ID];

const AgentGlyph = ({ id, className = 'w-4 h-4' }: { id: ChatAgentId; className?: string }) => {
    if (id === 'prompt_sales') return <Target className={className} />;
    if (id === 'image_director') return <ImageIcon className={className} />;
    if (id === 'video_director') return <Video className={className} />;
    return <Sparkles className={className} />;
};

const renderInlineChatText = (text: string, keyPrefix: string): React.ReactNode[] =>
    text
        .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
        .filter(Boolean)
        .map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith('`') && part.endsWith('`')) {
                return <code key={`${keyPrefix}-code-${index}`} className="rounded bg-black/10 px-1 py-0.5 text-[.92em] text-brand-accent dark:bg-white/10">{part.slice(1, -1)}</code>;
            }
            return <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>;
        });

const RichChatText = ({ content }: { content: string }) => {
    const lines = content.split('\n');

    return (
        <div className="space-y-2 text-[13px] leading-6 text-foreground/90">
            {lines.map((rawLine, index) => {
                const line = rawLine.trim();
                if (!line) return <div key={`space-${index}`} className="h-1" aria-hidden="true" />;

                const heading = line.match(/^(#{1,3})\s+(.+)$/);
                if (heading) {
                    return (
                        <h4 key={`heading-${index}`} className="pt-1 text-sm font-bold tracking-tight text-foreground">
                            {renderInlineChatText(heading[2], `heading-${index}`)}
                        </h4>
                    );
                }

                const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
                if (ordered) {
                    return (
                        <div key={`ordered-${index}`} className="flex items-start gap-2.5 rounded-xl border border-brand-accent/10 bg-brand-accent/[.035] px-3 py-2">
                            <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-accent/15 text-[10px] font-bold text-brand-accent">{ordered[1]}</span>
                            <span className="min-w-0">{renderInlineChatText(ordered[2], `ordered-${index}`)}</span>
                        </div>
                    );
                }

                const bullet = line.match(/^[-•]\s+(.+)$/);
                if (bullet) {
                    return (
                        <div key={`bullet-${index}`} className="flex items-start gap-2.5 pl-1">
                            <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" />
                            <span className="min-w-0">{renderInlineChatText(bullet[1], `bullet-${index}`)}</span>
                        </div>
                    );
                }

                if (line.startsWith('> ')) {
                    return (
                        <div key={`quote-${index}`} className="rounded-r-xl border-l-2 border-brand-accent bg-brand-accent/[.045] px-3 py-2 text-foreground">
                            {renderInlineChatText(line.slice(2), `quote-${index}`)}
                        </div>
                    );
                }

                if (/^[\p{L}][\p{L}\s]{1,36}:$/u.test(line)) {
                    return <div key={`label-${index}`} className="pt-1 text-[10px] font-bold uppercase tracking-[.16em] text-brand-accent">{line.slice(0, -1)}</div>;
                }

                return <p key={`paragraph-${index}`}>{renderInlineChatText(line, `paragraph-${index}`)}</p>;
            })}
        </div>
    );
};

const FISH_DIRECTION_PART_PATTERN = /(\[[a-z][a-z ' -]{0,63}\])/g;

const NarrationText = ({ narration }: { narration: string }) => {
    const directionTags = new Set(extractFishDirectionTags(narration));
    return narration.split(FISH_DIRECTION_PART_PATTERN).map((part, index) =>
        directionTags.has(part) ? (
            <span
                key={`fish-direction-${index}`}
                className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-md border border-cyan-500/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-cyan-700 dark:text-cyan-300"
                title="Direção de voz do Fish Audio"
            >
                {part}
            </span>
        ) : (
            <React.Fragment key={`narration-text-${index}`}>{part}</React.Fragment>
        )
    );
};

interface NarrationCardProps {
    content: string;
    onApply: () => void;
    onApplyAndCreateTitles: () => void;
    titlePlanningNode?: React.ReactNode;
    actionsDisabled?: boolean;
}

const NarrationCard = ({
    content,
    onApply,
    onApplyAndCreateTitles,
    titlePlanningNode,
    actionsDisabled = false,
}: NarrationCardProps) => {
    const delivery = parseChatNarrationDelivery(content);
    if (!delivery) return null;

    const directionTags = extractFishDirectionTags(delivery.narration);
    const uniqueDirections = uniqueFishDirectionTags(delivery.narration);
    const directionLabel = `${directionTags.length} ${directionTags.length === 1 ? 'direção' : 'direções'}`;

    return (
        <div className="space-y-3">
            {delivery.before && (
                <div className="rounded-2xl border border-black/5 bg-brand-card/50 px-4 py-3 shadow-lg dark:border-white/5">
                    <RichChatText content={delivery.before} />
                </div>
            )}

            <section
                data-mileto-narration-card="final"
                aria-label="Narração pronta"
                className="overflow-hidden rounded-2xl border border-black/10 bg-brand-card/80 dark:border-white/10"
            >
                <header className="flex items-start justify-between gap-3 border-b border-black/5 px-4 py-3 dark:border-white/5">
                    <div className="min-w-0">
                        <div className="text-[9px] font-bold uppercase tracking-[.16em] text-brand-accent">
                            Narração pronta
                        </div>
                        <h4 className="mt-1 truncate text-[13px] font-semibold text-foreground">
                            {delivery.title}
                        </h4>
                    </div>

                    <span className={cn(
                        'shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold',
                        directionTags.length > 0
                            ? 'border-cyan-500/20 bg-cyan-500/[.06] text-cyan-700 dark:text-cyan-300'
                            : 'border-black/10 bg-black/[.035] text-brand-muted dark:border-white/10 dark:bg-white/[.035]'
                    )}>
                        {directionTags.length > 0 ? `Fish Audio · ${directionLabel}` : 'Sem direções'}
                    </span>
                </header>

                <div className="px-4 py-3.5">
                    <div className="whitespace-pre-wrap text-[13px] leading-6 text-foreground/95">
                        <NarrationText narration={delivery.narration} />
                    </div>
                </div>

                {uniqueDirections.length > 0 && (
                    <details className="border-t border-black/5 px-4 py-2.5 text-[10px] dark:border-white/5">
                        <summary className="cursor-pointer select-none text-brand-muted hover:text-foreground">
                            Ver {directionLabel}
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {uniqueDirections.map((tag) => (
                                <span key={tag} className="rounded-md border border-cyan-500/15 px-1.5 py-1 font-mono text-[9px] text-cyan-700 dark:text-cyan-300">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </details>
                )}

                <footer className="flex flex-wrap justify-end gap-2 border-t border-black/5 p-3 dark:border-white/5">
                    <button
                        type="button"
                        data-narration-action="apply"
                        onClick={onApply}
                        disabled={actionsDisabled}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-black/10 px-3 text-[10px] font-semibold text-foreground transition hover:border-brand-accent/35 disabled:cursor-wait disabled:opacity-45 dark:border-white/10"
                    >
                        Aplicar narração
                    </button>
                    <button
                        type="button"
                        data-narration-action="apply-and-create-titles"
                        onClick={onApplyAndCreateTitles}
                        disabled={actionsDisabled}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-brand-accent px-3 text-[10px] font-bold text-[#07110d] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-45"
                    >
                        <Wand2 className="h-3.5 w-3.5" /> Aplicar e criar títulos
                    </button>
                </footer>
            </section>

            {titlePlanningNode}

            {delivery.after && (
                <div className="rounded-xl border border-black/5 bg-black/[.025] px-3 py-2 dark:border-white/5 dark:bg-white/[.025]">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-[.16em] text-brand-muted">Observação</div>
                    <RichChatText content={delivery.after} />
                </div>
            )}
        </div>
    );
};

interface StructuredAgentResponseProps {
    content: string;
    onApply: () => void;
    onApplyAndCreateTitles: () => void;
    titlePlanningNode?: React.ReactNode;
    actionsDisabled?: boolean;
}

const StructuredAgentResponse = ({
    content,
    onApply,
    onApplyAndCreateTitles,
    titlePlanningNode,
    actionsDisabled = false,
}: StructuredAgentResponseProps) => {
    const delivery = parseChatNarrationDelivery(content);
    if (delivery) {
        return (
            <NarrationCard
                content={content}
                onApply={onApply}
                onApplyAndCreateTitles={onApplyAndCreateTitles}
                titlePlanningNode={titlePlanningNode}
                actionsDisabled={actionsDisabled}
            />
        );
    }

    const result = parseStructuredResult(content);
    if (!result) return <RichChatText content={stripMarkers(content)} />;

    const title = typeof result.title === 'string' ? result.title : 'Plano de produção';
    const mainPrompt = [result.prompt, result.masterPrompt, result.objective]
        .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
    const compactFields = [
        ['Hook', result.hook],
        ['CTA', result.cta],
        ['Estilo', result.visualStyle || result.style],
        ['Formato', result.aspectRatio],
    ].filter(([, value]) => typeof value === 'string' && value.trim()) as Array<[string, string]>;
    const triggers = Array.isArray(result.triggers) ? result.triggers.filter((item) => typeof item === 'string') : [];
    const scenes = Array.isArray(result.scenes) ? result.scenes.length : 0;
    const takes = Array.isArray(result.takes) ? result.takes.length : 0;

    return (
        <div className="space-y-3">
            <div>
                <div className="text-[10px] font-bold uppercase tracking-[.18em] text-brand-accent">Entrega especializada</div>
                <h4 className="mt-1 text-sm font-bold text-foreground">{title}</h4>
            </div>
            {mainPrompt && (
                <div className="rounded-xl border border-black/10 dark:border-white/10 bg-brand-dark/55 p-3 whitespace-pre-wrap text-xs leading-relaxed">
                    {mainPrompt}
                </div>
            )}
            {compactFields.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                    {compactFields.map(([label, value]) => (
                        <div key={label} className="rounded-lg bg-black/5 dark:bg-white/5 px-2.5 py-2">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-brand-muted">{label}</div>
                            <div className="mt-1 text-[11px] text-foreground/90">{value}</div>
                        </div>
                    ))}
                </div>
            )}
            {(triggers.length > 0 || scenes > 0 || takes > 0) && (
                <div className="flex flex-wrap gap-1.5">
                    {triggers.map((trigger) => <span key={trigger} className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[9px] font-semibold text-amber-200">{trigger}</span>)}
                    {scenes > 0 && <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-1 text-[9px] font-semibold text-violet-200">{scenes} cenas</span>}
                    {takes > 0 && <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[9px] font-semibold text-cyan-200">{takes} takes</span>}
                </div>
            )}
        </div>
    );
};

const tierFromStoredModel = (model: string): MiletoTier => {
    if (model === 'mileto-lite') return 'lite';
    if (model === 'mileto-ultra') return 'ultra';
    return 'mileto';
};

// ─── Main Component ──────────────────────────────────────────────────────────

export const ChatMileto: React.FC = () => {
    // ─── Window State ────────────────────────────────────────────────────────
    const [isOpen, setIsOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // ─── Drag State for the floating button ──────────────────────────────────
    const [btnPos, setBtnPos] = useState({ x: -1, y: -1 });
    const isDraggingBtn = useRef(false);
    const [isBtnDraggingState, setIsBtnDraggingState] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const hasDragged = useRef(false);

    // ─── Chat Data ───────────────────────────────────────────────────────────
    const [folders, setFolders] = useState<ChatFolder[]>([]);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [savedScripts, setSavedScripts] = useState<SavedChatScript[]>(readSavedChatScripts);
    const [isScriptLibraryOpen, setIsScriptLibraryOpen] = useState(false);
    const [isCreatingScript, setIsCreatingScript] = useState(false);
    const [newScriptTitle, setNewScriptTitle] = useState('');
    const [newScriptContent, setNewScriptContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    // O renderer conhece somente o nível público. Cérebro, modelo, raciocínio e
    // prompt são resolvidos pelo gateway dentro da versão ativa de cada agente.
    const [selectedTier, setSelectedTier] = useState<MiletoTier>('mileto');
    const [tierMenuOpen, setTierMenuOpen] = useState(false);
    const selectedModel = MILETO_TIERS.find((tier) => tier.id === selectedTier)?.model || 'mileto-plus';

    const navigate = useNavigate();
    const { adData, updateAdData } = useWizard();
    const [titlePlans, setTitlePlans] = useState<Record<string, ChatTitlePlanState>>({});
    const [activeTitlePlanMessageId, setActiveTitlePlanMessageId] = useState<string | null>(null);
    const titlePlanAbortControllerRef = useRef<AbortController | null>(null);
    const activeTitlePlan = activeTitlePlanMessageId
        ? titlePlans[activeTitlePlanMessageId]
        : undefined;
    const isTitleModeActive = Boolean(
        activeTitlePlanMessageId
        && activeTitlePlan
        && activeTitlePlan.sessionId === activeSessionId,
    );

    const exitTitleMode = useCallback((notify = false) => {
        titlePlanAbortControllerRef.current?.abort();
        titlePlanAbortControllerRef.current = null;
        if (activeTitlePlanMessageId) {
            setTitlePlans((current) => {
                const state = current[activeTitlePlanMessageId];
                if (!state?.busy) return current;
                return {
                    ...current,
                    [activeTitlePlanMessageId]: {
                        ...state,
                        busy: false,
                        error: 'Planejamento interrompido. Você pode iniciar novamente quando quiser.',
                    },
                };
            });
        }
        setActiveTitlePlanMessageId(null);
        setTierMenuOpen(false);
        setInputText('');
        if (notify) toast.info('Ajuste de títulos encerrado. O Narrador voltou ao modo normal.');
    }, [activeTitlePlanMessageId]);

    useEffect(() => {
        try {
            localStorage.setItem(SAVED_CHAT_SCRIPTS_STORAGE_KEY, JSON.stringify(savedScripts));
        } catch {
            // O chat continua utilizável mesmo quando o armazenamento local está indisponível.
        }
    }, [savedScripts]);

    const handleSaveScript = useCallback(() => {
        const content = newScriptContent.trim();
        if (!content) {
            toast.warning('Cole um roteiro antes de salvar.');
            return;
        }
        const now = Date.now();
        const fallbackTitle = content.replace(/\s+/g, ' ').slice(0, 42);
        setSavedScripts((current) => [{
            id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `script-${now}-${Math.random().toString(36).slice(2)}`,
            title: newScriptTitle.trim() || fallbackTitle || 'Roteiro salvo',
            content,
            createdAt: now,
            updatedAt: now,
        }, ...current]);
        setNewScriptTitle('');
        setNewScriptContent('');
        setIsCreatingScript(false);
        toast.success('Roteiro salvo na sua biblioteca.');
    }, [newScriptContent, newScriptTitle]);

    const handleUseSavedScript = useCallback((script: SavedChatScript) => {
        setInputText(script.content);
        window.setTimeout(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(script.content.length, script.content.length);
        }, 0);
    }, []);

    const narrationPatchFromMessage = useCallback(
        (msg: ChatMessage): Partial<AdData> => {
            const script = extractScript(msg.content);
            const title = extractProjectTitle(msg.content);
            const result = parseStructuredResult(msg.content);
            const responseMode = msg.narrationDirectionMode;
            const explicitMode = responseMode === 'automatic'
                || responseMode === 'manual'
                || responseMode === 'clean'
                ? responseMode
                : result?.directionMode === 'automatic'
                || result?.directionMode === 'manual'
                || result?.directionMode === 'clean'
                ? result.directionMode
                : null;
            return {
                ...invalidatedNarrationDerivatives(),
                title,
                ...narrationContractFromChatScript(adData, script, explicitMode),
                isNarrationGenerated: false,
                plannedTitles: undefined,
                plannedTitlesNarrationKey: undefined,
            };
        },
        [adData]
    );

    const handleUseAsScript = useCallback(
        (msg: ChatMessage) => {
            if (isLoading) {
                toast.info('Aguarde a resposta atual terminar antes de aplicar outra narração.');
                return;
            }
            exitTitleMode();
            updateAdData(narrationPatchFromMessage(msg));
            setIsOpen(false);
            navigate('/wizard/step/1');
            toast.success('Narração aplicada ao projeto.');
        },
        [exitTitleMode, isLoading, navigate, narrationPatchFromMessage, updateAdData]
    );

    const handleApplyAndCreateTitles = useCallback(async (msg: ChatMessage) => {
        if (isLoading) {
            toast.info('Aguarde a resposta atual terminar antes de criar títulos.');
            return;
        }
        const patch = narrationPatchFromMessage(msg);
        const nextAdData = { ...adData, ...patch } as AdData;
        const script = nextAdData.narrationPlainText;
        exitTitleMode();
        setEditingMessageId(null);
        const controller = new AbortController();
        titlePlanAbortControllerRef.current = controller;
        updateAdData(patch);
        setActiveTitlePlanMessageId(msg.id);
        setTierMenuOpen(false);
        setTitlePlans((current) => ({
            ...current,
            [msg.id]: {
                busy: true,
                phase: 'generating',
                sessionId: msg.sessionId,
                script,
                narrationKey: titlePlanningNarrationKey(script),
            },
        }));
        try {
            const proposal = await planNarrationTitles({ script, signal: controller.signal });
            if (titlePlanAbortControllerRef.current !== controller) return;
            setTitlePlans((current) => ({
                ...current,
                [msg.id]: {
                    ...current[msg.id],
                    proposal,
                    busy: false,
                    phase: 'generating',
                    error: undefined,
                },
            }));
            toast.success('Narração aplicada. Agora revise os títulos sugeridos.');
        } catch (error) {
            if (controller.signal.aborted) return;
            const message = error instanceof Error ? error.message : 'Não foi possível criar os títulos.';
            setTitlePlans((current) => ({
                ...current,
                [msg.id]: {
                    ...(current[msg.id] || {
                        sessionId: msg.sessionId,
                        script,
                        narrationKey: titlePlanningNarrationKey(script),
                        phase: 'generating' as const,
                    }),
                    busy: false,
                    error: message,
                },
            }));
            toast.error(message);
        } finally {
            if (titlePlanAbortControllerRef.current === controller) {
                titlePlanAbortControllerRef.current = null;
            }
        }
    }, [adData, exitTitleMode, isLoading, narrationPatchFromMessage, updateAdData]);

    const updateTitlePlan = useCallback((messageId: string, updater: (proposal: TitlePlanningProposal) => TitlePlanningProposal) => {
        setTitlePlans((current) => {
            const state = current[messageId];
            if (!state?.proposal) return current;
            return { ...current, [messageId]: { ...state, proposal: updater(state.proposal) } };
        });
    }, []);

    const handleRefineTitlePlan = useCallback(async (messageId: string, rawInstruction: string) => {
        const state = titlePlans[messageId];
        const instruction = rawInstruction.trim();
        if (!state || !instruction || state.busy) return;
        if (titlePlanningNarrationKey(adData.narrationPlainText) !== state.narrationKey) {
            const message = 'A narração do projeto mudou. Gere novamente os títulos a partir da narração atual.';
            setTitlePlans((current) => ({
                ...current,
                [messageId]: { ...current[messageId], error: message },
            }));
            toast.warning(message);
            return;
        }
        const controller = new AbortController();
        titlePlanAbortControllerRef.current?.abort();
        titlePlanAbortControllerRef.current = controller;
        setTitlePlans((current) => ({
            ...current,
            [messageId]: {
                ...state,
                busy: true,
                phase: 'refining',
                lastInstruction: instruction,
                error: undefined,
            },
        }));
        try {
            const proposal = await planNarrationTitles({
                script: state.script,
                instruction,
                previousTitles: state.proposal?.suggestions,
                revision: state.proposal?.revision,
                signal: controller.signal,
            });
            if (titlePlanAbortControllerRef.current !== controller) return;
            setTitlePlans((current) => ({
                ...current,
                [messageId]: {
                    ...current[messageId],
                    proposal,
                    busy: false,
                    phase: 'refining',
                    error: undefined,
                },
            }));
        } catch (error) {
            if (controller.signal.aborted) return;
            const message = error instanceof Error ? error.message : 'Não foi possível ajustar os títulos.';
            setTitlePlans((current) => ({
                ...current,
                [messageId]: {
                    ...current[messageId],
                    busy: false,
                    error: message,
                },
            }));
        } finally {
            if (titlePlanAbortControllerRef.current === controller) {
                titlePlanAbortControllerRef.current = null;
            }
        }
    }, [adData.narrationPlainText, titlePlans]);

    const handleApplyTitlePlan = useCallback((msg: ChatMessage) => {
        const proposal = titlePlans[msg.id]?.proposal;
        if (!proposal) return;
        const selected = proposal.suggestions
            .filter((suggestion) => suggestion.selected && suggestion.text.trim())
            .map((suggestion) => ({ ...suggestion, text: suggestion.text.trim() }));
        if (!selected.length) {
            toast.warning('Selecione pelo menos um título.');
            return;
        }
        const nextAdData = { ...adData, ...narrationPatchFromMessage(msg) } as AdData;
        if (
            titlePlanningNarrationKey(adData.narrationPlainText) !==
            titlePlanningNarrationKey(nextAdData.narrationPlainText)
        ) {
            toast.warning('A narração do projeto mudou. Gere novamente as sugestões para evitar títulos desatualizados.');
            return;
        }
        updateAdData({
            plannedTitles: selected,
            plannedTitlesNarrationKey: titlePlanningNarrationKey(nextAdData.narrationPlainText),
        });
        exitTitleMode();
        toast.success(`${selected.length} título${selected.length === 1 ? '' : 's'} aplicado${selected.length === 1 ? '' : 's'} ao projeto.`);
    }, [adData, exitTitleMode, narrationPatchFromMessage, titlePlans, updateAdData]);

    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');

    // ─── Inline New Folder State ─────────────────────────────────────────────
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');

    // ─── Drag & Drop Session into Folder ─────────────────────────────────────
    const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
    const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const activeRequestControllersRef = useRef(new Map<string, AbortController>());
    // Quando a resposta já foi persistida mas o POST ficou preso na rede do
    // Electron, o monitor encerra somente a espera local. Este Set diferencia
    // essa reconciliação automática de uma interrupção solicitada pelo usuário.
    const reconciledRequestSessionsRef = useRef(new Set<string>());
    const pendingResponseMarkersRef = useRef(
        new Map<string, { baselineLastMessageId: string | null; startedAt: number }>()
    );
    const [responseWatchRevision, setResponseWatchRevision] = useState(0);
    const activeSessionRef = useRef<string | null>(null);

    // Não cancelamos uma resposta ao recolher/desmontar o painel: a execução é
    // mantida pelo servidor e a conversa é atualizada quando o usuário voltar.

    // ─── Initialize button position ──────────────────────────────────────────
    useEffect(() => {
        if (btnPos.x === -1) {
            setBtnPos({ x: window.innerWidth - 80, y: window.innerHeight - 80 });
        }
    }, []);

    // ─── Load data ───────────────────────────────────────────────────────────
    useEffect(() => {
        if (isOpen) {
            chatApi.getFolders().then(setFolders).catch(console.error);
            chatApi.getSessions().then(setSessions).catch(console.error);
        }
    }, [isOpen]);

    useEffect(() => {
        if (activeSessionId) {
            // Sessão recém-criada NESTA ação já tem a mensagem otimista na tela; buscar
            // do servidor devolveria [] e apagaria a bolha do usuário (race). Pula uma vez.
            if (justCreatedSessionRef.current === activeSessionId) {
                justCreatedSessionRef.current = null;
                return;
            }
            chatApi.getMessages(activeSessionId).then(setMessages).catch(console.error);
        } else {
            setMessages([]);
        }
    }, [activeSessionId]);

    useEffect(() => {
        activeSessionRef.current = activeSessionId;
    }, [activeSessionId]);

    useEffect(() => {
        if (!activeTitlePlanMessageId || !activeTitlePlan || !activeSessionId) return;
        if (activeTitlePlan.sessionId !== activeSessionId) {
            exitTitleMode();
            return;
        }
        if (!messages.some((message) => message.id === activeTitlePlanMessageId)) {
            exitTitleMode();
        }
    }, [
        activeSessionId,
        activeTitlePlan,
        activeTitlePlanMessageId,
        exitTitleMode,
        messages,
    ]);

    // ─── Auto-scroll ─────────────────────────────────────────────────────────
    // Caso o painel seja fechado, a resposta continua no servidor. Ao voltar à
    // conversa, consultamos o estado e recarregamos as mensagens até ela terminar.
    useEffect(() => {
        if (!isOpen || !activeSessionId) return;

        let disposed = false;
        let timer: number | undefined;
        let observedActiveResponse = false;
        const sessionId = activeSessionId;

        const refreshBackgroundResponse = async () => {
            try {
                const { active } = await chatApi.getResponseStatus(sessionId);
                if (disposed) return;

                const persisted = await chatApi.getMessages(sessionId);
                if (disposed) return;
                setMessages(persisted);

                // O POST pode ainda estar chegando ao servidor quando a primeira
                // consulta acontece. Enquanto não surgir uma nova resposta criada
                // depois deste envio, a requisição local mantém o monitor ativo.
                const localController = activeRequestControllersRef.current.get(sessionId);
                const lastPersistedMessage = persisted[persisted.length - 1];
                const pendingMarker = pendingResponseMarkersRef.current.get(sessionId);
                const persistedAt = lastPersistedMessage ? Date.parse(lastPersistedMessage.createdAt) : Number.NaN;
                const hasNewPersistedAssistant = Boolean(
                    localController &&
                    pendingMarker &&
                    lastPersistedMessage?.role === 'assistant' &&
                    lastPersistedMessage.id !== pendingMarker.baselineLastMessageId &&
                    Number.isFinite(persistedAt) &&
                    persistedAt >= pendingMarker.startedAt - 2_000
                );
                const waitingForFirstServerState = Boolean(
                    localController && !hasNewPersistedAssistant
                );

                if (active || waitingForFirstServerState) {
                    if (active) observedActiveResponse = true;
                    setIsLoading(true);
                    timer = window.setTimeout(refreshBackgroundResponse, 800);
                    return;
                }

                // O estado do servidor é a fonte de verdade. Uma requisição HTTP
                // antiga pode continuar pendurada mesmo depois de a resposta já
                // ter sido salva; ela não deve manter os três pontos na tela.
                if (localController && hasNewPersistedAssistant) {
                    reconciledRequestSessionsRef.current.add(sessionId);
                    localController.abort();
                }
                activeRequestControllersRef.current.delete(sessionId);
                pendingResponseMarkersRef.current.delete(sessionId);
                if (localController || observedActiveResponse) setIsLoading(false);
            } catch (error) {
                if (!disposed) {
                    console.error('Falha ao recuperar resposta em segundo plano:', error);
                    // Um erro transitório de rede não pode matar o monitor. Antes,
                    // só fechar e reabrir o chat criava um monitor novo.
                    timer = window.setTimeout(refreshBackgroundResponse, 1600);
                }
            }
        };

        timer = window.setTimeout(refreshBackgroundResponse, 350);
        return () => {
            disposed = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [isOpen, activeSessionId, responseWatchRevision]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ─── Auto-resize textarea ────────────────────────────────────────────────
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
        }
    }, [inputText]);

    // ─── Button Drag Handlers ────────────────────────────────────────────────
    const onBtnMouseDown = useCallback(
        (e: React.MouseEvent) => {
            isDraggingBtn.current = true;
            hasDragged.current = false;
            dragOffset.current = { x: e.clientX - btnPos.x, y: e.clientY - btnPos.y };

            const onMove = (ev: MouseEvent) => {
                if (isDraggingBtn.current) {
                    hasDragged.current = true;
                    if (!isBtnDraggingState) setIsBtnDraggingState(true);
                    setBtnPos({
                        x: Math.max(0, Math.min(window.innerWidth - 56, ev.clientX - dragOffset.current.x)),
                        y: Math.max(0, Math.min(window.innerHeight - 56, ev.clientY - dragOffset.current.y)),
                    });
                }
            };
            const onUp = () => {
                isDraggingBtn.current = false;
                setIsBtnDraggingState(false);
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        },
        [btnPos]
    );

    const onBtnClick = useCallback(() => {
        if (!hasDragged.current) {
            setIsOpen(true);
        }
    }, []);

    // ─── Drag & Drop Handlers ────────────────────────────────────────────────
    const onDragStart = useCallback((e: React.DragEvent, sessionId: string) => {
        setDraggingSessionId(sessionId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', sessionId);
    }, []);

    const onDragOver = useCallback((e: React.DragEvent, folderId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTargetFolderId(folderId);
    }, []);

    const onDragLeave = useCallback(() => {
        setDropTargetFolderId(null);
    }, []);

    const onDrop = useCallback(async (e: React.DragEvent, folderId: string) => {
        e.preventDefault();
        setDropTargetFolderId(null);
        const sessionId = e.dataTransfer.getData('text/plain');
        if (!sessionId) return;

        try {
            const updated = await chatApi.moveSession(sessionId, folderId);
            setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
            // Auto-expand the folder
            setExpandedFolders((prev) => new Set([...prev, folderId]));
        } catch (err) {
            console.error(err);
        }
        setDraggingSessionId(null);
    }, []);

    const onDragEnd = useCallback(() => {
        setDraggingSessionId(null);
        setDropTargetFolderId(null);
    }, []);

    // ─── Chat Actions ────────────────────────────────────────────────────────

    const stopActiveResponse = useCallback(() => {
        const sessionId = activeSessionRef.current;
        if (!sessionId) return;

        activeRequestControllersRef.current.get(sessionId)?.abort();
        void chatApi.cancelResponse(sessionId).catch((error) => {
            console.error('Falha ao interromper a resposta no servidor:', error);
        });
    }, []);

    const handleNewChat = useCallback((folderId?: string | null) => {
        // Criar ou abrir outra conversa não interrompe trabalhos já enviados.
        // Eles continuam no servidor e ficam disponíveis ao voltar para a sessão.
        setActiveSessionId(null);
        activeSessionRef.current = null;
        setIsLoading(false);
        setMessages([]);
        setInputText('');
        setEditingMessageId(null);
        exitTitleMode();
        // If creating inside a folder, we'll store the target folder for the next auto-created session
        newChatFolderRef.current = folderId || null;
    }, [exitTitleMode]);

    const newChatFolderRef = useRef<string | null>(null);
    // Marca a sessão criada dentro do próprio envio, para o efeito de carregar
    // mensagens não sobrescrever a mensagem otimista com uma lista vazia.
    const justCreatedSessionRef = useRef<string | null>(null);

    const handleEditLastMessage = useCallback((message: ChatMessage) => {
        if (isLoading || message.role !== 'user') return;
        exitTitleMode();
        setEditingMessageId(message.id);
        setInputText(message.content);
        window.setTimeout(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(message.content.length, message.content.length);
        }, 0);
    }, [exitTitleMode, isLoading]);

    // Override handleSend to use the folder ref for auto-create
    const handleSendWithFolder = useCallback(async () => {
        const userContent = inputText.trim();
        if (!userContent || isLoading || activeTitlePlan?.busy) return;

        if (isTitleModeActive && activeTitlePlanMessageId && activeTitlePlan) {
            const intent = classifyChatTitleModeIntent(userContent);
            if (intent === 'exit_title_mode') {
                setInputText('');
                exitTitleMode(true);
                return;
            }
            if (intent === 'refine_titles') {
                const sessionId = activeTitlePlan.sessionId;
                const tempUserMsg: ChatMessage = {
                    id: `temp-title-refinement-${Date.now()}`,
                    sessionId,
                    role: 'user',
                    content: userContent,
                    interactionMode: 'title_refinement',
                    createdAt: new Date().toISOString(),
                };
                setInputText('');
                setEditingMessageId(null);
                setMessages((current) => [...current, tempUserMsg]);

                const refinement = handleRefineTitlePlan(activeTitlePlanMessageId, userContent);
                try {
                    const persisted = await chatApi.persistTitleRefinementMessage(sessionId, userContent);
                    if (activeSessionRef.current === sessionId) {
                        setMessages((current) => current.map((message) => (
                            message.id === tempUserMsg.id ? persisted : message
                        )));
                    }
                } catch (error) {
                    console.error('Falha ao persistir o ajuste de títulos:', error);
                    toast.warning('O ajuste foi enviado, mas não pôde ser salvo no histórico local.');
                }
                await refinement;
                return;
            }

            if (intent === 'narrator') {
                // Um pedido explícito de roteiro/narração encerra o contexto de
                // títulos e segue pelo fluxo normal do Narrador na mesma mensagem.
                exitTitleMode();
            }
        }

        let sessionId = activeSessionId;
        let responseBaselineLastMessageId = messages[messages.length - 1]?.id || null;

        if (!sessionId) {
            try {
                const targetFolder = newChatFolderRef.current;
                const session = await chatApi.createSession(
                    inputText.substring(0, 40) + (inputText.length > 40 ? '...' : ''),
                    targetFolder,
                    selectedModel,
                    ACTIVE_CHAT_AGENT_ID
                );
                setSessions((prev) => [session, ...prev]);
                sessionId = session.id;
                justCreatedSessionRef.current = session.id;
                setActiveSessionId(session.id);
                newChatFolderRef.current = null;
            } catch (err) {
                // Antes isto era um `return` mudo: o texto ficava na caixa e o
                // usuário não tinha nenhuma pista do que aconteceu.
                console.error('Falha ao criar sessão de chat:', err);
                toast.error(
                    'Não foi possível iniciar a conversa. Verifique se o servidor local está rodando.'
                );
                return;
            }
        }

        setIsLoading(true);

        if (editingMessageId && sessionId) {
            try {
                const remaining = await chatApi.truncateMessagesFrom(sessionId, editingMessageId);
                setMessages(remaining);
                responseBaselineLastMessageId = remaining[remaining.length - 1]?.id || null;
                setEditingMessageId(null);
            } catch (err) {
                console.error('Falha ao preparar a reescrita:', err);
                toast.error('Não foi possível editar esta mensagem. Tente novamente.');
                setIsLoading(false);
                return;
            }
        }

        setInputText('');

        const tempUserMsg: ChatMessage = {
            id: 'temp-user-' + Date.now(),
            sessionId: sessionId,
            role: 'user',
            content: userContent,
            createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, tempUserMsg]);

        const requestController = new AbortController();
        activeRequestControllersRef.current.set(sessionId, requestController);
        pendingResponseMarkersRef.current.set(sessionId, {
            baselineLastMessageId: responseBaselineLastMessageId,
            startedAt: Date.now(),
        });
        // O envio em uma conversa já aberta precisa religar o monitor; alterar
        // somente isLoading não recriava o efeito e causava a resposta invisível.
        setResponseWatchRevision((revision) => revision + 1);

        try {
            const locale = navigator.language || 'pt-BR';
            const { userMessage, assistantMessage } = await chatApi.sendMessage(
                sessionId,
                userContent,
                selectedModel,
                'equilibrado',
                locale,
                ACTIVE_CHAT_AGENT_ID,
                requestController.signal
            );
            if (activeSessionRef.current === sessionId) {
                setMessages((prev) => {
                    const replacedIds = new Set([tempUserMsg.id, userMessage.id, assistantMessage.id]);
                    return prev
                        .filter((message) => !replacedIds.has(message.id))
                        .concat([userMessage, assistantMessage])
                        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
                });
            }
        } catch (err: unknown) {
            if ((err as Error)?.name === 'AbortError' || requestController.signal.aborted) {
                const wasReconciled = reconciledRequestSessionsRef.current.has(sessionId);
                try {
                    const persisted = await chatApi.getMessages(sessionId);
                    if (activeSessionRef.current === sessionId) {
                        setMessages(persisted);
                    }
                } catch (refreshErr) {
                    console.error('Falha ao atualizar a conversa interrompida:', refreshErr);
                }
                if (wasReconciled) return;
                if (activeSessionRef.current === sessionId) {
                    toast.info('Resposta interrompida. Você pode editar sua última mensagem e tentar novamente.');
                }
                return;
            }
            const axErr = err as { response?: { data?: { message?: string } }; message?: string };
            const errorMsg: ChatMessage = {
                id: 'error-' + Date.now(),
                sessionId: sessionId,
                role: 'assistant',
                content: `❌ Erro: ${axErr?.response?.data?.message || axErr?.message || 'Falha na comunicação com a IA.'}`,
                agentId: ACTIVE_CHAT_AGENT_ID,
                agentLabel: 'Narrador',
                createdAt: new Date().toISOString(),
            };
            if (activeSessionRef.current === sessionId) {
                setMessages((prev) => [...prev, errorMsg]);
            }
        } finally {
            reconciledRequestSessionsRef.current.delete(sessionId);
            pendingResponseMarkersRef.current.delete(sessionId);
            if (activeRequestControllersRef.current.get(sessionId) === requestController) {
                activeRequestControllersRef.current.delete(sessionId);
            }
            if (activeSessionRef.current === sessionId) {
                setIsLoading(false);
            }
        }
    }, [
        activeSessionId,
        activeTitlePlan,
        activeTitlePlanMessageId,
        editingMessageId,
        exitTitleMode,
        handleRefineTitlePlan,
        inputText,
        isLoading,
        isTitleModeActive,
        messages,
        selectedModel,
    ]);

    // ─── Inline Folder Creation ──────────────────────────────────────────────
    const handleCreateFolder = useCallback(() => {
        setIsCreatingFolder(true);
        setNewFolderName('');
    }, []);

    const confirmCreateFolder = useCallback(async () => {
        if (!newFolderName.trim()) {
            setIsCreatingFolder(false);
            return;
        }
        try {
            const folder = await chatApi.createFolder(newFolderName.trim());
            setFolders((prev) => [...prev, folder]);
            setExpandedFolders((prev) => new Set([...prev, folder.id]));
        } catch (err) {
            console.error(err);
        }
        setIsCreatingFolder(false);
        setNewFolderName('');
    }, [newFolderName]);

    const handleDeleteSession = useCallback(
        async (sessionId: string) => {
            try {
                if (activeRequestControllersRef.current.has(sessionId)) {
                    activeRequestControllersRef.current.get(sessionId)?.abort();
                    await chatApi.cancelResponse(sessionId);
                }
                await chatApi.deleteSession(sessionId);
                setSessions((prev) => prev.filter((s) => s.id !== sessionId));
                if (activeSessionId === sessionId) {
                    setActiveSessionId(null);
                    activeSessionRef.current = null;
                    setIsLoading(false);
                    setMessages([]);
                    exitTitleMode();
                }
            } catch (err) {
                console.error(err);
            }
        },
        [activeSessionId, exitTitleMode]
    );

    const handleDeleteFolder = useCallback(async (folderId: string) => {
        try {
            await chatApi.deleteFolder(folderId);
            setFolders((prev) => prev.filter((f) => f.id !== folderId));
            setSessions((prev) => prev.map((s) => (s.folderId === folderId ? { ...s, folderId: null } : s)));
        } catch (err) {
            console.error(err);
        }
    }, []);

    const handleRename = useCallback(async (type: 'folder' | 'session', id: string, newName: string) => {
        try {
            if (type === 'folder') {
                const folder = await chatApi.renameFolder(id, newName);
                setFolders((prev) => prev.map((f) => (f.id === id ? folder : f)));
            } else {
                const session = await chatApi.renameSession(id, newName);
                setSessions((prev) => prev.map((s) => (s.id === id ? session : s)));
            }
        } catch (err) {
            console.error(err);
        }
        setEditingId(null);
    }, []);

    const selectSession = useCallback((session: ChatSession) => {
        exitTitleMode();
        setActiveSessionId(session.id);
        activeSessionRef.current = session.id;
        setIsLoading(false);
        setSelectedTier(tierFromStoredModel(session.model));
        setEditingMessageId(null);
        setInputText('');
        newChatFolderRef.current = null;
    }, [exitTitleMode]);

    const toggleFolderExpand = (id: string) => {
        setExpandedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Group sessions
    const unfiledSessions = sessions.filter((s) => !s.folderId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const getSessionsInFolder = (folderId: string) =>
        sessions.filter((s) => s.folderId === folderId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    // ─── Session Item Renderer ───────────────────────────────────────────────
    const renderSessionItem = (s: ChatSession, indent: boolean = false) => (
        <div
            key={s.id}
            draggable={!s.folderId} // Only unfiled sessions are draggable
            onDragStart={(e) => onDragStart(e, s.id)}
            onDragEnd={onDragEnd}
            onClick={() => selectSession(s)}
            className={cn(
                'flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer group text-xs truncate transition-colors',
                indent ? 'pl-7' : 'px-2',
                s.id === activeSessionId
                    ? 'bg-brand-accent/10 text-brand-accent font-medium border-r-2 border-brand-accent shadow-[inset_0_0_15px_rgba(0,230,118,0.05)]'
                    : 'text-brand-muted hover:bg-black/5 dark:bg-white/5 hover:text-foreground',
                draggingSessionId === s.id && 'opacity-40'
            )}
        >
            {!s.folderId && (
                <GripVertical className="w-3 h-3 text-slate-600 cursor-grab shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
            <AgentGlyph id={s.agentId || ACTIVE_CHAT_AGENT_ID} className="w-3 h-3 shrink-0" />
            {editingId === s.id ? (
                <input
                    autoFocus
                    className="flex-1 bg-transparent border-b border-indigo-500 text-foreground outline-none text-xs"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={() => handleRename('session', s.id, editingText)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRename('session', s.id, editingText)}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                <span className="truncate flex-1">{s.title}</span>
            )}
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(s.id);
                        setEditingText(s.title);
                    }}
                    className="p-0.5 rounded hover:bg-black/10 dark:bg-white/10 text-slate-500 hover:text-foreground"
                >
                    <Edit3 className="w-2.5 h-2.5" />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(s.id);
                    }}
                    className="p-0.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400"
                >
                    <Trash2 className="w-2.5 h-2.5" />
                </button>
            </div>
        </div>
    );

    // ─── Render: Floating Button ─────────────────────────────────────────────
    if (!isOpen) {
        return (
            <div
                onMouseDown={onBtnMouseDown}
                onClick={onBtnClick}
                className={cn(
                    'fixed z-9999 w-14 h-14 rounded-full bg-linear-to-br from-brand-lime to-brand-accent shadow-[0_0_20px_rgba(0,230,118,0.3)] flex items-center justify-center cursor-grab active:cursor-grabbing hover:shadow-[0_0_30px_rgba(0,230,118,0.5)] hover:scale-105 select-none border border-black/20 dark:border-white/20',
                    !isBtnDraggingState && 'transition-all duration-300'
                )}
                style={{ left: btnPos.x, top: btnPos.y }}
                title="Narrador Mileto"
            >
                <MessageSquare className="w-6 h-6 text-[#0a0f12]" />
            </div>
        );
    }

    // ─── Render: Chat Window ─────────────────────────────────────────────────
    const windowStyle: React.CSSProperties = isFullscreen
        ? { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, borderRadius: 0 }
        : { position: 'fixed', top: 0, right: 0, width: '50vw', height: '100vh', zIndex: 9999 };
    const lastEditableUserMessageId = [...messages]
        .reverse()
        .find((message) => message.role === 'user' && message.interactionMode !== 'title_refinement')
        ?.id;

    return (
        <div
            style={windowStyle}
            className="flex flex-col bg-brand-dark border-l border-black/10 dark:border-white/10 shadow-[-10px_0_30px_rgba(0,0,0,0.8)] overflow-hidden font-sans"
        >
            {/* ─── Header ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 py-3 bg-brand-card/80 backdrop-blur-md border-b border-black/10 dark:border-white/10 shrink-0">
                <div className="flex items-center gap-2.5">
                    <AgentGlyph id={ACTIVE_CHAT_AGENT_ID} className="w-5 h-5 text-brand-accent" />
                    <div>
                        <span className="block text-sm font-bold text-foreground tracking-widest uppercase">Narrador</span>
                        <span className="block text-[9px] uppercase tracking-[.18em] text-brand-muted">Mileto IA</span>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="p-1.5 rounded hover:bg-black/10 dark:bg-white/10 text-slate-400 hover:text-foreground transition-colors"
                        title={isFullscreen ? 'Restaurar' : 'Tela Cheia'}
                    >
                        {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={() => {
                            setIsOpen(false);
                            setIsFullscreen(false);
                        }}
                        className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                        title="Fechar"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* ─── Body ───────────────────────────────────────────────────── */}
            <div className="flex flex-1 overflow-hidden">
                {/* ─── Sidebar ─────────────────────────────────────────────── */}
                {isSidebarOpen && (
                    <div className="w-56 shrink-0 bg-brand-card border-r border-black/5 dark:border-white/5 flex flex-col overflow-hidden">
                        {/* Sidebar Header */}
                        <div className="flex items-center justify-between px-2 py-2 border-b border-black/5 dark:border-white/5">
                            <button
                                onClick={() => handleNewChat(null)}
                                className="flex items-center gap-1.5 text-xs text-brand-accent hover:text-foreground font-medium px-2 py-1 rounded hover:bg-black/5 dark:bg-white/5 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" /> Novo Chat
                            </button>
                            <button
                                onClick={handleCreateFolder}
                                className="p-1 rounded hover:bg-black/5 dark:bg-white/5 text-brand-muted hover:text-brand-lime transition-colors"
                                title="Nova Pasta"
                            >
                                <FolderPlus className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {/* Sessions List */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
                            {/* Inline New Folder Input */}
                            {isCreatingFolder && (
                                <div className="flex items-center gap-1 px-2 py-1.5 bg-brand-dark/50 border-y border-black/5 dark:border-white/5">
                                    <FolderOpen className="w-3.5 h-3.5 text-brand-lime/80 shrink-0" />
                                    <input
                                        autoFocus
                                        placeholder="Nome da pasta..."
                                        className="flex-1 text-xs bg-transparent border-b border-brand-accent/50 text-foreground outline-none px-1 py-0.5"
                                        value={newFolderName}
                                        onChange={(e) => setNewFolderName(e.target.value)}
                                        onBlur={confirmCreateFolder}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') confirmCreateFolder();
                                            if (e.key === 'Escape') {
                                                setIsCreatingFolder(false);
                                                setNewFolderName('');
                                            }
                                        }}
                                    />
                                </div>
                            )}

                            {/* Folders */}
                            {folders.map((folder) => {
                                const folderSessions = getSessionsInFolder(folder.id);
                                const isExpanded = expandedFolders.has(folder.id);
                                const isDropTarget = dropTargetFolderId === folder.id;
                                return (
                                    <div
                                        key={folder.id}
                                        className="mb-0.5"
                                        onDragOver={(e) => onDragOver(e, folder.id)}
                                        onDragLeave={onDragLeave}
                                        onDrop={(e) => onDrop(e, folder.id)}
                                    >
                                        <div
                                            className={cn(
                                                'flex items-center gap-1 px-2 py-1.5 cursor-pointer group transition-colors',
                                                isDropTarget
                                                    ? 'bg-brand-accent/5 border border-dashed border-brand-accent/30 rounded'
                                                    : 'hover:bg-black/5 dark:bg-white/5'
                                            )}
                                            onClick={() => toggleFolderExpand(folder.id)}
                                        >
                                            {isExpanded ? (
                                                <ChevronDown className="w-3 h-3 text-brand-muted" />
                                            ) : (
                                                <ChevronRight className="w-3 h-3 text-brand-muted" />
                                            )}
                                            <FolderOpen className="w-3.5 h-3.5 text-brand-lime/80" />
                                            {editingId === folder.id ? (
                                                <input
                                                    autoFocus
                                                    className="flex-1 text-xs bg-transparent border-b border-brand-accent text-foreground outline-none px-1"
                                                    value={editingText}
                                                    onChange={(e) => setEditingText(e.target.value)}
                                                    onBlur={() => handleRename('folder', folder.id, editingText)}
                                                    onKeyDown={(e) =>
                                                        e.key === 'Enter' &&
                                                        handleRename('folder', folder.id, editingText)
                                                    }
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <span className="text-xs text-foreground/80 truncate flex-1">
                                                    {folder.name}
                                                </span>
                                            )}
                                            <span className="text-[10px] text-brand-muted mr-1">
                                                {folderSessions.length}
                                            </span>
                                            <div className="hidden group-hover:flex items-center gap-0.5">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingId(folder.id);
                                                        setEditingText(folder.name);
                                                    }}
                                                    className="p-0.5 rounded hover:bg-black/10 dark:bg-white/10 text-slate-500 hover:text-foreground"
                                                >
                                                    <Edit3 className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteFolder(folder.id);
                                                    }}
                                                    className="p-0.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Expanded Folder Content */}
                                        {isExpanded && (
                                            <div className="border-l border-black/5 dark:border-white/5 ml-3">
                                                {/* New Chat inside folder */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleNewChat(folder.id);
                                                    }}
                                                    className="flex items-center gap-1.5 pl-4 pr-2 py-1 text-[11px] text-brand-accent/70 hover:text-brand-accent hover:bg-black/5 dark:bg-white/5 w-full transition-colors"
                                                >
                                                    <Plus className="w-3 h-3" /> Nova conversa
                                                </button>
                                                {folderSessions.map((s) => renderSessionItem(s, true))}
                                                {folderSessions.length === 0 && (
                                                    <p className="pl-4 py-1.5 text-[10px] text-brand-muted italic">
                                                        Arraste conversas aqui
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Unfiled Sessions */}
                            {unfiledSessions.length > 0 && (
                                <div
                                    className={cn(
                                        'mt-1 pt-1',
                                        folders.length > 0 && 'border-t border-black/5 dark:border-white/5'
                                    )}
                                >
                                    <p className="px-2 pb-1 text-[10px] text-brand-muted uppercase tracking-widest pl-3">
                                        Conversas soltas
                                    </p>
                                    {unfiledSessions.map((s) => renderSessionItem(s, false))}
                                </div>
                            )}

                            {folders.length === 0 && sessions.length === 0 && !isCreatingFolder && (
                                <div className="flex flex-col items-center justify-center h-full py-8 gap-2">
                                    <Bot className="w-8 h-8 text-foreground/10" />
                                    <p className="text-xs text-brand-muted text-center px-4 font-medium">
                                        Nenhuma conversa ainda. Clique em "Novo Chat" para começar!
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Biblioteca local de roteiros */}
                        <div className="shrink-0 border-t border-black/5 dark:border-white/5">
                            <div className="flex items-center gap-1 px-2 py-2">
                                <button
                                    type="button"
                                    onClick={() => setIsScriptLibraryOpen((open) => !open)}
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-foreground/80 transition hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                                    aria-expanded={isScriptLibraryOpen}
                                >
                                    {isScriptLibraryOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                    <FolderOpen className="h-4 w-4 text-brand-lime" />
                                    <span className="min-w-0 flex-1 truncate">Roteiros salvos</span>
                                    <span className="rounded-full bg-brand-lime/10 px-1.5 py-0.5 font-mono text-[9px] text-brand-lime">
                                        {savedScripts.length}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsScriptLibraryOpen(true);
                                        setIsCreatingScript((creating) => !creating);
                                    }}
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-brand-lime/20 bg-brand-lime/8 text-brand-lime transition hover:bg-brand-lime/15"
                                    title="Colar e salvar roteiro"
                                    aria-label="Colar e salvar roteiro"
                                >
                                    <Plus className="h-4 w-4" />
                                </button>
                            </div>

                            {isScriptLibraryOpen && (
                                <div className="max-h-72 space-y-1.5 overflow-y-auto px-2 pb-2 custom-scrollbar">
                                    {isCreatingScript && (
                                        <div className="space-y-2 rounded-xl border border-brand-lime/20 bg-brand-dark/70 p-2.5">
                                            <input
                                                value={newScriptTitle}
                                                onChange={(event) => setNewScriptTitle(event.target.value)}
                                                placeholder="Nome do roteiro"
                                                className="w-full rounded-lg border border-white/8 bg-black/20 px-2.5 py-2 text-xs text-foreground outline-none transition placeholder:text-brand-muted focus:border-brand-lime/40"
                                            />
                                            <textarea
                                                value={newScriptContent}
                                                onChange={(event) => setNewScriptContent(event.target.value)}
                                                placeholder="Cole o roteiro aqui..."
                                                rows={5}
                                                className="w-full resize-none rounded-lg border border-white/8 bg-black/20 px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none transition placeholder:text-brand-muted focus:border-brand-lime/40"
                                            />
                                            <div className="flex justify-end gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setIsCreatingScript(false);
                                                        setNewScriptTitle('');
                                                        setNewScriptContent('');
                                                    }}
                                                    className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-muted transition hover:bg-white/5 hover:text-foreground"
                                                >
                                                    Cancelar
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleSaveScript}
                                                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-lime px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-brand-dark transition hover:brightness-110"
                                                >
                                                    <Save className="h-3.5 w-3.5" /> Salvar
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {savedScripts.map((script) => (
                                        <div
                                            key={script.id}
                                            className="group flex items-center gap-1 rounded-xl border border-white/6 bg-black/10 p-1.5 transition hover:border-brand-lime/20 hover:bg-brand-lime/[0.04]"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => handleUseSavedScript(script)}
                                                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1.5 text-left"
                                                title="Colocar este roteiro na mensagem"
                                            >
                                                <FileText className="h-4 w-4 shrink-0 text-brand-accent" />
                                                <span className="min-w-0">
                                                    <span className="block truncate text-[11px] font-bold text-foreground/90">{script.title}</span>
                                                    <span className="block truncate text-[9px] text-brand-muted">{script.content}</span>
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSavedScripts((current) => current.filter((item) => item.id !== script.id))}
                                                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-brand-muted opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                                                title="Excluir roteiro salvo"
                                                aria-label={`Excluir ${script.title}`}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}

                                    {!isCreatingScript && savedScripts.length === 0 && (
                                        <p className="px-3 py-3 text-center text-[10px] leading-relaxed text-brand-muted">
                                            Cole aqui os roteiros que deseja reutilizar depois.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Sidebar Toggle */}
                        <button
                            onClick={() => setIsSidebarOpen(false)}
                            className="flex items-center justify-center gap-1.5 border-t border-black/5 py-2.5 text-xs font-medium tracking-wide text-brand-muted transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/5 dark:hover:bg-white/5"
                        >
                            <PanelLeftClose className="h-3.5 w-3.5" /> Recolher
                        </button>
                    </div>
                )}

                {/* ─── Main Chat Area ──────────────────────────────────────── */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    {!isSidebarOpen && (
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="absolute top-2 left-1 z-10 p-1 bg-indigo-900/50 rounded text-slate-400 hover:text-foreground hover:bg-indigo-800/80 transition-colors"
                            title="Abrir barra lateral"
                        >
                            <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    )}

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar relative">
                        {messages.length === 0 && !isLoading && (
                            <div className="flex flex-col items-center justify-center h-full gap-3 select-none">
                                <div className="w-16 h-16 rounded-full bg-linear-to-br from-brand-lime/10 to-brand-accent/10 border border-brand-accent/20 flex items-center justify-center shadow-[0_0_30px_rgba(0,230,118,0.05)]">
                                    <MessageSquare className="w-8 h-8 text-brand-accent" />
                                </div>
                                <h3 className="text-lg font-bold text-foreground tracking-widest uppercase">
                                    Narrador
                                </h3>
                                <p className="text-xs text-brand-muted text-center max-w-[250px] leading-relaxed">
                                    Converse livremente. Como posso ajudar?
                                </p>
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={cn('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                            >
                                {msg.role === 'assistant' && (
                                    <div className="w-8 h-8 rounded-full bg-linear-to-br from-brand-lime to-brand-accent flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_10px_rgba(0,230,118,0.2)]">
                                        <AgentGlyph id={msg.agentId || ACTIVE_CHAT_AGENT_ID} className="w-4 h-4 text-[#0a0f12]" />
                                    </div>
                                )}
                                <div
                                    className={cn(
                                        'text-[13px] leading-relaxed flex flex-col',
                                        msg.role === 'user'
                                            ? 'max-w-[80%] px-4 py-3 bg-brand-accent/10 text-foreground border border-brand-accent/30 rounded-2xl rounded-br-sm shadow-[0_4px_20px_rgba(0,230,118,0.05)]'
                                            : hasFinalScript(msg.content)
                                                ? 'w-full max-w-[88%] text-foreground/90'
                                                : 'max-w-[80%] px-4 py-3 bg-brand-card/50 text-foreground/90 border border-black/5 dark:border-white/5 rounded-2xl rounded-bl-sm shadow-xl'
                                    )}
                                >
                                    {msg.role === 'assistant' && (
                                        <div className={cn(
                                            'mb-2 text-[9px] font-bold uppercase tracking-[.16em] text-brand-muted',
                                            hasFinalScript(msg.content) && 'px-1'
                                        )}>
                                            {msg.agentLabel || historicalAgentLabel(msg.agentId)}
                                        </div>
                                    )}
                                    {msg.role === 'user' && msg.interactionMode === 'title_refinement' && (
                                        <div className="mb-1.5 text-[8px] font-bold uppercase tracking-[.14em] text-brand-accent/80">
                                            Ajuste de títulos
                                        </div>
                                    )}
                                    {msg.role === 'assistant'
                                        ? (
                                            <StructuredAgentResponse
                                                content={msg.content}
                                                onApply={() => handleUseAsScript(msg)}
                                                onApplyAndCreateTitles={() => handleApplyAndCreateTitles(msg)}
                                                actionsDisabled={isLoading}
                                                titlePlanningNode={titlePlans[msg.id]?.proposal ? (
                                                    <ChatTitleProposal
                                                        proposal={titlePlans[msg.id].proposal!}
                                                        busy={titlePlans[msg.id].busy}
                                                        error={titlePlans[msg.id].error}
                                                        active={isTitleModeActive && activeTitlePlanMessageId === msg.id}
                                                        lastInstruction={titlePlans[msg.id].lastInstruction}
                                                        onActivate={() => {
                                                            if (
                                                                titlePlanningNarrationKey(adData.narrationPlainText)
                                                                !== titlePlans[msg.id].narrationKey
                                                            ) {
                                                                toast.warning('A narração mudou. Gere uma nova proposta de títulos.');
                                                                return;
                                                            }
                                                            exitTitleMode();
                                                            setEditingMessageId(null);
                                                            setActiveTitlePlanMessageId(msg.id);
                                                            setTierMenuOpen(false);
                                                            textareaRef.current?.focus();
                                                        }}
                                                        onToggle={(id) => updateTitlePlan(msg.id, (proposal) => ({
                                                            ...proposal,
                                                            suggestions: proposal.suggestions.map((item) =>
                                                                item.id === id ? { ...item, selected: !item.selected } : item
                                                            ),
                                                        }))}
                                                        onEdit={(id, text) => updateTitlePlan(msg.id, (proposal) => ({
                                                            ...proposal,
                                                            suggestions: proposal.suggestions.map((item) =>
                                                                item.id === id ? { ...item, text: text.slice(0, 90) } : item
                                                            ),
                                                        }))}
                                                        onApply={() => handleApplyTitlePlan(msg)}
                                                    />
                                                ) : titlePlans[msg.id]?.busy ? (
                                                    <div className="mt-3 rounded-xl border border-brand-accent/15 bg-brand-accent/[.035] px-3 py-2 text-[10px] text-brand-muted">
                                                        Planejamento em andamento no campo principal do chat.
                                                    </div>
                                                ) : titlePlans[msg.id]?.error ? (
                                                    <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[.04] px-3 py-3 text-[11px] text-red-400">
                                                        {titlePlans[msg.id].error}
                                                    </div>
                                                ) : undefined}
                                            />
                                        )
                                        : <div className="whitespace-pre-wrap">{msg.content}</div>}

                                    {msg.role === 'user'
                                        && msg.interactionMode !== 'title_refinement'
                                        && msg.id === lastEditableUserMessageId
                                        && !isLoading && (
                                        <div className="mt-2 flex justify-end border-t border-brand-accent/10 pt-2">
                                            <button
                                                type="button"
                                                onClick={() => handleEditLastMessage(msg)}
                                                className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-brand-muted transition-colors hover:text-brand-accent"
                                                title="Editar esta mensagem e refazer a resposta"
                                            >
                                                <Edit3 className="h-3 w-3" /> Editar e refazer
                                            </button>
                                        </div>
                                    )}

                                </div>
                                {msg.role === 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                                        <User className="w-4 h-4 text-foreground/70" />
                                    </div>
                                )}
                            </div>
                        ))}

                        {isLoading && (
                            <div className="flex gap-2.5 justify-start">
                                <div className="w-8 h-8 rounded-full bg-linear-to-br from-brand-lime to-brand-accent flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(0,230,118,0.2)]">
                                    <AgentGlyph id={ACTIVE_CHAT_AGENT_ID} className="w-4 h-4 text-[#0a0f12]" />
                                </div>
                                <div className="bg-brand-card/50 border border-black/5 dark:border-white/5 rounded-2xl rounded-bl-sm px-4 py-3 shadow-xl">
                                    <div className="flex gap-1.5">
                                        <div
                                            className="w-1.5 h-1.5 bg-brand-accent rounded-full animate-bounce"
                                            style={{ animationDelay: '0ms' }}
                                        />
                                        <div
                                            className="w-1.5 h-1.5 bg-brand-lime rounded-full animate-bounce"
                                            style={{ animationDelay: '150ms' }}
                                        />
                                        <div
                                            className="w-1.5 h-1.5 bg-brand-accent rounded-full animate-bounce"
                                            style={{ animationDelay: '300ms' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="bg-brand-card/80 backdrop-blur-xl border-t border-black/5 dark:border-white/5 p-4 z-10 shrink-0">
                        {isTitleModeActive && activeTitlePlan && (
                            activeTitlePlan.busy ? (
                                <div className="mb-2.5 space-y-2">
                                    <TitlePlanningProgress
                                        phase={activeTitlePlan.phase === 'generating' ? 'generating' : 'refining'}
                                    />
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => exitTitleMode(true)}
                                            className="rounded-lg border border-black/10 px-2.5 py-1.5 text-[9px] font-bold text-brand-muted transition hover:border-red-400/30 hover:text-red-300 dark:border-white/10"
                                        >
                                            Cancelar ajuste
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mb-2.5 flex items-center justify-between gap-3 rounded-xl border border-brand-accent/20 bg-brand-accent/[.05] px-3 py-2.5">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-brand-accent">
                                            <Target className="h-3.5 w-3.5 shrink-0" /> Ajustando títulos
                                        </div>
                                        <p className="mt-0.5 truncate text-[9px] text-brand-muted">
                                            Escreva normalmente. Um pedido de nova narração muda o contexto automaticamente.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => exitTitleMode(true)}
                                        className="shrink-0 rounded-lg border border-black/10 px-2.5 py-1.5 text-[9px] font-bold text-brand-muted transition hover:border-brand-accent/30 hover:text-foreground dark:border-white/10"
                                    >
                                        Encerrar
                                    </button>
                                </div>
                            )
                        )}
                        {editingMessageId && !isLoading && (
                            <div className="mb-2.5 flex items-center justify-between gap-3 rounded-xl border border-brand-accent/25 bg-brand-accent/[.06] px-3 py-2">
                                <div className="flex min-w-0 items-center gap-2 text-[10px] font-bold text-brand-accent">
                                    <Edit3 className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">Editando sua última mensagem — a resposta seguinte será refeita.</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingMessageId(null);
                                        setInputText('');
                                    }}
                                    className="shrink-0 text-[9px] font-black uppercase tracking-wider text-brand-muted hover:text-foreground"
                                >
                                    Cancelar
                                </button>
                            </div>
                        )}
                        <div className="flex items-end gap-2.5">
                            <textarea
                                ref={textareaRef}
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey && !isLoading && !activeTitlePlan?.busy) {
                                        e.preventDefault();
                                        handleSendWithFolder();
                                    }
                                }}
                                placeholder={isTitleModeActive
                                    ? 'Diga como quer ajustar os títulos…'
                                    : 'Digite sua mensagem para a IA…'}
                                disabled={isTitleModeActive && activeTitlePlan?.busy}
                                rows={1}
                                className="flex-1 bg-brand-dark/50 border border-black/10 dark:border-white/10 rounded-xl px-4 py-3 text-[13px] text-foreground placeholder-brand-muted outline-none focus:border-brand-accent/50 focus:bg-brand-dark shadow-inner resize-none custom-scrollbar transition-all"
                            />
                            <button
                                onClick={isLoading ? stopActiveResponse : handleSendWithFolder}
                                disabled={!isLoading && (!inputText.trim() || Boolean(isTitleModeActive && activeTitlePlan?.busy))}
                                className={cn(
                                    'p-3 rounded-xl transition-all duration-300 shrink-0 border',
                                    isLoading
                                        ? 'border-red-400/40 bg-red-500/15 text-red-300 shadow-[0_0_15px_rgba(248,113,113,0.15)] hover:bg-red-500/25'
                                        : inputText.trim() && !(isTitleModeActive && activeTitlePlan?.busy)
                                        ? 'bg-brand-accent hover:bg-brand-accent/80 hover:scale-105 border-brand-accent text-[#0a0f12] shadow-[0_0_15px_rgba(0,230,118,0.4)]'
                                        : 'bg-black/5 dark:bg-white/5 border-transparent text-brand-muted cursor-not-allowed'
                                )}
                                title={isLoading
                                    ? 'Parar resposta'
                                    : isTitleModeActive
                                    ? 'Enviar ajuste de títulos'
                                    : editingMessageId
                                    ? 'Salvar edição e refazer resposta'
                                    : 'Enviar mensagem'}
                            >
                                {isLoading ? (
                                    <Square className="h-4 w-4 fill-current" />
                                ) : (
                                    <Send className="w-5 h-5 ml-0.5" />
                                )}
                            </button>
                        </div>

                        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            {!isTitleModeActive ? (
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setTierMenuOpen((open) => !open)}
                                    className="flex items-center gap-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-brand-dark/60 px-2.5 py-1.5 text-[10px] font-bold text-foreground hover:border-brand-accent/40 transition-colors"
                                    title="Escolher o nível do Narrador"
                                >
                                    {MILETO_TIERS.find((tier) => tier.id === selectedTier)?.label}
                                    <ChevronDown className={cn('w-3 h-3 text-brand-accent transition-transform', tierMenuOpen && 'rotate-180')} />
                                </button>
                                {tierMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setTierMenuOpen(false)} />
                                        <div className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-brand-card shadow-2xl">
                                            {MILETO_TIERS.map((tier) => (
                                                <button
                                                    type="button"
                                                    key={tier.id}
                                                    onClick={() => {
                                                        setSelectedTier(tier.id);
                                                        setTierMenuOpen(false);
                                                    }}
                                                    className={cn(
                                                        'w-full border-l-2 px-3 py-2.5 text-left transition-colors',
                                                        selectedTier === tier.id
                                                            ? 'border-brand-accent bg-brand-accent/10'
                                                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                                                    )}
                                                >
                                                    <span className={cn('flex items-center gap-1.5 text-xs font-bold', selectedTier === tier.id ? 'text-brand-accent' : 'text-foreground')}>
                                                        {tier.label}
                                                        {selectedTier === tier.id && <Check className="w-3 h-3" />}
                                                    </span>
                                                    <span className="mt-0.5 block text-[10px] text-brand-muted">{tier.description}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-accent/20 bg-brand-accent/[.04] px-2.5 py-1.5 text-[9px] font-bold text-brand-accent">
                                    <Target className="h-3 w-3" /> Modo títulos
                                </span>
                            )}
                            <span className="text-[10px] text-brand-muted uppercase tracking-widest font-semibold ml-auto">
                                Enter ↵
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
