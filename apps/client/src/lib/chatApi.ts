import { ChatAgentId, ChatFolder, ChatSession, ChatMessage } from '../types';
import { API_BASE_URL } from './apiBase';
import { authStorage } from './authStorage';

const BASE = `${API_BASE_URL}/api/chat`;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
    // O servidor local repassa este token ao gateway (que tem a chave da IA).
    const token = await authStorage.get();
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options?.headers || {}),
        },
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
    model: string = 'gpt-4o',
    agentId: ChatAgentId = 'director'
): Promise<ChatSession> {
    const data = await request<{ session: ChatSession }>(`${BASE}/sessions`, {
        method: 'POST',
        body: JSON.stringify({ title, folderId, model, agentId }),
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

export async function truncateMessagesFrom(sessionId: string, messageId: string): Promise<ChatMessage[]> {
    const data = await request<{ messages: ChatMessage[] }>(
        `${BASE}/sessions/${sessionId}/messages/from/${messageId}`,
        { method: 'DELETE' }
    );
    return data.messages;
}

export async function sendMessage(
    sessionId: string,
    content: string,
    model: string,
    reasoning?: string,
    locale: string = 'pt-BR',
    agentId: ChatAgentId = 'director',
    signal?: AbortSignal
): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> {
    // `model` é o tier Mileto (mileto-lite/plus/ultra); o gateway resolve o modelo
    // real e injeta a persona. `reasoning` só vale para o Ultra.
    const data = await request<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>(`${BASE}/message`, {
        method: 'POST',
        body: JSON.stringify({ sessionId, content, model, reasoning, locale, agentId }),
        signal,
    });
    return {
        userMessage: data.userMessage,
        assistantMessage: data.assistantMessage,
    };
}

export interface AiGenerationJob {
    id: string;
    phase: 'downloading' | 'done' | 'error';
    percent: number;
    step: 'processing';
    stepPercent: number;
    mode: 'image' | 'video';
    title: string;
    destination: string;
    startedAt: number;
    completedAt?: number;
    source: 'ai-generation';
    statusText?: string;
    error?: string;
    track?: {
        id: string;
        displayName: string;
        originalName: string;
        filePath: string;
        publicUrl: string;
        durationSec: number;
        createdAt: string;
        type: 'image' | 'video';
    };
}

export async function startAiGeneration(payload: {
    kind: 'image' | 'video';
    tier: string;
    spec: Record<string, unknown>;
    title: string;
    conversationId: string;
    conversationTitle: string;
}): Promise<AiGenerationJob> {
    const data = await request<{ ok: true; job: AiGenerationJob }>(`${API_BASE_URL}/api/ai/generations`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    return data.job;
}

export async function getAiGeneration(id: string): Promise<AiGenerationJob> {
    const data = await request<{ ok: true; job: AiGenerationJob }>(
        `${API_BASE_URL}/api/ai/generations/${encodeURIComponent(id)}`
    );
    return data.job;
}
