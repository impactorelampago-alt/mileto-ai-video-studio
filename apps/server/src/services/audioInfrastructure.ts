import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import fetch from 'node-fetch';
import ffmpeg from 'fluent-ffmpeg';
import { isWithinRoots, safeResolve } from '../utils/safePath';
import {
    gatewayAudioIsolation,
    type GatewayAudioIsolationResult,
} from './gatewayClient';

export const AUDIO_ISOLATION_PIPELINE_VERSION = 'voice-isolation-pcm16k-mono-envelope-align-v2';
export const TAKE_AUDIO_MIX_PIPELINE_VERSION = 'take-audio-opt-in-mix-v1';
export const MAX_ISOLATION_SECONDS = 10 * 60;
export const MAX_ISOLATION_REMOTE_BYTES = 512 * 1024 * 1024;
export const MAX_ISOLATION_REDIRECTS = 3;
export const ISOLATION_ALIGNMENT_TOLERANCE_SECONDS = 0.08;
export const ISOLATION_CORRELATION_WINDOW_SECONDS = 0.02;
export const ISOLATION_MAX_SEARCH_OFFSET_SECONDS = 0.5;
export const ISOLATION_MAX_ACCEPTED_OFFSET_SECONDS = 0.35;
export const ISOLATION_MIN_CORRELATION_CONFIDENCE = 0.2;

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const builtinMusicCandidates = [
    path.join(__dirname, '..', 'assets', 'system-music'),
    path.join(__dirname, '..', '..', 'assets', 'system-music'),
];
const BUILTIN_MUSIC_PATH = process.env.BUILTIN_MUSIC_PATH
    || builtinMusicCandidates.find((candidate) => fs.existsSync(candidate))
    || builtinMusicCandidates[0];
const ISOLATION_ROOT = path.join(BASE_DATA_PATH, 'narrations', 'isolated');
const AUDIO_WORK_ROOT = path.join(BASE_DATA_PATH, 'temp', 'audio-infrastructure');
const GATEWAY_ORIGIN = new URL(
    process.env.GATEWAY_BASE_URL || 'https://api.miletoaivideo.com.br',
).origin;
const OPS_MEDIA_PROXY_PATH = /^\/v1\/integrations\/mileto-ops\/media\/[A-Za-z0-9_-]{32,160}$/;

for (const directory of [ISOLATION_ROOT, AUDIO_WORK_ROOT]) {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

export type AudioIsolationSourceType = 'narration' | 'take' | 'audio';

export interface AudioSourceReference {
    sourceUrl?: string | null;
    sourcePath?: string | null;
}

export interface ResolvedAudioSource {
    kind: 'local' | 'remote';
    value: string;
    remoteKind?: 'r2' | 'ops';
}

export interface AudioProbe {
    duration: number;
    hasAudio: boolean;
}

export interface AudioIsolationResult {
    outputUrl: string;
    outputPath: string;
    sourceDuration: number;
    providerDuration: number;
    outputDuration: number;
    detectedOffsetSeconds: number;
    correlationConfidence: number;
    cacheHit: boolean;
    demo: boolean;
    charged: number;
    balance: number | null;
}

interface IsolationMetadata {
    version: string;
    cacheKey: string;
    sourceSha256: string;
    sourceType: AudioIsolationSourceType;
    sourceDuration: number;
    providerDuration: number;
    outputDuration: number;
    detectedOffsetSeconds: number;
    correlationConfidence: number;
    demo: boolean;
    createdAt: string;
}

export interface AudioIsolationDependencies {
    gateway?: typeof gatewayAudioIsolation;
    probe?: (filePath: string) => Promise<AudioProbe>;
    extractPcm?: (sourcePath: string, targetPath: string) => Promise<void>;
    align?: (sourcePath: string, targetPath: string, duration: number, offsetSeconds?: number) => Promise<void>;
    download?: (source: ResolvedAudioSource, targetPath: string) => Promise<void>;
}

const isolationJobs = new Map<string, Promise<AudioIsolationResult>>();

const finiteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeIsolationSourceType = (value: unknown): AudioIsolationSourceType => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'narration' || normalized === 'take' || normalized === 'audio') {
        return normalized;
    }
    throw new Error('sourceType deve ser narration, take ou audio.');
};

