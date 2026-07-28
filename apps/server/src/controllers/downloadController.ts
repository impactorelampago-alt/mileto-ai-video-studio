import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { createHash, randomUUID as uuidv4 } from 'crypto';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import fetch from 'node-fetch';
import { isSafeRemoteUrl, safeResolve } from '../utils/safePath';
import { FILES_ROOT, registerFile } from './fileExplorerController';

// Binários empacotados pelo Electron. Em desenvolvimento, usa o PATH como fallback.
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const FFMPEG_DIR = FFMPEG_BIN ? path.dirname(FFMPEG_BIN) : undefined;

const YTDLP_CACHE_DIR = path.join(path.dirname(FILES_ROOT), 'data', 'yt-dlp-cache');
const MAX_JOBS = 5;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const INSPECT_TIMEOUT_MS = 60 * 1000;
const MAX_INSPECT_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_REMOTE_DOWNLOAD_BYTES = Math.max(
    1024 * 1024 * 1024,
    Number(process.env.REMOTE_DOWNLOAD_MAX_BYTES || 20 * 1024 ** 3)
);
const AUDIO_BITRATES = new Set([128, 192, 256, 320]);
const GATEWAY_ORIGIN = new URL(
    process.env.GATEWAY_BASE_URL || 'https://api.miletoaivideo.com.br'
).origin;
const OPS_MEDIA_PROXY_PATH = /^\/v1\/integrations\/mileto-ops\/media\/[A-Za-z0-9_-]{32,160}$/;

fs.mkdirSync(YTDLP_CACHE_DIR, { recursive: true });

// O runtime JavaScript libera o catálogo completo do YouTube. O Electron que hospeda
// o servidor também funciona como Node porque é iniciado com ELECTRON_RUN_AS_NODE=1.
const YTDLP_COMMON_ARGS = [
    '--cache-dir',
    YTDLP_CACHE_DIR,
    '--js-runtimes',
    `node:${process.execPath}`,
    '--remote-components',
    'ejs:github',
];

type DownloadMode = 'audio' | 'video' | 'image';
type JobPhase = 'downloading' | 'done' | 'error';
type JobStep = 'downloading' | 'processing';

interface DownloadedMedia {
    id: string;
    originalName: string;
    displayName: string;
    filePath: string;
    publicUrl: string;
    durationSec: number;
    createdAt: string;
    type: DownloadMode;
}

interface DownloadJob {
    id: string;
    phase: JobPhase;
    percent: number;
    step: JobStep;
    stepPercent: number;
    mode: DownloadMode;
    destination: string;
    title?: string;
    track?: DownloadedMedia;
    error?: string;
    process?: ChildProcess;
    abortController?: AbortController;
    startedAt: number;
    completedAt?: number;
}

interface YtDlpFormat {
    format_id?: string;
    ext?: string;
    height?: number;
    width?: number;
    fps?: number;
    vcodec?: string;
    acodec?: string;
    abr?: number;
    filesize?: number;
    filesize_approx?: number;
}

interface YtDlpMetadata {
    id?: string;
    title?: string;
    duration?: number;
    thumbnail?: string;
    extractor?: string;
    extractor_key?: string;
    webpage_url?: string;
    uploader?: string;
    is_live?: boolean;
    live_status?: string;
    formats?: YtDlpFormat[];
    entries?: unknown[];
    ext?: string;
    height?: number;
    width?: number;
    fps?: number;
    vcodec?: string;
    acodec?: string;
    abr?: number;
    filesize?: number;
    filesize_approx?: number;
}

const jobs = new Map<string, DownloadJob>();

function validateUrl(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('Cole um link para continuar.');
    }
    const url = value.trim();
    if (!isSafeRemoteUrl(url)) {
        throw new Error('URL inválida ou não permitida.');
    }
    return url;
}

