import { Request, Response } from 'express';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import { safeResolve, isSafeRemoteUrl } from '../utils/safePath';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const builtinMusicCandidates = [
    path.join(__dirname, '..', 'assets', 'system-music'),
    path.join(__dirname, '..', '..', 'assets', 'system-music'),
];
const BUILTIN_MUSIC_PATH =
    process.env.BUILTIN_MUSIC_PATH ||
    builtinMusicCandidates.find((candidate) => fs.existsSync(candidate)) ||
    builtinMusicCandidates[0];
const AUDIO_MIXES_DIR = path.join(BASE_DATA_PATH, 'public/mixes');

if (!fs.existsSync(AUDIO_MIXES_DIR)) {
    fs.mkdirSync(AUDIO_MIXES_DIR, { recursive: true });
}

const MAX_AUDIO_SECONDS = 6 * 60 * 60;

interface NormalizedAudioTrackConfig {
    enabled: boolean;
    volume: number;
    offsetSec: number;
    trimStart: number;
    trimEnd?: number;
    fadeInSec: number;
    fadeOutSec: number;
}

const boundedNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const normalizeAudioTrackConfig = (
    value: Record<string, unknown> | undefined,
    defaultVolume: number,
): NormalizedAudioTrackConfig => {
    const trimStart = boundedNumber(value?.trimStart, 0, 0, MAX_AUDIO_SECONDS);
    const parsedTrimEnd = Number(value?.trimEnd);
    const trimEnd = Number.isFinite(parsedTrimEnd) && parsedTrimEnd > 0
        ? Math.min(parsedTrimEnd, MAX_AUDIO_SECONDS)
        : undefined;

    if (trimEnd !== undefined && trimEnd <= trimStart) {
        throw new Error('O fim do corte deve ficar depois do início.');
    }

    return {
        enabled: value?.enabled !== false,
        volume: boundedNumber(value?.volume, defaultVolume, 0, 2),
        offsetSec: boundedNumber(value?.offsetSec, 0, 0, MAX_AUDIO_SECONDS),
        trimStart,
        trimEnd,
        fadeInSec: boundedNumber(value?.fadeInSec, 0, 0, 60),
        fadeOutSec: boundedNumber(value?.fadeOutSec, 0, 0, 60),
    };
};

const probeAudioDuration = (inputPath: string): Promise<number> => new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (error, metadata) => {
        if (error) {
            reject(error);
            return;
        }
        const duration = Number(metadata.format.duration || 0);
        if (!Number.isFinite(duration) || duration <= 0) {
            reject(new Error('A duração da faixa de áudio é inválida.'));
            return;
        }
        resolve(duration);
    });
});

const fitConfigToSource = (
    config: NormalizedAudioTrackConfig,
    sourceDuration: number,
): NormalizedAudioTrackConfig => {
    if (config.trimStart >= sourceDuration - 0.01) {
        throw new Error('O início do corte ultrapassa a duração da faixa.');
    }
    const trimEnd = Math.min(config.trimEnd ?? sourceDuration, sourceDuration);
    if (trimEnd <= config.trimStart) {
        throw new Error('O intervalo de corte da faixa está vazio.');
    }
    return { ...config, trimEnd };
};

const filterNumber = (value: number): string => Number(value.toFixed(3)).toString();

