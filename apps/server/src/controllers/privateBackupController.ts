import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { BASE_DATA_PATH, DEFAULT_ROOT_FOLDERS, FILES_ROOT, categoryOf, readIndex, toPublicUrl, writeIndex, type FileEntry } from './fileExplorerController';
import { gatewayRequest, isAllowedSharedAudioUrl } from './sharedController';
import { downloadRemoteAudioFile } from './audioController';
import { safeResolve } from '../utils/safePath';
import { GatewayHttpError } from '../services/gatewayClient';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceIdForEntry = (entry: FileEntry) => {
    if (UUID.test(entry.id)) return entry.id;
    const hash = createHash('sha256').update(`${entry.id}\0${entry.relPath}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const root = path.resolve(FILES_ROOT);
const ownerFile = path.join(BASE_DATA_PATH, 'data', 'private-backup-owner.json');
const indexPath = path.join(BASE_DATA_PATH, 'data', 'files_index.json');
const healthyIndex = async () => {
    if (!fs.existsSync(indexPath)) return true;
    try { return Array.isArray(JSON.parse(await fs.promises.readFile(indexPath, 'utf8'))); }
    catch { return false; }
};
const readOwner = (): { orgId: number; userId: number } | null => {
    try {
        const value = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
        if (Number.isSafeInteger(value.orgId) && Number.isSafeInteger(value.userId)) return value;
    } catch { /* ainda não habilitado */ }
    return null;
};

export const getOwner = async (_req: Request, res: Response) => res.json({ ok: true, owner: readOwner() });

export const claimOwner = async (req: Request, res: Response) => {
    try {
        const result = await gatewayRequest(req, '/auth/me') as { user?: { id?: number; orgId?: number } };
        const userId = Number(result.user?.id);
        const orgId = Number(result.user?.orgId);
        if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(orgId) || userId <= 0 || orgId <= 0) {
            throw new GatewayHttpError(403, 'Conta sem organização válida.');
        }
        const previous = readOwner();
        if (previous && (previous.userId !== userId || previous.orgId !== orgId)) {
            return res.status(409).json({ ok: false, message: 'Os dados locais já pertencem a outra conta. Não serão enviados a esta conta.' });
        }
        if (!previous) {
            await fs.promises.mkdir(path.dirname(ownerFile), { recursive: true });
            await fs.promises.writeFile(ownerFile, JSON.stringify({ orgId, userId }), { flag: 'wx' });
        }
        res.json({ ok: true, owner: { orgId, userId } });
    } catch (error) {
        const status = error instanceof GatewayHttpError && error.status > 0 ? error.status : 500;
        res.status(status).json({ ok: false, message: (error as Error).message || 'Falha ao vincular backup.' });
    }
};
const insideRoot = (candidate: string) => {
    const relative = path.relative(root, path.resolve(candidate));
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const hashFile = async (target: string) => {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
    return hash.digest('hex');
};

/** Inventário verificável do acervo local; arquivos ausentes nunca contam como protegidos. */
export const inventory = async (_req: Request, res: Response) => {
    if (!await healthyIndex()) {
        return res.status(409).json({ ok: false,
            message: 'O índice do acervo está corrompido. O backup foi interrompido para não declarar os arquivos protegidos.' });
    }
    let entries = readIndex();
    const known = new Set(entries.map((entry) => entry.relPath.replace(/\\/g, '/')));
    const discoveredEntries: FileEntry[] = [];
    const pending = DEFAULT_ROOT_FOLDERS.map((folder) => path.join(root, folder));
    let discovered = 0;
    while (pending.length) {
        const directory = pending.pop()!;
        const realDirectory = await fs.promises.realpath(directory).catch(() => '');
        if (!realDirectory || !insideRoot(realDirectory)) {
            return res.status(409).json({ ok: false, message: 'Pasta do acervo indisponível ou fora do diretório seguro.' });
        }
        const children = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => null);
        if (!children) return res.status(409).json({ ok: false, message: 'Não foi possível ler uma pasta do acervo.' });
        for (const child of children) {
            const candidate = path.join(directory, child.name);
            if (child.isSymbolicLink()) continue;
            if (child.isDirectory()) { pending.push(candidate); continue; }
            if (!child.isFile()) continue;
            const relPath = path.relative(root, candidate).split(path.sep).join('/');
            if (known.has(relPath)) continue;
            let category: FileEntry['category'];
            try { category = categoryOf(child.name); } catch { continue; }
            const stat = await fs.promises.stat(candidate).catch(() => null);
            if (!stat?.isFile() || stat.size <= 0) continue;
            discoveredEntries.push({ id: randomUUID(), category, name: child.name, relPath,
                publicUrl: toPublicUrl(relPath), filePath: candidate,
                type: category === 'Músicas' ? 'audio' : category === 'Imagens' ? 'image' : 'video',
                createdAt: stat.birthtime.toISOString() });
            known.add(relPath);
            discovered += 1;
            if (discovered > 50_000) return res.status(413).json({ ok: false, message: 'Acervo grande demais para inventariar.' });
        }
    }
    if (discovered) {
        try {
            const latest = readIndex();
            const latestPaths = new Set(latest.map((entry) => entry.relPath.replace(/\\/g, '/')));
            for (const entry of discoveredEntries) {
                if (!latestPaths.has(entry.relPath)) latest.push(entry);
            }
            writeIndex(latest);
            entries = latest;
        }
        catch { return res.status(500).json({ ok: false, message: 'Não foi possível atualizar o índice do acervo.' }); }
    }
    const files = [];
    for (const entry of entries) {
        try {
            if (!entry.relPath) continue;
            const candidate = safeResolve(root, entry.relPath);
            if (!insideRoot(candidate)) continue;
            const [real, stat] = await Promise.all([fs.promises.realpath(candidate), fs.promises.stat(candidate)]);
            if (!insideRoot(real) || !stat.isFile() || stat.size <= 0) continue;
            files.push({
                sourceId: sourceIdForEntry(entry),
                relPath: entry.relPath,
                sourceUrl: toPublicUrl(entry.relPath),
                name: entry.name,
                size: stat.size,
                sourceMtime: stat.mtime.toISOString(),
                category: entry.category,
            });
        } catch {
            // Um item apagado do disco não vira backup fictício.
        }
    }
    res.json({ ok: true, files });
};

/** Restaura um item do cofre pessoal sem sobrescrever arquivos locais divergentes. */
export const restoreFile = async (req: Request, res: Response) => {
    const sourceId = String(req.params.sourceId || '');
    if (!UUID.test(sourceId)) return res.status(400).json({ ok: false, message: 'Arquivo inválido.' });
    let temporary = '';
    try {
        if (!await healthyIndex()) throw new GatewayHttpError(409, 'O índice local do acervo está corrompido. Restauração interrompida.');
        const savedOwner = readOwner();
        const me = await gatewayRequest(req, '/auth/me') as { user?: { id?: number; orgId?: number } };
        if (!savedOwner || savedOwner.userId !== Number(me.user?.id)
            || savedOwner.orgId !== Number(me.user?.orgId)) {
            throw new GatewayHttpError(409, 'Ative o backup pessoal para esta conta antes de restaurar arquivos.');
        }
        const result = await gatewayRequest(req, '/private/backups/files') as {
            files?: Array<{ sourceId: string; assetId: string; relPath: string; size: number; sha256: string; sourceMtime: string }>;
        };
        const record = result.files?.find((item) => item.sourceId === sourceId);
        if (!record || !UUID.test(record.assetId)) {
            return res.status(404).json({ ok: false, message: 'Backup do arquivo não encontrado nesta conta.' });
        }
        const relPath = String(record.relPath || '').replace(/\\/g, '/');
        const parts = relPath.split('/');
        if (parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..')
            || !['Vídeos', 'Imagens', 'Músicas', 'Geração por IA', 'Moldura'].includes(parts[0])) {
            throw new GatewayHttpError(400, 'Caminho de restauração inválido.');
        }
        const target = safeResolve(root, relPath);
        if (!insideRoot(target)) throw new GatewayHttpError(400, 'Destino fora do acervo.');
        const expectedSize = Number(record.size);
        if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > 20 * 1024 * 1024 * 1024) {
            throw new GatewayHttpError(413, 'Tamanho do backup inválido.');
        }
        const expectedHash = String(record.sha256 || '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new GatewayHttpError(400, 'Checksum do backup inválido.');
        const existing = await fs.promises.lstat(target).catch(() => null);
        if (existing && (!existing.isFile() || !insideRoot(await fs.promises.realpath(target)))) {
            return res.status(409).json({ ok: false, message: 'O destino existente não é um arquivo seguro do acervo.' });
        }
        if (existing?.isFile()) {
            if (existing.size !== expectedSize || await hashFile(target) !== expectedHash) {
                return res.status(409).json({ ok: false, message: 'Já existe um arquivo diferente nesse caminho. O original foi preservado.' });
            }
        } else {
            const download = await gatewayRequest(req, `/shared/files/item/${record.assetId}/download-url`, {
                method: 'POST',
            }) as { download?: { url?: string } };
            const url = String(download.download?.url || '');
            if (!isAllowedSharedAudioUrl(url)) throw new GatewayHttpError(502, 'URL de restauração inválida.');
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            const realParent = await fs.promises.realpath(path.dirname(target));
            if (!insideRoot(realParent)) throw new GatewayHttpError(400, 'Pasta de destino inválida.');
            temporary = `${target}.restore-${randomUUID()}.part`;
            await downloadRemoteAudioFile(url, temporary, expectedSize, isAllowedSharedAudioUrl);
            const downloaded = await fs.promises.stat(temporary);
            if (downloaded.size !== expectedSize || await hashFile(temporary) !== expectedHash) {
                throw new GatewayHttpError(409, 'O arquivo recebido não passou na verificação de integridade.');
            }
            // Hard-link atômico no mesmo volume: falha se alguém criou o destino
            // durante o download, em vez de sobrescrever um arquivo do usuário.
            await fs.promises.link(temporary, target);
            await fs.promises.unlink(temporary);
            temporary = '';
        }
        const index = readIndex();
        const prior = index.find((entry) => entry.id === sourceId);
        if (!prior) {
            const name = path.basename(target);
            const category = categoryOf(name);
            const entry: FileEntry = {
                id: sourceId,
                category,
                name,
                relPath,
                publicUrl: toPublicUrl(relPath),
                filePath: target,
                type: category === 'Músicas' ? 'audio' : category === 'Imagens' ? 'image' : 'video',
                createdAt: new Date().toISOString(),
            };
            index.push(entry);
            writeIndex(index);
        }
        const mtime = new Date(record.sourceMtime);
        if (Number.isFinite(mtime.getTime())) await fs.promises.utimes(target, mtime, mtime).catch(() => undefined);
        res.json({ ok: true, restored: !existing });
    } catch (error) {
        const status = (error as NodeJS.ErrnoException).code === 'EEXIST' ? 409
            : error instanceof GatewayHttpError && error.status > 0 ? error.status : 500;
        res.status(status).json({ ok: false, message: (error as Error).message || 'Falha ao restaurar arquivo.' });
    } finally {
        if (temporary) await fs.promises.unlink(temporary).catch(() => undefined);
    }
};
