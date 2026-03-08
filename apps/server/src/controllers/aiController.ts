import { Request, Response } from 'express';
import Replicate from 'replicate';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// --- Replicate Integration ---

export const testReplicate = async (req: Request, res: Response) => {
    const token = (req.headers['x-replicate-token'] as string)?.trim();
    if (!token) return res.status(401).json({ ok: false, message: 'Missing Replicate Token' });

    try {
        const replicate = new Replicate({ auth: token });
        await replicate.hardware.list();
        res.json({ ok: true });
    } catch (error: any) {
        const errorMessage = error.message || 'Unknown error';
        console.error('Replicate Test Error:', errorMessage);
        res.status(401).json({ ok: false, message: errorMessage });
    }
};

export const generateReplicateImage = async (req: Request, res: Response) => {
    const token = (req.headers['x-replicate-token'] as string)?.trim();
    const { projectId, prompt, aspectRatio = '1:1', qualityPreset = 'standard' } = req.body;

    if (!token) return res.status(401).json({ ok: false, message: 'Missing Token' });
    if (!projectId || !prompt) return res.status(400).json({ ok: false, message: 'Missing parameters' });

    try {
        const replicate = new Replicate({ auth: token });
        const model = 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b';
        const input = {
            prompt,
            aspect_ratio: aspectRatio,
            refine: qualityPreset === 'quality' ? 'expert_ensemble_refiner' : 'base_image_refiner',
        };

        const output = await replicate.run(model, { input });
        const imageUrl = Array.isArray(output) ? output[0] : (output as unknown as string);

        if (!imageUrl) throw new Error('No image URL returned');

        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const fileName = `img-${uuidv4()}.png`;
        const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
        const projectDir = path.join(BASE_DATA_PATH, 'data/projects', projectId, 'ai/images');

        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }

        const filePath = path.join(projectDir, fileName);
        fs.writeFileSync(filePath, response.data);

        const publicUrl = `/data/projects/${projectId}/ai/images/${fileName}`;

        res.json({
            ok: true,
            asset: {
                id: uuidv4(),
                type: 'image',
                path: filePath,
                publicUrl: publicUrl,
                duration: 3.5,
            },
        });
    } catch (error: any) {
        console.error('Replicate Gen Error:', error.message);
        res.status(500).json({ ok: false, message: error.message || 'Generation Failed' });
    }
};

// --- Runway (Custom Text-to-Video) Integration ---

const sanitizeRunwayToken = (token: string) => {
    let t = token.trim();
    if (t.startsWith('Bearer ')) {
        t = t.substring(7).trim();
    }
    return t;
};

export const validateRunway = async (req: Request, res: Response) => {
    const { apiKey } = req.body;
    // Soft validation: just check if it exists and looks somewhat valid (not empty)
    if (!apiKey || apiKey.trim().length === 0) {
        return res.status(400).json({ ok: false, message: 'API Key missing' });
    }

    // We skip the external call to avoid 404s/auth errors during setup.
    // Validation will happen meaningfully when generating a video.
    res.json({ ok: true, message: 'Runway Key Saved' });
};