function validateDestination(value: unknown, mode: DownloadMode): string {
    const fallback = mode === 'audio' ? 'Músicas' : mode === 'image' ? 'Imagens' : 'Vídeos';
    const raw = typeof value === 'string' ? value.trim() : fallback;
    const destination = raw.replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '');
    const destinationDir = destination ? safeResolve(FILES_ROOT, destination) : FILES_ROOT;
    if (!fs.existsSync(destinationDir) || !fs.statSync(destinationDir).isDirectory()) {
        throw new Error('A pasta escolhida não existe mais. Selecione outro destino.');
    }
    return destination;
}

function validateOpsMediaProxyUrl(value: unknown): string {
    let url: URL;
    try {
        url = new URL(String(value || ''));
    } catch {
        throw new Error('A entrega segura do Mileto Ops é inválida.');
    }
    if (
        url.origin !== GATEWAY_ORIGIN ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !OPS_MEDIA_PROXY_PATH.test(url.pathname)
    ) {
        throw new Error('A entrega não pertence ao gateway seguro do Mileto Ops.');
    }
    return url.toString();
}

const allowedExtensions: Record<DownloadMode, Set<string>> = {
    audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']),
    image: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']),
    video: new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mpeg', '.mpg']),
};

const extensionFromMime = (mime: string, mode: DownloadMode) => {
    const known: Record<string, string> = {
        'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
        'audio/ogg': '.ogg', 'audio/flac': '.flac',
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
        'image/avif': '.avif', 'image/bmp': '.bmp',
        'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
        'video/x-matroska': '.mkv', 'video/x-msvideo': '.avi',
    };
    return known[mime] || (mode === 'audio' ? '.mp3' : mode === 'image' ? '.jpg' : '.mp4');
};

const safeRemoteName = (value: unknown, mode: DownloadMode, mime: string) => {
    const raw = path.basename(String(value || '').trim()).replace(/[\p{Cc}<>:"/\\|?*]/gu, '').slice(0, 120);
    const suppliedExtension = path.extname(raw).toLowerCase();
    const extension = allowedExtensions[mode].has(suppliedExtension)
        ? suppliedExtension
        : extensionFromMime(mime, mode);
    const stem = (suppliedExtension ? raw.slice(0, -suppliedExtension.length) : raw).trim().slice(0, 100);
    return `${stem || 'Arquivo Mileto Ops'}${extension}`;
};

const categoryForMode = (mode: DownloadMode) =>
    mode === 'audio' ? 'Músicas' : mode === 'image' ? 'Imagens' : 'Vídeos';

function cleanProcessError(stderr: string, fallback: string): string {
    const ansiColorPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
    const lines = stderr
        .replace(ansiColorPattern, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const errorLine = [...lines].reverse().find((line) => /^ERROR:/i.test(line));
    const message = errorLine || lines.at(-1) || fallback;
    return message.replace(/^ERROR:\s*/i, '').slice(0, 500);
}

function terminateProcessTree(child: ChildProcess): void {
    if (!child.pid) return;
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
                shell: false,
                windowsHide: true,
                stdio: 'ignore',
            });
        } else {
            child.kill('SIGKILL');
        }
    } catch {
        try {
            child.kill('SIGKILL');
        } catch {
            /* já encerrado */
        }
    }
}

function runYtDlp(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(YTDLP_BIN, args, { shell: false, windowsHide: true });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let outputTooLarge = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            terminateProcessTree(child);
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
            if (Buffer.byteLength(stdout, 'utf-8') > MAX_INSPECT_OUTPUT_BYTES) {
                outputTooLarge = true;
                terminateProcessTree(child);
            }
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf-8');
        });
        child.once('error', (error) => {
            clearTimeout(timeout);
            reject(new Error(`Não foi possível abrir o mecanismo de download: ${error.message}`));
        });
        child.once('close', (code) => {
            clearTimeout(timeout);
            if (timedOut) return reject(new Error('A análise do link excedeu 60 segundos.'));
            if (outputTooLarge) return reject(new Error('O site retornou dados demais para uma análise segura.'));
            if (code !== 0) {
                return reject(new Error(cleanProcessError(stderr, `O site recusou a análise (código ${code}).`)));
            }
            resolve({ stdout, stderr });
        });
    });
}

