import { Request, Response } from 'express';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
const AUDIO_MIXES_DIR = path.join(BASE_DATA_PATH, 'public/mixes');

if (!fs.existsSync(AUDIO_MIXES_DIR)) {
    fs.mkdirSync(AUDIO_MIXES_DIR, { recursive: true });
}

export const mixAudio = async (req: Request, res: Response) => {
    try {
        const { narrationUrl, musicUrl, audioConfig } = req.body;

        if (!narrationUrl && !musicUrl) {
            return res.status(400).json({ ok: false, message: 'Nenhum áudio fornecido para mixagem.' });
        }

        // Parse volumes from frontend config
        const narrationVol = audioConfig?.narration?.enabled ? (audioConfig.narration.volume ?? 1) : 0;
        const musicVol = audioConfig?.background?.enabled ? (audioConfig.background.volume ?? 0.2) : 0;

        // Resolving physical paths for ffmpeg to read
        // URLs come as http://localhost:3301/narrations/xxx.mp3 — extract just the pathname
        const resolveAudioPath = (url: string): string => {
            if (!url) return '';
            if (url.startsWith('http')) {
                const pathname = new URL(url, 'http://localhost').pathname; // e.g. /narrations/xxx.mp3
                return path.join(BASE_DATA_PATH, pathname);
            }
            // Relative URL like /narrations/xxx.mp3
            return path.join(BASE_DATA_PATH, url);
        };

        const narrationPath = resolveAudioPath(narrationUrl);
        const musicPath = resolveAudioPath(musicUrl);

        // Hash inputs to cache the mix
        const hashStr = `${narrationUrl}-${musicUrl}-${narrationVol}-${musicVol}`;
        const hash = crypto.createHash('md5').update(hashStr).digest('hex');
        const outputFileName = `mix-${hash}.mp3`;
        const outputPath = path.join(AUDIO_MIXES_DIR, outputFileName);
        const publicUrl = `/mixes/${outputFileName}`;

        // Return cached mix if exists
        if (fs.existsSync(outputPath)) {
            return res.json({ ok: true, masterAudioUrl: publicUrl });
        }

        const command = ffmpeg();
        let inputCount = 0;

        if (narrationPath && fs.existsSync(narrationPath) && narrationVol > 0) {
            command.input(narrationPath);
            inputCount++;
        }

        if (musicPath && fs.existsSync(musicPath) && musicVol > 0) {
            command.input(musicPath);
            inputCount++;
        }

        console.log(`[Audio Mix Debug]`);
        console.log(`- narrationUrl: ${narrationUrl}`);
        console.log(`- narrationPath: ${narrationPath}`);
        console.log(`- exists? ${narrationPath ? fs.existsSync(narrationPath) : false}`);
        console.log(`- narrationVol: ${narrationVol}`);
        console.log(`- musicUrl: ${musicUrl}`);
        console.log(`- musicPath: ${musicPath}`);
        console.log(`- exists? ${musicPath ? fs.existsSync(musicPath) : false}`);
        console.log(`- musicVol: ${musicVol}`);
        console.log(`-> inputCount: ${inputCount}`);

        if (inputCount === 0) {
            return res.json({ ok: true, masterAudioUrl: null });
        }

        if (inputCount === 1) {
            // Se tem só um válido, o input já foi adicionado
            const singleVol = narrationPath && narrationVol > 0 ? narrationVol : musicVol;

            await new Promise<void>((resolve, reject) => {
                command
                    .audioFilters(`volume=${singleVol}`)
                    .save(outputPath)
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err));
            });

            return res.json({ ok: true, masterAudioUrl: publicUrl });
        }

        // Se tem dois, aplica amix
        // A duração do master será a duração da narração (shortest)
        // O amix por padrão pode misturar as durações, então usamos duration=shortest
        await new Promise<void>((resolve, reject) => {
            command
                .complexFilter([
                    `[0:a]volume=${narrationVol}[a0]`,
                    `[1:a]volume=${musicVol}[a1]`,
                    `[a0][a1]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`,
                ])
                .map('[aout]')
                .save(outputPath)
                .on('end', () => resolve())
                .on('error', (err) => reject(err));
        });

        res.json({ ok: true, masterAudioUrl: publicUrl });
    } catch (error: any) {
        console.error('[Audio Mix Error]', error);
        res.status(500).json({ ok: false, message: error.message || 'Erro ao mixar áudios' });
    }
};