export const generateRunwayVideo = async (req: Request, res: Response) => {
    let token = req.headers['x-runway-token'] as string;
    const { prompt, durationSec = 4, aspectRatio = '1920:1080' } = req.body;

    if (!token) return res.status(401).json({ ok: false, message: 'Missing Token' });
    token = sanitizeRunwayToken(token);

    try {
        // Strict Validation for Veo
        const duration = Number(durationSec);
        if (![4, 6, 8].includes(duration)) {
            return res.status(400).json({
                ok: false,
                message: `Duração inválida (${duration}s). Use 4, 6 ou 8 segundos.`,
            });
        }

        // Validate Ratio format (W:H)
        if (!aspectRatio.includes(':')) {
            return res.status(400).json({
                ok: false,
                message: `Proporção inválida (${aspectRatio}). Use formato W:H (ex: 1920:1080).`,
            });
        }

        // Clean and truncate prompt - Runway limits to 1000 characters
        let cleanPrompt = prompt ? prompt.trim() : 'High quality video';
        if (cleanPrompt.length > 1000) {
            cleanPrompt = cleanPrompt.substring(0, 997) + '...';
            console.warn(`Text-to-Video prompt truncated from ${prompt.length} to 1000 chars`);
        }

        const payload = {
            model: 'veo3.1_fast',
            promptText: cleanPrompt,
            ratio: aspectRatio,
            duration: duration,
            audio: false,
        };

        // Debug Log
        try {
            const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
            const logPath = path.join(BASE_DATA_PATH, 'runway_debug.log');
            const logEntry = `[${new Date().toISOString()}] Payload: ${JSON.stringify(payload)}\n`;
            fs.appendFileSync(logPath, logEntry);
        } catch (_e) {
            /* ignore */
        }

        console.log('Runway Payload (Veo):', JSON.stringify(payload, null, 2));

        const response = await axios.post('https://api.dev.runwayml.com/v1/text_to_video', payload, {
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Runway-Version': '2024-11-06',
                'Content-Type': 'application/json',
            },
        });

        const jobId = response.data.id;
        res.json({ ok: true, jobId });
    } catch (error: unknown) {
        const axiosErr = error as {
            response?: { data?: { error?: string; details?: string }; status?: number };
            message?: string;
        };
        const errData = axiosErr.response?.data;
        const errMsg = errData?.error || errData?.details || axiosErr.message || 'Unknown error';
        const errStatus = axiosErr.response?.status || 500;

        console.error('Runway Gen Error:', JSON.stringify(errData || axiosErr.message));

        // Debug Log Error
        try {
            const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
            const logPath = path.join(BASE_DATA_PATH, 'runway_debug.log');
            const logEntry = `[${new Date().toISOString()}] ERROR (${errStatus}): ${JSON.stringify(errData || axiosErr.message)}\n`;
            fs.appendFileSync(logPath, logEntry);
        } catch (_e) {
            /* ignore */
        }

        res.status(errStatus).json({
            ok: false,
            message: `Runway Error: ${errMsg}`,
            details: errData,
        });
    }
};

