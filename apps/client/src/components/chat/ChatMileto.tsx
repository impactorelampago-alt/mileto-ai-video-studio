import React, { useState, useRef, useCallback, useEffect } from 'react';
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
    Brain,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import * as chatApi from '../../lib/chatApi';
import { ChatFolder, ChatSession, ChatMessage } from '../../types';

// ─── Níveis Mileto (o que o usuário vê) ──────────────────────────────────────

// Níveis Mileto que o usuário vê. O modelo real fica escondido.
// Mileto Ultra usa modelo de raciocínio, com nível ajustável.
type MiletoTier = 'lite' | 'plus' | 'ultra';
type ReasoningLevel = 'rapido' | 'equilibrado' | 'profundo';

const MILETO_TIERS: { id: MiletoTier; name: string; desc: string }[] = [
    { id: 'lite', name: 'Mileto Lite', desc: 'Rápido, para respostas ágeis' },
    { id: 'plus', name: 'Mileto Plus', desc: 'Equilíbrio para o dia a dia' },
    { id: 'ultra', name: 'Mileto Ultra', desc: 'Máxima qualidade, com raciocínio' },
];

const REASONING_LEVELS: { id: ReasoningLevel; name: string }[] = [
    { id: 'rapido', name: 'Rápido' },
    { id: 'equilibrado', name: 'Equilibrado' },
    { id: 'profundo', name: 'Profundo' },
];

/**
 * Tier Mileto → identificador que o gateway entende. O app manda só o tier
 * ("mileto-ultra"); o modelo real é resolvido no super admin, escondido do cliente.
 */
const tierToGateway = (tier: MiletoTier): string => `mileto-${tier}`;

/** Mapa reverso: a partir do que foi salvo numa sessão, recupera o tier. */
const tierFromModel = (model: string): { tier: MiletoTier; reasoning: ReasoningLevel } => {
    // Formato novo: "mileto-lite" | "mileto-plus" | "mileto-ultra".
    if (model === 'mileto-lite') return { tier: 'lite', reasoning: 'equilibrado' };
    if (model === 'mileto-plus') return { tier: 'plus', reasoning: 'equilibrado' };
    if (model === 'mileto-ultra') return { tier: 'ultra', reasoning: 'equilibrado' };
    // Back-compat: sessões antigas guardavam o nome do modelo real.
    if (model === 'gpt-4.1-nano') return { tier: 'lite', reasoning: 'equilibrado' };
    if (model === 'gpt-4.1-mini') return { tier: 'plus', reasoning: 'equilibrado' };
    if (model === 'gpt-4.1') return { tier: 'ultra', reasoning: 'rapido' };
    if (model === 'o3-mini') return { tier: 'ultra', reasoning: 'profundo' };
    if (model === 'o4-mini') return { tier: 'ultra', reasoning: 'equilibrado' };
    return { tier: 'plus', reasoning: 'equilibrado' }; // fallback p/ sessões antigas
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
    const [selectedTier, setSelectedTier] = useState<MiletoTier>('plus');
    const [reasoning, setReasoning] = useState<ReasoningLevel>('equilibrado');
    // O app manda o tier; o gateway resolve o modelo real e injeta a persona.
    const selectedModel = tierToGateway(selectedTier);
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
                    selectedModel
                );
                setSessions((prev) => [session, ...prev]);
                sessionId = session.id;
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
                reasoning,
                locale
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
    }, [inputText, isLoading, activeSessionId, selectedModel, reasoning]);

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
        const { tier, reasoning: r } = tierFromModel(session.model);
        setSelectedTier(tier);
        setReasoning(r);
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
            <MessageSquare className="w-3 h-3 shrink-0" />
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
                title="Chat Mileto"
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
                    <MessageSquare className="w-5 h-5 text-brand-accent" />
                    <span className="text-sm font-bold text-foreground tracking-widest uppercase">Chat Mileto</span>
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
                                    Chat Mileto
                                </h3>
                                <p className="text-xs text-brand-muted text-center max-w-[250px] leading-relaxed">
                                    Seu assistente de IA integrado. Escreva prompts, gere ideias de roteiros, e peça
                                    ajuda com qualquer coisa!
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
                                        <Bot className="w-4 h-4 text-[#0a0f12]" />
                                    </div>
                                )}
                                <div
                                    className={cn(
                                        'max-w-[80%] px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap',
                                        msg.role === 'user'
                                            ? 'bg-brand-accent/10 text-foreground border border-brand-accent/30 rounded-2xl rounded-br-sm shadow-[0_4px_20px_rgba(0,230,118,0.05)]'
                                            : 'bg-brand-card/50 text-foreground/90 border border-black/5 dark:border-white/5 rounded-2xl rounded-bl-sm shadow-xl'
                                    )}
                                >
                                    {msg.content}
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
                                    <Bot className="w-4 h-4 text-[#0a0f12]" />
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

                        {/* Seletor de nível Mileto, ao lado do envio (estilo Claude/GPT) */}
                        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <div className="relative group">
                                <select
                                    value={selectedTier}
                                    onChange={(e) => setSelectedTier(e.target.value as MiletoTier)}
                                    className="appearance-none text-[11px] font-bold bg-brand-dark/60 text-brand-accent border border-brand-accent/25 rounded-lg pl-3 pr-7 py-1.5 outline-none hover:border-brand-accent/60 cursor-pointer transition-colors tracking-wide"
                                    title={MILETO_TIERS.find((t) => t.id === selectedTier)?.desc}
                                >
                                    {MILETO_TIERS.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="w-3 h-3 text-brand-accent absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>

                            {/* Nível de raciocínio — só no Ultra */}
                            {selectedTier === 'ultra' && (
                                <div className="relative animate-in fade-in slide-in-from-left-1 duration-200">
                                    <select
                                        value={reasoning}
                                        onChange={(e) => setReasoning(e.target.value as ReasoningLevel)}
                                        className="appearance-none text-[11px] font-semibold bg-brand-dark/60 text-brand-muted border border-black/10 dark:border-white/10 rounded-lg pl-6 pr-7 py-1.5 outline-none hover:border-brand-accent/40 cursor-pointer transition-colors"
                                        title="Nível de raciocínio do Mileto Ultra"
                                    >
                                        {REASONING_LEVELS.map((r) => (
                                            <option key={r.id} value={r.id}>
                                                {r.name}
                                            </option>
                                        ))}
                                    </select>
                                    <Brain className="w-3 h-3 text-brand-muted absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                    <ChevronDown className="w-3 h-3 text-brand-muted absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
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
