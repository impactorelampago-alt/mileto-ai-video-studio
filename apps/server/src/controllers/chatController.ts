import { Request, Response } from 'express';
import https from 'https';
import * as chatService from '../services/chatService';

// ─── Helper: HTTPS POST (stable, no crash) ──────────────────────────────────

function httpsPost(
    url: string,
    body: object,
    headers: Record<string, string>
): Promise<{ status: number; data: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const postData = JSON.stringify(body);

        const options = {
            hostname: parsed.hostname,
            port: 443,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                ...headers,
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: string) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({ status: res.statusCode || 0, data });
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.setTimeout(60000, () => {
            req.destroy();
            reject(new Error('Request timeout (60s)'));
        });

        req.write(postData);
        req.end();
    });
}

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
        const { sessionId, content, model, openaiKey, geminiKey, locale } = req.body;

        if (!sessionId || !content) {
            res.status(400).json({ ok: false, message: 'sessionId and content are required' });
            return;
        }

        const userMsg = chatService.addMessage(sessionId, 'user', content);

        const selectedModel = model || 'gpt-4o';
        const isGemini = selectedModel.startsWith('gemini');
        const apiKey = isGemini ? geminiKey : openaiKey;

        if (!apiKey) {
            const provider = isGemini ? 'Gemini' : 'OpenAI';
            const errMsg = chatService.addMessage(
                sessionId,
                'assistant',
                `⚠️ Chave da API ${provider} não configurada. Vá em Configurações para adicionar.`
            );
            res.json({ ok: true, userMessage: userMsg, assistantMessage: errMsg });
            return;
        }

        // Build system prompt with language from locale
        const langMap: Record<string, string> = {
            pt: 'Português do Brasil',
            'pt-BR': 'Português do Brasil',
            'pt-PT': 'Português de Portugal',
            en: 'English',
            'en-US': 'English',
            es: 'Español',
            fr: 'Français',
            de: 'Deutsch',
            it: 'Italiano',
            ja: '日本語',
            ko: '한국어',
            zh: '中文',
        };
        const userLocale = locale || 'pt-BR';
        const langName = langMap[userLocale] || langMap[userLocale.split('-')[0]] || 'Português do Brasil';
        const systemPrompt = `Você é Mileto, um assistente de IA inteligente e prestativo. Responda SEMPRE em ${langName}. Seja claro, objetivo e amigável. Quando o usuário pedir algo criativo, seja criativo. Quando pedir algo técnico, seja preciso.`;

        const history = chatService.getMessages(sessionId);
        let assistantContent = '';

        if (isGemini) {
            // Gemini doesn't support 'system' role — inject as first user/model pair
            const geminiMessages: { role: string; parts: { text: string }[] }[] = [
                { role: 'user', parts: [{ text: systemPrompt }] },
                { role: 'model', parts: [{ text: 'Entendido! Estou pronto para ajudar.' }] },
            ];
            history
                .filter((m) => m.role !== 'system')
                .forEach((m) => {
                    geminiMessages.push({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: m.content }],
                    });
                });

            try {
                const resp = await httpsPost(
                    `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${geminiKey}`,
                    { contents: geminiMessages, generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } },
                    {}
                );
                const data = JSON.parse(resp.data);
                if (resp.status !== 200) {
                    throw new Error(data?.error?.message || `Gemini API error: ${resp.status}`);
                }
                assistantContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta do Gemini.';
            } catch (apiErr: unknown) {
                assistantContent = `❌ Erro Gemini: ${apiErr instanceof Error ? apiErr.message : 'Erro desconhecido'}`;
            }
        } else {
            // OpenAI: inject system prompt as first message
            const openaiMessages: { role: string; content: string }[] = [{ role: 'system', content: systemPrompt }];
            history.forEach((m) => {
                openaiMessages.push({ role: m.role, content: m.content });
            });

            try {
                const resp = await httpsPost(
                    'https://api.openai.com/v1/chat/completions',
                    { model: selectedModel, messages: openaiMessages, temperature: 0.7, max_tokens: 4096 },
                    { Authorization: `Bearer ${openaiKey}` }
                );
                const data = JSON.parse(resp.data);
                if (resp.status !== 200) {
                    throw new Error(data?.error?.message || `OpenAI API error: ${resp.status}`);
                }
                assistantContent = data?.choices?.[0]?.message?.content || 'Sem resposta da OpenAI.';
            } catch (apiErr: unknown) {
                assistantContent = `❌ Erro OpenAI: ${apiErr instanceof Error ? apiErr.message : 'Erro desconhecido'}`;
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
