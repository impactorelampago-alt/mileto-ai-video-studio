import { Request, Response } from 'express';
import fs from 'fs';
import { generateNarration } from '../services/fishAudio';

export const previewVoice = async (req: Request, res: Response) => {
    try {
        const { voiceId, text, apiKey } = req.body;
        console.log(`[TTS] Preview requested for voice ${voiceId}`);

        if (!voiceId || !text || !apiKey) {
            return res.status(400).json({ ok: false, message: 'Missing parameters (voiceId, text, apiKey)' });
        }

        const result = await generateNarration(voiceId, text, apiKey);
        res.json({ ok: true, ...result });
    } catch (error: any) {
        console.error('[TTS] Preview error:', error.message);
        res.status(500).json({ ok: false, message: error.message });
    }
};

export const createNarration = async (req: Request, res: Response) => {
    try {
        const { voiceId, text, apiKey } = req.body;
        console.log(`[TTS] Narration requested for voice ${voiceId}`);

        if (!voiceId || !text || !apiKey) {
            return res.status(400).json({ ok: false, message: 'Missing parameters (voiceId, text, apiKey)' });
        }

        const result = await generateNarration(voiceId, text, apiKey);
        res.json({ ok: true, ...result });
    } catch (error: any) {
        console.error('[TTS] Narration error:', error.message);
        res.status(500).json({ ok: false, message: error.message });
    }
};

import { createModel } from '../services/fishAudio';

export const cloneVoice = async (req: Request, res: Response) => {
    try {
        const apiKey = req.body.apiKey;
        const voiceName = req.body.voiceName || 'Cloned Voice';

        if (!apiKey) {
            return res.status(400).json({ ok: false, message: 'Fish Audio API Key is required.' });
        }

        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'No audio file uploaded.' });
        }

        let fileBuffer: Buffer;
        if (req.file.buffer) {
            fileBuffer = req.file.buffer;
        } else if (req.file.path) {
            fileBuffer = fs.readFileSync(req.file.path);
        } else {
            return res.status(400).json({ ok: false, message: 'File payload is empty.' });
        }

        const fileName = req.file.originalname || 'audio.mp3';
        const mimeType = req.file.mimetype || 'audio/mpeg';

        console.log(`[TTS] Clone Voice requested: ${voiceName} (${fileName}, ${mimeType})`);

        const modelData = await createModel(voiceName, fileBuffer, fileName, mimeType, apiKey);

        if (req.file.path) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('[TTS] Could not delete temp file:', err);
            });
        }

        res.json({
            ok: true,
            message: 'Voice cloned successfully',
            modelId: modelData._id,
            modelTitle: modelData.title,
        });
    } catch (error: any) {
        console.error('[TTS] Voice Clone error:', error);
        res.status(500).json({ ok: false, message: error.message || 'Error cloning voice' });
    }
};