function formatQualityLabel(height: number): string {
    if (height >= 4320) return `${height}p · 8K`;
    if (height >= 2160) return `${height}p · 4K`;
    if (height >= 1440) return `${height}p · 2K`;
    if (height >= 1080) return `${height}p · Full HD`;
    if (height >= 720) return `${height}p · HD`;
    return `${height}p`;
}

function inspectFormats(metadata: YtDlpMetadata) {
    const formats: YtDlpFormat[] =
        Array.isArray(metadata.formats) && metadata.formats.length > 0 ? metadata.formats : [metadata];
    const videoExtensions = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'flv', '3gp']);
    const audioExtensions = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac', 'weba']);
    const isVideoFormat = (format: YtDlpFormat) =>
        (Boolean(format.vcodec) && format.vcodec !== 'none') ||
        videoExtensions.has(String(format.ext || '').toLowerCase());
    const isAudioFormat = (format: YtDlpFormat) =>
        (Boolean(format.acodec) && format.acodec !== 'none') ||
        audioExtensions.has(String(format.ext || '').toLowerCase()) ||
        isVideoFormat(format);
    const videoFormats = formats.filter(isVideoFormat);
    const audioFormats = formats.filter(isAudioFormat);
    const heights = [...new Set(videoFormats.map((format) => Math.round(Number(format.height))))]
        .filter((height) => height >= 144 && height <= 8640)
        .sort((a, b) => b - a);

    const maxAudioSize = Math.max(
        0,
        ...audioFormats.map((format) => Number(format.filesize || format.filesize_approx || 0))
    );

    const videoOptions = heights.map((height) => {
        const candidates = videoFormats.filter((format) => Math.round(Number(format.height)) === height);
        const estimatedBytes =
            Math.max(0, ...candidates.map((format) => Number(format.filesize || format.filesize_approx || 0))) +
            maxAudioSize;
        const fps = Math.max(0, ...candidates.map((format) => Math.round(Number(format.fps || 0))));
        return {
            quality: String(height),
            height,
            label: formatQualityLabel(height),
            fps: fps || undefined,
            estimatedBytes: estimatedBytes || undefined,
        };
    });

    if (videoOptions.length === 0) {
        videoOptions.push({
            quality: 'best',
            height: 0,
            label: 'Melhor qualidade disponível',
            fps: undefined,
            estimatedBytes: undefined,
        });
    }

    const sourceAudioBitrate = Math.round(Math.max(0, ...audioFormats.map((format) => Number(format.abr || 0))));
    return {
        videoOptions,
        audioOptions: [
            { bitrate: 320, label: '320 kbps · Máxima' },
            { bitrate: 256, label: '256 kbps · Alta' },
            { bitrate: 192, label: '192 kbps · Recomendada' },
            { bitrate: 128, label: '128 kbps · Compacta' },
        ],
        sourceAudioBitrate: sourceAudioBitrate || undefined,
        hasVideo: videoFormats.length > 0,
        hasAudio: audioFormats.length > 0,
    };
}

function findOutputFile(tmpDir: string): string | null {
    const candidates = fs
        .readdirSync(tmpDir)
        .map((name) => {
            const full = path.join(tmpDir, name);
            try {
                return { full, stat: fs.statSync(full) };
            } catch {
                return null;
            }
        })
        .filter((candidate): candidate is { full: string; stat: fs.Stats } => Boolean(candidate?.stat.isFile()))
        .filter((candidate) => !/\.(part|ytdl|temp)$/i.test(candidate.full))
        .sort((a, b) => b.stat.size - a.stat.size);
    return candidates[0]?.full || null;
}

function moveFile(source: string, target: string): void {
    try {
        fs.renameSync(source, target);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        fs.copyFileSync(source, target);
        fs.unlinkSync(source);
    }
}