export const buildAudioFilterChain = (config: NormalizedAudioTrackConfig): string => {
    const trimEnd = config.trimEnd;
    if (trimEnd === undefined) throw new Error('Não foi possível determinar o fim da faixa.');

    const clipDuration = trimEnd - config.trimStart;
    const fadeIn = Math.min(config.fadeInSec, clipDuration / 2);
    const fadeOut = Math.min(config.fadeOutSec, clipDuration / 2);
    const filters = [
        `atrim=start=${filterNumber(config.trimStart)}:end=${filterNumber(trimEnd)}`,
        'asetpts=PTS-STARTPTS',
        `volume=${filterNumber(config.volume)}`,
    ];
    if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${filterNumber(fadeIn)}`);
    if (fadeOut > 0) {
        filters.push(`afade=t=out:st=${filterNumber(clipDuration - fadeOut)}:d=${filterNumber(fadeOut)}`);
    }
    if (config.offsetSec > 0) {
        filters.push(`adelay=${Math.round(config.offsetSec * 1000)}:all=1`);
    }
    return filters.join(',');
};

export const mixAudio = async (req: Request, res: Response) => {
    try {
        const { narrationUrl, musicUrl, audioConfig } = req.body;

        if (!narrationUrl && !musicUrl) {
            return res.status(400).json({ ok: false, message: 'Nenhum áudio fornecido para mixagem.' });
        }

        const narrationConfig = normalizeAudioTrackConfig(audioConfig?.narration, 1);
        const musicConfig = normalizeAudioTrackConfig(audioConfig?.background, 0.3);
        const narrationRequested = Boolean(narrationUrl && narrationConfig.enabled && narrationConfig.volume > 0);
        const musicRequested = Boolean(musicUrl && musicConfig.enabled && musicConfig.volume > 0);

        // Resolve o input do ffmpeg com CONTAINMENT (nada de `../../etc/passwd`) e
        // bloqueia SSRF (URL externa tem que ser http(s) para host público).
        const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
        const resolveLocalPath = (pathname: string): string => {
            const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
            if (relative === 'system-music' || relative.startsWith('system-music/')) {
                return safeResolve(BUILTIN_MUSIC_PATH, relative.replace(/^system-music\/?/, ''));
            }
            return safeResolve(BASE_DATA_PATH, relative);
        };
        const resolveAudioInput = (url: string): string => {
            if (!url) return '';
            let parsed: URL | null = null;
            try {
                parsed = new URL(url);
            } catch {
                // Caminho relativo tipo /narrations/xxx.mp3 → sob BASE_DATA_PATH, sem escapar.
                return resolveLocalPath(url);
            }
            if (LOCAL_HOSTS.includes(parsed.hostname)) {
                // URL.pathname mantém %C3%BA etc. Sem decodificar, "Músicas" virava
                // uma pasta literal "M%C3%BAsicas" e a faixa era descartada da mixagem.
                return resolveLocalPath(parsed.pathname);
            }
            // Externa (ex.: https://cdn.pixabay.com/...): só se for host público válido.
            if (!isSafeRemoteUrl(url)) throw new Error('URL de áudio não permitida.');
            return url;
        };

        const isLocalInput = (input: string) =>
            !!input && !/^https?:\/\//.test(input);

        const narrationPath = narrationRequested ? resolveAudioInput(narrationUrl) : '';
        const musicPath = musicRequested ? resolveAudioInput(musicUrl) : '';

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

        const narrationReady = narrationRequested && !!finalNarrationPath && fs.existsSync(finalNarrationPath);
        const musicReady = musicRequested && !!finalMusicPath && fs.existsSync(finalMusicPath);

        if (narrationRequested && !narrationReady) {
            throw new Error('A narração selecionada não foi encontrada no disco.');
        }
        if (musicRequested && !musicReady) {
            throw new Error('A música selecionada não foi encontrada no disco. Selecione-a novamente.');
        }

        const [narrationDuration, musicDuration] = await Promise.all([
            narrationReady ? probeAudioDuration(finalNarrationPath) : Promise.resolve(0),
            musicReady ? probeAudioDuration(finalMusicPath) : Promise.resolve(0),
        ]);
        const effectiveNarrationConfig = narrationReady
            ? fitConfigToSource(narrationConfig, narrationDuration)
            : narrationConfig;
        const effectiveMusicConfig = musicReady
            ? fitConfigToSource(musicConfig, musicDuration)
            : musicConfig;

        const readyInputs: Array<{
            kind: 'narration' | 'music';
            inputPath: string;
            config: NormalizedAudioTrackConfig;
        }> = [];
        if (narrationReady) {
            readyInputs.push({ kind: 'narration', inputPath: finalNarrationPath, config: effectiveNarrationConfig });
        }
        if (musicReady) {
            readyInputs.push({ kind: 'music', inputPath: finalMusicPath, config: effectiveMusicConfig });
        }

        if (readyInputs.length === 0) {
            return res.json({ ok: true, masterAudioUrl: null });
        }

        const hashStr = JSON.stringify({
            version: 3,
            narrationUrl,
            musicUrl,
            narration: narrationReady ? effectiveNarrationConfig : null,
            music: musicReady ? effectiveMusicConfig : null,
        });
        const hash = crypto.createHash('md5').update(hashStr).digest('hex');
        const outputFileName = `mix-${hash}.mp3`;
        const outputPath = path.join(AUDIO_MIXES_DIR, outputFileName);
        const publicUrl = `/mixes/${outputFileName}`;
        if (fs.existsSync(outputPath)) {
            return res.json({ ok: true, masterAudioUrl: publicUrl });
        }

        const command = ffmpeg();
        readyInputs.forEach((input) => command.input(input.inputPath));

        console.log('[Audio Mix]', readyInputs.map((input) => ({
            kind: input.kind,
            trimStart: input.config.trimStart,
            trimEnd: input.config.trimEnd,
            offsetSec: input.config.offsetSec,
            volume: input.config.volume,
        })));

        if (readyInputs.length === 1) {
            const singleInput = readyInputs[0];

            await new Promise<void>((resolve, reject) => {
                command
                    .audioFilters(buildAudioFilterChain(singleInput.config))
                    .save(outputPath)
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err));
            });

            return res.json({ ok: true, masterAudioUrl: publicUrl });
        }

        const filteredInputs = readyInputs.map((input, index) => (
            `[${index}:a]${buildAudioFilterChain(input.config)}[a${index}]`
        ));
        const mixInputs = readyInputs.map((_, index) => `[a${index}]`).join('');
        await new Promise<void>((resolve, reject) => {
            command
                .complexFilter([
                    ...filteredInputs,
                    `${mixInputs}amix=inputs=${readyInputs.length}:duration=first:dropout_transition=2:normalize=0[aout]`,
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
