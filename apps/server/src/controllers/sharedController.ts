import { Request, Response } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fetch, { RequestInit } from 'node-fetch';
import ffmpeg from 'fluent-ffmpeg';
import { bearerFrom, GatewayHttpError } from '../services/gatewayClient';
import { BASE_DATA_PATH } from './fileExplorerController';

const GATEWAY_URL = (process.env.GATEWAY_BASE_URL || 'https://api.miletoaivideo.com.br').replace(/\/+$/, '');

const jsonFrom = async (response: { text: () => Promise<string> }) => {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
};

const gatewayRequest = async (req: Request, path: string, init: RequestInit = {}) => {
    const token = bearerFrom(req);
    if (!token) throw new GatewayHttpError(401, 'Sessão Mileto ausente ou expirada.');
    const headers = {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
    };
    let response;
    try {
        response = await fetch(`${GATEWAY_URL}${path}`, {
            ...init,
            headers,
            signal: AbortSignal.timeout(120000),
        } as RequestInit);
    } catch (error) {
        const name = (error as Error)?.name;
        if (name === 'AbortError' || name === 'TimeoutError') {
            throw new GatewayHttpError(504, 'O ambiente compartilhado demorou demais para responder.');
        }
        throw new GatewayHttpError(0, 'Sem conexão com o ambiente compartilhado.');
    }
    const data = await jsonFrom(response);
    if (!response.ok) {
        throw new GatewayHttpError(response.status, data.message || `Gateway ${response.status}`);
    }
    return data;
};

const respond = async (res: Response, action: () => Promise<unknown>) => {
    try {
        res.json(await action());
    } catch (error) {
        const status = error instanceof GatewayHttpError && error.status > 0 ? error.status : 500;
        res.status(status).json({ ok: false, message: (error as Error).message || 'Erro no ambiente compartilhado.' });
    }
};

const hashFile = (filePath: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });

const mimeFromName = (name: string): string => {
    const ext = path.extname(name).toLowerCase();
    const known: Record<string, string> = {
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
        '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
    };
    return known[ext] || 'application/octet-stream';
};

const safeUploadHeaders = (uploadUrl: string, preparedHeaders: Record<string, string>, size: number) => {
    const signedUrl = new URL(uploadUrl);
    const queryNames = new Set(Array.from(signedUrl.searchParams.keys(), (key) => key.toLowerCase()));
    const headers: Record<string, string> = { 'Content-Length': String(size) };
    for (const [name, value] of Object.entries(preparedHeaders || {})) {
        // O presigner do R2 move metadados x-amz-* para a query assinada.
        // Repeti-los como header provoca SignatureDoesNotMatch.
        if (queryNames.has(name.toLowerCase())) continue;
        headers[name] = value;
    }
    return headers;
};

const r2FailureCode = async (response: { text: () => Promise<string> }) => {
    const body = await response.text().catch(() => '');
    return body.match(/<Code>([^<]+)<\/Code>/i)?.[1] || '';
};