async function finalizeDownload(jobId: string, tmpDir: string): Promise<void> {
    const job = jobs.get(jobId);
    if (!job) return;

    const output = findOutputFile(tmpDir);
    if (!output) throw new Error('O mecanismo terminou, mas nenhum arquivo de mídia foi encontrado.');

    const expectedExtension = job.mode === 'audio' ? '.mp3' : '.mp4';
    if (path.extname(output).toLowerCase() !== expectedExtension) {
        throw new Error(`A conversão não gerou um arquivo ${expectedExtension.toUpperCase()} válido.`);
    }

    const id = uuidv4();
    const newFileName = `${id}${expectedExtension}`;
    const targetDir = job.destination ? safeResolve(FILES_ROOT, job.destination) : FILES_ROOT;
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        throw new Error('A pasta escolhida não existe mais. Selecione outro destino.');
    }
    const targetPath = path.join(targetDir, newFileName);
    moveFile(output, targetPath);

    const fallbackName = path.basename(output, path.extname(output));
    const displayName = (job.title || fallbackName).trim().slice(0, 100) || 'Download';
    const category = job.mode === 'audio' ? 'Músicas' : 'Vídeos';
    const relPath = path.join(job.destination, newFileName).split(path.sep).join('/');

    const entry = await registerFile(targetPath, relPath, {
        category,
        name: `${displayName}${expectedExtension}`,
    });

    job.track = {
        id: entry.id,
        originalName: entry.name,
        displayName,
        filePath: entry.filePath,
        publicUrl: entry.publicUrl,
        durationSec: entry.durationSec ?? 0,
        createdAt: entry.createdAt,
        type: job.mode,
    };
    job.phase = 'done';
    job.percent = 100;
    job.stepPercent = 100;
    job.completedAt = Date.now();
}

function scheduleJobCleanup(jobId: string): void {
    const timer = setTimeout(() => jobs.delete(jobId), 30 * 60 * 1000);
    timer.unref?.();
}

// POST /api/download/inspect { url }
export const inspectDownload = async (req: Request, res: Response) => {
    try {
        const url = validateUrl(req.body?.url);
        const args = [
            ...YTDLP_COMMON_ARGS,
            '--dump-single-json',
            '--skip-download',
            '--no-playlist',
            '--no-warnings',
            '--socket-timeout',
            '20',
            url,
        ];
        const { stdout } = await runYtDlp(args, INSPECT_TIMEOUT_MS);
        const metadata = JSON.parse(stdout) as YtDlpMetadata;
        if (metadata.entries && !metadata.title) {
            throw new Error('Cole o link de um vídeo específico, não o link de uma playlist.');
        }

        const live = Boolean(metadata.is_live || metadata.live_status === 'is_live');
        const formatInfo = inspectFormats(metadata);
        res.json({
            ok: true,
            media: {
                id: String(metadata.id || ''),
                title: String(metadata.title || 'Mídia sem título').slice(0, 200),
                durationSec: Number(metadata.duration || 0),
                thumbnail: metadata.thumbnail || undefined,
                source: String(metadata.extractor_key || metadata.extractor || 'Site'),
                sourceUrl: metadata.webpage_url || url,
                uploader: metadata.uploader || undefined,
                live,
                ...formatInfo,
            },
        });
    } catch (error) {
        const message =
            error instanceof SyntaxError
                ? 'O site respondeu em um formato que não pôde ser analisado.'
                : error instanceof Error
                  ? error.message
                  : 'Não foi possível analisar este link.';
        res.status(400).json({ ok: false, message });
    }
};

