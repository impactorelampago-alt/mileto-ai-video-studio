import { Request, Response } from 'express';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import { safeResolve, isSafeRemoteUrl } from '../utils/safePath';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
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

        // Resolve o input do ffmpeg com CONTAINMENT (nada de `../../etc/passwd`) e
        // bloqueia SSRF (URL externa tem que ser http(s) para host público).
        const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
        const resolveAudioInput = (url: string): string => {
            if (!url) return '';
            let parsed: URL | null = null;
            try {
                parsed = new URL(url);
            } catch {
                // Caminho relativo tipo /narrations/xxx.mp3 → sob BASE_DATA_PATH, sem escapar.
                return safeResolve(BASE_DATA_PATH, url.replace(/^\/+/, ''));
            }
            if (LOCAL_HOSTS.includes(parsed.hostname)) {
                return safeResolve(BASE_DATA_PATH, parsed.pathname.replace(/^\/+/, ''));
            }
            // Externa (ex.: https://cdn.pixabay.com/...): só se for host público válido.
            if (!isSafeRemoteUrl(url)) throw new Error('URL de áudio não permitida.');
            return url;
        };

        const isLocalInput = (input: string) =>
            !!input && !/^https?:\/\//.test(input);

        const narrationPath = resolveAudioInput(narrationUrl);
        const musicPath = resolveAudioInput(musicUrl);

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

        const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

        // Helper para garantir que o áudio externo seja baixado antes do ffmpeg tentar acessá-lo
        const ensureLocalFile = async (inputPath: string, type: string): Promise<string> => {
            if (!inputPath) return '';
            if (isLocalInput(inputPath)) return inputPath;

            // Se for online (https), criaremos um cache do arquivo em disco
            const urlHash = crypto.createHash('md5').update(inputPath).digest('hex');
            const cachedFilePath = path.join(AUDIO_MIXES_DIR, `ext_${type}_${urlHash}.mp3`);

            if (fs.existsSync(cachedFilePath)) {
                return cachedFilePath;
            }

            try {
                // Download com Axios disfarçado de Navegador (Bypass 403 Pixabay).
                // timeout evita pendurar a requisição para sempre num socket mudo.
                const response = await axios({
                    url: inputPath,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 20000,
                    maxContentLength: 60 * 1024 * 1024,
                    headers: {
                        'User-Agent': FAKE_USER_AGENT,
                        Referer: 'https://pixabay.com/',
                    },
                });

                const writer = fs.createWriteStream(cachedFilePath);
                await new Promise<void>((resolve, reject) => {
                    // Erro NO MEIO do stream de origem também precisa rejeitar (antes só o
                    // 'error' do writer rejeitava → download truncado virava cache eterno).
                    response.data.on('error', reject);
                    writer.on('error', reject);
                    writer.on('finish', resolve);
                    response.data.pipe(writer);
                });

                // Arquivo vazio/zero-byte não deve contar como cache válido.
                if (!fs.existsSync(cachedFilePath) || fs.statSync(cachedFilePath).size === 0) {
                    throw new Error('Arquivo de áudio remoto vazio.');
                }
                return cachedFilePath;
            } catch (err: any) {
                // Remove o parcial para não "cachear" um download quebrado.
                try {
                    if (fs.existsSync(cachedFilePath)) fs.unlinkSync(cachedFilePath);
                } catch {
                    /* ignore */
                }
                console.error(`[Audio Mix] Falha ao baixar ${type}:`, err.message);
                throw new Error(`Pixabay ou servidor remoto negou acesso a URL de áudio (${err.message})`);
            }
        };

        const finalNarrationPath = await ensureLocalFile(narrationPath, 'narration');
        const finalMusicPath = await ensureLocalFile(musicPath, 'music');

        const narrationReady = !!finalNarrationPath && narrationVol > 0 && fs.existsSync(finalNarrationPath);
        const musicReady = !!finalMusicPath && musicVol > 0 && fs.existsSync(finalMusicPath);

        if (narrationReady) {
            command.input(finalNarrationPath);
            inputCount++;
        }

        if (musicReady) {
            command.input(finalMusicPath);
            inputCount++;
        }

        console.log(`[Audio Mix Debug]`);
        console.log(`- narrationUrl: ${narrationUrl}`);
        console.log(`- finalNarrationPath: ${finalNarrationPath}`);
        console.log(`- narrationReady? ${narrationReady}`);
        console.log(`- narrationVol: ${narrationVol}`);
        console.log(`- musicUrl: ${musicUrl}`);
        console.log(`- finalMusicPath: ${finalMusicPath}`);
        console.log(`- musicReady? ${musicReady}`);
        console.log(`- musicVol: ${musicVol}`);
        console.log(`-> inputCount: ${inputCount}`);

        if (inputCount === 0) {
            return res.json({ ok: true, masterAudioUrl: null });
        }

        if (inputCount === 1) {
            // Se tem só um válido, o input já foi adicionado
            const singleVol = narrationReady ? narrationVol : musicVol;

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
