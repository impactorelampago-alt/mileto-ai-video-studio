import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import fetch from 'node-fetch';
import ffmpeg from 'fluent-ffmpeg';
import { VoiceSettings, clamp } from './ttsTypes';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const AUDIO_CACHE_DIR = path.join(BASE_DATA_PATH, 'voice_samples');
const NARRATION_DIR = path.join(BASE_DATA_PATH, 'narrations');

// Ensure directories exist
if (!fs.existsSync(AUDIO_CACHE_DIR)) fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
if (!fs.existsSync(NARRATION_DIR)) fs.mkdirSync(NARRATION_DIR, { recursive: true });

export const getAudioDuration = (filePath: string): Promise<number> => {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return resolve(0); // If ffprobe fails (maybe missing bin), return 0 to not block flow
            resolve(metadata.format.duration || 0);
        });
    });
};

export interface RemoteVoice {
    id: string;
    name: string;
    description: string;
}

/**
 * Lista as vozes disponíveis na conta ElevenLabs (premade + clonadas).
 * Sem isso o usuário precisaria descobrir o voice_id na mão no site deles.
 */
export const listVoices = async (apiKey: string): Promise<RemoteVoice[]> => {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
    });

    if (!response.ok) {
        throw new Error(`ElevenLabs API Error: ${response.status} - ${await response.text()}`);
    }

    const data = (await response.json()) as {
        voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string> }[];
    };

    return (data.voices || []).map((v) => {
        const labels = Object.values(v.labels || {}).filter(Boolean);
        return {
            id: v.voice_id,
            name: v.name,
            description: labels.length ? labels.join(' · ') : v.category || 'ElevenLabs',
        };
    });
};

export const testApiKey = async (apiKey: string) => {
    try {
        const response = await fetch('https://api.elevenlabs.io/v1/user', {
            headers: { 'xi-api-key': apiKey },
        });
        if (!response.ok) {
            console.error('[ElevenLabs Test] Error:', response.status, await response.text());
            return false;
        }
        return true;
    } catch (error) {
        console.error('[ElevenLabs Test] Exception:', error);
        return false;
    }
};

export const generatePreview = async (voiceId: string, text: string, apiKey: string) => {
    if (!apiKey) throw new Error('API Key is required');

    // Create a deterministic filename based on voice and text
    const hash = crypto.createHash('md5').update(`${voiceId}-${text}`).digest('hex');
    const fileName = `preview-${hash}.mp3`;
    const filePath = path.join(AUDIO_CACHE_DIR, fileName);

    // Serve cached file if exists
    if (fs.existsSync(filePath)) {
        return { url: `/voice_samples/${fileName}`, path: filePath };
    }

    // Call ElevenLabs API
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ElevenLabs API Error: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    return { url: `/voice_samples/${fileName}`, path: filePath };
};

/**
 * ATENÇÃO: `stability` é INVERTIDO. A doc da ElevenLabs diz, literalmente, que
 * valores altos produzem "a monotonous voice with limited emotion" — ou seja,
 * quanto MENOR, mais emoção. O 0.5 antigo era o default neutro do fornecedor,
 * nunca uma escolha de narração animada.
 *
 * Preset de anúncio (recomendação oficial "Conversational"): stability 0.40,
 * similarity_boost 0.75.
 */
const ELEVEN_DEFAULTS = { stability: 0.4, similarityBoost: 0.75, speed: 1 };

const buildVoiceSettings = (settings?: VoiceSettings) => ({
    stability: clamp(settings?.stability ?? ELEVEN_DEFAULTS.stability, 0, 1),
    similarity_boost: clamp(settings?.similarityBoost ?? ELEVEN_DEFAULTS.similarityBoost, 0, 1),
    speed: clamp(settings?.speed ?? ELEVEN_DEFAULTS.speed, 0.25, 4),
});

export const generateNarration = async (
    voiceId: string,
    text: string,
    apiKey: string,
    settings?: VoiceSettings
) => {
    if (!apiKey) throw new Error('API Key is required');

    const voiceSettings = buildVoiceSettings(settings);

    // Os ajustes ENTRAM na chave do cache: sem isso, mexer nos sliders devolveria o áudio antigo.
    const cacheSuffix = `-st${voiceSettings.stability}-sim${voiceSettings.similarity_boost}-sp${voiceSettings.speed}`;
    const hash = crypto.createHash('md5').update(`${voiceId}-${text}-full${cacheSuffix}`).digest('hex');
    const fileName = `narration-${hash}.mp3`;
    const filePath = path.join(NARRATION_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        console.log(`[ElevenLabs] Generating TTS for: "${text.substring(0, 30)}..."`);

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                // multilingual_v2 suporta pt-BR oficialmente (29 idiomas) e aceita até
                // 10.000 caracteres. Não aceita `language_code` — o sotaque brasileiro
                // vem da VOZ escolhida, não de um parâmetro.
                model_id: 'eleven_multilingual_v2',
                voice_settings: voiceSettings,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ElevenLabs API Error: ${response.status} - ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
    }

    const duration = await getAudioDuration(filePath);
    return { url: `/narrations/${fileName}`, path: filePath, duration };
};