// POST /api/download/start { url, mode, quality?, audioBitrate?, destination? }
export const startDownload = (req: Request, res: Response) => {
    try {
        const url = validateUrl(req.body?.url);
        const mode: DownloadMode = req.body?.mode === 'video' ? 'video' : 'audio';
        const requestedQuality = String(req.body?.quality || 'best');
        const requestedHeight = requestedQuality === 'best' ? null : Number(requestedQuality);
        const requestedBitrate = Number(req.body?.audioBitrate || 192);
        const destination = validateDestination(req.body?.destination, mode);

        if (
            requestedHeight !== null &&
            (!Number.isInteger(requestedHeight) || requestedHeight < 144 || requestedHeight > 8640)
        ) {
            return res.status(400).json({ ok: false, message: 'Qualidade de vídeo inválida.' });
        }
        if (!AUDIO_BITRATES.has(requestedBitrate)) {
            return res.status(400).json({ ok: false, message: 'Qualidade de áudio inválida.' });
        }
        if ([...jobs.values()].filter((job) => job.phase === 'downloading').length >= MAX_JOBS) {
            return res
                .status(429)
                .json({ ok: false, message: 'Há muitos downloads em andamento. Aguarde um deles terminar.' });
        }

        const jobId = uuidv4();
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-dl-'));
        const job: DownloadJob = {
            id: jobId,
            phase: 'downloading',
            percent: 0,
            step: 'downloading',
            stepPercent: 0,
            mode,
            destination,
            startedAt: Date.now(),
        };
        jobs.set(jobId, job);

        const args = [
            ...YTDLP_COMMON_ARGS,
            '--no-playlist',
            '--newline',
            '--socket-timeout',
            '30',
            '--retries',
            '5',
            '--fragment-retries',
            '5',
            '--match-filter',
            '!is_live',
            '--progress-template',
            'download:dl:%(progress._percent_str)s',
            '--print',
            'before_dl:meta:%(title)s',
        ];

        if (mode === 'audio') {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', `${requestedBitrate}K`);
        } else {
            const selector =
                requestedHeight === null
                    ? 'bv*+ba/b'
                    : `bv*[height<=${requestedHeight}]+ba/b[height<=${requestedHeight}]`;
            args.push('-f', selector, '--merge-output-format', 'mp4', '--recode-video', 'mp4');
        }
        if (FFMPEG_DIR) args.push('--ffmpeg-location', FFMPEG_DIR);
        args.push('--output', path.join(tmpDir, '%(title).180B.%(ext)s'), url);

        const child = spawn(YTDLP_BIN, args, { shell: false, windowsHide: true });
        job.process = child;
        let stderr = '';
        let timedOut = false;
        const cleanupTemporaryFiles = () => {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {
                /* não fatal */
            }
        };

        const timeout = setTimeout(() => {
            timedOut = true;
            terminateProcessTree(child);
        }, JOB_TIMEOUT_MS);

        child.stdout.on('data', (chunk: Buffer) => {
            for (const rawLine of chunk.toString('utf-8').split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line) continue;

                if (line.startsWith('meta:') && !job.title) {
                    job.title = line.slice(5).trim().slice(0, 200);
                    continue;
                }

                const progress = line.match(/^dl:\s*([\d.]+)\s*%/i) || line.match(/\[download\]\s+([\d.]+)\s*%/i);
                if (progress) {
                    job.step = 'downloading';
                    job.stepPercent = Math.max(0, Math.min(100, Number(progress[1])));
                    job.percent = Math.round(job.stepPercent * (mode === 'audio' ? 0.85 : 0.9));
                    continue;
                }

                if (/\[(ExtractAudio|Merger|VideoConvertor|VideoRemuxer|FFmpeg)\]/i.test(line)) {
                    job.step = 'processing';
                    job.stepPercent = Math.max(job.stepPercent, 70);
                    job.percent = Math.max(job.percent, 90);
                }
            }
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf-8');
        });

        child.once('close', async (code) => {
            clearTimeout(timeout);
            if (job.phase !== 'downloading') {
                cleanupTemporaryFiles();
                scheduleJobCleanup(jobId);
                return;
            }
            try {
                if (timedOut) throw new Error('O download excedeu o limite de 30 minutos.');
                if (code !== 0) throw new Error(cleanProcessError(stderr, `O download terminou com código ${code}.`));
                job.step = 'processing';
                job.stepPercent = 95;
                await finalizeDownload(jobId, tmpDir);
            } catch (error) {
                job.phase = 'error';
                job.error = error instanceof Error ? error.message : 'Falha ao finalizar o download.';
                job.completedAt = Date.now();
            } finally {
                cleanupTemporaryFiles();
                scheduleJobCleanup(jobId);
            }
        });

        child.once('error', (error) => {
            clearTimeout(timeout);
            job.phase = 'error';
            job.error = `Não foi possível abrir o mecanismo de download: ${error.message}`;
            job.completedAt = Date.now();
            cleanupTemporaryFiles();
            scheduleJobCleanup(jobId);
        });

        res.json({ ok: true, jobId });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Não foi possível iniciar o download.';
        res.status(400).json({ ok: false, message });
    }
};

