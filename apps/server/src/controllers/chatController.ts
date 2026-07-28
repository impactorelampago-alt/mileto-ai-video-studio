import { Request, Response } from 'express';
import * as chatService from '../services/chatService';
import { bearerFrom, gatewayChat, GatewayHttpError } from '../services/gatewayClient';

const CHAT_AGENT_IDS = ['director', 'prompt_sales', 'image_director', 'video_director'] as const;
type ChatAgentId = (typeof CHAT_AGENT_IDS)[number];

const normalizeAgentId = (value: unknown): ChatAgentId =>
    CHAT_AGENT_IDS.includes(value as ChatAgentId) ? (value as ChatAgentId) : 'director';

const SCRIPT_OUTPUT_INSTRUCTION = `<INSTRUCAO_DE_FORMATO_DO_APP>
Responda ao pedido do usuário imediatamente anterior.
Se a resposta contiver um roteiro final pronto para uso, gere também um título curto e use exatamente:
===TITULO===
Título do projeto em uma linha, sem tags, com no máximo 60 caracteres
===ROTEIRO===
Texto completo da narração
===FIM===
Se não houver roteiro final, não use esses marcadores.
</INSTRUCAO_DE_FORMATO_DO_APP>`;

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
        const { title, folderId, model, agentId } = req.body;
        if (!title) {
            res.status(400).json({ ok: false, message: 'Title is required' });
            return;
        }
        res.json({
            ok: true,
            session: chatService.createSession(
                title,
                folderId || null,
                model || 'gpt-4o',
                normalizeAgentId(agentId)
            ),
        });
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

        const session = chatService.getSession(sessionId);
        if (!session) {
            res.status(404).json({ ok: false, message: 'Conversa não encontrada.' });
            return;
        }
        const agentId = normalizeAgentId(req.body?.agentId || session.agentId);
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
            .filter((m) => {
                if (m.role === 'user') return true;
                if (m.role !== 'assistant') return false;
                // Falhas transitórias ficam visíveis no histórico local, mas não
                // são contexto de negócio e não devem contaminar a próxima tentativa.
                const content = m.content.trim();
                return !content.startsWith('❌') && !content.startsWith('⚠️');
            })
            .map((m) => ({ role: m.role, content: m.content }));
        const historyForGateway = history.map((message, index) =>
            agentId === 'director' && index === history.length - 1 && message.role === 'user'
                ? { ...message, content: `${message.content}\n\n${SCRIPT_OUTPUT_INSTRUCTION}` }
                : message
        );

        let assistantContent = '';
        let assistantAgent: { id: string; label: string; version: number; tier: 'lite' | 'mileto' | 'ultra' } | undefined;
        try {
            const result = await gatewayChat(token, {
                messages: historyForGateway,
                agentId,
                model: model || 'mileto-plus',
                reasoning,
                locale: locale || 'pt-BR',
            });
            assistantContent = result.text || 'Sem resposta do assistente.';
            assistantAgent = result.agent;
        } catch (apiErr: unknown) {
            if (apiErr instanceof GatewayHttpError) {
                assistantContent =
                    apiErr.status === 402
                        ? '⚠️ Seus créditos Mileto acabaram. Recarregue para continuar usando o assistente.'
                        : apiErr.status === 401
                          ? '⚠️ Sessão expirada. Entre novamente para conversar com o assistente.'
                          : apiErr.status === 504
                            ? '⚠️ O agente precisou de mais tempo do que o servidor permitiu. Sua mensagem foi preservada e nenhum erro técnico precisa ser copiado: tente novamente.'
                            : apiErr.status === 502 || apiErr.status === 503
                              ? '⚠️ O serviço de IA ficou temporariamente indisponível. Sua mensagem foi preservada; tente novamente em instantes.'
                          : `❌ Erro do servidor Mileto: ${apiErr.message}`;
            } else {
                assistantContent = `❌ Erro: ${apiErr instanceof Error ? apiErr.message : 'desconhecido'}`;
            }
        }

        const assistantMsg = chatService.addMessage(sessionId, 'assistant', assistantContent, {
            agentId: normalizeAgentId(assistantAgent?.id || agentId),
            agentLabel: assistantAgent?.label,
            agentVersion: assistantAgent?.version,
            agentTier: assistantAgent?.tier,
        });
        res.json({ ok: true, userMessage: userMsg, assistantMessage: assistantMsg });
    } catch (err: unknown) {
        console.error('[ChatController] sendMessage error:', err);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Unexpected error' });
        }
    }
};
