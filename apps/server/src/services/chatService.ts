import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
    createdAt: string;
    updatedAt: string;
}

export interface ChatMessage {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
}

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
    } catch {
        const empty: ChatDB = { folders: [], sessions: [], messages: [] };
        fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2), 'utf-8');
        return empty;
    }
}

function writeDB(db: ChatDB): void {
    ensureDir();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
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

export function createSession(title: string, folderId: string | null = null, model: string = 'gpt-4o'): ChatSession {
    const db = readDB();
    const now = new Date().toISOString();
    const session: ChatSession = {
        id: uuidv4(),
        title,
        folderId,
        model,
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

export function addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): ChatMessage {
    const db = readDB();
    const msg: ChatMessage = {
        id: uuidv4(),
        sessionId,
        role,
        content,
        createdAt: new Date().toISOString(),
    };
    db.messages.push(msg);
    // Update session timestamp
    const session = db.sessions.find((s) => s.id === sessionId);
    if (session) session.updatedAt = msg.createdAt;
    writeDB(db);
    return msg;
}

export function deleteMessage(id: string): boolean {
    const db = readDB();
    const idx = db.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    db.messages.splice(idx, 1);
    writeDB(db);
    return true;
}