const realAllowedRoots = (roots: string[]): string[] => roots
    .filter((root) => fs.existsSync(root))
    .map((root) => fs.realpathSync(root));

const existingContainedFile = (candidate: string, roots: string[]): string => {
    if (/^(?:\\\\|\/\/|\\\\[?.]\\)/.test(candidate) || !path.isAbsolute(candidate)) {
        throw new Error('O caminho da fonte não é um arquivo local permitido.');
    }
    const resolved = path.resolve(candidate);
    if (!isWithinRoots(resolved, roots)) {
        throw new Error('A fonte está fora dos diretórios locais permitidos.');
    }
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size <= 0) throw new Error('A fonte de áudio está vazia ou não existe.');

    // Bloqueia symlink/junction que aparenta estar sob USER_DATA_PATH mas aponta
    // para fora. O caminho real é o que FFmpeg efetivamente abrirá.
    const real = fs.realpathSync(resolved);
    const allowed = realAllowedRoots(roots);
    if (!allowed.length || !isWithinRoots(real, allowed)) {
        throw new Error('A fonte local resolve para fora dos diretórios permitidos.');
    }
    return real;
};

const hasR2Signature = (url: URL): boolean => {
    const query = new Set(Array.from(url.searchParams.keys(), (key) => key.toLowerCase()));
    return query.has('x-amz-signature')
        || query.has('x-amz-credential')
        || query.has('signature')
        || query.has('token');
};

export const classifyTrustedIsolationRemoteUrl = (rawUrl: string): 'r2' | 'ops' | null => {
    let url: URL;
    try {
        url = new URL(String(rawUrl || ''));
    } catch {
        return null;
    }
    if (url.username || url.password || url.hash) return null;

    const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
    const r2Suffix = '.r2.cloudflarestorage.com';
    const r2Prefix = hostname.endsWith(r2Suffix)
        ? hostname.slice(0, -r2Suffix.length)
        : '';
    const validR2Host = Boolean(r2Prefix) && r2Prefix.split('.').every(
        (label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    );
    if (
        url.protocol === 'https:'
        && (!url.port || url.port === '443')
        && validR2Host
        && hasR2Signature(url)
    ) return 'r2';

    if (
        url.origin === GATEWAY_ORIGIN
        && !url.search
        && OPS_MEDIA_PROXY_PATH.test(url.pathname)
    ) return 'ops';
    return null;
};

const localPathFromUrl = (rawUrl: string, dataRoot: string): string | null => {
    let url: URL;
    let wasAbsolute = true;
    try {
        url = new URL(rawUrl);
    } catch {
        wasAbsolute = false;
        url = new URL(rawUrl, 'http://localhost');
    }

    if (wasAbsolute) {
        const host = url.hostname.toLowerCase().replace(/\.+$/, '');
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) return null;
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    }

    let pathname: string;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        throw new Error('A URL local contém codificação inválida.');
    }
    const mappings: Array<{ prefix: string; root: string }> = [
        { prefix: '/data/', root: path.join(dataRoot, 'data') },
        { prefix: '/music/', root: path.join(dataRoot, 'music') },
        { prefix: '/uploads/', root: path.join(dataRoot, 'uploads') },
        { prefix: '/narrations/', root: path.join(dataRoot, 'narrations') },
        { prefix: '/videos/', root: path.join(dataRoot, 'videos') },
        { prefix: '/transitions/', root: path.join(dataRoot, 'public', 'transitions') },
        { prefix: '/mixes/', root: path.join(dataRoot, 'public', 'mixes') },
        { prefix: '/files/', root: path.join(dataRoot, 'files') },
        { prefix: '/preview-cache/', root: path.join(dataRoot, 'preview-cache') },
        { prefix: '/system-music/', root: BUILTIN_MUSIC_PATH },
    ];
    const mapping = mappings.find(({ prefix }) => pathname.startsWith(prefix));
    if (!mapping) throw new Error('A URL local não pertence a um diretório de mídia permitido.');
    const relative = pathname.slice(mapping.prefix.length).replace(/^\/+/, '');
    const candidate = safeResolve(mapping.root, relative);
    return existingContainedFile(candidate, [mapping.root]);
};

