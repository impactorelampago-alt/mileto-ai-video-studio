import { Request, Response } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import fetch, { RequestInit } from 'node-fetch';
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

const uploadPath = async (
    req: Request,
    filePath: string,
    originalName: string,
    mimeType: string,
    parentPath: string,
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
    };
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
        return { ok: true, deduplicated: true, entry: prepared.item };
    }
    if (!prepared.uploadUrl) throw new Error('O gateway não preparou o upload.');

    const uploadResponse = await fetch(prepared.uploadUrl, {
        method: 'PUT',
        headers: {
            ...(prepared.uploadHeaders || {}),
            'Content-Length': String(stat.size),
        },
        body: fs.createReadStream(filePath),
        signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!uploadResponse.ok) {
        throw new Error(`Falha ao enviar para o R2 (${uploadResponse.status}).`);
    }

    const completed = (await gatewayRequest(req, '/shared/files/upload/complete', {
        method: 'POST',
        body: JSON.stringify(uploadMeta),
    })) as { item?: unknown; deduplicated?: boolean };
    return { ok: true, deduplicated: completed.deduplicated, entry: completed.item };
};

const resolveLocalSource = (sourceUrl: string, backendPath: string): string => {
    const root = path.resolve(BASE_DATA_PATH);
    let candidate = backendPath ? path.resolve(backendPath) : '';

    if (!candidate && sourceUrl) {
        const pathname = decodeURIComponent(new URL(sourceUrl, 'http://localhost').pathname);
        const mappings: Array<[string, string]> = [
            ['/data/', 'data'],
            ['/music/', 'music'],
            ['/uploads/', 'uploads'],
            ['/narrations/', 'narrations'],
            ['/videos/', 'videos'],
            ['/mixes/', path.join('public', 'mixes')],
            ['/files/', 'files'],
        ];
        const mapping = mappings.find(([prefix]) => pathname.startsWith(prefix));
        if (mapping) candidate = path.resolve(root, mapping[1], pathname.slice(mapping[0].length));
    }

    if (!candidate) throw new Error('Não foi possível localizar a mídia local.');
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('A mídia precisa estar dentro da pasta de dados do Mileto.');
    }
    if (!fs.existsSync(candidate)) throw new Error('A mídia local não existe mais.');
    return candidate;
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
        res.json(await uploadPath(req, filePath, req.file.originalname, req.file.mimetype, parentPath));
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
        res.json(await uploadPath(req, filePath, name, String(req.body.mimeType || ''), parentPath));
    } catch (error) {
        const status = error instanceof GatewayHttpError && error.status > 0 ? error.status : 400;
        res.status(status).json({ ok: false, message: (error as Error).message || 'Falha ao compartilhar mídia local.' });
    }
};
