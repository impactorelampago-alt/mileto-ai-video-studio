import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import fetch, { Response as FetchResponse } from 'node-fetch';
import { bearerFrom, GatewayHttpError, gatewayJson, gatewayUploadFile } from '../services/gatewayClient';
import { BASE_DATA_PATH } from './fileExplorerController';
import { resolveLocalSource } from './sharedController';
import { getVideoEncoderArgs, getVideoMetadata } from '../services/ffmpeg';
import { selectOpsPreviewProxyProfile, type OpsPreviewProxyProfile } from '../services/opsPreviewProxy';
import { isSafeRemoteUrl, safeResolve } from '../utils/safePath';
import {
    compactOpsText,
    prepareOpsExportMetadata,
    validateOpsExportMetadata,
} from '../services/opsExportMetadata';

const CACHE_ROOT = path.join(BASE_DATA_PATH, 'ops-cache');
// O índice contém capabilities locais e nunca pode ficar sob uma rota estática.
const INDEX_PATH = path.join(CACHE_ROOT, 'index.json');
const MAX_BYTES = Math.max(1024 * 1024 * 1024, Number(process.env.OPS_CACHE_MAX_BYTES || 20 * 1024 ** 3));
const TTL_MS = Math.max(24 * 60 * 60 * 1000, Number(process.env.OPS_CACHE_TTL_DAYS || 7) * 24 * 60 * 60 * 1000);
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const activeMaterializations = new Set<string>();
const OPS_BASE_URL = process.env.OPS_BASE_URL || 'https://miletoops.com';
const OPS_MEDIA_ORIGIN = new URL(OPS_BASE_URL).origin;
const OPS_MEDIA_PATH = /^\/api\/integrations\/mileto-ai-video\/delivery\/[^/]+$/;
const OPS_VIEW_CONTEXT_HEADER = 'x-ops-view-context';
const OPS_EXPORT_MAX_BYTES = Math.max(25 * 1024 * 1024, Number(process.env.OPS_EXPORT_MAX_BYTES || 512 * 1024 * 1024));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const viewContextFrom = (req: Request): string | null => {
    const raw = req.headers[OPS_VIEW_CONTEXT_HEADER];
    if (raw === undefined || raw === null || raw === '') return null;
    if (Array.isArray(raw)) throw new GatewayHttpError(422, 'Contexto do Mileto Ops inválido.');
    const contextId = String(raw).trim();
    if (
        contextId.length < 20 ||
        contextId.length > 300 ||
        !/^[A-Za-z0-9._~-]+$/.test(contextId)
    ) {
        throw new GatewayHttpError(422, 'Contexto do Mileto Ops inválido.');
    }
    return contextId;
};

interface ExternalReference {
    id: string;
    connectionId: string;
    accountId: string;
    companyId: string;
    folderId?: string | null;
    assetId: string;
    name: string;
    kind: 'video' | 'image' | 'audio' | string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    mid?: string | null;
    version?: string | null;
    checksum?: string | null;
    opsUpdatedAt?: string | null;
    capabilities?: Record<string, unknown>;
}

interface DownloadDescriptor {
    url?: string;
    ready?: boolean;
    retryAfterSeconds?: number;
    expiresAt?: string | null;
    delivery?: 'hls' | 'mp4' | 'signed-object' | string;
    supportsRange?: boolean | null;
    sizeBytes?: number | null;
    checksum?: string | null;
    mimeType?: string | null;
    fileName?: string | null;
}

interface CacheEntry {
    cacheId: string;
    referenceId: string;
    cacheKey: string;
    assetId: string;
    name: string;
    kind: string;
    mimeType: string | null;
    sizeBytes: number;
    localSha256: string;
    accessCapability: string;
    filePath: string;
    proxyPath?: string | null;
    proxyProfile?: OpsPreviewProxyProfile | null;
    delivery?: string | null;
    duration: number;
    frames: string[];
    createdAt: string;
    lastAccessedAt: string;
}

interface DownloadResponse {
    ok: boolean;
    reference: ExternalReference;
    download: DownloadDescriptor;
}

const ensureDirs = () => {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
};
ensureDirs();