export const resolveAudioSourceReference = (
    reference: AudioSourceReference,
    dataRoot = BASE_DATA_PATH,
): ResolvedAudioSource => {
    const sourcePath = String(reference.sourcePath || '').trim();
    const sourceUrl = String(reference.sourceUrl || '').trim();
    if (!sourcePath && !sourceUrl) throw new Error('Informe sourceUrl ou sourcePath.');

    if (sourcePath) {
        return {
            kind: 'local',
            value: existingContainedFile(sourcePath, [dataRoot]),
        };
    }

    const localPath = localPathFromUrl(sourceUrl, dataRoot);
    if (localPath) return { kind: 'local', value: localPath };

    const remoteKind = classifyTrustedIsolationRemoteUrl(sourceUrl);
    if (!remoteKind) {
        throw new Error('A URL remota não é uma entrega assinada R2/Ops permitida.');
    }
    return { kind: 'remote', value: sourceUrl, remoteKind };
};

const sizeLimiter = (maxBytes: number): Transform => {
    let received = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length;
            if (received > maxBytes) {
                callback(new Error('A fonte remota excedeu o limite seguro de tamanho.'));
                return;
            }
            callback(null, chunk);
        },
    });
};

export const downloadTrustedIsolationSource = async (
    source: ResolvedAudioSource,
    targetPath: string,
): Promise<void> => {
    if (source.kind !== 'remote' || !source.remoteKind) {
        throw new Error('A fonte solicitada não é remota.');
    }

    let currentUrl = source.value;
    const originalOrigin = new URL(currentUrl).origin;
    let redirects = 0;
    while (true) {
        const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(60_000),
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            (response.body as unknown as { destroy?: () => void } | null)?.destroy?.();
            if (source.remoteKind === 'ops') {
                throw new Error('A entrega Ops tentou redirecionar para outra origem.');
            }
            if (redirects >= MAX_ISOLATION_REDIRECTS) {
                throw new Error('A fonte R2 excedeu o limite de redirecionamentos.');
            }
            const location = response.headers.get('location');
            if (!location) throw new Error('A fonte R2 redirecionou sem destino.');
            const next = new URL(location, currentUrl);
            if (
                next.origin !== originalOrigin
                || classifyTrustedIsolationRemoteUrl(next.toString()) !== 'r2'
            ) {
                throw new Error('A fonte R2 redirecionou para um destino não permitido.');
            }
            currentUrl = next.toString();
            redirects += 1;
            continue;
        }
        if (!response.ok || !response.body) {
            throw new Error(`A entrega remota de áudio falhou (${response.status}).`);
        }
        const declared = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(declared) && declared > MAX_ISOLATION_REMOTE_BYTES) {
            (response.body as unknown as { destroy?: () => void }).destroy?.();
            throw new Error('A fonte remota excedeu o limite seguro de tamanho.');
        }
        await pipeline(
            response.body as unknown as NodeJS.ReadableStream,
            sizeLimiter(MAX_ISOLATION_REMOTE_BYTES),
            fs.createWriteStream(targetPath),
        );
        return;
    }
};

export const sha256File = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
});

export const buildIsolationCacheKey = (
    sourceSha256: string,
    sourceType: AudioIsolationSourceType,
): string => crypto.createHash('sha256').update(JSON.stringify({
    version: AUDIO_ISOLATION_PIPELINE_VERSION,
    sourceSha256,
    sourceType,
})).digest('hex');

export const probeAudioFile = (filePath: string): Promise<AudioProbe> => new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
        if (error) {
            reject(new Error('Não foi possível inspecionar o áudio.'));
            return;
        }
        const audioStream = metadata.streams.find((stream) => stream.codec_type === 'audio');
        const streamDuration = finiteNumber(audioStream?.duration);
        const formatDuration = finiteNumber(metadata.format.duration);
        const duration = streamDuration && streamDuration > 0
            ? streamDuration
            : formatDuration && formatDuration > 0
                ? formatDuration
                : 0;
        resolve({ duration, hasAudio: Boolean(audioStream) });
    });
});