export const generateRunwayImageToVideo = async (req: Request, res: Response) => {
    let token = req.headers['x-runway-token'] as string;
    const { promptText, imageUrl, durationSec = 5, ratio = '1280:768' } = req.body;

    if (!token) return res.status(401).json({ ok: false, message: 'Missing Token' });
    token = sanitizeRunwayToken(token);

    if (!imageUrl) return res.status(400).json({ ok: false, message: 'Missing Image URL' });

    try {
        // Validate duration (Gen-3 Alpha Turbo supports 5 or 10 seconds)
        const duration = Number(durationSec);
        if (![5, 10].includes(duration)) {
            return res.status(400).json({
                ok: false,
                message: `Duração inválida (${duration}s). Use 5 ou 10 segundos para Image-to-Video.`,
            });
        }

        // Clean prompt text - Runway limits to 1000 characters
        let prompt = promptText ? promptText.trim() : 'High quality video';
        if (prompt.length > 1000) {
            prompt = prompt.substring(0, 997) + '...';
            console.warn(`Prompt truncated from ${promptText.length} to 1000 chars`);
        }

        // Runway requires promptImage to be:
        // - https:// URL (publicly accessible)
        // - runway:// URI (from uploads endpoint)
        // - data:image/ base64 data URI
        // If the image is on localhost, we need to read it and convert to base64
        let finalImageUrl = imageUrl;
        if (imageUrl.startsWith('http://localhost') || imageUrl.startsWith('/data/')) {
            try {
                // Resolve the local file path
                let localPath = imageUrl;
                if (localPath.startsWith('http://localhost')) {
                    // Extract path after the host: http://localhost:3301/data/... -> /data/...
                    const urlObj = new URL(localPath);
                    localPath = urlObj.pathname;
                }
                // Map /data/... to the actual filesystem path
                const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
                const filePath = path.join(BASE_DATA_PATH, localPath);

                if (fs.existsSync(filePath)) {
                    const imageBuffer = fs.readFileSync(filePath);
                    const ext = path.extname(filePath).toLowerCase();
                    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
                    finalImageUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
                    console.log(`Converted local image to base64 (${(imageBuffer.length / 1024).toFixed(1)}KB)`);
                } else {
                    console.error('Local image file not found:', filePath);
                    return res.status(400).json({ ok: false, message: `Imagem não encontrada: ${filePath}` });
                }
            } catch (convErr) {
                console.error('Failed to convert image to base64:', convErr);
                return res
                    .status(400)
                    .json({ ok: false, message: 'Falha ao processar imagem local. Use uma URL HTTPS pública.' });
            }
        }

        // Runway Gen-3 Alpha Turbo Image-to-Video payload
        const payload: Record<string, unknown> = {
            model: 'gen3a_turbo',
            promptImage: finalImageUrl,
            promptText: prompt,
            ratio: ratio,
            duration: duration,
        };

        // Debug Log
        try {
            const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
            const logPath = path.join(BASE_DATA_PATH, 'runway_debug.log');
            const logEntry = `[${new Date().toISOString()}] Img2Vid Payload: ${JSON.stringify(payload)}\n`;
            fs.appendFileSync(logPath, logEntry);
        } catch (_e) {
            /* ignore */
        }

        console.log('Runway Img2Vid Payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post('https://api.dev.runwayml.com/v1/image_to_video', payload, {
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Runway-Version': '2024-11-06',
                'Content-Type': 'application/json',
            },
        });

        const jobId = response.data.id;
        res.json({ ok: true, jobId });
    } catch (error: unknown) {
        const axiosErr = error as {
            response?: { data?: { error?: string; details?: string }; status?: number };
            message?: string;
        };
        const errData = axiosErr.response?.data;
        const errMsg = errData?.error || errData?.details || axiosErr.message || 'Unknown error';
        const errStatus = axiosErr.response?.status || 500;

        console.error('Runway Img2Vid Error:', JSON.stringify(errData || axiosErr.message));

        try {
            const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
            const logPath = path.join(BASE_DATA_PATH, 'runway_debug.log');
            const logEntry = `[${new Date().toISOString()}] ERROR (${errStatus}): ${JSON.stringify(errData || axiosErr.message)}\n`;
            fs.appendFileSync(logPath, logEntry);
        } catch (_e) {
            /* ignore */
        }

        // Surface the FULL error to user so we can debug
        res.status(errStatus).json({
            ok: false,
            message: `Runway Error: ${errMsg}`,
            details: errData,
        });
    }
};

