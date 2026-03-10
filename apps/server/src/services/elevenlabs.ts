import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import fetch from 'node-fetch';
import ffmpeg from 'fluent-ffmpeg';

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

export const generateNarration = async (voiceId: string, text: string, apiKey: string) => {
    if (!apiKey) throw new Error('API Key is required');

    const hash = crypto.createHash('md5').update(`${voiceId}-${text}-full`).digest('hex');
    const fileName = `narration-${hash}.mp3`;
    const filePath = path.join(NARRATION_DIR, fileName);

    if (!fs.existsSync(filePath)) {
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
    }

    const duration = await getAudioDuration(filePath);
    return { url: `/narrations/${fileName}`, path: filePath, duration };
};
