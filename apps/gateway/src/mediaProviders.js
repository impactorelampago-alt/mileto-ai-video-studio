import { Readable } from 'node:stream';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const SEEDANCE_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,159}$/i;

const providerError = (provider, status, data) => {
    const message =
        data?.error?.message || data?.error?.message || data?.message || `Falha no provedor (${status}).`;
    const error = new Error(String(message).slice(0, 500));
    error.status = status;
    error.provider = provider;
    return error;
};

const fetchJson = async (provider, url, init, timeoutMs) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { message: text.slice(0, 500) };
    }
    if (!response.ok) throw providerError(provider, response.status, data);
    return data;
};

const cleanModel = (model) => {
    const value = String(model || '').trim();
    if (!MODEL_ID.test(value)) throw new Error('ID de modelo de produção inválido.');
    return value;
};

const cleanPrompt = (prompt, max = 12000) => {
    const value = String(prompt || '').trim();
    if (!value) throw new Error('Prompt de produção vazio.');
    return value.slice(0, max);
};

const cleanRatio = (value, fallback = '9:16') => {
    const ratio = String(value || fallback).trim();
    return ['1:1', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'adaptive'].includes(ratio)
        ? ratio
        : fallback;
};

export const generateGeminiImage = async ({ key, model, prompt, aspectRatio = '1:1', imageSize = '1K' }) => {
    if (!key) throw new Error('Chave Gemini não configurada.');
    const modelId = cleanModel(model);
    const ratio = cleanRatio(aspectRatio, '1:1');
    const size = ['512', '1K', '2K', '4K'].includes(String(imageSize).toUpperCase())
        ? String(imageSize).toUpperCase()
        : '1K';
    const data = await fetchJson(
        'gemini',
        `${GEMINI_BASE}/${encodeURIComponent(modelId)}:generateContent`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
                contents: [{ parts: [{ text: cleanPrompt(prompt) }] }],
                generationConfig: {
                    responseModalities: ['IMAGE'],
                    responseFormat: { image: { aspectRatio: ratio, imageSize: size } },
                },
            }),
        },
        180000
    );
    const parts = data?.candidates?.flatMap((candidate) => candidate?.content?.parts || []) || [];
    const image = parts.find((part) => (part.inlineData || part.inline_data)?.data && !part.thought);
    const inline = image?.inlineData || image?.inline_data;
    if (!inline?.data) throw new Error('O Gemini não devolveu uma imagem final.');
    const bytes = Buffer.from(inline.data, 'base64');
    if (!bytes.length || bytes.length > 40 * 1024 * 1024) throw new Error('Imagem devolvida pelo Gemini é inválida.');
    return {
        bytes,
        mimeType: String(inline.mimeType || inline.mime_type || 'image/png').slice(0, 100),
        usageUnits: Number(data?.usageMetadata?.totalTokenCount || data?.usage_metadata?.total_token_count || 1),
    };
};

export const createSeedanceVideo = async ({
    key,
    model,
    prompt,
    aspectRatio = '9:16',
    durationSec = 5,
    resolution = '720p',
}) => {
    if (!key) throw new Error('Chave Seedance não configurada.');
    const duration = Math.max(2, Math.min(12, Math.round(Number(durationSec) || 5)));
    const ratio = cleanRatio(aspectRatio, '9:16');
    const safeResolution = ['480p', '720p', '1080p'].includes(String(resolution)) ? String(resolution) : '720p';
    const data = await fetchJson(
        'seedance',
        `${SEEDANCE_BASE}/contents/generations/tasks`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model: cleanModel(model),
                content: [{ type: 'text', text: cleanPrompt(prompt, 8000) }],
                generate_audio: false,
                ratio,
                duration,
                resolution: safeResolution,
                watermark: false,
            }),
        },
        60000
    );
    const taskId = String(data?.id || '').trim();
    if (!taskId || taskId.length > 300) throw new Error('O Seedance não devolveu um identificador de tarefa.');
    return { taskId };
};

export const getSeedanceVideo = async ({ key, taskId }) => {
    if (!key) throw new Error('Chave Seedance não configurada.');
    const id = String(taskId || '').trim();
    if (!/^[a-z0-9._-]{3,300}$/i.test(id)) throw new Error('Tarefa Seedance inválida.');
    const data = await fetchJson(
        'seedance',
        `${SEEDANCE_BASE}/contents/generations/tasks/${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } },
        30000
    );
    const status = String(data?.status || 'running').toLowerCase();
    const providerStatus = ['queued', 'running', 'succeeded', 'failed', 'expired'].includes(status) ? status : 'running';
    return {
        status: providerStatus,
        videoUrl: providerStatus === 'succeeded' ? String(data?.content?.video_url || '').trim() : '',
        usageUnits: Number(data?.usage?.completion_tokens || data?.usage?.total_tokens || 1),
        errorCode: String(data?.error?.code || '').slice(0, 100),
        errorMessage: String(data?.error?.message || '').slice(0, 500),
    };
};

const isAllowedProviderMediaUrl = (value) => {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:') return false;
        const host = url.hostname.toLowerCase();
        return host.endsWith('.volces.com') || host.endsWith('.bytepluses.com') || host.endsWith('.byteplus.com');
    } catch {
        return false;
    }
};

export const fetchProviderMedia = async (url, redirectCount = 0) => {
    if (redirectCount > 3) throw new Error('O provedor excedeu o limite de redirecionamentos de mídia.');
    if (!isAllowedProviderMediaUrl(url)) throw new Error('Destino de mídia do provedor não autorizado.');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(180000) });
    if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirecionamento de mídia sem destino.');
        const next = new URL(location, url).toString();
        if (!isAllowedProviderMediaUrl(next)) throw new Error('Redirecionamento de mídia não autorizado.');
        return fetchProviderMedia(next, redirectCount + 1);
    }
    if (!response.ok || !response.body) throw new Error(`Não foi possível obter a mídia gerada (${response.status}).`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 1024 * 1024 * 1024) throw new Error('Vídeo gerado ultrapassa o limite de 1 GB.');
    return {
        body: Readable.fromWeb(response.body),
        mimeType: String(response.headers.get('content-type') || 'video/mp4').split(';')[0],
        length: Number.isFinite(length) && length > 0 ? length : null,
    };
};