const readIndex = (): CacheEntry[] => {
    try {
        if (!fs.existsSync(INDEX_PATH)) return [];
        const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const PROJECTS_ROOT = path.join(BASE_DATA_PATH, 'data', 'projects');

/**
 * Arquivos do Ops usados por um rascunho deixam de ser cache descartável: eles
 * são a cópia local persistente daquele take. A varredura é propositalmente
 * tolerante a rascunhos antigos/corrompidos para nunca interromper a limpeza.
 */
const draftReferencedOpsIdentities = () => {
    const cacheIds = new Set<string>();
    const referenceIds = new Set<string>();
    const assetIds = new Set<string>();
    if (!fs.existsSync(PROJECTS_ROOT)) return { cacheIds, referenceIds, assetIds };

    for (const project of fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
        if (!project.isDirectory()) continue;
        const dataPath = path.join(PROJECTS_ROOT, project.name, 'ad-data.json');
        if (!fs.existsSync(dataPath)) continue;
        try {
            const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as {
                mediaTakes?: Array<{
                    externalMedia?: {
                        source?: string;
                        cacheId?: string | null;
                        referenceId?: string | null;
                        assetId?: string | null;
                    };
                }>;
            };
            for (const take of parsed.mediaTakes || []) {
                if (take.externalMedia?.source !== 'mileto_ops') continue;
                const cacheId = String(take.externalMedia.cacheId || '');
                const referenceId = String(take.externalMedia.referenceId || '');
                const assetId = String(take.externalMedia.assetId || '');
                if (/^[0-9a-f]{32}$/i.test(cacheId)) cacheIds.add(cacheId);
                if (/^[0-9a-f-]{36}$/i.test(referenceId)) referenceIds.add(referenceId);
                if (/^[0-9a-f-]{36}$/i.test(assetId)) assetIds.add(assetId);
            }
        } catch {
            // Um projeto ilegível não deve impedir que os demais sejam protegidos.
        }
    }
    return { cacheIds, referenceIds, assetIds };
};

const writeIndex = (entries: CacheEntry[]) => {
    const temporary = `${INDEX_PATH}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(temporary, INDEX_PATH);
};

const extensionFor = (reference: ExternalReference, download: DownloadDescriptor) => {
    if (download.delivery === 'mp4') return '.mp4';
    const existing = path.extname(download.fileName || reference.name || '').toLowerCase();
    const mime = String(download.mimeType || reference.mimeType || '').toLowerCase().split(';')[0].trim();
    const byMime: Record<string, string> = {
        'video/mp4': '.mp4',
        'video/quicktime': '.mov',
        'video/webm': '.webm',
        'video/x-matroska': '.mkv',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/avif': '.avif',
        'audio/mpeg': '.mp3',
        'audio/wav': '.wav',
        'audio/ogg': '.ogg',
        'audio/flac': '.flac',
    };
    if (byMime[mime]) return byMime[mime];
    const allowedByKind: Record<string, Set<string>> = {
        video: new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mpeg', '.mpg']),
        image: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']),
        audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']),
    };
    if (allowedByKind[reference.kind]?.has(existing)) return existing;
    return reference.kind === 'image' ? '.img' : reference.kind === 'audio' ? '.audio' : '.video';
};

const cacheKeyFor = (reference: ExternalReference, download: DownloadDescriptor) =>
    [
        reference.connectionId,
        reference.assetId,
        reference.version || reference.checksum || reference.opsUpdatedAt || 'unversioned',
        download.delivery || 'unknown-delivery',
    ].join(':');

const cacheIdFor = (cacheKey: string) => crypto.createHash('sha256').update(cacheKey).digest('hex').slice(0, 32);

const newAccessCapability = () => crypto.randomBytes(32).toString('base64url');

const cacheFileUrl = (cacheId: string, filePath: string, accessCapability: string) =>
    `/api/ops/cache/file/${cacheId}/${encodeURIComponent(path.basename(filePath))}?cap=${encodeURIComponent(accessCapability)}`;

const ensureAccessCapability = (entry: CacheEntry) => {
    if (!entry.accessCapability) entry.accessCapability = newAccessCapability();
    return entry.accessCapability;
};

const capabilityMatches = (actual: string, expected: string) => {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

const hashFile = (filePath: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });

const removeEntryFiles = (entry: CacheEntry) => {
    const directory = safeResolve(CACHE_ROOT, entry.cacheId);
    fs.rmSync(directory, { recursive: true, force: true });
};

const cleanupCache = (protectedCacheId?: string) => {
    const now = Date.now();
    const protectedIdentities = draftReferencedOpsIdentities();
    if (protectedCacheId) protectedIdentities.cacheIds.add(protectedCacheId);
    const isProtected = (entry: CacheEntry) =>
        protectedIdentities.cacheIds.has(entry.cacheId) ||
        protectedIdentities.referenceIds.has(entry.referenceId) ||
        protectedIdentities.assetIds.has(entry.assetId);
    let entries = readIndex().filter((entry) => {
        const exists = fs.existsSync(entry.filePath);
        const expired = now - new Date(entry.lastAccessedAt).getTime() > TTL_MS;
        if ((!exists || expired) && !isProtected(entry)) {
            removeEntryFiles(entry);
            return false;
        }
        return exists;
    });

    let total = entries.reduce((sum, entry) => sum + Number(entry.sizeBytes || 0), 0);
    if (total > MAX_BYTES * 0.9) {
        const oldestFirst = [...entries].sort(
            (a, b) => new Date(a.lastAccessedAt).getTime() - new Date(b.lastAccessedAt).getTime()
        );
        const removed = new Set<string>();
        for (const entry of oldestFirst) {
            if (total <= MAX_BYTES * 0.75) break;
            if (isProtected(entry)) continue;
            removeEntryFiles(entry);
            total -= Number(entry.sizeBytes || 0);
            removed.add(entry.cacheId);
        }
        entries = entries.filter((entry) => !removed.has(entry.cacheId));
    }
    writeIndex(entries);
};

const responseSource = (entry: CacheEntry, reference: ExternalReference) => {
    const accessCapability = ensureAccessCapability(entry);
    return {
        id: entry.cacheId,
        path: entry.filePath,
        fileName: entry.name,
        duration: entry.duration,
        frames: [],
        type: entry.kind,
        url: cacheFileUrl(entry.cacheId, entry.filePath, accessCapability),
        proxyUrl: entry.proxyPath ? cacheFileUrl(entry.cacheId, entry.proxyPath, accessCapability) : '',
        cacheId: entry.cacheId,
        externalMedia: {
            source: 'mileto_ops',
            referenceId: reference.id,
            connectionId: reference.connectionId,
            accountId: reference.accountId,
            companyId: reference.companyId,
            folderId: reference.folderId || null,
            assetId: reference.assetId,
            mid: reference.mid || null,
            version: reference.version || null,
            checksum: reference.checksum || null,
            opsUpdatedAt: reference.opsUpdatedAt || null,
            cacheId: entry.cacheId,
        },
    };
};

const restoredCacheSource = (entry: CacheEntry) => {
    const accessCapability = ensureAccessCapability(entry);
    return {
        id: entry.cacheId,
        path: entry.filePath,
        fileName: entry.name,
        duration: entry.duration,
        frames: [],
        type: entry.kind,
        url: cacheFileUrl(entry.cacheId, entry.filePath, accessCapability),
        proxyUrl: entry.proxyPath ? cacheFileUrl(entry.cacheId, entry.proxyPath, accessCapability) : '',
        cacheId: entry.cacheId,
        externalMedia: {
            source: 'mileto_ops',
            referenceId: entry.referenceId,
            assetId: entry.assetId,
            cacheId: entry.cacheId,
        },
    };
};

const abortableDelay = (seconds: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            const error = new Error('Operação cancelada.');
            error.name = 'AbortError';
            reject(error);
            return;
        }
        const delayMs = Math.min(10, Math.max(1, Number(seconds) || 5)) * 1000;
        const onAbort = () => {
            clearTimeout(timer);
            const error = new Error('Operação cancelada.');
            error.name = 'AbortError';
            reject(error);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, delayMs);
        signal?.addEventListener('abort', onAbort, { once: true });
    });

const assertAllowedOpsMediaUrl = (rawUrl: string) => {
    let mediaUrl: URL;
    try {
        mediaUrl = new URL(String(rawUrl));
    } catch {
        throw new GatewayHttpError(502, 'O Mileto Ops devolveu uma URL de mídia inválida.');
    }
    if (!isSafeRemoteUrl(mediaUrl.toString())) {
        throw new GatewayHttpError(502, 'O Mileto Ops devolveu uma URL de mídia inválida.');
    }
    if (mediaUrl.username || mediaUrl.password) {
        throw new GatewayHttpError(502, 'A URL de mídia do Mileto Ops contém credenciais.');
    }
    if (mediaUrl.origin !== OPS_MEDIA_ORIGIN) {
        throw new GatewayHttpError(502, 'A URL de mídia não pertence à origem configurada do Mileto Ops.');
    }
    if (process.env.NODE_ENV === 'production' && mediaUrl.protocol !== 'https:') {
        throw new GatewayHttpError(502, 'A URL de mídia do Mileto Ops deve usar HTTPS.');
    }
    if (!OPS_MEDIA_PATH.test(mediaUrl.pathname) || mediaUrl.search || mediaUrl.hash) {
        throw new GatewayHttpError(502, 'A URL de mídia não usa o caminho autorizado da integração.');
    }
    return mediaUrl;
};

const fetchFollowingPublicRedirects = async (
    rawUrl: string,
    redirects = 0,
    pendingAttempts = 0,
    signal?: AbortSignal
): Promise<FetchResponse> => {
    const currentUrl = assertAllowedOpsMediaUrl(rawUrl);
    if (redirects > 3) throw new GatewayHttpError(502, 'A mídia do Mileto Ops redirecionou vezes demais.');
    let response: FetchResponse;
    try {
        const timeoutSignal = AbortSignal.timeout(30 * 60 * 1000);
        response = await fetch(currentUrl.toString(), {
            method: 'GET',
            redirect: 'manual',
            signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
        });
    } catch (error) {
        const name = (error as Error)?.name;
        if (signal?.aborted) throw new GatewayHttpError(499, 'Operação cancelada.');
        if (name === 'AbortError' || name === 'TimeoutError') {
            throw new GatewayHttpError(504, 'O download do Mileto Ops demorou demais.');
        }
        throw new GatewayHttpError(502, 'A mídia do Mileto Ops ficou indisponível durante o download.');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new GatewayHttpError(502, 'Redirecionamento de mídia sem destino.');
        const next = new URL(location, currentUrl).toString();
        return fetchFollowingPublicRedirects(next, redirects + 1, pendingAttempts, signal);
    }
    if (response.status === 202) {
        if (pendingAttempts >= 11) {
            throw new GatewayHttpError(504, 'O vídeo ainda está sendo preparado pelo provedor. Tente novamente.');
        }
        let retryAfterSeconds = Number(response.headers.get('retry-after') || 5);
        try {
            const body = (await response.json()) as { retryAfterSeconds?: number };
            retryAfterSeconds = Number(body.retryAfterSeconds || retryAfterSeconds);
        } catch {
            // Retry-After/default continuam válidos mesmo sem JSON.
        }
        await abortableDelay(retryAfterSeconds, signal);
        return fetchFollowingPublicRedirects(currentUrl.toString(), redirects, pendingAttempts + 1, signal);
    }
    return response;
};

const pipeResponseToFile = (response: FetchResponse, filePath: string): Promise<number> =>
    new Promise((resolve, reject) => {
        if (!response.body) return reject(new Error('Resposta de mídia vazia.'));
        const body = response.body as unknown as NodeJS.ReadableStream & { destroy: () => void };
        const output = fs.createWriteStream(filePath, { flags: 'w' });
        let receivedBytes = 0;
        let settled = false;
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            body.destroy();
            output.destroy();
            reject(error);
        };
        body.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (receivedBytes > MAX_BYTES) {
                fail(new GatewayHttpError(413, 'O arquivo ultrapassou a quota local do cache Ops.'));
            }
        });
        body.on('error', fail);
        output.on('error', fail);
        output.on('finish', () => {
            if (settled) return;
            settled = true;
            resolve(receivedBytes);
        });
        body.pipe(output);
    });

const requestDownload = async (
    token: string,
    referenceId: string,
    viewContextId: string | null,
    signal?: AbortSignal
): Promise<DownloadResponse> =>
    gatewayJson<DownloadResponse>(
        token,
        `/v1/integrations/mileto-ops/references/${encodeURIComponent(referenceId)}/download`,
        {
            method: 'POST',
            body: {},
            headers: viewContextId ? { 'X-Ops-View-Context': viewContextId } : {},
            signal,
        },
        150000
    );

interface DownloadedDelivery {
    response: DownloadResponse;
    receivedBytes: number;
    contentLength: number | null;
    effectiveMimeType: string;
}

const effectiveMimeFor = (
    reference: ExternalReference,
    descriptor: DownloadDescriptor,
    response: FetchResponse
) => {
    const headerMime = String(response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    const declaredMime = String(descriptor.mimeType || '').toLowerCase().split(';')[0].trim();
    const effectiveMime = headerMime || declaredMime;
    if (!effectiveMime || ['application/json', 'text/html', 'text/plain'].includes(effectiveMime)) {
        throw new GatewayHttpError(422, 'O provedor devolveu um tipo de arquivo inválido.');
    }
    if (descriptor.delivery === 'mp4' && effectiveMime !== 'video/mp4') {
        throw new GatewayHttpError(422, 'O provedor não devolveu o MP4 esperado.');
    }
    if (descriptor.delivery === 'signed-object') {
        if (reference.kind === 'image' && !effectiveMime.startsWith('image/')) {
            throw new GatewayHttpError(422, 'O provedor não devolveu uma imagem válida.');
        }
        if (reference.kind === 'video' && !effectiveMime.startsWith('video/')) {
            throw new GatewayHttpError(422, 'O provedor não devolveu um vídeo válido.');
        }
    }
    return effectiveMime;
};

const downloadWithRenewal = async (
    token: string,
    referenceId: string,
    viewContextId: string | null,
    targetPart: string,
    initial: DownloadResponse,
    signal?: AbortSignal
): Promise<DownloadedDelivery> => {
    let latest: DownloadResponse | null = initial;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) latest = await requestDownload(token, referenceId, viewContextId, signal);
        if (signal?.aborted) throw new GatewayHttpError(499, 'Operação cancelada.');
        if (!latest.download?.url) throw new GatewayHttpError(502, 'O Mileto Ops não devolveu URL de download.');
        if (latest.download.delivery === 'hls') {
            throw new GatewayHttpError(422, 'A entrega HLS não pode ser usada como arquivo de edição.');
        }
        const response = await fetchFollowingPublicRedirects(latest.download.url, 0, 0, signal);
        if ([401, 403, 410].includes(response.status) && attempt < 2) continue;
        if (!response.ok) throw new GatewayHttpError(response.status, `Falha ao baixar mídia do Mileto Ops (${response.status}).`);
        const declaredHeader = Number(response.headers.get('content-length') || 0);
        const declaredDescriptor = Number(latest.download.sizeBytes || 0);
        const declared = declaredDescriptor || declaredHeader;
        if (declared > MAX_BYTES) throw new GatewayHttpError(413, 'O arquivo é maior que a quota local do cache Ops.');
        try {
            const effectiveMimeType = effectiveMimeFor(latest.reference, latest.download, response);
            const receivedBytes = await pipeResponseToFile(response, targetPart);
            return {
                response: latest,
                receivedBytes,
                contentLength: declared > 0 ? declared : null,
                effectiveMimeType,
            };
        } catch (error) {
            fs.rmSync(targetPart, { force: true });
            if (error instanceof GatewayHttpError && [413, 422, 499].includes(error.status)) throw error;
            if (attempt >= 2) throw error;
            // A URL pode ter expirado no meio do stream; busca outra e reinicia.
        }
    }
    throw new GatewayHttpError(410, 'A autorização de download expirou repetidamente. Tente novamente.');
};

const generateProxy = async (
    inputPath: string,
    outputPath: string,
    profile: OpsPreviewProxyProfile = 'standard',
) =>
    new Promise<boolean>((resolve) => {
        const trimPreview = profile === 'trim';
        const child = spawn(FFMPEG_BIN, [
            '-y',
            '-i',
            inputPath,
            '-vf',
            // O proxy de recorte só existe para compatibilidade de codec: 360p
            // e ultrafast reduzem bastante a espera dos MOV/HEVC de celular.
            // O proxy padrão do editor mantém os 540p anteriores.
            trimPreview ? 'scale=360:-2' : 'scale=540:-2',
            ...getVideoEncoderArgs({
                quality: trimPreview ? 31 : 28,
                speed: trimPreview ? 'ultrafast' : 'veryfast',
            }),
            '-movflags',
            '+faststart',
            '-c:a',
            'aac',
            '-b:a',
            trimPreview ? '96k' : '128k',
            outputPath,
        ]);
        child.on('error', () => resolve(false));
        child.on('close', (code) => resolve(code === 0 && fs.existsSync(outputPath)));
    });

const prepareEntry = async (
    cacheId: string,
    cacheKey: string,
    reference: ExternalReference,
    filePath: string,
    localSha256: string,
    effectiveMimeType: string,
    delivery: string | null,
    // O Editor de Cortes pula a recodificação apenas quando o codec original é
    // compatível. MOV/HEVC recebe o perfil leve para não abrir com tela preta.
    skipProxy = false
): Promise<CacheEntry> => {
    const kind = reference.kind === 'image' ? 'image' : reference.kind === 'audio' ? 'audio' : 'video';
    let duration = kind === 'image' ? 3.5 : 0;
    let proxyPath: string | null = null;
    let proxyProfile: OpsPreviewProxyProfile | null = null;
    if (kind === 'video') {
        const metadata = await getVideoMetadata(filePath);
        duration = Number(metadata.duration || 0);
        proxyProfile = selectOpsPreviewProxyProfile({
            filePath,
            mimeType: effectiveMimeType,
            codecName: metadata.codecName,
            pixelFormat: metadata.pixelFormat,
            skipProxy,
        });
        if (proxyProfile) {
            proxyPath = safeResolve(CACHE_ROOT, cacheId, proxyProfile === 'trim' ? 'preview-trim.mp4' : 'preview.mp4');
            if (path.resolve(proxyPath) === path.resolve(filePath)) {
                proxyPath = safeResolve(CACHE_ROOT, cacheId, 'preview-2.mp4');
            }
            const failedProfile = proxyProfile;
            if (!(await generateProxy(filePath, proxyPath, proxyProfile))) {
                fs.rmSync(proxyPath, { force: true });
                proxyPath = null;
                proxyProfile = null;
                if (failedProfile === 'trim') {
                    throw new GatewayHttpError(
                        500,
                        'Não foi possível converter este MOV para uma prévia compatível. Tente novamente.',
                        'ops_preview_proxy_failed',
                    );
                }
            }
        }
    }
    const stat = fs.statSync(filePath);
    const proxyBytes = proxyPath && fs.existsSync(proxyPath) ? fs.statSync(proxyPath).size : 0;
    const filename = path.basename(filePath);
    const now = new Date().toISOString();
    const accessCapability = newAccessCapability();
    return {
        cacheId,
        referenceId: reference.id,
        cacheKey,
        assetId: reference.assetId,
        name: reference.name || filename,
        kind,
        mimeType: effectiveMimeType || null,
        sizeBytes: stat.size + proxyBytes,
        localSha256,
        accessCapability,
        filePath,
        proxyPath,
        proxyProfile,
        delivery,
        duration,
        frames: [],
        createdAt: now,
        lastAccessedAt: now,
    };
};

/** POST /api/ops/cache/materialize — baixa e prepara um ativo autorizado. */
export const materialize = async (req: Request, res: Response) => {
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ ok: false, message: 'Sessão Mileto ausente ou expirada.' });
    let viewContextId: string | null;
    try {
        viewContextId = viewContextFrom(req);
    } catch (error) {
        return res.status(422).json({ ok: false, message: (error as Error).message });
    }
    const referenceId = String(req.body?.referenceId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(referenceId)) {
        return res.status(400).json({ ok: false, message: 'Referência do Mileto Ops inválida.' });
    }
    const skipProxy = req.body?.skipProxy === true;

    const downloadAbort = new AbortController();
    const abortOnClose = () => {
        if (!res.writableEnded) downloadAbort.abort();
    };
    res.once('close', abortOnClose);
    try {
        cleanupCache();
        const descriptor = await requestDownload(token, referenceId, viewContextId, downloadAbort.signal);
        if (downloadAbort.signal.aborted) return;
        const reference = descriptor.reference;
        if (!reference?.id || !reference.assetId) throw new GatewayHttpError(502, 'Referência incompleta no gateway.');
        if (!descriptor.download?.url || descriptor.download.ready === false) {
            throw new GatewayHttpError(502, 'O gateway não devolveu uma entrega pronta do Mileto Ops.');
        }
        if (!['video', 'image'].includes(reference.kind)) {
            return res.status(422).json({ ok: false, message: 'Apenas vídeos e imagens podem ser adicionados como take.' });
        }
        const cacheKey = cacheKeyFor(reference, descriptor.download);
        const cacheId = cacheIdFor(cacheKey);
        if (activeMaterializations.has(cacheId)) {
            return res.status(409).json({ ok: false, message: 'Este arquivo já está sendo preparado. Aguarde um instante.' });
        }
        activeMaterializations.add(cacheId);
        try {
            const existingIndex = readIndex();
            const existing = existingIndex.find(
                (entry) => entry.cacheId === cacheId && entry.cacheKey === cacheKey && fs.existsSync(entry.filePath)
            );
            if (existing) {
                existing.lastAccessedAt = new Date().toISOString();
                ensureAccessCapability(existing);
                if (existing.kind === 'video') {
                    const metadata = await getVideoMetadata(existing.filePath);
                    const desiredProfile = selectOpsPreviewProxyProfile({
                        filePath: existing.filePath,
                        mimeType: existing.mimeType,
                        codecName: metadata.codecName,
                        pixelFormat: metadata.pixelFormat,
                        skipProxy,
                    });
                    // Entradas antigas com preview.mp4 são equivalentes ao perfil padrão.
                    const currentProfile = existing.proxyPath
                        ? existing.proxyProfile || 'standard'
                        : null;
                    const needsProxy = Boolean(desiredProfile && !existing.proxyPath);
                    const needsStandardUpgrade = desiredProfile === 'standard' && currentProfile === 'trim';
                    if (needsProxy || needsStandardUpgrade) {
                        const nextProfile = desiredProfile as OpsPreviewProxyProfile;
                        let proxyPath = safeResolve(
                            CACHE_ROOT,
                            cacheId,
                            nextProfile === 'trim' ? 'preview-trim.mp4' : 'preview.mp4',
                        );
                        if (path.resolve(proxyPath) === path.resolve(existing.filePath)) {
                            proxyPath = safeResolve(CACHE_ROOT, cacheId, 'preview-2.mp4');
                        }
                        if (await generateProxy(existing.filePath, proxyPath, nextProfile)) {
                            const previousProxyPath = existing.proxyPath;
                            existing.proxyPath = proxyPath;
                            existing.proxyProfile = nextProfile;
                            if (previousProxyPath && path.resolve(previousProxyPath) !== path.resolve(proxyPath)) {
                                fs.rmSync(previousProxyPath, { force: true });
                            }
                            existing.sizeBytes = fs.statSync(existing.filePath).size + fs.statSync(proxyPath).size;
                        } else {
                            fs.rmSync(proxyPath, { force: true });
                            if (nextProfile === 'trim') {
                                throw new GatewayHttpError(
                                    500,
                                    'Não foi possível converter este MOV para uma prévia compatível. Tente novamente.',
                                    'ops_preview_proxy_failed',
                                );
                            }
                        }
                    }
                }
                writeIndex(existingIndex);
                return res.json({ ok: true, cached: true, source: responseSource(existing, reference) });
            }

            const directory = safeResolve(CACHE_ROOT, cacheId);
            fs.mkdirSync(directory, { recursive: true });
            const partialPath = safeResolve(directory, `${cacheId}.part`);
            fs.rmSync(partialPath, { force: true });

            const downloaded = await downloadWithRenewal(
                token,
                referenceId,
                viewContextId,
                partialPath,
                descriptor,
                downloadAbort.signal
            );
            const latest = downloaded.response;
            const latestCacheKey = cacheKeyFor(latest.reference, latest.download);
            if (latestCacheKey !== cacheKey) {
                fs.rmSync(partialPath, { force: true });
                throw new GatewayHttpError(409, 'O ativo mudou durante o download. Tente adicioná-lo novamente.');
            }
            const stat = fs.statSync(partialPath);
            if (stat.size !== downloaded.receivedBytes) {
                fs.rmSync(partialPath, { force: true });
                throw new GatewayHttpError(
                    422,
                    'O arquivo local ficou incompleto durante a gravação.',
                    'ops_materialization_incomplete',
                );
            }
            if (stat.size > MAX_BYTES) {
                fs.rmSync(partialPath, { force: true });
                throw new GatewayHttpError(413, 'O arquivo ultrapassou a quota local do cache Ops.');
            }
            if (downloaded.contentLength && stat.size !== downloaded.contentLength) {
                fs.rmSync(partialPath, { force: true });
                throw new GatewayHttpError(
                    422,
                    'O tamanho baixado não confere com a entrega do Mileto Ops.',
                    'ops_download_size_mismatch',
                );
            }
            const localSha256 = await hashFile(partialPath);
            const deliveryChecksum = String(latest.download.checksum || '').toLowerCase();
            if (deliveryChecksum && !/^[0-9a-f]{64}$/.test(deliveryChecksum)) {
                fs.rmSync(partialPath, { force: true });
                throw new GatewayHttpError(502, 'O Mileto Ops devolveu um checksum de entrega inválido.');
            }
            if (deliveryChecksum && localSha256.toLowerCase() !== deliveryChecksum) {
                fs.rmSync(partialPath, { force: true });
                throw new GatewayHttpError(
                    422,
                    'O checksum baixado não confere com a entrega do Mileto Ops.',
                    'ops_download_checksum_mismatch',
                );
            }
            const extension = extensionFor(latest.reference, latest.download);
            const finalPath = safeResolve(directory, `${cacheId}${extension}`);
            fs.renameSync(partialPath, finalPath);

            let entry: CacheEntry;
            try {
                entry = await prepareEntry(
                    cacheId,
                    cacheKey,
                    latest.reference,
                    finalPath,
                    localSha256,
                    downloaded.effectiveMimeType,
                    latest.download.delivery || null,
                    skipProxy
                );
            } catch (error) {
                // O diretório acabou de ser criado para esta materialização e
                // ainda não entrou no índice; não conserve arquivo órfão.
                fs.rmSync(directory, { recursive: true, force: true });
                throw error;
            }
            const next = readIndex().filter((item) => item.cacheId !== cacheId);
            next.push(entry);
            writeIndex(next);
            cleanupCache(cacheId);
            return res.status(201).json({ ok: true, cached: false, source: responseSource(entry, latest.reference) });
        } finally {
            activeMaterializations.delete(cacheId);
        }
    } catch (error) {
        if (downloadAbort.signal.aborted || res.destroyed) return;
        const status = error instanceof GatewayHttpError && error.status > 0 ? error.status : 500;
        // Indisponibilidade, troca de delegação ou remoção no Ops não
        // autoriza apagar a cópia local usada por um projeto existente.
        res.status(status).json({
            ok: false,
            code: error instanceof GatewayHttpError ? error.code : null,
            message: (error as Error).message || 'Não foi possível preparar a mídia do Mileto Ops.',
        });
    } finally {
        res.off('close', abortOnClose);
    }
};

/**
 * POST /api/ops/cache/restore — reabre um take já materializado sem depender
 * da disponibilidade momentânea do Ops. A referência continua sendo validada
 * na importação original; esta rota apenas devolve uma capability nova para o
 * arquivo privado que já existe neste computador.
 */
export const restoreCached = (req: Request, res: Response) => {
    if (!bearerFrom(req)) {
        return res.status(401).json({ ok: false, message: 'Sessão Mileto ausente ou expirada.' });
    }

    const referenceId = String(req.body?.referenceId || '').trim();
    const assetId = String(req.body?.assetId || '').trim();
    const cacheId = String(req.body?.cacheId || '').trim();
    const validReference = /^[0-9a-f-]{36}$/i.test(referenceId);
    const validAsset = /^[0-9a-f-]{36}$/i.test(assetId);
    const validCache = /^[0-9a-f]{32}$/i.test(cacheId);
    if (!validReference && !validAsset && !validCache) {
        return res.status(400).json({ ok: false, message: 'Referência local do Mileto Ops inválida.' });
    }

    const entries = readIndex();
    const candidates = entries
        .filter((entry) => {
            if (!fs.existsSync(entry.filePath)) return false;
            if (validCache && entry.cacheId === cacheId) {
                return (!validReference || entry.referenceId === referenceId) &&
                    (!validAsset || entry.assetId === assetId);
            }
            if (validReference && entry.referenceId === referenceId) {
                return !validAsset || entry.assetId === assetId;
            }
            return validAsset && entry.assetId === assetId;
        })
        .sort((left, right) => {
            const score = (entry: CacheEntry) => {
                if (validCache && entry.cacheId === cacheId) return 3;
                if (validReference && entry.referenceId === referenceId) return 2;
                if (validAsset && entry.assetId === assetId) return 1;
                return 0;
            };
            const scoreDifference = score(right) - score(left);
            if (scoreDifference) return scoreDifference;
            return new Date(right.lastAccessedAt).getTime() - new Date(left.lastAccessedAt).getTime();
        });
    const entry = candidates[0];
    if (!entry) {
        return res.status(404).json({
            ok: false,
            code: 'ops_local_cache_miss',
            message: 'A cópia local deste take ainda não está disponível.',
        });
    }

    entry.lastAccessedAt = new Date().toISOString();
    ensureAccessCapability(entry);
    writeIndex(entries);
    return res.json({ ok: true, cached: true, source: restoredCacheSource(entry) });
};

/** GET /api/ops/cache/file/:cacheId/:filename — serve somente o arquivo autorizado pela URL-capability local. */
export const serveCacheFile = (req: Request, res: Response) => {
    const cacheId = String(req.params.cacheId || '');
    const filename = String(req.params.filename || '');
    const suppliedCapability = String(req.query.cap || '');
    if (!/^[0-9a-f]{32}$/i.test(cacheId) || filename !== path.basename(filename) || !suppliedCapability) {
        return res.status(404).end();
    }

    const entries = readIndex();
    const entry = entries.find((item) => item.cacheId === cacheId);
    if (!entry) return res.status(404).end();

    const expectedCapability = ensureAccessCapability(entry);
    if (!capabilityMatches(suppliedCapability, expectedCapability)) return res.status(403).end();

    const requestedPath = safeResolve(CACHE_ROOT, cacheId, filename);
    const allowedPaths = [entry.filePath, entry.proxyPath]
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => path.resolve(candidate));
    if (!allowedPaths.includes(path.resolve(requestedPath)) || !fs.existsSync(requestedPath)) {
        return res.status(404).end();
    }

    entry.lastAccessedAt = new Date().toISOString();
    writeIndex(entries);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(requestedPath);
};

export const cacheStatus = (_req: Request, res: Response) => {
    cleanupCache();
    const entries = readIndex();
    res.json({
        ok: true,
        preservesDraftReferences: true,
        entries: entries.length,
        bytes: entries.reduce((sum, entry) => sum + Number(entry.sizeBytes || 0), 0),
        maxBytes: MAX_BYTES,
        ttlDays: Math.round(TTL_MS / (24 * 60 * 60 * 1000)),
    });
};

/** POST /api/ops/exports/metadata — prepara os metadados editoriais revisáveis. */
export const prepareExportMetadata = (req: Request, res: Response) => {
    try {
        const metadata = prepareOpsExportMetadata({
            projectId: String(req.body?.projectId || ''),
            projectTitle: String(req.body?.projectTitle || ''),
            narrationText: typeof req.body?.narrationText === 'string' ? req.body.narrationText : '',
            mediaTakeCount: Number(req.body?.mediaTakeCount || 0),
            title: Object.prototype.hasOwnProperty.call(req.body || {}, 'title') ? req.body.title : null,
            description: Object.prototype.hasOwnProperty.call(req.body || {}, 'description') ? req.body.description : null,
        });
        res.json({ ok: true, data: metadata });
    } catch (error) {
        res.status(422).json({
            ok: false,
            code: 'ops_export_metadata_invalid',
            message: (error as Error).message || 'Os metadados editoriais da exportação são inválidos.',
        });
    }
};

/** POST /api/ops/exports/upload — ponte local para o upload seguro do gateway. */
export const uploadExport = async (req: Request, res: Response) => {
    try {
        const token = bearerFrom(req);
        const sourcePath = typeof req.body?.sourcePath === 'string' ? path.resolve(req.body.sourcePath) : '';
        const tempRelative = sourcePath ? path.relative(path.resolve(os.tmpdir()), sourcePath) : '..';
        if (!sourcePath || tempRelative.startsWith('..') || path.isAbsolute(tempRelative) || !/^mileto-final-[\w-]+\.mp4$/i.test(path.basename(sourcePath))) {
            throw new Error('Arquivo de exportação inválido.');
        }
        const stat = await fs.promises.stat(sourcePath);
        if (!stat.isFile()) throw new Error('O MP4 temporário não foi encontrado.');
        if (stat.size > OPS_EXPORT_MAX_BYTES) throw new Error(`O MP4 excede o limite de ${Math.floor(OPS_EXPORT_MAX_BYTES / 1024 / 1024)} MB configurado para o Mileto Ops.`);
        const companyId = String(req.body?.companyId || '').trim();
        if (!companyId) throw new Error('Selecione uma empresa do Mileto Ops.');
        const fileName = String(req.body?.fileName || 'MeuVideo_Mileto.mp4').replace(/[\\/:*?"<>|]/g, '_');
        const metadata = validateOpsExportMetadata({
            title: req.body?.title,
            description: req.body?.description,
            narrationSummary: req.body?.narrationSummary,
            sourceProjectId: req.body?.sourceProjectId,
            sourceProjectTitle: req.body?.sourceProjectTitle,
        });
        const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
        if (idempotencyKey && !UUID_PATTERN.test(idempotencyKey)) {
            throw new GatewayHttpError(422, 'A chave idempotente da exportação é inválida.', 'invalid_idempotency_key');
        }
        const viewContext = viewContextFrom(req);
        const result = await gatewayUploadFile(token || '', `/v1/integrations/mileto-ops/companies/${encodeURIComponent(companyId)}/assets/export`, sourcePath, {
            folderId: String(req.body?.folderId || ''),
            fileName: fileName.endsWith('.mp4') ? fileName : `${fileName}.mp4`,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            ...metadata,
        }, viewContext ? { 'X-Ops-View-Context': viewContext } : {});
        res.json(result);
    } catch (error) {
        const status = error instanceof GatewayHttpError && error.status > 0 ? error.status : 400;
        res.status(status).json({
            ok: false,
            code: error instanceof GatewayHttpError ? (error.code || 'mileto_ops_error') : 'ops_export_invalid',
            message: (error as Error).message || 'Não foi possível enviar ao Mileto Ops.',
        });
    }
};

/** POST /api/ops/files/import-local — envia um MP4 já presente na biblioteca local. */
export const importLocalFile = async (req: Request, res: Response) => {
    try {
        const token = bearerFrom(req);
        const sourcePath = resolveLocalSource(
            String(req.body?.sourceUrl || ''),
            String(req.body?.backendPath || ''),
        );
        if (path.extname(sourcePath).toLowerCase() !== '.mp4') {
            throw new Error('O Mileto Ops aceita somente vídeos MP4 nesta transferência.');
        }
        const stat = await fs.promises.stat(sourcePath);
        if (!stat.isFile()) throw new Error('O MP4 local não foi encontrado.');
        if (stat.size > OPS_EXPORT_MAX_BYTES) {
            throw new Error(`O MP4 excede o limite de ${Math.floor(OPS_EXPORT_MAX_BYTES / 1024 / 1024)} MB configurado para o Mileto Ops.`);
        }
        const companyId = String(req.body?.companyId || '').trim();
        if (!companyId) throw new Error('Selecione uma empresa do Mileto Ops.');
        const requestedName = String(req.body?.fileName || path.basename(sourcePath)).replace(/[\\/:*?"<>|]/g, '_');
        const fileName = requestedName.toLowerCase().endsWith('.mp4') ? requestedName : `${requestedName}.mp4`;
        const localTitle = compactOpsText(req.body?.title || path.parse(fileName).name);
        const localDescription = compactOpsText(
            req.body?.description || `Vídeo “${localTitle}” enviado da biblioteca local do Mileto AI Video.`
        );
        const metadata = validateOpsExportMetadata({
            title: localTitle,
            description: localDescription,
            narrationSummary: req.body?.narrationSummary || localDescription,
            sourceProjectId: req.body?.sourceProjectId || `local-file:${crypto.createHash('sha256').update(sourcePath).digest('hex')}`,
            sourceProjectTitle: req.body?.sourceProjectTitle || localTitle,
        });
        const viewContext = viewContextFrom(req);
        const result = await gatewayUploadFile(
            token || '',
            `/v1/integrations/mileto-ops/companies/${encodeURIComponent(companyId)}/assets/export`,
            sourcePath,
            { folderId: String(req.body?.folderId || ''), fileName, ...metadata },
            viewContext ? { 'X-Ops-View-Context': viewContext } : {},
        );
        res.json(result);
    } catch (error) {
        const status = error instanceof GatewayHttpError && error.status > 0 ? error.status : 400;
        res.status(status).json({
            ok: false,
            code: error instanceof GatewayHttpError ? (error.code || 'mileto_ops_error') : 'ops_export_invalid',
            message: (error as Error).message || 'Não foi possível enviar o arquivo local ao Mileto Ops.',
        });
    }
};
