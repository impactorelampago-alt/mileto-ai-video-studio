import { Request, Response } from 'express';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
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
const audioCacheJobs = new Map<string, Promise<void>>();
export const MAX_REMOTE_AUDIO_BYTES = 60 * 1024 * 1024;
export const MAX_REMOTE_AUDIO_REDIRECTS = 3;
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

type AudioCacheProducer = (temporaryPath: string) => Promise<void>;
type AudioCacheValidator = (filePath: string) => Promise<boolean>;

const removeFileQuietly = async (filePath: string): Promise<void> => {
    try {
        await fs.promises.unlink(filePath);
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
};

/**
 * Um arquivo existente só é cache quando também é um áudio decodificável.
 * Isso evita perpetuar zero-byte, download HTML ou MP3 parcial deixado por uma
 * queda do app/FFmpeg.
 */
export const isUsableAudioCacheFile = async (filePath: string): Promise<boolean> => {
    try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile() || stat.size <= 0) return false;
        const duration = await probeAudioDuration(filePath);
        return Number.isFinite(duration) && duration > 0;
    } catch {
        return false;
    }
};

interface AudioMixCacheHashInput {
    narrationUrl?: string | null;
    musicUrl?: string | null;
    narrationPath?: string | null;
    musicPath?: string | null;
    narrationConfig?: unknown;
    musicConfig?: unknown;
}

const sha256File = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
});

/**
 * A URL identifica a seleção, mas não necessariamente os bytes: um arquivo
 * local pode ser substituído no mesmo caminho. O SHA-256 das fontes impede que
 * um mix válido, porém antigo, seja reutilizado nesse caso.
 */
export const buildAudioMixCacheHash = async (input: AudioMixCacheHashInput): Promise<string> => {
    const [narrationSha256, musicSha256] = await Promise.all([
        input.narrationPath ? sha256File(input.narrationPath) : Promise.resolve(null),
        input.musicPath ? sha256File(input.musicPath) : Promise.resolve(null),
    ]);
    const identity = JSON.stringify({
        version: 4,
        narration: input.narrationPath ? {
            url: input.narrationUrl || null,
            sha256: narrationSha256,
            config: input.narrationConfig ?? null,
        } : null,
        music: input.musicPath ? {
            url: input.musicUrl || null,
            sha256: musicSha256,
            config: input.musicConfig ?? null,
        } : null,
    });
    return crypto.createHash('sha256').update(identity).digest('hex');
};

const temporaryAudioPath = (targetPath: string): string => {
    const extension = path.extname(targetPath) || '.audio';
    const stem = targetPath.slice(0, targetPath.length - extension.length);
    return `${stem}.${process.pid}-${crypto.randomUUID()}.tmp${extension}`;
};

/**
 * Garante cache validado com publicação atômica. Chamadas concorrentes para o
 * mesmo destino compartilham o produtor; o caminho final nunca é usado como
 * arquivo de trabalho do download/FFmpeg.
 */
export const ensureValidAudioCacheFile = async (
    targetPath: string,
    producer: AudioCacheProducer,
    validator: AudioCacheValidator = isUsableAudioCacheFile,
): Promise<void> => {
    if (await validator(targetPath)) return;

    const running = audioCacheJobs.get(targetPath);
    if (running) {
        await running;
        return;
    }

    const job: Promise<void> = (async () => {
        // Outra instância/processo pode ter publicado enquanto aguardávamos a
        // primeira validação. Revalida antes de remover ou produzir.
        if (await validator(targetPath)) return;
        await removeFileQuietly(targetPath);

        const temporaryPath = temporaryAudioPath(targetPath);
        try {
            await producer(temporaryPath);
            if (!(await validator(temporaryPath))) {
                throw new Error('O arquivo de áudio gerado está vazio ou corrompido.');
            }
            await fs.promises.rename(temporaryPath, targetPath);
        } finally {
            // No sucesso o rename já moveu o temporário; no erro remove o parcial.
            await removeFileQuietly(temporaryPath);
        }
    })().finally(() => {
        if (audioCacheJobs.get(targetPath) === job) audioCacheJobs.delete(targetPath);
    });

    audioCacheJobs.set(targetPath, job);
    await job;
};