const uploadPath = async (
    req: Request,
    filePath: string,
    originalName: string,
    mimeType: string,
    parentPath: string,
    options: { preventDuplicate?: boolean; visibility?: 'library' | 'project' } = {},
) => {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('A origem local não é um arquivo.');
    const sha256 = await hashFile(filePath);
    const category = parentPath.split(/[\\/]/).filter(Boolean)[0] || 'Vídeos';
    const uploadMeta = {
        sha256,
        size: stat.size,
        mimeType: mimeType || mimeFromName(originalName),
        name: originalName,
        parentPath,
        category,
        visibility: options.visibility === 'project' ? 'project' : 'library',
    };

    if (options.preventDuplicate) {
        try {
            const listing = (await gatewayRequest(
                req,
                `/shared/files/list?path=${encodeURIComponent(parentPath)}`
            )) as {
                files?: Array<{
                    id?: string;
                    name?: string;
                    size?: number;
                    checksum?: string | null;
                    sha256?: string | null;
                }>;
            };
            const normalizedName = originalName.trim().toLocaleLowerCase('pt-BR');
            const existing = (listing.files || []).find((item) => {
                const existingChecksum = String(item.checksum || item.sha256 || '').trim().toLowerCase();
                if (existingChecksum && existingChecksum === sha256) return true;

                const sameName = String(item.name || '').trim().toLocaleLowerCase('pt-BR') === normalizedName;
                const sameSize = Number(item.size || 0) === stat.size;
                return sameName && sameSize;
            });

            if (existing) {
                return {
                    ok: true,
                    deduplicated: true,
                    identityCode: sha256,
                    entry: existing,
                };
            }
        } catch {
            // A preparação do gateway continua sendo a segunda barreira de deduplicação.
        }
    }

    let uploaded = false;
    for (let attempt = 0; attempt < 2 && !uploaded; attempt += 1) {
        const prepared = (await gatewayRequest(req, '/shared/files/upload/prepare', {
            method: 'POST',
            body: JSON.stringify(uploadMeta),
        })) as {
            deduplicated?: boolean;
            uploadUrl?: string;
            uploadHeaders?: Record<string, string>;
            item?: unknown;
        };
        if (prepared.deduplicated) {
            return { ok: true, deduplicated: true, identityCode: sha256, entry: prepared.item };
        }
        if (!prepared.uploadUrl) throw new Error('O gateway não preparou o upload.');

        const uploadResponse = await fetch(prepared.uploadUrl, {
            method: 'PUT',
            headers: safeUploadHeaders(prepared.uploadUrl, prepared.uploadHeaders || {}, stat.size),
            body: fs.createReadStream(filePath),
            signal: AbortSignal.timeout(30 * 60 * 1000),
        });
        if (uploadResponse.ok) {
            uploaded = true;
            break;
        }

        const failureCode = await r2FailureCode(uploadResponse);
        if (attempt === 0 && uploadResponse.status === 403) continue;
        throw new GatewayHttpError(
            uploadResponse.status,
            failureCode
                ? `O R2 recusou o upload (${failureCode}).`
                : `Falha ao enviar para o R2 (${uploadResponse.status}).`
        );
    }

    if (!uploaded) throw new Error('O upload para o R2 não foi concluído.');

    const completed = (await gatewayRequest(req, '/shared/files/upload/complete', {
        method: 'POST',
        body: JSON.stringify(uploadMeta),
    })) as { item?: unknown; deduplicated?: boolean };
    return { ok: true, deduplicated: completed.deduplicated, identityCode: sha256, entry: completed.item };
};