// POST /api/download/ops — importa uma entrega efêmera do gateway para a
// biblioteca local e usa a mesma fila/sino dos demais downloads.
export const startOpsDownload = (req: Request, res: Response) => {
    try {
        if ([...jobs.values()].filter((job) => job.phase === 'downloading').length >= MAX_JOBS) {
            return res
                .status(429)
                .json({ ok: false, message: 'Há muitos downloads em andamento. Aguarde um deles terminar.' });
        }

        const url = validateOpsMediaProxyUrl(req.body?.url);
        const rawMode = String(req.body?.mode || '');
        if (!['audio', 'image', 'video'].includes(rawMode)) {
            return res.status(400).json({ ok: false, message: 'Tipo de mídia inválido.' });
        }
        const mode = rawMode as DownloadMode;
        const destination = validateDestination(req.body?.destination, mode);
        const rawExpectedBytes = Number(req.body?.sizeBytes || 0);
        const expectedBytes = Number.isFinite(rawExpectedBytes) && rawExpectedBytes > 0
            ? rawExpectedBytes
            : 0;
        if (expectedBytes > MAX_REMOTE_DOWNLOAD_BYTES) {
            return res.status(413).json({ ok: false, message: 'O arquivo ultrapassa o limite local de download.' });
        }
        const expectedChecksum = String(req.body?.checksum || '').trim().toLowerCase();
        if (expectedChecksum && !/^[0-9a-f]{64}$/.test(expectedChecksum)) {
            return res.status(400).json({ ok: false, message: 'Checksum do arquivo inválido.' });
        }

        const requestedName = String(req.body?.name || 'Arquivo Mileto Ops').slice(0, 120);
        const jobId = uuidv4();
        const abortController = new AbortController();
        const job: DownloadJob = {
            id: jobId,
            phase: 'downloading',
            percent: 0,
            step: 'downloading',
            stepPercent: 0,
            mode,
            title: requestedName,
            destination,
            abortController,
            startedAt: Date.now(),
        };
        jobs.set(jobId, job);
        res.status(202).json({ ok: true, jobId });

        void (async () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-ops-dl-'));
            const partialPath = path.join(tmpDir, `${jobId}.part`);
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    redirect: 'manual',
                    signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(JOB_TIMEOUT_MS)]),
                });
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    throw new Error('O gateway tentou redirecionar a entrega para uma origem externa.');
                }
                if (!response.ok || !response.body) {
                    throw new Error(`A entrega do Mileto Ops falhou (${response.status}).`);
                }

                const contentLength = Math.max(0, Number(response.headers.get('content-length') || expectedBytes || 0));
                if (contentLength > MAX_REMOTE_DOWNLOAD_BYTES) {
                    throw new Error('O arquivo ultrapassa o limite local de download.');
                }
                const mimeType = String(response.headers.get('content-type') || '')
                    .toLowerCase()
                    .split(';')[0]
                    .trim();
                if (
                    (mode === 'audio' && !mimeType.startsWith('audio/')) ||
                    (mode === 'image' && !mimeType.startsWith('image/')) ||
                    (mode === 'video' && !mimeType.startsWith('video/'))
                ) {
                    throw new Error('O gateway devolveu um tipo de mídia diferente do solicitado.');
                }

                let receivedBytes = 0;
                const hash = createHash('sha256');
                const progress = new Transform({
                    transform(chunk: Buffer, _encoding, callback) {
                        receivedBytes += chunk.length;
                        if (receivedBytes > MAX_REMOTE_DOWNLOAD_BYTES) {
                            callback(new Error('O arquivo ultrapassa o limite local de download.'));
                            return;
                        }
                        hash.update(chunk);
                        job.stepPercent = contentLength > 0
                            ? Math.min(99, (receivedBytes / contentLength) * 100)
                            : Math.min(95, job.stepPercent + 0.25);
                        job.percent = Math.round(job.stepPercent);
                        callback(null, chunk);
                    },
                });
                await pipeline(response.body as unknown as NodeJS.ReadableStream, progress, fs.createWriteStream(partialPath));

                if (abortController.signal.aborted) {
                    const aborted = new Error('Download cancelado.');
                    aborted.name = 'AbortError';
                    throw aborted;
                }

                if (expectedBytes && receivedBytes !== expectedBytes) {
                    throw new Error('O tamanho baixado não confere com o arquivo do Mileto Ops.');
                }
                if (contentLength && receivedBytes !== contentLength) {
                    throw new Error('O download terminou incompleto.');
                }
                const actualChecksum = hash.digest('hex');
                if (expectedChecksum && actualChecksum !== expectedChecksum) {
                    throw new Error('O checksum baixado não confere com o Mileto Ops.');
                }

                job.step = 'processing';
                job.stepPercent = 99;
                job.percent = 99;
                const displayName = safeRemoteName(requestedName, mode, mimeType);
                const extension = path.extname(displayName).toLowerCase();
                const storedName = `${uuidv4()}${extension}`;
                const targetDir = destination ? safeResolve(FILES_ROOT, destination) : FILES_ROOT;
                const targetPath = path.join(targetDir, storedName);
                const relPath = path.join(destination, storedName).split(path.sep).join('/');
                moveFile(partialPath, targetPath);

                const entry = await registerFile(targetPath, relPath, {
                    category: categoryForMode(mode),
                    name: displayName,
                });
                job.track = {
                    id: entry.id,
                    originalName: entry.name,
                    displayName: entry.name.replace(/\.[^.]+$/, ''),
                    filePath: entry.filePath,
                    publicUrl: entry.publicUrl,
                    durationSec: entry.durationSec ?? 0,
                    createdAt: entry.createdAt,
                    type: mode,
                };
                job.phase = 'done';
                job.percent = 100;
                job.stepPercent = 100;
                job.completedAt = Date.now();
            } catch (error) {
                job.phase = 'error';
                job.error = abortController.signal.aborted
                    ? 'Download cancelado.'
                    : error instanceof Error
                        ? error.message
                        : 'Falha ao baixar do Mileto Ops.';
                job.completedAt = Date.now();
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
                scheduleJobCleanup(jobId);
            }
        })();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Não foi possível iniciar o download do Mileto Ops.';
        res.status(400).json({ ok: false, message });
    }
};

