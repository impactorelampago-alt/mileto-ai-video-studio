import { Request, Response } from 'express';
import Replicate from 'replicate';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import { bearerFrom, gatewayChat, gatewayJson, GatewayHttpError } from '../services/gatewayClient';
import {
    DEFAULT_TITLE_GENERATOR_CONFIG,
    loadEffectiveTitleGeneratorConfig,
    type TitleGeneratorConfig,
    type VideoFormat,
} from '../services/titleGeneratorConfig';
import {
    compactTitleDisplayText,
    deterministicCaptionTitleCandidates,
    deterministicTitleCandidates,
    fitTitlesToTimeline,
    isSemanticallyCompleteTitle,
    normalizeTriggerKey,
    preventTitleOverlaps,
    resolveLiteralCaptionText,
    resolveTitleColors,
    rotatingTitleTypeIndex,
    selectTitlesForSemanticCoverage,
    semanticCoverageForTitles,
    semanticRolesForTitle,
    titleTypeWordCapacity,
    triggerMapWithAliases,
    type BrandPaletteInput,
} from '../services/titleGenerationRules';
import {
    AUTOMATIC_TITLES_FALLBACK_WARNING,
    AUTOMATIC_TITLES_UNAVAILABLE_WARNING,
    isTransientTitleGenerationError,
    logTitleGenerationDiagnostic,
    runResilientTitleGeneration,
    titleGenerationDiagnostic,
} from '../services/titleGenerationResilience';
import { storeAiGeneratedMedia } from './fileExplorerController';

const titleExtractionPrompt = (config: TitleGeneratorConfig) => {
    const enabled = config.triggers.filter((trigger) => trigger.enabled);
    const triggerRules = enabled.map((trigger) => {
        const examples = trigger.examples.length ? ` Exemplos de referência: ${trigger.examples.join(' | ')}.` : '';
        return `- kind "${trigger.id}" (${trigger.name}), no máximo ${trigger.maxOccurrences}. Prefira até ${trigger.maxWords} palavras por título: ${trigger.instructions}${examples}`;
    }).join('\n');
    const kinds = enabled.map((trigger) => `"${trigger.id}"`).join(', ');
    return `Você é um diretor criativo sênior especializado em títulos de retenção para vídeos curtos.

Objetivo da agencia:
${config.extractionPrompt}

Gatilhos permitidos:
${triggerRules}

Processo de análise obrigatório:
1. Leia a narração inteira e identifique todos os fatos comerciais explícitos antes de escolher títulos.
2. Classifique apenas os fatos que correspondem aos gatilhos permitidos.
3. Confira cada frase nas legendas temporizadas e devolva somente sequências literais e contínuas.
4. Revise a lista final: preço, região, benefício, produto, diferencial, público e CTA explícitos não podem ser omitidos se o respectivo gatilho estiver ativo.

Regras obrigatórias:
1. Para cada fato, separe SOURCE TEXT de DISPLAY TEXT.
2. sourceText é uma sequência literal e contínua das legendas. Ela serve para comprovar o fato e localizar seu tempo. Nunca invente, resuma ou parafraseie sourceText.
3. displayText é a etiqueta visual curta: mantenha apenas o núcleo que uma pessoa reconhece em menos de um segundo.
4. Escreva um RÓTULO NOMINAL, não um pedaço de frase. Remova artigos, possessivos e verbos de locução sem valor visual: "O EXAME DE VISTA SAI POR CONTA" vira "EXAME DE VISTA"; "A SUA ARMAÇÃO SAI" vira "ARMAÇÃO".
5. Quando houver ação comercial seguida do objeto, preserve o conceito e não a instrução: "MONTE SEUS ÓCULOS DO SEU JEITO" pode gerar "ÓCULOS" como produto e "SEU JEITO" como diferencial. Nunca gere "ARMAÇÃO SAI", "O EXAME DE VISTA" ou outro fragmento de oração.
6. Em preço, displayText contém o valor completo: "A PARTIR DE R$ 39,90" vira "R$ 39,90". Nunca gere "A PARTIR DE" sozinho.
7. Em região, use somente a localidade: "ATENÇÃO, PIRACICABA" vira "PIRACICABA".
8. Em urgência, preserve a informação concreta: "SOMENTE ATÉ SÁBADO" pode virar "ATÉ SÁBADO"; "ÚLTIMAS 8 UNIDADES" permanece completa.
9. Em CTA, preserve verbo e destino: "CLIQUE NO BOTÃO" e "CHAME NO WHATSAPP". Não gere uma ação genérica.
10. O limite de palavras é uma preferência visual. Pode excedê-lo quando cortar destruir o sentido.
11. O startSec deve ser exatamente o tempo da primeira palavra de sourceText.
12. Use kind somente entre: ${kinds}.
13. Exemplos são referências, não uma lista fechada. Identifique outros fatos realmente pronunciados.
14. Respeite o máximo de ocorrências de cada gatilho e use ${config.maxTitles} como quantidade-base de títulos. Quando existirem na narração, a cobertura obrigatória de gancho, oferta/benefício e CTA pode acrescentar títulos além dessa base. Qualidade e cobertura dos fatos são mais importantes que preencher a quantidade.

Responda exclusivamente em JSON válido: {"titles":[{"sourceText":"trecho literal completo","displayText":"etiqueta curta","startSec":0.5,"kind":${kinds.split(', ')[0] || '"hook"'}}]}`;
};

