import fs from 'fs';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatFolder {
    id: string;
    name: string;
    createdAt: string;
}

export interface ChatSession {
    id: string;
    title: string;
    folderId: string | null; // null = unfiled
    model: string; // e.g. 'gpt-4o', 'gemini-1.5-pro'
    agentId?: ChatAgentId;
    createdAt: string;
    updatedAt: string;
}

export interface ChatMessage {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    agentId?: ChatAgentId;
    agentLabel?: string;
    agentVersion?: number;
    agentTier?: 'lite' | 'mileto' | 'ultra';
    narrationDirectionMode?: 'automatic' | 'manual' | 'clean';
    createdAt: string;
}

export type ChatAgentId = 'director' | 'prompt_sales' | 'image_director' | 'video_director';
export const ACTIVE_CHAT_AGENT_ID: ChatAgentId = 'prompt_sales';
export const ACTIVE_CHAT_AGENT_LABEL = 'Narrador';

interface ChatDB {
    folders: ChatFolder[];
    sessions: ChatSession[];
    messages: ChatMessage[];
}

// ─── File I/O ────────────────────────────────────────────────────────────────

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const DB_PATH = path.join(BASE_DATA_PATH, 'data', 'chat_db.json');

function ensureDir() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readDB(): ChatDB {
    ensureDir();
    if (!fs.existsSync(DB_PATH)) {
        const empty: ChatDB = { folders: [], sessions: [], messages: [] };
        fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2), 'utf-8');
        return empty;
    }
    try {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(raw) as ChatDB;
    } catch (err) {
        // NÃO sobrescreve o arquivo: um JSON truncado (crash/antivírus durante a
        // escrita) apagaria TODO o histórico. Preserva como .corrupt-<ts> para
        // recuperação e segue com um DB vazio só em memória.
        try {
            const backup = `${DB_PATH}.corrupt-${Date.now()}`;
            fs.renameSync(DB_PATH, backup);
            console.error('[chat] chat_db.json ilegível — preservado em', backup, (err as Error).message);
        } catch {
            /* se nem renomear der, seguimos vazios sem destruir nada */
        }
        return { folders: [], sessions: [], messages: [] };
    }
}