const runFfmpeg = (
    configure: (command: ReturnType<typeof ffmpeg>) => ReturnType<typeof ffmpeg>,
    timeoutMs: number,
): Promise<void> => new Promise((resolve, reject) => {
    const command = configure(ffmpeg());
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        try {
            command.kill('SIGKILL');
        } catch {
            // O processo pode já ter encerrado entre o timer e o kill.
        }
    }, timeoutMs);
    command
        .on('end', () => {
            clearTimeout(timeout);
            resolve();
        })
        .on('error', () => {
            clearTimeout(timeout);
            reject(new Error(timedOut ? 'O processamento de áudio excedeu o tempo limite.' : 'O FFmpeg não conseguiu processar o áudio.'));
        });
});

export const extractPcmS16leMono16k = async (sourcePath: string, targetPath: string): Promise<void> => {
    await runFfmpeg(
        (command) => command
            .input(sourcePath)
            .noVideo()
            .outputOptions(['-map 0:a:0'])
            .audioCodec('pcm_s16le')
            .audioChannels(1)
            .audioFrequency(16000)
            .format('s16le')
            .save(targetPath),
        12 * 60 * 1000,
    );
};

export interface PcmEnvelopeAlignment {
    /** Positivo: a saída do provedor está atrasada e precisa perder o início. */
    offsetSeconds: number;
    confidence: number;
    comparedWindows: number;
}

const pcmEnvelope = (
    pcm: Buffer,
    sampleRate: number,
    windowSeconds: number,
): number[] => {
    const windowSamples = Math.max(32, Math.round(sampleRate * windowSeconds));
    const totalSamples = Math.floor(pcm.length / 2);
    const envelope: number[] = [];
    for (let start = 0; start + windowSamples <= totalSamples; start += windowSamples) {
        let energy = 0;
        for (let index = 0; index < windowSamples; index += 1) {
            const sample = pcm.readInt16LE((start + index) * 2) / 32768;
            energy += sample * sample;
        }
        envelope.push(Math.sqrt(energy / windowSamples));
    }
    return envelope;
};

const pearsonAtLag = (original: number[], isolated: number[], lag: number): {
    correlation: number;
    count: number;
} => {
    const originalStart = Math.max(0, -lag);
    const isolatedStart = Math.max(0, lag);
    const count = Math.min(original.length - originalStart, isolated.length - isolatedStart);
    if (count < 10) return { correlation: -1, count };

    let originalMean = 0;
    let isolatedMean = 0;
    for (let index = 0; index < count; index += 1) {
        originalMean += original[originalStart + index];
        isolatedMean += isolated[isolatedStart + index];
    }
    originalMean /= count;
    isolatedMean /= count;

    let numerator = 0;
    let originalEnergy = 0;
    let isolatedEnergy = 0;
    for (let index = 0; index < count; index += 1) {
        const a = original[originalStart + index] - originalMean;
        const b = isolated[isolatedStart + index] - isolatedMean;
        numerator += a * b;
        originalEnergy += a * a;
        isolatedEnergy += b * b;
    }
    const denominator = Math.sqrt(originalEnergy * isolatedEnergy);
    return {
        correlation: denominator > 1e-12 ? numerator / denominator : -1,
        count,
    };
};

/**
 * Compara envelopes RMS em PCM mono/16 kHz. Correlação por envelope tolera a
 * mudança de timbre causada pelo isolamento, mas ainda detecta atraso ou avanço
 * que quebraria a sincronização labial.
 */
export const detectPcmEnvelopeAlignment = (
    originalPcm: Buffer,
    isolatedPcm: Buffer,
    sampleRate = 16000,
): PcmEnvelopeAlignment => {
    const original = pcmEnvelope(originalPcm, sampleRate, ISOLATION_CORRELATION_WINDOW_SECONDS);
    const isolated = pcmEnvelope(isolatedPcm, sampleRate, ISOLATION_CORRELATION_WINDOW_SECONDS);
    if (original.length < 10 || isolated.length < 10) {
        return { offsetSeconds: 0, confidence: 0, comparedWindows: Math.min(original.length, isolated.length) };
    }

    const maxLag = Math.max(1, Math.round(
        ISOLATION_MAX_SEARCH_OFFSET_SECONDS / ISOLATION_CORRELATION_WINDOW_SECONDS,
    ));
    let bestLag = 0;
    let bestCorrelation = -1;
    let comparedWindows = 0;
    for (let lag = -maxLag; lag <= maxLag; lag += 1) {
        const candidate = pearsonAtLag(original, isolated, lag);
        if (
            candidate.correlation > bestCorrelation + 1e-9
            || (Math.abs(candidate.correlation - bestCorrelation) <= 1e-9 && Math.abs(lag) < Math.abs(bestLag))
        ) {
            bestLag = lag;
            bestCorrelation = candidate.correlation;
            comparedWindows = candidate.count;
        }
    }
    return {
        offsetSeconds: bestLag * ISOLATION_CORRELATION_WINDOW_SECONDS,
        confidence: Number(Math.max(-1, Math.min(1, bestCorrelation)).toFixed(6)),
        comparedWindows,
    };
};

