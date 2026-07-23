import { Request, Response } from 'express';
import * as chatService from '../services/chatService';
import { bearerFrom, gatewayChat, GatewayHttpError } from '../services/gatewayClient';

// ─── Folder Endpoints ────────────────────────────────────────────────────────

export const getFolders = async (_req: Request, res: Response) => {
    try {
        res.json({ ok: true, folders: chatService.getFolders() });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

export const createFolder = async (req: Request, res: Response) => {
    try {
        const { name } = req.body;
        if (!name) {
            res.status(400).json({ ok: false, message: 'Name is required' });
            return;
        }
        res.json({ ok: true, folder: chatService.createFolder(name) });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

export const renameFolder = async (req: Request, res: Response) => {
    try {
        const folder = chatService.renameFolder(req.params.id, req.body.name);
        if (!folder) {
            res.status(404).json({ ok: false, message: 'Folder not found' });
            return;
        }
        res.json({ ok: true, folder });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

export const deleteFolder = async (req: Request, res: Response) => {
    try {
        if (!chatService.deleteFolder(req.params.id)) {
            res.status(404).json({ ok: false, message: 'Folder not found' });
            return;
        }
        res.json({ ok: true });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

// ─── Session Endpoints ───────────────────────────────────────────────────────

export const getSessions = async (req: Request, res: Response) => {
    try {
        res.json({ ok: true, sessions: chatService.getSessions(req.query.folderId as string | undefined) });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

export const createSession = async (req: Request, res: Response) => {
    try {
        const { title, folderId, model } = req.body;
        if (!title) {
            res.status(400).json({ ok: false, message: 'Title is required' });
            return;
        }
        res.json({ ok: true, session: chatService.createSession(title, folderId || null, model || 'gpt-4o') });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

export const renameSession = async (req: Request, res: Response) => {
    try {
        const session = chatService.renameSession(req.params.id, req.body.title);
        if (!session) {
            res.status(404).json({ ok: false, message: 'Session not found' });
            return;
        }
        res.json({ ok: true, session });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

export const updateSessionModel = async (req: Request, res: Response) => {
    try {
        const session = chatService.updateSessionModel(req.params.id, req.body.model);
        if (!session) {
            res.status(404).json({ ok: false, message: 'Session not found' });
            return;
        }
        res.json({ ok: true, session });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

export const moveSession = async (req: Request, res: Response) => {
    try {
        const session = chatService.moveSession(req.params.id, req.body.folderId);
        if (!session) {
            res.status(404).json({ ok: false, message: 'Session not found' });
            return;
        }
        res.json({ ok: true, session });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

export const deleteSession = async (req: Request, res: Response) => {
    try {
        if (!chatService.deleteSession(req.params.id)) {
            res.status(404).json({ ok: false, message: 'Session not found' });
            return;
        }
        res.json({ ok: true });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

// ─── Message Endpoints ───────────────────────────────────────────────────────

export const getMessages = async (req: Request, res: Response) => {
    try {
        res.json({ ok: true, messages: chatService.getMessages(req.params.sessionId) });
    } catch (err: unknown) {
        res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' });
    }
};

// ─── Send Message & Get AI Response ──────────────────────────────────────────

export const sendMessage = async (req: Request, res: Response) => {
    try {
        const { sessionId, content, model, reasoning, locale } = req.body;

        if (!sessionId || !content) {
            res.status(400).json({ ok: false, message: 'sessionId and content are required' });
            return;
        }

        const userMsg = chatService.addMessage(sessionId, 'user', content);

        const token = bearerFrom(req);
        if (!token) {
            const errMsg = chatService.addMessage(
                sessionId,
                'assistant',
                '⚠️ Sessão expirada. Entre novamente para conversar com o assistente.'
            );
            res.json({ ok: true, userMessage: userMsg, assistantMessage: errMsg });
            return;
        }

        // O histórico é local; a persona e a chave ficam no gateway. Mandamos só a
        // conversa (o tier Mileto e o nível de raciocínio o gateway resolve).
        const history = chatService
            .getMessages(sessionId)
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: m.content }));

        let assistantContent = '';
        try {
            const result = await gatewayChat(token, {
                messages: history,
                model: model || 'mileto-plus',
                reasoning,
                locale: locale || 'pt-BR',
            });
            assistantContent = result.text || 'Sem resposta do assistente.';
        } catch (apiErr: unknown) {
            if (apiErr instanceof GatewayHttpError) {
                assistantContent =
                    apiErr.status === 402
                        ? '⚠️ Seus créditos Mileto acabaram. Recarregue para continuar usando o assistente.'
                        : apiErr.status === 401
                          ? '⚠️ Sessão expirada. Entre novamente para conversar com o assistente.'
                          : `❌ Erro do servidor Mileto: ${apiErr.message}`;
            } else {
                assistantContent = `❌ Erro: ${apiErr instanceof Error ? apiErr.message : 'desconhecido'}`;
            }
        }

        const assistantMsg = chatService.addMessage(sessionId, 'assistant', assistantContent);
        res.json({ ok: true, userMessage: userMsg, assistantMessage: assistantMsg });
    } catch (err: unknown) {
        console.error('[ChatController] sendMessage error:', err);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unexpected error' });
        }
    }
};