const parseGatewayJson = (value: unknown) => {
    const raw = String(value || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try {
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
};

let titleGenerationSequence = 0;
const nextTitleGenerationSequence = () => {
    const current = titleGenerationSequence;
    titleGenerationSequence = (titleGenerationSequence + 1) % 100_000;
    return current;
};

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
    const { projectId, prompt, aspectRatio = '1:1', qualityPreset = 'standard', conversationId, conversationTitle } = req.body;

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
        const entry = await storeAiGeneratedMedia(Buffer.from(response.data), '.png', {
            conversationId: String(conversationId || projectId),
            conversationTitle: String(conversationTitle || 'Projeto atual'),
            prompt: String(prompt),
            provider: 'replicate',
            model,
        });

        res.json({
            ok: true,
            asset: {
                id: entry.id,
                type: 'image',
                path: entry.filePath,
                publicUrl: entry.publicUrl,
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
            const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
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
            const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
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
                const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
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
            const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
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
            const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
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
            const pId = String(projectId);
            const entry = await storeAiGeneratedMedia(Buffer.from(videoResponse.data), '.mp4', {
                conversationId: pId,
                conversationTitle: 'Projeto atual',
                provider: 'runway',
                model: 'runway-video',
            });

            res.json({
                status: 'SUCCEEDED',
                asset: {
                    id: entry.id,
                    type: 'video',
                    path: entry.filePath,
                    publicUrl: entry.publicUrl,
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

export const generateTitles = async (req: Request, res: Response) => {
    const {
        script,
        captions,
        format = '9:16',
        brandPalette = null,
        companyId = null,
        opsViewContextId = null,
        mode = 'ai',
    } = req.body;
    const token = bearerFrom(req);
    const requestId = String(req.headers['x-request-id'] || uuidv4()).slice(0, 80);
    let phase = 'validation';

    if (!script || !captions || !captions.segments) {
        return res.status(400).json({
            ok: false,
            code: 'title_input_invalid',
            message: 'A narração e as legendas temporizadas são obrigatórias.',
            phase,
            retryable: false,
            requestId,
        });
    }
    if (!token) {
        return res.status(401).json({
            ok: false,
            code: 'title_auth_expired',
            message: 'Sessão expirada. Entre novamente para gerar títulos.',
            phase,
            retryable: false,
            requestId,
        });
    }

    // Extract all words with their start times for the AI to reference
    const wordTimings = captions.segments
        .flatMap((seg: any) => (seg.words || []).flatMap((w: any) => {
            const start = Number(w.start);
            const text = String(w.text || '').trim();
            return Number.isFinite(start) && text ? [`[${start.toFixed(2)}s] ${text}`] : [];
        }))
        .join(' ');

    const fallbackSystemPrompt = `Você é diretor criativo especializado em títulos de retenção para vídeos curtos (Reels, TikTok e anúncios).
Sua missão é selecionar apenas os textos que realmente melhoram a atenção e a conversão do vídeo, sempre coerentes com a narração e com o instante em que aparecem.

Você receberá o roteiro e as legendas com o tempo de cada palavra. Não existe quantidade fixa de títulos: escolha somente os momentos que realmente merecem destaque. A quantidade deve seguir os gatilhos legítimos encontrados no vídeo; nunca invente frases, repita a mesma ideia ou preencha espaço sem motivo.

Critérios de escolha, em ordem de prioridade:
1. Gancho inicial, benefício concreto, preço/oferta, prova, quebra de padrão, urgência legítima e chamada para ação real.
2. Se o roteiro mencionar claramente uma cidade, bairro, região ou endereço, crie exatamente um título de conexão local usando esse nome, no instante em que ele for dito. Nunca invente localização e não repita a região em outros títulos.
   Exemplo obrigatório: em "Se você mora em Rio das Ostras, na Ótica Olá", o título local é "RIO DAS OSTRAS". "Ótica Olá" é a empresa e nunca deve ser classificada como localização.
3. Se houver uma CTA explícita (por exemplo: clique no botão, chame no WhatsApp, agende, compre, garanta, acesse, reserve ou venha), inclua no máximo um item com "kind": "cta" no momento dessa CTA. Quando houver mais de uma possibilidade, priorize a ação direta que informa o que o espectador deve fazer, como "clique no botão", em vez de uma frase genérica sobre a oferta. Use exatamente as palavras pronunciadas; nunca invente uma CTA que não exista no áudio.

Regras obrigatórias:
1. Cada título deve ter entre 1 e 6 palavras e ser uma sequência literal e contínua das palavras fornecidas nas legendas. Não resuma, não parafraseie e não invente texto.
2. Não use escassez, urgência, preço, bônus ou prova se a narração não os sustentar.
3. O startSec deve ser EXATAMENTE um dos tempos mapeados nas legendas.
4. Use durationSec 2 para todos os itens.
5. Use "kind" com um destes valores: "hook", "offer", "benefit", "local" ou "cta".

O usuário fornecerá as legendas no formato "[segundo] palavra".
Responda exclusivamente em JSON válido, nesta estrutura:
{
  "titles": [
    { "text": "Hook curto e direto", "startSec": 0.5, "durationSec": 2, "kind": "hook" }
  ]
}`;

    try {
        phase = 'company_palette';
        let effectiveBrandPalette: BrandPaletteInput = brandPalette;
        if (companyId) {
            const contextHeaders: Record<string, string> = opsViewContextId
                ? { 'X-Ops-View-Context': String(opsViewContextId) }
                : {};
            try {
                try {
                    const companyResponse = await gatewayJson<{ data?: { palette?: BrandPaletteInput } }>(
                        token,
                        `/v1/integrations/mileto-ops/companies/${encodeURIComponent(String(companyId))}`,
                        { headers: contextHeaders }
                    );
                    effectiveBrandPalette = companyResponse.data?.palette || null;
                } catch (error) {
                    if (!(error instanceof GatewayHttpError) || error.status !== 404) throw error;
                    // Compatibilidade com o gateway de produção anterior à rota de
                    // detalhe: refazemos a validação no servidor pela listagem delegada
                    // e pelo mesmo X-Ops-View-Context; não confiamos na paleta do body.
                    let cursor: string | null = null;
                    let delegatedCompany: { id?: string; kind?: string; palette?: BrandPaletteInput } | null = null;
                    for (let page = 0; page < 100 && !delegatedCompany; page += 1) {
                        const query = new URLSearchParams({ limit: '100' });
                        if (cursor) query.set('cursor', cursor);
                        const listing = await gatewayJson<{
                            data?: { id?: string; kind?: string; palette?: BrandPaletteInput }[];
                            meta?: { nextCursor?: string | null };
                        }>(token, `/v1/integrations/mileto-ops/companies?${query}`, { headers: contextHeaders });
                        delegatedCompany = (listing.data || []).find((company) =>
                            String(company.id || '') === String(companyId) && company.kind !== 'archive'
                        ) || null;
                        cursor = listing.meta?.nextCursor || null;
                        if (!cursor) break;
                    }
                    if (!delegatedCompany) {
                        throw new GatewayHttpError(404, 'A empresa não pertence ao contexto delegado do Mileto Ops.');
                    }
                    effectiveBrandPalette = delegatedCompany.palette || null;
                }
            } catch (error) {
                if (!isTransientTitleGenerationError(error)) throw error;
                const diagnostic = titleGenerationDiagnostic(error, phase, requestId);
                logTitleGenerationDiagnostic('company_palette_fallback', diagnostic);
                // A paleta do body não é confiável quando existe uma empresa do Ops.
                // Na indisponibilidade transitória usamos apenas o fallback visual seguro.
                effectiveBrandPalette = null;
            }
        }
        phase = 'configuration';
        let titleSettings: Awaited<ReturnType<typeof loadEffectiveTitleGeneratorConfig>>;
        try {
            titleSettings = await loadEffectiveTitleGeneratorConfig(token);
        } catch (error) {
            const diagnostic = titleGenerationDiagnostic(error, phase, requestId);
            logTitleGenerationDiagnostic('configuration_fallback', diagnostic);
            titleSettings = {
                config: structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG),
                source: 'compatibility-default',
            };
        }
        const titleConfig = titleSettings.config;
        const spokenWords = captions.segments.flatMap((segment: any) =>
            (segment.words || []).map((word: any) => ({
                text: String(word.text || '').trim(),
                start: Number(word.start),
            }))
        ).filter((word: { text: string; start: number }) => word.text && Number.isFinite(word.start));
        const timelineDurationSec = Math.max(
            0,
            ...captions.segments.map((segment: any) => Number(segment.end) || 0),
            ...spokenWords.map((word: { start: number }) => word.start + 0.25),
        );
        const enabledTriggers = titleConfig.triggers.filter((trigger) => trigger.enabled && trigger.titleTypes.length);
        const configuredLiteralCandidates = enabledTriggers.flatMap((trigger) =>
            [...trigger.examples, trigger.sample]
                .filter(Boolean)
                .map((candidate) => ({ text: candidate, kind: trigger.id }))
        );
        const deterministicCandidates = [
            ...deterministicCaptionTitleCandidates(spokenWords),
            ...deterministicTitleCandidates(script),
            ...configuredLiteralCandidates,
        ];
        const systemPrompt = titleConfig?.triggers?.some((trigger) => trigger.enabled)
            ? titleExtractionPrompt(titleConfig)
            : fallbackSystemPrompt;
        phase = mode === 'local' ? 'local_fallback' : 'ai';
        const resilientGeneration = await runResilientTitleGeneration<any>({
            skipPrimary: mode === 'local',
            maxAttempts: 3,
            phase: 'ai',
            requestId,
            primary: async () => {
                const result = await gatewayChat(token, {
                messages: [{
                    role: 'user',
                    content: `Narração final: ${script}\n\nLegendas temporizadas autorizadas para a saída literal: ${wordTimings}`,
                }],
                system: systemPrompt,
                json: true,
                model: titleConfig.ai.model,
                reasoning: titleConfig.ai.reasoning,
                maxOutputTokens: titleConfig.ai.maxOutputTokens,
                locale: 'pt-BR',
                });
                const parsed: any = parseGatewayJson(result.text);
                return Array.isArray(parsed) ? parsed : Array.isArray(parsed.titles) ? parsed.titles : [];
            },
            fallback: async () => deterministicCandidates,
        });
        if (resilientGeneration.diagnostic) {
            logTitleGenerationDiagnostic(
                resilientGeneration.source === 'local' ? 'ai_fallback_used' : 'generation_unavailable',
                resilientGeneration.diagnostic,
            );
        }
        const normalizeTitleWord = (value: unknown) => String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('pt-BR')
            .replace(/[^a-z0-9%]+/g, '');
        const seenTitlesByTrigger = new Map<string, string[]>();
        const occurrenceByTrigger = new Map<string, number>();
        const generationSequence = nextTitleGenerationSequence();
        let modelAssignmentIndex = 0;
        const triggerById = triggerMapWithAliases(enabledTriggers);
        const videoFormat = (['9:16', '16:9', '4:5', '1:1'].includes(String(format)) ? format : '9:16') as VideoFormat;
        const titleCandidates = resilientGeneration.source === 'ai'
            ? [
                ...deterministicCaptionTitleCandidates(spokenWords),
                ...deterministicTitleCandidates(script),
                ...resilientGeneration.items,
                ...configuredLiteralCandidates,
            ]
            : resilientGeneration.items;
        phase = 'formatting';

        // Format titles, snap them to a real spoken word, and reject duplicates.
        // The effective organization settings own style, size, position and color.
        const mappedTitleCandidates = titleCandidates.map((title: any) => {
                const trigger = triggerById.get(normalizeTriggerKey(title?.kind));
                const sourceCandidate = title?.sourceText || title?.text;
                const literal = trigger
                    ? resolveLiteralCaptionText(spokenWords, sourceCandidate, title?.startSec, trigger.id)
                    : null;
                const compact = trigger && literal
                    ? compactTitleDisplayText(literal.text, trigger.id, trigger.maxWords)
                    : null;
                return {
                    trigger,
                    literal,
                    compact,
                };
            });
        // Evidência semântica é medida antes dos limites visuais, duplicatas e
        // sobreposições. Assim, um CTA comprovado na narração continua sendo
        // obrigatório mesmo se um candidato posterior for descartado.
        const semanticEvidence = mappedTitleCandidates.flatMap(({ trigger, literal }: any) => {
            if (!trigger || !literal) return [];
            const semanticRoles = semanticRolesForTitle(trigger.id, literal.startSec, timelineDurationSec);
            return semanticRoles.length ? [{
                startSec: literal.startSec,
                durationSec: 1,
                triggerId: trigger.id,
                semanticRoles,
            }] : [];
        });
        const generatedTitles = mappedTitleCandidates
            .filter(({ trigger, literal, compact }: any) => {
                const key = normalizeTitleWord(compact?.text);
                if (!trigger || !literal || !compact || !key) return false;
                const triggerId = normalizeTriggerKey(trigger.id);
                const seen = seenTitlesByTrigger.get(triggerId) || [];
                if (seen.some((existing) => existing.includes(key) || key.includes(existing))) return false;
                seenTitlesByTrigger.set(triggerId, [...seen, key]);
                return true;
            })
            .flatMap(({ trigger, literal, compact }: any) => {
                if (!trigger || !literal || !compact) return [];
                const triggerId = normalizeTriggerKey(trigger.id);
                const occurrence = occurrenceByTrigger.get(triggerId) || 0;
                if (occurrence >= trigger.maxOccurrences) return [];
                const fittedText = compact.text.slice(0, 90);
                if (!isSemanticallyCompleteTitle(fittedText)) return [];
                const displayLiteral = resolveLiteralCaptionText(
                    spokenWords,
                    fittedText,
                    literal.startSec,
                    trigger.id
                );
                const titleType = trigger.titleTypes[rotatingTitleTypeIndex(
                    trigger.titleTypes.length,
                    generationSequence,
                    modelAssignmentIndex
                )];
                modelAssignmentIndex += 1;
                const visualMaxWords = Math.min(
                    trigger.maxWords,
                    titleTypeWordCapacity(titleType.styleId, titleType.maxWords)
                );
                const visualCompact = compactTitleDisplayText(literal.text, trigger.id, visualMaxWords);
                if (!visualCompact) return [];
                const visualText = visualCompact.text.slice(0, 90);
                if (!isSemanticallyCompleteTitle(visualText)) return [];
                const visualLiteral = resolveLiteralCaptionText(
                    spokenWords,
                    visualText,
                    literal.startSec,
                    trigger.id
                );
                occurrenceByTrigger.set(triggerId, occurrence + 1);
                const layout = titleType.layouts[videoFormat] || titleType.layouts['9:16'];
                const colors = resolveTitleColors(titleType.color || trigger.color, effectiveBrandPalette, occurrence);
                const resolvedStartSec = visualLiteral?.startSec ?? displayLiteral?.startSec ?? literal.startSec;
                const semanticRoles = semanticRolesForTitle(trigger.id, resolvedStartSec, timelineDurationSec);
                return [{
                    id: uuidv4(),
                    text: visualText,
                    sourceText: visualCompact.sourceText,
                    qualifierText: visualCompact.qualifierText,
                    triggerId: trigger.id,
                    semanticRoles,
                    startSec: resolvedStartSec,
                    durationSec: titleType.durationSec,
                    isActive: true,
                    posX: layout.posX,
                    posY: layout.posY,
                    scale: layout.scale,
                    scaleX: layout.scaleX,
                    scaleY: layout.scaleY,
                    textBoxWidthPct: layout.textBoxWidthPct,
                    maxWords: visualMaxWords,
                    styleId: titleType.styleId,
                    fontFamily: titleType.fontFamily,
                    animationId: titleType.animationId,
                    ...colors,
                }];
            });

        const timelineCandidates = fitTitlesToTimeline(generatedTitles, timelineDurationSec);
        const semanticSelection = selectTitlesForSemanticCoverage(timelineCandidates, titleConfig.maxTitles);
        const finalTitles = fitTitlesToTimeline(
            preventTitleOverlaps(semanticSelection.titles),
            timelineDurationSec,
        );
        const semanticCoverage = semanticCoverageForTitles(semanticEvidence, finalTitles);
        const semanticRoleLabels = {
            hook: 'gancho',
            offer_or_benefit: 'oferta ou benefício',
            cta: 'CTA',
        } as const;
        const semanticWarning = semanticCoverage.missing.length
            ? `Cobertura de títulos incompleta: ${semanticCoverage.missing.map((role) => semanticRoleLabels[role]).join(', ')}.`
            : undefined;
        const fallbackWarning = finalTitles.length && resilientGeneration.source === 'local'
            ? AUTOMATIC_TITLES_FALLBACK_WARNING
            : undefined;
        const warning = finalTitles.length
            ? [fallbackWarning, semanticWarning].filter(Boolean).join(' ') || undefined
            : AUTOMATIC_TITLES_UNAVAILABLE_WARNING;
        const warnings = [
            ...(fallbackWarning ? [{
                code: 'title_fallback_used',
                message: fallbackWarning,
            }] : []),
            ...(semanticCoverage.missing.length ? [{
                code: 'title_semantic_coverage_missing',
                message: semanticWarning,
                missingRoles: semanticCoverage.missing,
            }] : []),
            ...(!finalTitles.length ? [{
                code: 'automatic_titles_unavailable',
                message: AUTOMATIC_TITLES_UNAVAILABLE_WARNING,
            }] : []),
        ];
        const metrics = {
            rawCandidateCount: titleCandidates.length,
            formattedCandidateCount: generatedTitles.length,
            inTimelineCandidateCount: timelineCandidates.length,
            acceptedCount: finalTitles.length,
            droppedOutOfBoundsOrInvisible: generatedTitles.length - timelineCandidates.length,
            droppedByCoverageLimitOrOverlap: Math.max(0, timelineCandidates.length - finalTitles.length),
        };

        res.json({
            ok: true,
            titles: finalTitles,
            configSource: titleSettings.source,
            source: finalTitles.length ? resilientGeneration.source : 'none',
            attempts: resilientGeneration.attempts,
            timelineDurationSec,
            semanticCoverage,
            metrics,
            ...(warnings.length ? { warnings } : {}),
            ...(warning ? { warning } : {}),
            ...(resilientGeneration.diagnostic ? { diagnostic: resilientGeneration.diagnostic } : {}),
        });
    } catch (error: unknown) {
        const diagnostic = titleGenerationDiagnostic(error, phase, requestId);
        logTitleGenerationDiagnostic('request_failed', diagnostic);
        const responseStatus = diagnostic.status >= 400 && diagnostic.status <= 599
            ? diagnostic.status
            : 500;
        res.status(responseStatus).json({ ok: false, ...diagnostic });
    }
};