const remoteAudioSizeLimiter = (maxBytes: number): Transform => {
    let receivedBytes = 0;
    return new Transform({
        transform(chunk, encoding, callback) {
            const chunkBytes = Buffer.isBuffer(chunk)
                ? chunk.length
                : Buffer.byteLength(chunk, encoding);
            receivedBytes += chunkBytes;
            if (receivedBytes > maxBytes) {
                callback(new Error(`O áudio remoto excedeu o limite de ${maxBytes} bytes.`));
                return;
            }
            callback(null, chunk);
        },
    });
};

type RemoteAudioUrlValidator = (url: string) => boolean;

export const isAllowedRemoteAudioUrl = (rawUrl: string): boolean => {
    if (!isSafeRemoteUrl(rawUrl)) return false;
    try {
        const parsed = new URL(rawUrl);
        const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
        const isPixabay = hostname === 'pixabay.com' || hostname.endsWith('.pixabay.com');
        const r2Suffix = '.r2.cloudflarestorage.com';
        const r2Prefix = hostname.endsWith(r2Suffix)
            ? hostname.slice(0, -r2Suffix.length)
            : '';
        const isSignedR2 = Boolean(r2Prefix) && r2Prefix.split('.').every(
            (label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
        );
        return parsed.protocol === 'https:'
            && (!parsed.port || parsed.port === '443')
            && (isPixabay || isSignedR2);
    } catch {
        return false;
    }
};

/**
 * Baixa mídia remota seguindo no máximo três redirects seguros e limita os
 * bytes enquanto o corpo é transmitido. O `maxContentLength` do Axios não
 * conta o corpo quando a resposta é um stream, por isso o Transform é a
 * barreira efetiva de disco.
 *
 * A URL inicial já é validada por `resolveAudioInput`. Cada novo `Location`
 * precisa ser validado novamente para impedir que um host público redirecione
 * o servidor local para loopback, rede privada ou link-local.
 */
export const downloadRemoteAudioFile = async (
    inputUrl: string,
    destinationPath: string,
    maxBytes = MAX_REMOTE_AUDIO_BYTES,
    validateRedirectUrl: RemoteAudioUrlValidator = isAllowedRemoteAudioUrl,
): Promise<void> => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new Error('Limite de download de áudio inválido.');
    }

    let currentUrl = inputUrl;
    let followedRedirects = 0;

    while (true) {
        let response;
        try {
            response = await axios({
                url: currentUrl,
                method: 'GET',
                responseType: 'stream',
                timeout: 20000,
                maxRedirects: 0,
                maxContentLength: maxBytes,
                headers: {
                    'User-Agent': FAKE_USER_AGENT,
                    Referer: 'https://pixabay.com/',
                },
            });
        } catch (error: unknown) {
            if (!axios.isAxiosError(error)) throw error;
            const status = error.response?.status;
            if (typeof status !== 'number' || status < 300 || status >= 400) throw error;
            response = error.response;
        }
        if (!response) throw new Error('O servidor remoto não devolveu uma resposta de áudio.');

        const status = Number(response.status);
        if (status >= 300 && status < 400) {
            const responseStream = response.data as { destroy?: () => void } | undefined;
            responseStream?.destroy?.();

            if (followedRedirects >= MAX_REMOTE_AUDIO_REDIRECTS) {
                throw new Error(`A URL de áudio excedeu o limite de ${MAX_REMOTE_AUDIO_REDIRECTS} redirecionamentos.`);
            }

            const location = String(response.headers?.location || '').trim();
            if (!location) throw new Error('Redirecionamento de URL de áudio sem destino.');

            let nextUrl: string;
            try {
                nextUrl = new URL(location, currentUrl).toString();
            } catch {
                throw new Error('Redirecionamento de URL de áudio inválido.');
            }
            if (!validateRedirectUrl(nextUrl)) {
                throw new Error('Redirecionamento de URL de áudio para destino não permitido.');
            }

            currentUrl = nextUrl;
            followedRedirects += 1;
            continue;
        }

        await pipeline(
            response.data,
            remoteAudioSizeLimiter(maxBytes),
            fs.createWriteStream(destinationPath),
        );
        return;
    }
};

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
            // O produto só recebe áudio remoto do Pixabay ou do R2 privado.
            // A allowlist evita DNS/redirect SSRF por uma URL pública arbitrária.
            if (!isAllowedRemoteAudioUrl(url)) throw new Error('URL de áudio não permitida.');
            return url;
        };

        const isLocalInput = (input: string) =>
            !!input && !/^https?:\/\//.test(input);

        const narrationPath = narrationRequested ? resolveAudioInput(narrationUrl) : '';
        const musicPath = musicRequested ? resolveAudioInput(musicUrl) : '';

        // Helper para garantir que o áudio externo seja baixado antes do ffmpeg tentar acessá-lo
        const ensureLocalFile = async (inputPath: string, type: string): Promise<string> => {
            if (!inputPath) return '';
            if (isLocalInput(inputPath)) return inputPath;

            // Se for online (https), criaremos um cache do arquivo em disco
            const urlHash = crypto.createHash('md5').update(inputPath).digest('hex');
            // v2 não reutiliza downloads parciais que builds antigas publicavam
            // diretamente no destino sem validação/rename atômico.
            const cachedFilePath = path.join(AUDIO_MIXES_DIR, `ext_v2_${type}_${urlHash}.mp3`);

            try {
                await ensureValidAudioCacheFile(cachedFilePath, async (temporaryPath) => {
                    // Download com Axios disfarçado de Navegador (Bypass 403 Pixabay).
                    // O helper limita e revalida redirects, além do corpo em stream.
                    await downloadRemoteAudioFile(inputPath, temporaryPath);
                });
                return cachedFilePath;
            } catch (err: any) {
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

        const hash = await buildAudioMixCacheHash({
            narrationUrl,
            musicUrl,
            narrationPath: narrationReady ? finalNarrationPath : null,
            musicPath: musicReady ? finalMusicPath : null,
            narrationConfig: narrationReady ? effectiveNarrationConfig : null,
            musicConfig: musicReady ? effectiveMusicConfig : null,
        });
        const outputFileName = `mix-${hash}.mp3`;
        const outputPath = path.join(AUDIO_MIXES_DIR, outputFileName);
        const publicUrl = `/mixes/${outputFileName}`;

        console.log('[Audio Mix]', readyInputs.map((input) => ({
            kind: input.kind,
            trimStart: input.config.trimStart,
            trimEnd: input.config.trimEnd,
            offsetSec: input.config.offsetSec,
            volume: input.config.volume,
        })));

        await ensureValidAudioCacheFile(outputPath, async (temporaryPath) => {
            const command = ffmpeg();
            readyInputs.forEach((input) => command.input(input.inputPath));

            if (readyInputs.length === 1) {
                const singleInput = readyInputs[0];
                await new Promise<void>((resolve, reject) => {
                    command
                        .audioFilters(buildAudioFilterChain(singleInput.config))
                        .save(temporaryPath)
                        .on('end', () => resolve())
                        .on('error', (err) => reject(err));
                });
                return;
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
                    .save(temporaryPath)
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err));
            });
        });

        res.json({ ok: true, masterAudioUrl: publicUrl });
    } catch (error: any) {
        console.error('[Audio Mix Error]', error);
        res.status(500).json({ ok: false, message: error.message || 'Erro ao mixar áudios' });
    }
};