export const buildIsolationAlignmentFilter = (duration: number, offsetSeconds = 0): string => {
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_ISOLATION_SECONDS) {
        throw new Error('Duração de alinhamento inválida.');
    }
    if (!Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) > ISOLATION_MAX_ACCEPTED_OFFSET_SECONDS) {
        throw new Error('O offset detectado excede o limite seguro de lip-sync.');
    }
    const alignment = offsetSeconds > 0.0005
        ? `atrim=start=${offsetSeconds.toFixed(6)},asetpts=PTS-STARTPTS,`
        : offsetSeconds < -0.0005
            ? `adelay=${Math.round(Math.abs(offsetSeconds) * 1000)}:all=1,`
            : '';
    return `${alignment}aresample=16000,apad,atrim=duration=${duration.toFixed(6)},asetpts=PTS-STARTPTS`;
};

export const alignIsolatedAudio = async (
    sourcePath: string,
    targetPath: string,
    duration: number,
    offsetSeconds = 0,
): Promise<void> => {
    const filter = buildIsolationAlignmentFilter(duration, offsetSeconds);
    await runFfmpeg(
        (command) => command
            .input(sourcePath)
            .noVideo()
            .audioFilters(filter)
            .audioCodec('pcm_s16le')
            .audioChannels(1)
            .audioFrequency(16000)
            .format('wav')
            .save(targetPath),
        12 * 60 * 1000,
    );
};

export const hasSevereIsolationDurationDrift = (
    sourceDuration: number,
    providerDuration: number,
): boolean => {
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return true;
    if (!Number.isFinite(providerDuration) || providerDuration <= 0) return true;
    const allowed = Math.max(2, sourceDuration * 0.05);
    return Math.abs(sourceDuration - providerDuration) > allowed;
};

export const assertNonDestructiveAudioTarget = (sourcePath: string, targetPath: string): void => {
    if (path.resolve(sourcePath) === path.resolve(targetPath)) {
        throw new Error('O processamento de áudio nunca pode sobrescrever a fonte original.');
    }
};

const alignedCacheValid = async (
    targetPath: string,
    metadataPath: string,
    cacheKey: string,
    sourceDuration: number,
    probe: (filePath: string) => Promise<AudioProbe>,
): Promise<IsolationMetadata | null> => {
    try {
        const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8')) as IsolationMetadata;
        if (
            metadata.version !== AUDIO_ISOLATION_PIPELINE_VERSION
            || metadata.cacheKey !== cacheKey
            || Math.abs(metadata.sourceDuration - sourceDuration) > ISOLATION_ALIGNMENT_TOLERANCE_SECONDS
            || !Number.isFinite(metadata.detectedOffsetSeconds)
            || !Number.isFinite(metadata.correlationConfidence)
        ) return null;
        const linkStat = await fs.promises.lstat(targetPath);
        if (linkStat.isSymbolicLink() || !linkStat.isFile() || linkStat.size <= 44) return null;
        const outputProbe = await probe(targetPath);
        if (!outputProbe.hasAudio || outputProbe.duration <= 0) return null;
        if (Math.abs(outputProbe.duration - sourceDuration) > ISOLATION_ALIGNMENT_TOLERANCE_SECONDS) return null;
        return { ...metadata, outputDuration: outputProbe.duration };
    } catch {
        return null;
    }
};

