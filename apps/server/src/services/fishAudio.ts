import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import fetch from 'node-fetch';
import FormData from 'form-data';

// Use persistent data path for bundled production stability
const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const NARRATION_DIR = path.join(BASE_DATA_PATH, 'narrations');

if (!fs.existsSync(NARRATION_DIR)) fs.mkdirSync(NARRATION_DIR, { recursive: true });

export const getAudioDuration = (filePath: string): Promise<number> => {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return resolve(0);
            resolve(metadata.format.duration || 0);
        });
    });
};

export const generateNarration = async (voiceId: string, text: string, apiKey: string) => {
    if (!apiKey) throw new Error('Fish Audio API Key is required');

    // Process text for API call first (do not append extra dots to avoid repetition)
    const finalPayloadText = text.trim();

    // Generate hash from processed text to ensure consistency
    const hash = crypto.createHash('md5').update(`${voiceId}-${finalPayloadText}`).digest('hex');
    const fileName = `narration-${hash}.mp3`;
    let filePath = path.join(NARRATION_DIR, fileName);

    // Bypass API call for the default narration to save credits
    // Normalize text to ignore spacing, newlines, and case differences
    const normalizedText = text.toLowerCase().replace(/[\s\W_]+/g, '');
    const isDefault = normalizedText.includes('atençãoatenção') && normalizedText.includes('óticavivaz');

    if (isDefault && voiceId === '3cd37df623144626b4c9d12e22dbe898') {
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
        console.log(`[FishAudio] Generating TTS for: "${text.substring(0, 30)}..."`);

        const response = await fetch('https://api.fish.audio/v1/tts', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: finalPayloadText,
                reference_id: voiceId, // Fish Audio uses reference_id or voice_id depending on docs, usually reference_id for cloned/presets
                format: 'mp3',
                mp3_bitrate: 128,
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
