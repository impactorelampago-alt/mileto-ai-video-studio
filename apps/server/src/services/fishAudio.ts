import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { VoiceSettings, clamp, isFishModel, DEFAULT_FISH_MODEL } from './ttsTypes';

// Use persistent data path for bundled production stability
const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const NARRATION_DIR = path.join(BASE_DATA_PATH, 'narrations');
const NARRATION_CACHE_VERSION = 'spoken-numbers-v2';

if (!fs.existsSync(NARRATION_DIR)) fs.mkdirSync(NARRATION_DIR, { recursive: true });

export const getAudioDuration = (filePath: string): Promise<number> => {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return resolve(0);
            resolve(metadata.format.duration || 0);
        });
    });
};

/**
 * A doc da Fish define speed 0.5–2.0 e volume em dB, mas não diz se o speed é
 * controle no modelo ou reamostragem — a qualidade nos extremos é indocumentada.
 * Por isso limitamos aqui também, e não só no slider da UI.
 */
const buildProsody = (settings?: VoiceSettings) => {
    const speed = clamp(settings?.speed ?? 1, 0.5, 2);
    const volume = clamp(settings?.volume ?? 0, -20, 20);
    if (speed === 1 && volume === 0) return null; // nada a ajustar → payload original
    return { speed, volume };
};

export const generateNarration = async (
    voiceId: string,
    text: string,
    apiKey: string,
    settings?: VoiceSettings
) => {
    if (!apiKey) throw new Error('Fish Audio API Key is required');

    // Process text for API call first (do not append extra dots to avoid repetition)
    const finalPayloadText = text.trim();
    const prosody = buildProsody(settings);

    const model = isFishModel(settings?.fishModel) ? settings.fishModel : DEFAULT_FISH_MODEL;

    // Generate hash from processed text to ensure consistency.
    // Prosódia E modelo ENTRAM na chave: sem isso, mexer nos sliders ou trocar de
    // modelo devolveria o áudio antigo do cache.
    const cacheSuffix = `${prosody ? `-s${prosody.speed}-v${prosody.volume}` : ''}-m${model}`;
    const hash = crypto
        .createHash('md5')
        .update(`${NARRATION_CACHE_VERSION}-${voiceId}-${finalPayloadText}${cacheSuffix}`)
        .digest('hex');
    const fileName = `narration-${hash}.mp3`;
    let filePath = path.join(NARRATION_DIR, fileName);

    // Bypass API call for the default narration to save credits
    // Normalize text to ignore spacing, newlines, and case differences
    const normalizedText = text.toLowerCase().replace(/[\s\W_]+/g, '');
    const isDefault = normalizedText.includes('atençãoatenção') && normalizedText.includes('óticavivaz');

    // Só reaproveita o áudio pré-gravado se o usuário não pediu nenhum ajuste de voz.
    if (isDefault && !prosody && voiceId === '3cd37df623144626b4c9d12e22dbe898') {
        console.log('[FishAudio] Default narration detected. Bypassing API to save credits.');
        const defaultFilePath = path.join(NARRATION_DIR, 'default-narration.mp3');

        // If not in AppData, try to copy from the packaged app directory
        if (!fs.existsSync(defaultFilePath)) {
            const bundledPathProd = path.join(__dirname, 'public', 'narrations', 'default-narration.mp3');
            const bundledPathDev = path.join(__dirname, '..', 'public', 'narrations', 'default-narration.mp3');
            const bundledPath = fs.existsSync(bundledPathProd) ? bundledPathProd : bundledPathDev;

            if (fs.existsSync(bundledPath)) {
                fs.copyFileSync(bundledPath, defaultFilePath);
            }
        }

        if (fs.existsSync(defaultFilePath)) {
            const duration = await getAudioDuration(defaultFilePath);
            return { url: `/narrations/default-narration.mp3`, path: defaultFilePath, duration };
        } else {
            console.warn('[FishAudio] Warning: bundled default narration not found, falling back to API.');
            filePath = defaultFilePath;
        }
    }

    if (!fs.existsSync(filePath)) {
        console.log(`[FishAudio] Generating TTS (${model}) for: "${text.substring(0, 30)}..."`);

        const response = await fetch('https://api.fish.audio/v1/tts', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                // O modelo vai no header, não no corpo. É o que habilita a
                // sintaxe [bracket] de emoção do S2.
                model,
            },
            body: JSON.stringify({
                text: finalPayloadText,
                reference_id: voiceId, // Fish Audio uses reference_id or voice_id depending on docs, usually reference_id for cloned/presets
                format: 'mp3',
                mp3_bitrate: 128,
                ...(prosody ? { prosody } : {}),
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Fish Audio API Error: ${response.status} - ${errorText}`);
        }

        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));
    }

    const duration = await getAudioDuration(filePath);
    return { url: `/narrations/${fileName}`, path: filePath, duration };
};

/**
 * Saldo de crédito de API da conta dona da chave.
 *
 * Existe por um motivo concreto: uma chave pode autenticar com sucesso e mesmo
 * assim dar 402, porque pertence a OUTRA conta que não a que o usuário vê no
 * navegador. Mostrar o saldo e o id da conta ao lado da chave torna isso óbvio
 * em vez de virar meia hora de investigação.
 */
export const getApiCredit = async (apiKey: string) => {
    const response = await fetch('https://api.fish.audio/wallet/self/api-credit', {
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { credit?: string; user_id?: string };
    const credit = Number(data.credit);

    return {
        credit: Number.isFinite(credit) ? credit : null,
        // Só um prefixo: o bastante para distinguir contas, sem despejar o id inteiro.
        accountId: data.user_id ? data.user_id.slice(0, 8) : null,
    };
};

export const testApiKey = async (apiKey: string) => {
    try {
        // Use the /model endpoint (no v1) as discovered for testing
        const response = await fetch('https://api.fish.audio/model', {
            headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[FishAudio Test] Error:', response.status, errorText);
            return false;
        }
        return true;
    } catch (error) {
        console.error('[FishAudio Test] Exception:', error);
        return false;
    }
};

export const createModel = async (
    name: string,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    apiKey: string
) => {
    if (!apiKey) throw new Error('Fish Audio API Key is required');

    try {
        const formData = new FormData();
        formData.append('title', name);
        formData.append('type', 'tts');
        formData.append('visibility', 'unlist');
        formData.append('train_mode', 'fast');

        formData.append('voices', fileBuffer, { filename: fileName, contentType: mimeType });

        console.log(`[FishAudio] Creating Custom Voice Model: ${name}`);

        const response = await fetch('https://api.fish.audio/model', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                ...formData.getHeaders(),
            },
            body: formData as any,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Fish Audio API /model Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data; // returns the model metadata { _id: "...", title: "..." }
    } catch (error: any) {
        console.error('[FishAudio Clone] Exception:', error.message);
        throw error;
    }
};