const responseFromMetadata = (
    fileName: string,
    outputPath: string,
    metadata: IsolationMetadata,
): AudioIsolationResult => ({
    outputUrl: `/narrations/isolated/${encodeURIComponent(fileName)}`,
    outputPath,
    sourceDuration: metadata.sourceDuration,
    providerDuration: metadata.providerDuration,
    outputDuration: metadata.outputDuration,
    detectedOffsetSeconds: metadata.detectedOffsetSeconds,
    correlationConfidence: metadata.correlationConfidence,
    cacheHit: true,
    demo: metadata.demo,
    charged: 0,
    balance: null,
});

const writeJsonAtomically = async (targetPath: string, value: unknown): Promise<void> => {
    const temporaryPath = `${targetPath}.${process.pid}-${crypto.randomUUID()}.tmp`;
    try {
        await fs.promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await fs.promises.rename(temporaryPath, targetPath);
    } finally {
        await fs.promises.unlink(temporaryPath).catch(() => undefined);
    }
};

export const isolateAudioSource = async (
    input: AudioSourceReference & {
        sourceType: AudioIsolationSourceType;
        token: string;
        dataRoot?: string;
    },
    dependencies: AudioIsolationDependencies = {},
): Promise<AudioIsolationResult> => {
    const dataRoot = input.dataRoot || BASE_DATA_PATH;
    const isolationRoot = input.dataRoot
        ? path.join(dataRoot, 'narrations', 'isolated')
        : ISOLATION_ROOT;
    const workRoot = input.dataRoot
        ? path.join(dataRoot, 'temp', 'audio-infrastructure')
        : AUDIO_WORK_ROOT;
    await fs.promises.mkdir(isolationRoot, { recursive: true });
    await fs.promises.mkdir(workRoot, { recursive: true });

    const gateway = dependencies.gateway || gatewayAudioIsolation;
    const probe = dependencies.probe || probeAudioFile;
    const extractPcm = dependencies.extractPcm || extractPcmS16leMono16k;
    const align = dependencies.align || alignIsolatedAudio;
    const download = dependencies.download || downloadTrustedIsolationSource;
    const resolved = resolveAudioSourceReference(input, dataRoot);
    const workDirectory = await fs.promises.mkdtemp(path.join(workRoot, 'isolate-'));

    try {
        const sourcePath = resolved.kind === 'local'
            ? resolved.value
            : path.join(workDirectory, 'remote-source.bin');
        if (resolved.kind === 'remote') await download(resolved, sourcePath);

        const sourceProbe = await probe(sourcePath);
        if (!sourceProbe.hasAudio || sourceProbe.duration <= 0) {
            throw new Error('A fonte não contém uma faixa de áudio utilizável.');
        }
        if (sourceProbe.duration > MAX_ISOLATION_SECONDS + ISOLATION_ALIGNMENT_TOLERANCE_SECONDS) {
            throw new Error('O isolamento aceita no máximo 10 minutos de áudio.');
        }

        const sourceSha256 = await sha256File(sourcePath);
        const cacheKey = buildIsolationCacheKey(sourceSha256, input.sourceType);
        const fileName = `voice-${cacheKey}.wav`;
        const outputPath = path.join(isolationRoot, fileName);
        const metadataPath = path.join(isolationRoot, `voice-${cacheKey}.json`);
        assertNonDestructiveAudioTarget(sourcePath, outputPath);

        const cached = await alignedCacheValid(
            outputPath,
            metadataPath,
            cacheKey,
            sourceProbe.duration,
            probe,
        );
        if (cached) return responseFromMetadata(fileName, outputPath, cached);

        const running = isolationJobs.get(outputPath);
        if (running) {
            const result = await running;
            return { ...result, cacheHit: true, charged: 0, balance: null };
        }

        const job = (async (): Promise<AudioIsolationResult> => {
            // Revalida depois de adquirir o lock por caminho: outra requisição
            // pode ter terminado entre a primeira leitura e este ponto.
            const newlyCached = await alignedCacheValid(
                outputPath,
                metadataPath,
                cacheKey,
                sourceProbe.duration,
                probe,
            );
            if (newlyCached) return responseFromMetadata(fileName, outputPath, newlyCached);

            // Só remove destinos derivados do hash sob isolationRoot. A fonte já
            // foi comparada com outputPath e nunca é tocada por esta recuperação.
            await fs.promises.unlink(outputPath).catch(() => undefined);
            await fs.promises.unlink(metadataPath).catch(() => undefined);

            const pcmPath = path.join(workDirectory, 'source.pcm');
            const providerPath = path.join(workDirectory, 'provider-output.bin');
            const providerPcmPath = path.join(workDirectory, 'provider-output.pcm');
            const alignedTemporaryPath = path.join(
                isolationRoot,
                `voice-${cacheKey}.${process.pid}-${crypto.randomUUID()}.tmp.wav`,
            );
            await extractPcm(sourcePath, pcmPath);
            const gatewayResult: GatewayAudioIsolationResult = await gateway(
                input.token,
                pcmPath,
                sourceProbe.duration,
                input.sourceType,
            );
            await fs.promises.writeFile(providerPath, gatewayResult.audio);

            const providerProbe = await probe(providerPath);
            if (!providerProbe.hasAudio || providerProbe.duration <= 0) {
                throw new Error('O gateway devolveu um áudio isolado inválido.');
            }
            if (hasSevereIsolationDurationDrift(sourceProbe.duration, providerProbe.duration)) {
                throw new Error('O isolamento alterou gravemente a duração e foi descartado para preservar o sincronismo.');
            }
            await extractPcm(providerPath, providerPcmPath);
            const alignment = detectPcmEnvelopeAlignment(
                await fs.promises.readFile(pcmPath),
                await fs.promises.readFile(providerPcmPath),
            );
            if (alignment.confidence < ISOLATION_MIN_CORRELATION_CONFIDENCE) {
                throw new Error(
                    'O isolamento não preservou informação temporal suficiente para confirmar lip-sync e foi descartado.',
                );
            }
            if (Math.abs(alignment.offsetSeconds) > ISOLATION_MAX_ACCEPTED_OFFSET_SECONDS) {
                throw new Error(
                    `O isolamento deslocou o áudio em ${alignment.offsetSeconds.toFixed(3)} s e foi descartado para preservar lip-sync.`,
                );
            }

            try {
                await align(providerPath, alignedTemporaryPath, sourceProbe.duration, alignment.offsetSeconds);
                const alignedProbe = await probe(alignedTemporaryPath);
                if (
                    !alignedProbe.hasAudio
                    || Math.abs(alignedProbe.duration - sourceProbe.duration) > ISOLATION_ALIGNMENT_TOLERANCE_SECONDS
                ) {
                    throw new Error('Não foi possível alinhar o áudio isolado à duração original.');
                }
                assertNonDestructiveAudioTarget(sourcePath, alignedTemporaryPath);
                await fs.promises.rename(alignedTemporaryPath, outputPath);

                const metadata: IsolationMetadata = {
                    version: AUDIO_ISOLATION_PIPELINE_VERSION,
                    cacheKey,
                    sourceSha256,
                    sourceType: input.sourceType,
                    sourceDuration: sourceProbe.duration,
                    providerDuration: providerProbe.duration,
                    outputDuration: alignedProbe.duration,
                    detectedOffsetSeconds: alignment.offsetSeconds,
                    correlationConfidence: alignment.confidence,
                    demo: gatewayResult.demo,
                    createdAt: new Date().toISOString(),
                };
                await writeJsonAtomically(metadataPath, metadata);
                return {
                    outputUrl: `/narrations/isolated/${encodeURIComponent(fileName)}`,
                    outputPath,
                    sourceDuration: sourceProbe.duration,
                    providerDuration: providerProbe.duration,
                    outputDuration: alignedProbe.duration,
                    detectedOffsetSeconds: alignment.offsetSeconds,
                    correlationConfidence: alignment.confidence,
                    cacheHit: false,
                    demo: gatewayResult.demo,
                    charged: gatewayResult.charged,
                    balance: gatewayResult.balance,
                };
            } finally {
                await fs.promises.unlink(alignedTemporaryPath).catch(() => undefined);
            }
        })().finally(() => {
            if (isolationJobs.get(outputPath) === job) isolationJobs.delete(outputPath);
        });

        isolationJobs.set(outputPath, job);
        return await job;
    } finally {
        // workDirectory é sempre criado sob a raiz fixa e nunca contém a fonte
        // local original; somente PCM e respostas transitórias são removidos.
        const relative = path.relative(workRoot, workDirectory);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
            await fs.promises.rm(workDirectory, { recursive: true, force: true });
        }
    }
};