// DELETE /api/download/:jobId
export const cancelDownload = (req: Request, res: Response) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, message: 'Download não encontrado.' });
    if (job.phase !== 'downloading') {
        return res.status(409).json({ ok: false, message: 'Este download já foi finalizado.' });
    }
    job.phase = 'error';
    job.error = 'Download cancelado.';
    job.completedAt = Date.now();
    if (job.process) terminateProcessTree(job.process);
    job.abortController?.abort();
    res.json({ ok: true });
};

// GET /api/download/status/:jobId
export const getDownloadStatus = (req: Request, res: Response) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, message: 'Download não encontrado.' });
    res.json({
        ok: true,
        phase: job.phase,
        percent: job.percent,
        step: job.step,
        stepPercent: job.stepPercent,
        mode: job.mode,
        title: job.title,
        track: job.track,
        error: job.error,
    });
};

// GET /api/download/jobs — fila da sessão atual, incluindo concluídos recentes.
export const listDownloadJobs = (_req: Request, res: Response) => {
    const items = [...jobs.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((job) => ({
            id: job.id,
            phase: job.phase,
            percent: job.percent,
            step: job.step,
            stepPercent: job.stepPercent,
            mode: job.mode,
            title: job.title,
            destination: job.destination,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            track: job.track,
            error: job.error,
        }));
    res.json({
        ok: true,
        jobs: items,
        activeCount: items.filter((job) => job.phase === 'downloading').length,
    });
};