export const getRunwayJobStatus = async (req: Request, res: Response) => {
    let token = req.headers['x-runway-token'] as string;
    const { jobId } = req.params;
    const { projectId } = req.query;

    if (!token) return res.status(401).json({ ok: false, message: 'Missing Token' });
    if (!projectId) return res.status(400).json({ ok: false, message: 'Missing Project ID' });
    token = sanitizeRunwayToken(token);

    try {
        const response = await axios.get(`https://api.dev.runwayml.com/v1/tasks/${jobId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Runway-Version': '2024-11-06',
            },
        });

        const status = response.data.status;

        if (status === 'SUCCEEDED') {
            const output = response.data.output;
            let videoUrl: string | null = null;

            // Handle array or string output
            if (Array.isArray(output) && output.length > 0) videoUrl = output[0];
            else if (typeof output === 'string') videoUrl = output;

            if (!videoUrl) {
                return res.status(500).json({ status: 'FAILED', error: 'No output URL in SUCCEEDED response' });
            }

            const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
            const fileName = `vid-${uuidv4()}.mp4`;
            const pId = String(projectId);
            const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
            const projectDir = path.join(BASE_DATA_PATH, 'data/projects', pId, 'ai/videos');

            if (!fs.existsSync(projectDir)) {
                fs.mkdirSync(projectDir, { recursive: true });
            }

            const filePath = path.join(projectDir, fileName);
            fs.writeFileSync(filePath, videoResponse.data);

            const publicUrl = `/data/projects/${pId}/ai/videos/${fileName}`;

            res.json({
                status: 'SUCCEEDED',
                asset: {
                    id: uuidv4(),
                    type: 'video',
                    path: filePath,
                    publicUrl: publicUrl,
                    duration: 5, // Default/Fallback, checks metadata in future
                    source: 'AI-Generated',
                },
            });
        } else if (status === 'FAILED') {
            res.json({ status: 'FAILED', error: response.data.error || 'Unknown error' });
        } else {
            res.json({ status: status, progress: response.data.progress });
        }
    } catch (error: any) {
        console.error('Runway Status Error:', error.message);
        res.status(500).json({ status: 'ERROR', message: 'Failed to check status' });
    }
};

import OpenAI from 'openai';

export const generateTitles = async (req: Request, res: Response) => {
    const { script, captions, openaiKey, geminiKey } = req.body;

    if (!script || !captions || !captions.segments) {
        return res.status(400).json({ ok: false, message: 'Missing script or captions data' });
    }

    if (!openaiKey && !geminiKey) {
        return res.status(401).json({ ok: false, message: 'Missing OpenAI or Gemini API Key' });
    }

    // Extract all words with their start times for the AI to reference
    const wordTimings = captions.segments
        .flatMap((seg: any) => (seg.words || []).map((w: any) => `[${w.start.toFixed(2)}s] ${w.text}`))
        .join(' ');

    const systemPrompt = `Você é um especialista em retenção de vídeos curtos (TikTok/Reels).
Sua missão é criar Títulos Chamativos (Hooks textuais) que vão aparecer na tela em momentos chave do vídeo para prender a atenção.
Vou te passar o roteiro completo e as legendas exatas (com o tempo em segundos de cada palavra).
Identifique de 3 a 5 momentos ideais (gatilhos de curiosidade, promessas, quebras de padrão) e crie um hook curto de impacto.

Regras:
1. O texto do título deve ser curto (máx 5-6 palavras), impactante e estar relacionado com o que está sendo dito naquele segundo.
2. O startSec (tempo de início) deve ser EXATAMENTE um dos tempos mapeados nas legendas fornecidas.
3. Fixe todos os 'durationSec' como 2 (dois segundos).

O usuário fornecerá as legendas no formato: "[segundo] palavra".
Responda EXCLUSIVAMENTE em formato JSON. O JSON DEVE CONTER uma raiz com a chave "titles" que é um array de objetos, assim:
{
  "titles": [
    { "text": "Hook Curto e Direto", "startSec": 0.50, "durationSec": 2 }
  ]
}`;

    try {
        let titlesJson = '';

        if (openaiKey) {
            console.log('[AI] Gerando Títulos com OpenAI...');
            const openai = new OpenAI({ apiKey: openaiKey });
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Roteiro: ${script}\n\nLegendas: ${wordTimings}` },
                ],
                response_format: { type: 'json_object' },
            });
            const content = response.choices[0].message.content || '{}';
            console.log('[AI] Output:', content);
            const parsedContent = JSON.parse(content);
            titlesJson = Array.isArray(parsedContent) ? parsedContent : parsedContent.titles || parsedContent;
        } else if (geminiKey) {
            console.log('[AI] Gerando Títulos com Gemini...');
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
                {
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: systemPrompt + '\n\n' + `Roteiro: ${script}\n\nLegendas: ${wordTimings}` }],
                        },
                    ],
                    generationConfig: { responseMimeType: 'application/json' },
                }
            );
            const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
            const parsedContent = JSON.parse(content);
            titlesJson = Array.isArray(parsedContent) ? parsedContent : parsedContent.titles || parsedContent;
        }

        // Format titles and assign IDs
        const finalTitles = (Array.isArray(titlesJson) ? titlesJson : []).map((t) => ({
            id: uuidv4(),
            text: t.text || 'Título gerado',
            startSec: Number(t.startSec) || 0,
            durationSec: Number(t.durationSec) || 2,
            isActive: false, // Default desativado
            posY: 30,
            scale: 1, // Default scale 1x
        }));

        res.json({ ok: true, titles: finalTitles });
    } catch (error: any) {
        console.error('[AI] Erro ao gerar títulos:', error.response?.data || error.message);
        res.status(500).json({ ok: false, message: 'Falha ao processar IA para Títulos.' });
    }
};