function writeDB(db: ChatDB): void {
    ensureDir();
    // Escrita ATÔMICA: grava num temp e faz rename (operação atômica no SO). Assim
    // um crash no meio da escrita não deixa o chat_db.json principal truncado.
    const tmp = `${DB_PATH}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_PATH);
}

// ─── Folder CRUD ─────────────────────────────────────────────────────────────

export function getFolders(): ChatFolder[] {
    return readDB().folders;
}

export function createFolder(name: string): ChatFolder {
    const db = readDB();
    const folder: ChatFolder = {
        id: uuidv4(),
        name,
        createdAt: new Date().toISOString(),
    };
    db.folders.push(folder);
    writeDB(db);
    return folder;
}

export function renameFolder(id: string, name: string): ChatFolder | null {
    const db = readDB();
    const folder = db.folders.find((f) => f.id === id);
    if (!folder) return null;
    folder.name = name;
    writeDB(db);
    return folder;
}

export function deleteFolder(id: string): boolean {
    const db = readDB();
    const idx = db.folders.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    db.folders.splice(idx, 1);
    // Move sessions in this folder to unfiled
    db.sessions.forEach((s) => {
        if (s.folderId === id) s.folderId = null;
    });
    writeDB(db);
    return true;
}

// ─── Session CRUD ────────────────────────────────────────────────────────────

export function getSessions(folderId?: string | null): ChatSession[] {
    const db = readDB();
    if (folderId === undefined) return db.sessions;
    return db.sessions.filter((s) => s.folderId === folderId);
}

export function getSession(id: string): ChatSession | null {
    const db = readDB();
    return db.sessions.find((s) => s.id === id) || null;
}

export function createSession(
    title: string,
    folderId: string | null = null,
    model: string = 'mileto-plus',
    _requestedAgentId: ChatAgentId = ACTIVE_CHAT_AGENT_ID
): ChatSession {
    const db = readDB();
    const now = new Date().toISOString();
    const session: ChatSession = {
        id: uuidv4(),
        title,
        folderId,
        model,
        // Nao reescrevemos sessoes nem mensagens existentes. Apenas novas
        // sessoes passam a pertencer canonicamente ao Narrador.
        agentId: ACTIVE_CHAT_AGENT_ID,
        createdAt: now,
        updatedAt: now,
    };
    db.sessions.push(session);
    writeDB(db);
    return session;
}

export function renameSession(id: string, title: string): ChatSession | null {
    const db = readDB();
    const session = db.sessions.find((s) => s.id === id);
    if (!session) return null;
    session.title = title;
    session.updatedAt = new Date().toISOString();
    writeDB(db);
    return session;
}

export function updateSessionModel(id: string, model: string): ChatSession | null {
    const db = readDB();
    const session = db.sessions.find((s) => s.id === id);
    if (!session) return null;
    session.model = model;
    session.updatedAt = new Date().toISOString();
    writeDB(db);
    return session;
}

export function moveSession(id: string, folderId: string | null): ChatSession | null {
    const db = readDB();
    const session = db.sessions.find((s) => s.id === id);
    if (!session) return null;
    session.folderId = folderId;
    session.updatedAt = new Date().toISOString();
    writeDB(db);
    return session;
}

export function deleteSession(id: string): boolean {
    const db = readDB();
    const idx = db.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    db.sessions.splice(idx, 1);
    // Also delete all messages in this session
    db.messages = db.messages.filter((m) => m.sessionId !== id);
    writeDB(db);
    return true;
}

// ─── Message CRUD ────────────────────────────────────────────────────────────

export function getMessages(sessionId: string): ChatMessage[] {
    const db = readDB();
    return db.messages.filter((m) => m.sessionId === sessionId);
}

export function addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata: Pick<ChatMessage, 'agentId' | 'agentLabel' | 'agentVersion' | 'agentTier' | 'narrationDirectionMode'> = {}
): ChatMessage {
    const db = readDB();
    const msg: ChatMessage = {
        id: uuidv4(),
        sessionId,
        role,
        content,
        ...metadata,
        createdAt: new Date().toISOString(),
    };
    db.messages.push(msg);
    // Update session timestamp
    const session = db.sessions.find((s) => s.id === sessionId);
    if (session) session.updatedAt = msg.createdAt;
    writeDB(db);
    return msg;
}

/**
 * Persiste uma resposta nova com a identidade publica atual do Chat.
 *
 * `addMessage` continua generico porque as mensagens antigas podem carregar os
 * cargos publicos usados na epoca. Assim, nada lido do historico e migrado ou
 * rebatizado; somente respostas criadas a partir desta versao recebem Narrador.
 */
export function addNarratorMessage(
    sessionId: string,
    content: string,
    metadata: Pick<ChatMessage, 'agentVersion' | 'agentTier' | 'narrationDirectionMode'> = {}
): ChatMessage {
    return addMessage(sessionId, 'assistant', content, {
        agentId: ACTIVE_CHAT_AGENT_ID,
        agentLabel: ACTIVE_CHAT_AGENT_LABEL,
        ...metadata,
    });
}

export function deleteMessage(id: string): boolean {
    const db = readDB();
    const idx = db.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    db.messages.splice(idx, 1);
    writeDB(db);
    return true;
}

/**
 * Remove uma mensagem e todas as mensagens seguintes da mesma conversa.
 *
 * Esse recorte permite que o usuário edite o último turno e regenere a resposta
 * sem deixar a versão antiga escondida no contexto enviado à IA.
 */
export function truncateMessagesFrom(sessionId: string, messageId: string): ChatMessage[] | null {
    const db = readDB();
    const sessionMessages = db.messages.filter((message) => message.sessionId === sessionId);
    const targetIndex = sessionMessages.findIndex((message) => message.id === messageId);
    if (targetIndex === -1 || sessionMessages[targetIndex].role !== 'user') return null;

    const removedIds = new Set(sessionMessages.slice(targetIndex).map((message) => message.id));
    db.messages = db.messages.filter((message) => !removedIds.has(message.id));

    const remaining = db.messages.filter((message) => message.sessionId === sessionId);
    const session = db.sessions.find((item) => item.id === sessionId);
    if (session) {
        session.updatedAt = remaining.at(-1)?.createdAt || session.createdAt;
    }
    writeDB(db);
    return remaining;
}