export const resolveLocalSource = (sourceUrl: string, backendPath: string): string => {
    const root = path.resolve(BASE_DATA_PATH);
    const candidates: string[] = [];
    if (backendPath) candidates.push(path.resolve(backendPath));

    if (sourceUrl) {
        const pathname = decodeURIComponent(new URL(sourceUrl, 'http://localhost').pathname);
        const mappings: Array<[string, string]> = [
            ['/data/', 'data'],
            ['/music/', 'music'],
            ['/uploads/', 'uploads'],
            ['/narrations/', 'narrations'],
            ['/videos/', 'videos'],
            ['/transitions/', path.join('public', 'transitions')],
            ['/mixes/', path.join('public', 'mixes')],
            ['/files/', 'files'],
        ];
        const mapping = mappings.find(([prefix]) => pathname.startsWith(prefix));
        if (mapping) candidates.push(path.resolve(root, mapping[1], pathname.slice(mapping[0].length)));
    }

    if (!candidates.length) throw new Error('Não foi possível localizar a mídia local.');
    for (const candidate of [...new Set(candidates)]) {
        const relative = path.relative(root, candidate);
        const tempRelative = path.relative(path.resolve(os.tmpdir()), candidate);
        const isFreshExport = !tempRelative.startsWith('..') && !path.isAbsolute(tempRelative)
            && /^mileto-final-[\w-]+\.mp4$/i.test(path.basename(candidate));
        const isInsideData = Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
        if (!isInsideData && !isFreshExport) continue;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    throw new Error('A mídia local não existe mais. Atualize a biblioteca e tente novamente.');
};

const probeDuration = (filePath: string) =>
    new Promise<number>((resolve) => {
        ffmpeg.ffprobe(filePath, (error, metadata) => {
            if (error) return resolve(1);
            resolve(Number(metadata.format.duration || 1));
        });
    });

export const materializeTransition = async (req: Request, res: Response) => {
    try {
        const assetId = String(req.params.assetId || '');
        const detail = (await gatewayRequest(
            req,
            `/shared/files/item/${encodeURIComponent(assetId)}`
        )) as { item?: { id?: string; name?: string; publicUrl?: string } };
        const item = detail.item;
        if (!item?.publicUrl) throw new GatewayHttpError(404, 'Transição compartilhada não encontrada.');

        const originalName = String(item.name || 'transicao.mp4');
        const extension = path.extname(originalName).toLowerCase();
        if (!['.mp4', '.mov', '.webm'].includes(extension)) {
            throw new GatewayHttpError(415, 'O arquivo compartilhado não é uma transição de vídeo compatível.');
        }

        const targetDir = path.join(BASE_DATA_PATH, 'public', 'transitions');
        await fs.promises.mkdir(targetDir, { recursive: true });
        const safeId = assetId.replace(/[^a-zA-Z0-9_-]/g, '');
        const filename = `shared-${safeId}${extension}`;
        const targetPath = path.join(targetDir, filename);

        if (!fs.existsSync(targetPath)) {
            const response = await fetch(item.publicUrl, { signal: AbortSignal.timeout(5 * 60 * 1000) });
            if (!response.ok || !response.body) {
                throw new GatewayHttpError(response.status, `Falha ao preparar a transição compartilhada (${response.status}).`);
            }
            const temporaryPath = `${targetPath}.part`;
            await new Promise<void>((resolve, reject) => {
                const output = fs.createWriteStream(temporaryPath);
                response.body?.pipe(output);
                response.body?.once('error', reject);
                output.once('error', reject);
                output.once('finish', resolve);
            });
            await fs.promises.rename(temporaryPath, targetPath);
        }

        const durationSec = await probeDuration(targetPath);
        res.json({
            ok: true,
            transition: {
                id: `shared:${assetId}`,
                sharedAssetId: assetId,
                scope: 'shared',
                originalName,
                publicUrl: `/transitions/${filename}`,
                filePath: targetPath,
                durationSec,
                category: 'Equipe',
                isBuiltIn: false,
            },
        });
    } catch (error) {
        const status = error instanceof GatewayHttpError && error.status > 0 ? error.status : 500;
        res.status(status).json({ ok: false, message: (error as Error).message || 'Falha ao preparar a transição compartilhada.' });
    }
};

export const status = (req: Request, res: Response) =>
    respond(res, () => gatewayRequest(req, '/shared/status'));

export const tree = (req: Request, res: Response) =>
    respond(res, () => gatewayRequest(req, '/shared/files/tree'));

export const list = (req: Request, res: Response) => {
    const path = encodeURIComponent(String(req.query.path || ''));
    return respond(res, () => gatewayRequest(req, `/shared/files/list?path=${path}`));
};

export const trash = (req: Request, res: Response) =>
    respond(res, () => gatewayRequest(req, '/shared/files/trash'));

export const createFolder = (req: Request, res: Response) =>
    respond(res, () =>
        gatewayRequest(req, '/shared/files/folder', { method: 'POST', body: JSON.stringify(req.body || {}) })
    );

export const renameItem = (req: Request, res: Response) =>
    respond(res, () =>
        gatewayRequest(req, '/shared/files/rename', { method: 'PATCH', body: JSON.stringify(req.body || {}) })
    );

export const moveItem = (req: Request, res: Response) =>
    respond(res, () =>
        gatewayRequest(req, '/shared/files/move', { method: 'POST', body: JSON.stringify(req.body || {}) })
    );

export const copyItem = (req: Request, res: Response) =>
    respond(res, () =>
        gatewayRequest(req, '/shared/files/copy', { method: 'POST', body: JSON.stringify(req.body || {}) })
    );

export const trashItem = (req: Request, res: Response) =>
    respond(res, () => gatewayRequest(req, `/shared/files/item/${encodeURIComponent(req.params.assetId)}`, { method: 'DELETE' }));

export const restoreItem = (req: Request, res: Response) =>
    respond(res, () =>
        gatewayRequest(req, `/shared/files/item/${encodeURIComponent(req.params.assetId)}/restore`, { method: 'POST' })
    );

export const uploadFile = async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ ok: false, message: 'Nenhum arquivo enviado.' });
    const filePath = req.file.path;
    try {
        const parentPath = String(req.body.parent || '');
        res.json(await uploadPath(
            req,
            filePath,
            req.file.originalname,
            req.file.mimetype,
            parentPath,
            { preventDuplicate: String(req.body.preventDuplicate || '') === 'true' }
        ));
    } catch (error) {
        const status = error instanceof GatewayHttpError && error.status > 0 ? error.status : 500;
        res.status(status).json({ ok: false, message: (error as Error).message || 'Falha no upload compartilhado.' });
    } finally {
        await fs.promises.unlink(filePath).catch(() => undefined);
    }
};

export const importLocalFile = async (req: Request, res: Response) => {
    try {
        const filePath = resolveLocalSource(String(req.body.sourceUrl || ''), String(req.body.backendPath || ''));
        const name = String(req.body.name || path.basename(filePath));
        const parentPath = String(req.body.parent || 'Vídeos');
        res.json(await uploadPath(
            req,
            filePath,
            name,
            String(req.body.mimeType || ''),
            parentPath,
            {
                preventDuplicate: req.body.preventDuplicate === true,
                visibility: req.body.visibility === 'project' ? 'project' : 'library',
            }
        ));
    } catch (error) {
        const status = error instanceof GatewayHttpError && error.status > 0 ? error.status : 400;
        res.status(status).json({ ok: false, message: (error as Error).message || 'Falha ao compartilhar mídia local.' });
    }
};
