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
    Loader2,
    Bot,
    User,
    FolderOpen,
    GripVertical,
    Copy,
    Check,
    Wand2,
    Target,
    Image as ImageIcon,
    Video,
    Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import * as chatApi from '../../lib/chatApi';
import { useWizard } from '../../context/WizardContext';
import { ChatAgentId, ChatFolder, ChatSession, ChatMessage } from '../../types';
import { useDownloadJobs } from '../../context/DownloadJobsContext';

type StructuredAgentResult = Record<string, unknown>;

const parseStructuredResult = (content: string): StructuredAgentResult | null => {
    const trimmed = (content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!trimmed.startsWith('{')) return null;
    try {
        const value = JSON.parse(trimmed);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
};

/**
 * A resposta contém um ROTEIRO FINAL marcado pela IA (entre ===ROTEIRO=== e ===FIM===)?
 * É o que decide se os botões Copiar/Usar aparecem — perguntas, exemplos e explicações
 * NÃO têm o marcador, então não mostram botão.
 */
const hasFinalScript = (content: string): boolean => {
    if (/===\s*ROTEIRO\s*===[\s\S]*?===\s*FIM\s*===/i.test(content || '')) return true;
    return typeof parseStructuredResult(content)?.narration === 'string';
};

/** Remove as linhas marcadoras do texto exibido — o usuário vê o roteiro limpo. */
const stripMarkers = (content: string): string =>
    (content || '')
        .replace(/^[ \t]*===\s*T[ÍI]TULO\s*===[ \t]*$/gim, 'Título do projeto:')
        .replace(/^[ \t]*===\s*(?:ROTEIRO|FIM)\s*===[ \t]*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

/**
 * Extrai SÓ o(s) roteiro(s) marcado(s) (o que a IA quer que seja usado). Fallback
 * heurístico (introdução/aviso/"---") para mensagens antigas sem marcador.
 */
const extractScript = (content: string): string => {
    const structuredNarration = parseStructuredResult(content)?.narration;
    if (typeof structuredNarration === 'string' && structuredNarration.trim()) return structuredNarration.trim();
    const marked = [...(content || '').matchAll(/===\s*ROTEIRO\s*===\s*([\s\S]*?)\s*===\s*FIM\s*===/gi)]
        .map((m) => m[1].trim())
        .filter(Boolean);
    if (marked.length) return marked.join('\n\n');

    // Fallback (sem marcador): corta introdução e aviso.
    let text = (content || '').trim();
    text = text.replace(/\n\s*(?:[*_>#\s]|⚠️)*(?:aviso|obs\.?|observa[çc]|nota|importante)\b[\s\S]*$/i, '').trim();
    const blocks = text
        .split(/^\s*---\s*$/m)
        .map((s) => s.trim())
        .filter(Boolean);
    if (blocks.length >= 2) {
        const tagged = blocks.find((b) => /\[[a-zA-Z]/.test(b));
        return (tagged || blocks[0]).replace(/^\s*---\s*$/gm, '').trim();
    }
    const lines = text.split('\n');
    const firstTag = lines.findIndex((l) => /^\s*\[[a-zA-Z]/.test(l));
    if (firstTag > 0) return lines.slice(firstTag).join('\n').trim();
    if (/:\s*$/.test(lines[0] || '')) return lines.slice(1).join('\n').trim();
    return text;
};

/** Extrai o título estruturado pela IA e cria um fallback para respostas antigas. */
const extractProjectTitle = (content: string): string => {
    const structuredTitle = parseStructuredResult(content)?.title;
    if (typeof structuredTitle === 'string' && structuredTitle.trim()) return structuredTitle.trim().slice(0, 60);
    const markedTitle = (content || '').match(
        /===\s*T[ÍI]TULO\s*===\s*([\s\S]*?)\s*===\s*ROTEIRO\s*===/i
    )?.[1];
    const cleanMarkedTitle = markedTitle?.replace(/\s+/g, ' ').trim();
    if (cleanMarkedTitle) return cleanMarkedTitle.slice(0, 60);

    const cleanScript = extractScript(content)
        .replace(/\[[^\]]+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleanScript) return 'Novo projeto Mileto';

    const firstSentence = cleanScript.split(/[.!?]/, 1)[0].trim();
    const words = (firstSentence || cleanScript).split(' ').slice(0, 8).join(' ');
    return words.slice(0, 60).trim() || 'Novo projeto Mileto';
};

type MiletoTier = 'lite' | 'mileto' | 'ultra';
const MILETO_TIERS: { id: MiletoTier; label: string; model: string; description: string }[] = [
    { id: 'lite', label: 'Mileto Lite', model: 'mileto-lite', description: 'Mais rápido e econômico' },
    { id: 'mileto', label: 'Mileto', model: 'mileto-plus', description: 'Equilíbrio recomendado' },
    { id: 'ultra', label: 'Mileto Ultra', model: 'mileto-ultra', description: 'Máxima profundidade' },
];

const CHAT_AGENTS: Array<{
    id: ChatAgentId;
    label: string;
    shortLabel: string;
    description: string;
    accent: string;
}> = [
    {
        id: 'director',
        label: 'Mileto Diretor',
        shortLabel: 'Diretor',
        description: 'Coordena a ideia, o roteiro e os especialistas.',
        accent: 'emerald',
    },
    {
        id: 'prompt_sales',
        label: 'Narração e Vendas',
        shortLabel: 'Narração e Vendas',
        description: 'Briefing guiado e narração comercial pronta para locução.',
        accent: 'amber',
    },
    {
        id: 'image_director',
        label: 'Diretor de Imagens',
        shortLabel: 'Imagens',
        description: 'Direção de arte e especificações visuais consistentes.',
        accent: 'violet',
    },
    {
        id: 'video_director',
        label: 'Diretor de Vídeos',
        shortLabel: 'Vídeos',
        description: 'Takes, movimentos, continuidade e storyboard.',
        accent: 'cyan',
    },
];

const agentById = (id?: ChatAgentId) => CHAT_AGENTS.find((agent) => agent.id === id) || CHAT_AGENTS[0];

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

const StructuredAgentResponse = ({ content }: { content: string }) => {
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
    const [isLoading, setIsLoading] = useState(false);
    // O renderer conhece somente o nível público. Cérebro, modelo, raciocínio e
    // prompt são resolvidos pelo gateway dentro da versão ativa de cada agente.
    const [selectedTier, setSelectedTier] = useState<MiletoTier>('mileto');
    const [tierMenuOpen, setTierMenuOpen] = useState(false);
    const [selectedAgentId, setSelectedAgentId] = useState<ChatAgentId>('director');
    const [agentMenuOpen, setAgentMenuOpen] = useState(false);
    const selectedModel = MILETO_TIERS.find((tier) => tier.id === selectedTier)?.model || 'mileto-plus';
    const selectedAgent = agentById(selectedAgentId);

    const navigate = useNavigate();
    const { updateAdData } = useWizard();
    const { registerClientJob, updateClientJob } = useDownloadJobs();
    const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
    const [generatingMessageIds, setGeneratingMessageIds] = useState<Set<string>>(new Set());

    // Copia SÓ o roteiro (o bloco entre os "---" que a IA marca), não o texto de
    // explicação nem o "Aviso" — é o que o usuário quer levar pra narração.
    const handleCopyMessage = useCallback((msg: ChatMessage) => {
        navigator.clipboard.writeText(extractScript(msg.content)).then(() => {
            setCopiedMsgId(msg.id);
            setTimeout(() => setCopiedMsgId((cur) => (cur === msg.id ? null : cur)), 1500);
        });
    }, []);

    // Aplica o ROTEIRO da resposta direto na narração e leva o usuário pra lá.
    const handleUseAsScript = useCallback(
        (msg: ChatMessage) => {
            const script = extractScript(msg.content);
            const title = extractProjectTitle(msg.content);
            updateAdData({ title, narrationText: script, isNarrationGenerated: false });
            setIsOpen(false);
            navigate('/wizard/step/1');
            toast.success('Título e roteiro aplicados ao projeto! ✨');
        },
        [navigate, updateAdData]
    );

    const handleGenerateMedia = useCallback(async (msg: ChatMessage) => {
        const spec = parseStructuredResult(msg.content);
        const agentId = msg.agentId || selectedAgentId;
        const kind = agentId === 'video_director' ? 'video' : agentId === 'image_director' ? 'image' : null;
        if (!spec || !kind || generatingMessageIds.has(msg.id)) return;
        setGeneratingMessageIds((current) => new Set(current).add(msg.id));
        try {
            const title = typeof spec.title === 'string'
                ? spec.title
                : kind === 'image' ? 'Imagem por IA' : 'Vídeo por IA';
            const job = await chatApi.startAiGeneration({
                kind,
                tier: MILETO_TIERS.find((tier) => tier.id === msg.agentTier)?.model || selectedModel,
                spec,
                title,
                conversationId: msg.sessionId || activeSessionId || msg.id,
                conversationTitle: sessions.find((session) => session.id === msg.sessionId)?.title || title,
            });
            registerClientJob({
                id: job.id,
                mode: kind,
                title,
                destination: 'Geração por IA',
                source: 'ai-generation',
                statusText: job.statusText || 'Preparando geração',
            });
            toast.success('Geração iniciada. Você pode continuar usando o Mileto; acompanhe pelo sino.');

            void (async () => {
                try {
                    while (true) {
                        await new Promise((resolve) => window.setTimeout(resolve, 1500));
                        const next = await chatApi.getAiGeneration(job.id);
                        updateClientJob(job.id, {
                            phase: next.phase,
                            percent: next.percent,
                            stepPercent: next.stepPercent,
                            statusText: next.statusText,
                            completedAt: next.completedAt,
                            error: next.error,
                            track: next.track,
                        });
                        if (next.phase !== 'downloading') break;
                    }
                } catch (error) {
                    updateClientJob(job.id, {
                        phase: 'error',
                        completedAt: Date.now(),
                        error: error instanceof Error ? error.message : 'Não foi possível acompanhar a geração.',
                    });
                } finally {
                    setGeneratingMessageIds((current) => {
                        const next = new Set(current);
                        next.delete(msg.id);
                        return next;
                    });
                }
            })();
        } catch (error) {
            setGeneratingMessageIds((current) => {
                const next = new Set(current);
                next.delete(msg.id);
                return next;
            });
            toast.error(error instanceof Error ? error.message : 'Não foi possível iniciar a geração.');
        }
    }, [activeSessionId, generatingMessageIds, registerClientJob, selectedAgentId, selectedModel, sessions, updateClientJob]);
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

    // ─── Auto-scroll ─────────────────────────────────────────────────────────
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

    const handleNewChat = useCallback((folderId?: string | null) => {
        setActiveSessionId(null);
        setMessages([]);
        setInputText('');
        // If creating inside a folder, we'll store the target folder for the next auto-created session
        newChatFolderRef.current = folderId || null;
    }, []);

    const newChatFolderRef = useRef<string | null>(null);
    // Marca a sessão criada dentro do próprio envio, para o efeito de carregar
    // mensagens não sobrescrever a mensagem otimista com uma lista vazia.
    const justCreatedSessionRef = useRef<string | null>(null);

    const chooseAgent = useCallback((agentId: ChatAgentId) => {
        if (agentId !== selectedAgentId && activeSessionId) {
            setActiveSessionId(null);
            setMessages([]);
            setInputText('');
            newChatFolderRef.current = null;
        }
        setSelectedAgentId(agentId);
        setAgentMenuOpen(false);
    }, [activeSessionId, selectedAgentId]);

    // Override handleSend to use the folder ref for auto-create
    const handleSendWithFolder = useCallback(async () => {
        if (!inputText.trim() || isLoading) return;

        let sessionId = activeSessionId;

        if (!sessionId) {
            try {
                const targetFolder = newChatFolderRef.current;
                const session = await chatApi.createSession(
                    inputText.substring(0, 40) + (inputText.length > 40 ? '...' : ''),
                    targetFolder,
                    selectedModel,
                    selectedAgentId
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

        const userContent = inputText.trim();
        setInputText('');
        setIsLoading(true);

        const tempUserMsg: ChatMessage = {
            id: 'temp-user-' + Date.now(),
            sessionId: sessionId,
            role: 'user',
            content: userContent,
            createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, tempUserMsg]);

        try {
            const locale = navigator.language || 'pt-BR';
            const { userMessage, assistantMessage } = await chatApi.sendMessage(
                sessionId,
                userContent,
                selectedModel,
                'equilibrado',
                locale,
                selectedAgentId
            );
            setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id).concat([userMessage, assistantMessage]));
        } catch (err: unknown) {
            const axErr = err as { response?: { data?: { message?: string } }; message?: string };
            const errorMsg: ChatMessage = {
                id: 'error-' + Date.now(),
                sessionId: sessionId,
                role: 'assistant',
                content: `❌ Erro: ${axErr?.response?.data?.message || axErr?.message || 'Falha na comunicação com a IA.'}`,
                createdAt: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, errorMsg]);
        } finally {
            setIsLoading(false);
        }
    }, [inputText, isLoading, activeSessionId, selectedAgentId, selectedModel]);

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
                await chatApi.deleteSession(sessionId);
                setSessions((prev) => prev.filter((s) => s.id !== sessionId));
                if (activeSessionId === sessionId) {
                    setActiveSessionId(null);
                    setMessages([]);
                }
            } catch (err) {
                console.error(err);
            }
        },
        [activeSessionId]
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
        setActiveSessionId(session.id);
        setSelectedTier(tierFromStoredModel(session.model));
        setSelectedAgentId(session.agentId || 'director');
        newChatFolderRef.current = null;
    }, []);

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
            <AgentGlyph id={s.agentId || 'director'} className="w-3 h-3 shrink-0" />
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
                title="Mileto Diretor"
            >
                <MessageSquare className="w-6 h-6 text-[#0a0f12]" />
            </div>
        );
    }

    // ─── Render: Chat Window ─────────────────────────────────────────────────
    const windowStyle: React.CSSProperties = isFullscreen
        ? { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, borderRadius: 0 }
        : { position: 'fixed', top: 0, right: 0, width: '50vw', height: '100vh', zIndex: 9999 };

    return (
        <div
            style={windowStyle}
            className="flex flex-col bg-brand-dark border-l border-black/10 dark:border-white/10 shadow-[-10px_0_30px_rgba(0,0,0,0.8)] overflow-hidden font-sans"
        >
            {/* ─── Header ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 py-3 bg-brand-card/80 backdrop-blur-md border-b border-black/10 dark:border-white/10 shrink-0">
                <div className="flex items-center gap-2.5">
                    <AgentGlyph id={selectedAgentId} className="w-5 h-5 text-brand-accent" />
                    <div>
                        <span className="block text-sm font-bold text-foreground tracking-widest uppercase">{selectedAgent.label}</span>
                        <span className="block text-[9px] uppercase tracking-[.18em] text-brand-muted">Equipe Mileto IA</span>
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

                        {/* Sidebar Toggle */}
                        <button
                            onClick={() => setIsSidebarOpen(false)}
                            className="py-2.5 text-xs text-brand-muted hover:text-foreground border-t border-black/5 dark:border-white/5 hover:bg-black/5 dark:bg-white/5 transition-colors font-medium tracking-wide"
                        >
                            ◀ Recolher
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
                                    {selectedAgent.label}
                                </h3>
                                <p className="text-xs text-brand-muted text-center max-w-[250px] leading-relaxed">
                                    {selectedAgent.description}
                                </p>
                                <div className="grid w-full max-w-xl grid-cols-2 gap-2 px-4 pt-3">
                                    {CHAT_AGENTS.map((agent) => (
                                        <button
                                            key={agent.id}
                                            type="button"
                                            onClick={() => chooseAgent(agent.id)}
                                            className={cn(
                                                'rounded-xl border p-3 text-left transition-all',
                                                selectedAgentId === agent.id
                                                    ? 'border-brand-accent/50 bg-brand-accent/10 shadow-[0_0_20px_rgba(0,230,118,.08)]'
                                                    : 'border-black/10 dark:border-white/10 bg-brand-card/50 hover:border-brand-accent/30 hover:bg-brand-card'
                                            )}
                                        >
                                            <span className="flex items-center gap-2 text-[11px] font-bold text-foreground">
                                                <AgentGlyph id={agent.id} className="h-3.5 w-3.5 text-brand-accent" />
                                                {agent.shortLabel}
                                            </span>
                                            <span className="mt-1.5 block text-[9px] leading-relaxed text-brand-muted">{agent.description}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={cn('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                            >
                                {msg.role === 'assistant' && (
                                    <div className="w-8 h-8 rounded-full bg-linear-to-br from-brand-lime to-brand-accent flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_10px_rgba(0,230,118,0.2)]">
                                        <AgentGlyph id={msg.agentId || selectedAgentId} className="w-4 h-4 text-[#0a0f12]" />
                                    </div>
                                )}
                                <div
                                    className={cn(
                                        'max-w-[80%] px-4 py-3 text-[13px] leading-relaxed flex flex-col',
                                        msg.role === 'user'
                                            ? 'bg-brand-accent/10 text-foreground border border-brand-accent/30 rounded-2xl rounded-br-sm shadow-[0_4px_20px_rgba(0,230,118,0.05)]'
                                            : 'bg-brand-card/50 text-foreground/90 border border-black/5 dark:border-white/5 rounded-2xl rounded-bl-sm shadow-xl'
                                    )}
                                >
                                    {msg.role === 'assistant' && (
                                        <div className="mb-2 text-[9px] font-bold uppercase tracking-[.16em] text-brand-muted">
                                            {msg.agentLabel || agentById(msg.agentId || selectedAgentId).label}
                                        </div>
                                    )}
                                    {msg.role === 'assistant'
                                        ? <StructuredAgentResponse content={msg.content} />
                                        : <div className="whitespace-pre-wrap">{msg.content}</div>}

                                    {/* Copiar/Usar SÓ quando a resposta traz um roteiro final marcado */}
                                    {msg.role === 'assistant' && hasFinalScript(msg.content) && (
                                            <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-black/5 dark:border-white/5">
                                                <button
                                                    onClick={() => handleCopyMessage(msg)}
                                                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-muted hover:text-foreground transition-colors"
                                                    title="Copiar resposta"
                                                >
                                                    {copiedMsgId === msg.id ? (
                                                        <>
                                                            <Check className="w-3 h-3 text-brand-accent" /> Copiado
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Copy className="w-3 h-3" /> Copiar
                                                        </>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleUseAsScript(msg)}
                                                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-accent hover:text-brand-lime transition-colors"
                                                    title="Usar este título e roteiro no projeto"
                                                >
                                                    <Wand2 className="w-3 h-3" /> Usar no projeto
                                                </button>
                                            </div>
                                        )}
                                    {msg.role === 'assistant'
                                        && parseStructuredResult(msg.content)
                                        && ['image_director', 'video_director'].includes(msg.agentId || selectedAgentId)
                                        && (
                                            <div className="mt-3 flex items-center gap-2 border-t border-black/5 dark:border-white/5 pt-2.5">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleGenerateMedia(msg)}
                                                    disabled={generatingMessageIds.has(msg.id)}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-accent/30 bg-brand-accent/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-brand-accent transition hover:bg-brand-accent/15 disabled:cursor-wait disabled:opacity-60"
                                                >
                                                    {generatingMessageIds.has(msg.id)
                                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        : (msg.agentId || selectedAgentId) === 'video_director'
                                                            ? <Video className="h-3.5 w-3.5" />
                                                            : <ImageIcon className="h-3.5 w-3.5" />}
                                                    {generatingMessageIds.has(msg.id)
                                                        ? 'Iniciando...'
                                                        : (msg.agentId || selectedAgentId) === 'video_director'
                                                            ? 'Aprovar e gerar vídeo'
                                                            : 'Aprovar e gerar imagem'}
                                                </button>
                                                <span className="text-[9px] leading-relaxed text-brand-muted">
                                                    O resultado será salvo somente no seu computador.
                                                </span>
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
                                    <AgentGlyph id={selectedAgentId} className="w-4 h-4 text-[#0a0f12]" />
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
                        <div className="flex items-end gap-2.5">
                            <textarea
                                ref={textareaRef}
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendWithFolder();
                                    }
                                }}
                                placeholder="Digite sua mensagem para a IA..."
                                rows={1}
                                className="flex-1 bg-brand-dark/50 border border-black/10 dark:border-white/10 rounded-xl px-4 py-3 text-[13px] text-foreground placeholder-brand-muted outline-none focus:border-brand-accent/50 focus:bg-brand-dark shadow-inner resize-none custom-scrollbar transition-all"
                            />
                            <button
                                onClick={handleSendWithFolder}
                                disabled={!inputText.trim() || isLoading}
                                className={cn(
                                    'p-3 rounded-xl transition-all duration-300 shrink-0 border',
                                    inputText.trim() && !isLoading
                                        ? 'bg-brand-accent hover:bg-brand-accent/80 hover:scale-105 border-brand-accent text-[#0a0f12] shadow-[0_0_15px_rgba(0,230,118,0.4)]'
                                        : 'bg-black/5 dark:bg-white/5 border-transparent text-brand-muted cursor-not-allowed'
                                )}
                            >
                                {isLoading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <Send className="w-5 h-5 ml-0.5" />
                                )}
                            </button>
                        </div>

                        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setAgentMenuOpen((open) => !open)}
                                    className="flex items-center gap-2 rounded-lg border border-brand-accent/20 bg-brand-accent/5 px-2.5 py-1.5 text-[10px] font-bold text-brand-accent hover:border-brand-accent/45 transition-colors"
                                    title="Escolher o especialista desta conversa"
                                >
                                    <AgentGlyph id={selectedAgentId} className="h-3 w-3" />
                                    {selectedAgent.shortLabel}
                                    <ChevronDown className={cn('h-3 w-3 transition-transform', agentMenuOpen && 'rotate-180')} />
                                </button>
                                {agentMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setAgentMenuOpen(false)} />
                                        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-brand-card shadow-2xl">
                                            <div className="border-b border-black/5 dark:border-white/5 px-3 py-2 text-[9px] font-bold uppercase tracking-[.18em] text-brand-muted">
                                                Equipe de agentes
                                            </div>
                                            {CHAT_AGENTS.map((agent) => (
                                                <button
                                                    type="button"
                                                    key={agent.id}
                                                    onClick={() => chooseAgent(agent.id)}
                                                    className={cn(
                                                        'flex w-full gap-2.5 border-l-2 px-3 py-2.5 text-left transition-colors',
                                                        selectedAgentId === agent.id
                                                            ? 'border-brand-accent bg-brand-accent/10'
                                                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                                                    )}
                                                >
                                                    <AgentGlyph id={agent.id} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent" />
                                                    <span>
                                                        <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                                                            {agent.label}
                                                            {selectedAgentId === agent.id && <Check className="h-3 w-3 text-brand-accent" />}
                                                        </span>
                                                        <span className="mt-0.5 block text-[9px] leading-relaxed text-brand-muted">{agent.description}</span>
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setTierMenuOpen((open) => !open)}
                                    className="flex items-center gap-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-brand-dark/60 px-2.5 py-1.5 text-[10px] font-bold text-foreground hover:border-brand-accent/40 transition-colors"
                                    title="Este nível vale para todos os agentes acionados nesta conversa"
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
