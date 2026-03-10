import { ChatFolder, ChatSession, ChatMessage } from '../types';

const API_URL = import.meta.env.VITE_API_BASE_URL || (window as any).API_BASE_URL || 'http://localhost:3301';
const BASE = `${API_URL}/api/chat`;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(data.message || `Request failed: ${res.status}`);
    }
    return res.json();
}

// ─── Folders ─────────────────────────────────────────────────────────────────

export async function getFolders(): Promise<ChatFolder[]> {
    const data = await request<{ folders: ChatFolder[] }>(`${BASE}/folders`);
    return data.folders;
}

export async function createFolder(name: string): Promise<ChatFolder> {
    const data = await request<{ folder: ChatFolder }>(`${BASE}/folders`, {
        method: 'POST',
        body: JSON.stringify({ name }),
    });
    return data.folder;
}

export async function renameFolder(id: string, name: string): Promise<ChatFolder> {
    const data = await request<{ folder: ChatFolder }>(`${BASE}/folders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
    });
    return data.folder;
}

export async function deleteFolder(id: string): Promise<void> {
    await request(`${BASE}/folders/${id}`, { method: 'DELETE' });
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function getSessions(folderId?: string | null): Promise<ChatSession[]> {
    const params = folderId !== undefined && folderId !== null ? `?folderId=${folderId}` : '';
    const data = await request<{ sessions: ChatSession[] }>(`${BASE}/sessions${params}`);
    return data.sessions;
}

export async function createSession(
    title: string,
    folderId: string | null = null,
    model: string = 'gpt-4o'
): Promise<ChatSession> {
    const data = await request<{ session: ChatSession }>(`${BASE}/sessions`, {
        method: 'POST',
        body: JSON.stringify({ title, folderId, model }),
    });
    return data.session;
}

export async function renameSession(id: string, title: string): Promise<ChatSession> {
    const data = await request<{ session: ChatSession }>(`${BASE}/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
    });
    return data.session;
}

export async function updateSessionModel(id: string, model: string): Promise<ChatSession> {
    const data = await request<{ session: ChatSession }>(`${BASE}/sessions/${id}/model`, {
        method: 'PATCH',
        body: JSON.stringify({ model }),
    });
    return data.session;
}

export async function moveSession(id: string, folderId: string | null): Promise<ChatSession> {
    const data = await request<{ session: ChatSession }>(`${BASE}/sessions/${id}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ folderId }),
    });
    return data.session;
}

export async function deleteSession(id: string): Promise<void> {
    await request(`${BASE}/sessions/${id}`, { method: 'DELETE' });
}

// ─── Messages ────────────────────────────────────────────────────────────────

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
    const data = await request<{ messages: ChatMessage[] }>(`${BASE}/sessions/${sessionId}/messages`);
    return data.messages;
}

export async function sendMessage(
    sessionId: string,
    content: string,
    model: string,
    openaiKey: string,
    geminiKey: string,
    locale: string = 'pt-BR'
): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> {
    const data = await request<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>(`${BASE}/message`, {
        method: 'POST',
        body: JSON.stringify({ sessionId, content, model, openaiKey, geminiKey, locale }),
    });
    return {
        userMessage: data.userMessage,
        assistantMessage: data.assistantMessage,
    };
}
