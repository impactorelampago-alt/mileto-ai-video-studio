import Replicate from 'replicate';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { BadRequestError, InternalServerError } from '../utils/errors';
import OpenAI from 'openai';

class AIService {
    private sanitizeRunwayToken(token: string) {
        let t = token.trim();
        if (t.startsWith('Bearer ')) t = t.substring(7).trim();
        return t;
    }

    async testReplicate(token: string) {
        try {
            const replicate = new Replicate({ auth: token });
            await replicate.hardware.list();
            return true;
        } catch (error: any) {
            console.error('[AIService] Replicate Test Error:', error.message);
            throw new BadRequestError(error.message || 'Invalid Replicate Token');
        }
    }

    async generateReplicateImage(projectId: string, prompt: string, aspectRatio: string = '1:1', qualityPreset: string = 'standard', customToken?: string) {
        const token = customToken || config.apiKeys.replicate;
        if (!token) throw new BadRequestError('Missing Replicate Token');

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

            if (!imageUrl) throw new InternalServerError('No image URL returned from Replicate');

            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const fileName = `img-${uuidv4()}.png`;
            const projectDir = path.join(config.paths.projects, projectId, 'ai/images');

            if (!fs.existsSync(projectDir)) {
                fs.mkdirSync(projectDir, { recursive: true });
            }

            const filePath = path.join(projectDir, fileName);
            fs.writeFileSync(filePath, response.data);

            const publicUrl = `/data/projects/${projectId}/ai/images/${fileName}`;

            return {
                id: uuidv4(),
                type: 'image',
                path: filePath,
                publicUrl: publicUrl,
                duration: 3.5,
            };
        } catch (error: any) {
            console.error('[AIService] Replicate Gen Error:', error.message);
            throw new InternalServerError(error.message || 'Generation Failed');
        }
    }

    async generateRunwayVideo(prompt: string, durationSec: number = 4, aspectRatio: string = '1920:1080', customToken?: string) {
        let token = customToken || config.apiKeys.runway;
        if (!token) throw new BadRequestError('Missing Runway Token');
        token = this.sanitizeRunwayToken(token);

        if (![4, 6, 8].includes(durationSec)) throw new BadRequestError(`Invalid duration (${durationSec}s). Use 4, 6 or 8.`);
        if (!aspectRatio.includes(':')) throw new BadRequestError('Invalid ratio format. Use W:H (ex: 1920:1080).');

        const payload = {
            model: 'veo3.1_fast',
            promptText: prompt.substring(0, 1000),
            ratio: aspectRatio,
            duration: durationSec,
            audio: false,
        };

        try {
            const response = await axios.post('https://api.dev.runwayml.com/v1/text_to_video', payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Runway-Version': '2024-11-06',
                    'Content-Type': 'application/json',
                },
            });
            return response.data.id;
        } catch (error: any) {
            console.error('[AIService] Runway Video Gen Error:', error.response?.data || error.message);
            throw new InternalServerError(error.response?.data?.error || 'Runway API Failed');
        }
    }

    async generateRunwayImageToVideo(promptText: string, imageUrl: string, durationSec: number = 5, ratio: string = '1280:768', customToken?: string) {
        let token = customToken || config.apiKeys.runway;
        if (!token) throw new BadRequestError('Missing Runway Token');
        token = this.sanitizeRunwayToken(token);

        if (![5, 10].includes(durationSec)) throw new BadRequestError(`Invalid duration (${durationSec}s). Use 5 or 10.`);

        let finalImageUrl = imageUrl;
        if (imageUrl.startsWith('http://localhost') || imageUrl.startsWith('/data/')) {
            try {
                let localPath = imageUrl;
                if (localPath.startsWith('http://localhost')) {
                    const urlObj = new URL(localPath);
                    localPath = urlObj.pathname;
                }
                const filePath = path.join(config.baseDataPath, localPath);
                if (fs.existsSync(filePath)) {
                    const imageBuffer = fs.readFileSync(filePath);
                    const ext = path.extname(filePath).toLowerCase();
                    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
                    finalImageUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
                }
            } catch (err) {
                console.error('[AIService] Image Conversion Error:', err);
            }
        }

        const payload = {
            model: 'gen3a_turbo',
            promptImage: finalImageUrl,
            promptText: promptText.substring(0, 1000),
            ratio: ratio,
            duration: durationSec,
        };

        try {
            const response = await axios.post('https://api.dev.runwayml.com/v1/image_to_video', payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Runway-Version': '2024-11-06',
                    'Content-Type': 'application/json',
                },
            });
            return response.data.id;
        } catch (error: any) {
            console.error('[AIService] Runway Img2Vid Error:', error.response?.data || error.message);
            throw new InternalServerError(error.response?.data?.error || 'Runway API Failed');
        }
    }

    async getRunwayJobStatus(jobId: string, projectId: string, customToken?: string) {
        let token = customToken || config.apiKeys.runway;
        if (!token) throw new BadRequestError('Missing Runway Token');
        token = this.sanitizeRunwayToken(token);

        try {
            const response = await axios.get(`https://api.dev.runwayml.com/v1/tasks/${jobId}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Runway-Version': '2024-11-06',
                },
            });

            const status = response.data.status;
            if (status === 'SUCCEEDED') {
                const videoUrl = Array.isArray(response.data.output) ? response.data.output[0] : response.data.output;
                if (!videoUrl) throw new InternalServerError('No video URL returned');

                const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
                const fileName = `vid-${uuidv4()}.mp4`;
                const projectDir = path.join(config.paths.projects, projectId, 'ai/videos');

                if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
                const filePath = path.join(projectDir, fileName);
                fs.writeFileSync(filePath, videoResponse.data);

                return {
                    status: 'SUCCEEDED',
                    asset: {
                        id: uuidv4(),
                        type: 'video',
                        path: filePath,
                        publicUrl: `/data/projects/${projectId}/ai/videos/${fileName}`,
                        duration: 5,
                        source: 'AI-Generated',
                    },
                };
            }
            return { status, progress: response.data.progress };
        } catch (error: any) {
            console.error('[AIService] Runway Status Error:', error.message);
            throw new InternalServerError('Failed to check Runway task status');
        }
    }

    async generateTitles(script: string, wordTimings: string, openaiKey?: string, geminiKey?: string) {
        const key = openaiKey || geminiKey || config.apiKeys.openai || config.apiKeys.gemini;
        if (!key) throw new BadRequestError('Missing AI API Key (OpenAI or Gemini)');

        const systemPrompt = `Você é um especialista em retenção de vídeos curtos (TikTok/Reels).
Sua missão é criar Títulos Chamativos (Hooks textuais) que vão aparecer na tela em momentos chave do vídeo para prender a atenção.
Responda EXCLUSIVAMENTE em formato JSON.`;

        try {
            let titlesJson: any = null;
            if (openaiKey || config.apiKeys.openai) {
                const openai = new OpenAI({ apiKey: openaiKey || config.apiKeys.openai });
                const response = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Roteiro: ${script}\n\nLegendas: ${wordTimings}` },
                    ],
                    response_format: { type: 'json_object' },
                });
                titlesJson = JSON.parse(response.choices[0].message.content || '{}');
            } else if (geminiKey || config.apiKeys.gemini) {
                const response = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey || config.apiKeys.gemini}`,
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
                titlesJson = JSON.parse(response.data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
            }

            const rawTitles = Array.isArray(titlesJson) ? titlesJson : titlesJson?.titles || [];
            return rawTitles.map((t: any) => ({
                id: uuidv4(),
                text: t.text || 'Título gerado',
                startSec: Number(t.startSec) || 0,
                durationSec: Number(t.durationSec) || 2,
                isActive: false,
                posY: 30,
                scale: 1,
            }));
        } catch (error: any) {
            console.error('[AIService] Title Gen Error:', error.message);
            throw new InternalServerError('Failed to generate titles');
        }
    }

    async generateMoodRewrite(text: string, mood: string, openaiKey?: string, geminiKey?: string) {
        const key = openaiKey || geminiKey || config.apiKeys.openai || config.apiKeys.gemini;
        if (!key) throw new BadRequestError('Missing AI API Key');

        const systemPrompt = `Você é um especialista em reescrita semântica para síntese de voz (TTS). Mood: ${mood}.`;
        try {
            if (openaiKey || config.apiKeys.openai) {
                const openai = new OpenAI({ apiKey: key });
                const response = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: text },
                    ],
                });
                return response.choices[0].message.content?.trim() || text;
            } else {
                const response = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
                    {
                        contents: [
                            {
                                role: 'user',
                                parts: [{ text: systemPrompt + '\n\n' + text }],
                            },
                        ],
                    }
                );
                return response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
            }
        } catch (error: any) {
            console.error('[AIService] Mood Rewrite Error:', error.message);
            throw new InternalServerError('Failed to rewrite mood');
        }
    }
}

export const aiService = new AIService();
