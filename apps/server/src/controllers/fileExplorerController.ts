import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash, randomUUID as uuidv4 } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { safeResolve } from '../utils/safePath';

const execFileAsync = promisify(execFile);
const FFPROBE_BIN = process.env.FFPROBE_PATH || 'ffprobe';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

export const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');

// Raiz do explorador: tudo daqui pra baixo. As 3 categorias padrão são subpastas.
export const FILES_ROOT = path.join(BASE_DATA_PATH, 'files');
const INDEX_JSON = path.join(BASE_DATA_PATH, 'data/files_index.json');
const PROJECTS_DIR = path.join(BASE_DATA_PATH, 'data/projects');
export const PREVIEW_CACHE_ROOT = path.join(BASE_DATA_PATH, 'preview-cache');
const previewJobs = new Map<string, Promise<string>>();

// Categorias padrão (pastas raiz fixas).
export const CATEGORIES = ['Músicas', 'Imagens', 'Vídeos'] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULT_ROOT_FOLDERS = [...CATEGORIES, 'Geração por IA'] as const;

/** Extensões suportadas por categoria (fonte: MediaTake.type + multer). */
const EXT_BY_CATEGORY: Record<Category, string[]> = {
    Músicas: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'],
    Imagens: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'],
    Vídeos: ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'],
};

// ─── Tipos do índice ──────────────────────────────────────────────────────

export interface FileEntry {
    id: string;
    category: Category;
    name: string; // nome do arquivo (basename)
    relPath: string; // relativo a FILES_ROOT, ex: "Músicas/rock/musica.mp3"
    publicUrl: string; // ex: "/files/Músicas/rock/musica.mp3"
    filePath: string; // absoluto
    type: 'audio' | 'image' | 'video';
    durationSec?: number;
    createdAt: string;
    aiGeneration?: {
        conversationId?: string;
        conversationTitle?: string;
        prompt?: string;
        provider?: string;
        model?: string;
        createdAt: string;
    };
}

// ─── Boot: garante pastas padrão ──────────────────────────────────────────

export function ensureFilesDirs(): void {
    if (!fs.existsSync(FILES_ROOT)) fs.mkdirSync(FILES_ROOT, { recursive: true });
    for (const cat of DEFAULT_ROOT_FOLDERS) {
        const p = path.join(FILES_ROOT, cat);
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }
}
ensureFilesDirs();
if (!fs.existsSync(PREVIEW_CACHE_ROOT)) fs.mkdirSync(PREVIEW_CACHE_ROOT, { recursive: true });

// ─── Índice (fonte da verdade dos metadados) ──────────────────────────────

export function readIndex(): FileEntry[] {
    try {
        if (fs.existsSync(INDEX_JSON)) {
            return JSON.parse(fs.readFileSync(INDEX_JSON, 'utf-8'));
        }
    } catch {
        /* corrompido: começa vazio */
    }
    return [];
}

export function writeIndex(entries: FileEntry[]): void {
    const dir = path.dirname(INDEX_JSON);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(INDEX_JSON, JSON.stringify(entries, null, 2), 'utf-8');
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function extOf(name: string): string {
    return path.extname(name).toLowerCase();
}

function isInsideFilesRoot(candidate: string): boolean {
    const relative = path.relative(path.resolve(FILES_ROOT), path.resolve(candidate));
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function existingEntryPath(entry?: FileEntry, requestedRelPath?: string): string | null {
    const candidates = [
        entry?.filePath,
        entry?.relPath ? safeResolve(FILES_ROOT, entry.relPath) : '',
        requestedRelPath ? safeResolve(FILES_ROOT, requestedRelPath) : '',
    ];
    for (const rawCandidate of candidates) {
        if (!rawCandidate) continue;
        const candidate = path.resolve(rawCandidate);
        if (!isInsideFilesRoot(candidate)) continue;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
}

/** Categoria a partir da extensão; lança se não for mídia reconhecida. */
export function categoryOf(name: string): Category {
    const ext = extOf(name);
    for (const cat of CATEGORIES) {
        if (EXT_BY_CATEGORY[cat].includes(ext)) return cat;
    }
    throw new Error(`Extensão não suportada: ${ext || '(sem extensão)'}`);
}

function typeOf(category: Category): FileEntry['type'] {
    return category === 'Músicas' ? 'audio' : category === 'Imagens' ? 'image' : 'video';
}

/** Codifica cada segmento de um caminho relativo p/ URL (mantém acentos/slashes).
 *  Exportado porque o musicController recalcula o publicUrl ao renomear. */
export function toPublicUrl(relPath: string): string {
    const encoded = relPath
        .split(/[\\/]+/)
        .filter(Boolean)
        .map((seg) => encodeURIComponent(seg))
        .join('/');
    return `/files/${encoded}`;
}

/** Sanitiza nome de pasta/arquivo: sem separadores, sem .., sem controle. */
function sanitizeName(name: string): string {
    const cleaned = [...name.replace(/[\\/:*?"<>|]/g, '')]
        .filter((character) => character.charCodeAt(0) >= 32)
        .join('')
        .trim();
    if (!cleaned || cleaned === '.' || cleaned === '..') {
        throw new Error('Nome inválido.');
    }
    return cleaned.slice(0, 120);
}

async function getMediaDuration(filePath: string): Promise<number | undefined> {
    try {
        const { stdout } = await execFileAsync(FFPROBE_BIN, [
            '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
        ]);
        const dur = parseFloat(String(stdout).trim());
        return isNaN(dur) ? undefined : dur;
    } catch {
        return undefined;
    }
}

/** Registra um arquivo no índice (usado por upload/copy/migração). */
export async function registerFile(
    filePath: string,
    relPath: string,
    extra?: Partial<FileEntry>
): Promise<FileEntry> {
    const name = path.basename(filePath);
    const category = extra?.category ?? categoryOf(name);
    const entry: FileEntry = {
        id: uuidv4(),
        category,
        name,
        relPath,
        publicUrl: toPublicUrl(relPath),
        filePath,
        type: typeOf(category),
        createdAt: new Date().toISOString(),
        ...extra,
    };
    if (entry.type === 'audio' || entry.type === 'video') {
        entry.durationSec = await getMediaDuration(filePath);
    }
    const index = readIndex();
    index.push(entry);
    writeIndex(index);
    return entry;
}

/**
 * Destino canônico de toda mídia criada por IA. O arquivo nasce no PC do
 * usuário; compartilhar continua sendo uma ação explícita posterior.
 */
export async function storeAiGeneratedMedia(
    content: Buffer,
    extension: string,
    metadata: Omit<NonNullable<FileEntry['aiGeneration']>, 'createdAt'>
): Promise<FileEntry> {
    const safeExtension = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    categoryOf(`generated${safeExtension}`);
    const folder = path.join(FILES_ROOT, 'Geração por IA');
    await fs.promises.mkdir(folder, { recursive: true });
    const storedName = `ia-${Date.now()}-${uuidv4()}${safeExtension}`;
    const target = path.join(folder, storedName);
    const relPath = path.join('Geração por IA', storedName).split(path.sep).join('/');
    await fs.promises.writeFile(target, content);
    return registerFile(target, relPath, {
        name: storedName,
        aiGeneration: { ...metadata, createdAt: new Date().toISOString() },
    });
}

/** Versão por streaming para vídeos grandes, sem manter centenas de MB na memória. */
export async function storeAiGeneratedMediaStream(
    content: Readable,
    extension: string,
    metadata: Omit<NonNullable<FileEntry['aiGeneration']>, 'createdAt'>
): Promise<FileEntry> {
    const safeExtension = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    categoryOf(`generated${safeExtension}`);
    const folder = path.join(FILES_ROOT, 'Geração por IA');
    await fs.promises.mkdir(folder, { recursive: true });
    const storedName = `ia-${Date.now()}-${uuidv4()}${safeExtension}`;
    const target = path.join(folder, storedName);
    const relPath = path.join('Geração por IA', storedName).split(path.sep).join('/');
    try {
        await pipeline(content, fs.createWriteStream(target, { flags: 'wx' }));
        return await registerFile(target, relPath, {
            name: storedName,
            aiGeneration: { ...metadata, createdAt: new Date().toISOString() },
        });
    } catch (error) {
        await fs.promises.unlink(target).catch(() => {});
        throw error;
    }
}

// ─── Reconciliação de projetos ────────────────────────────────────────────
//
// Quando um arquivo muda de lugar/nome, varremos TODOS os ad-data.json e
// reescrevemos os campos de mídia que apontavam pro path antigo. Só tocamos
// referências LOCAIS (não URL externa tipo Pixabay). O arquivo físico é único:
// a lista de Música de Fundo e os projetos passam a apontar pro novo caminho.

/**
 * Dado um caminho público antigo (ex: /music/x.mp3) e um novo (ou null = excluído),
 * reescreve TODOS os projetos. Retorna quantas referências foram atualizadas.
 * Exportado porque o musicController/deleteMusic precisa reaproveitar a mesma lógica.
 */
export function reconcileProjects(oldPublicUrl: string, newPublicUrl: string | null): number {
    if (!oldPublicUrl) return 0;
    let touched = 0;
    if (!fs.existsSync(PROJECTS_DIR)) return 0;

    const projects = fs
        .readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory());

    for (const proj of projects) {
        const dataPath = path.join(PROJECTS_DIR, proj.name, 'ad-data.json');
        if (!fs.existsSync(dataPath)) continue;
        let raw: string;
        try {
            raw = fs.readFileSync(dataPath, 'utf-8');
        } catch {
            continue;
        }
        if (!raw.includes(oldPublicUrl)) continue; // early skip: projeto não referencia

        let changed = false;
        try {
            const obj = JSON.parse(raw) as Record<string, unknown>;
            // Excluir a mídia da biblioteca também elimina o take inteiro das
            // linhas do tempo salvas. Apenas zerar a URL deixava cartões vazios
            // que reapareciam quando o rascunho era aberto novamente.
            if (newPublicUrl === null && Array.isArray(obj.mediaTakes)) {
                const remaining = obj.mediaTakes.filter((take) => !containsStringReference(take, oldPublicUrl));
                if (remaining.length !== obj.mediaTakes.length) {
                    obj.mediaTakes = remaining;
                    changed = true;
                }
            }
            if (rewriteRefs(obj, oldPublicUrl, newPublicUrl)) changed = true;
            if (changed) {
                fs.writeFileSync(dataPath, JSON.stringify(obj, null, 2), 'utf-8');
                touched++;
            }
        } catch {
            /* JSON inválido: não mexe */
        }
    }
    return touched;
}

function containsStringReference(node: unknown, reference: string): boolean {
    if (typeof node === 'string') return node.includes(reference);
    if (Array.isArray(node)) return node.some((item) => containsStringReference(item, reference));
    if (node && typeof node === 'object') {
        return Object.values(node as Record<string, unknown>).some((value) => containsStringReference(value, reference));
    }
    return false;
}

/** Percorre recursivamente um objeto reescrevendo strings que casam com oldUrl. */
function rewriteRefs(node: unknown, oldUrl: string, newUrl: string | null): boolean {
    let changed = false;
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            if (typeof node[i] === 'string' && (node[i] as string).includes(oldUrl)) {
                node[i] = newUrl === null ? '' : (node[i] as string).split(oldUrl).join(newUrl);
                changed = true;
            } else if (node[i] && typeof node[i] === 'object') {
                if (rewriteRefs(node[i], oldUrl, newUrl)) changed = true;
            }
        }
    } else if (node && typeof node === 'object') {
        for (const key of Object.keys(node as Record<string, unknown>)) {
            const v = (node as Record<string, unknown>)[key];
            if (typeof v === 'string' && v.includes(oldUrl)) {
                (node as Record<string, unknown>)[key] =
                    newUrl === null ? '' : v.split(oldUrl).join(newUrl);
                changed = true;
            } else if (v && typeof v === 'object') {
                if (rewriteRefs(v, oldUrl, newUrl)) changed = true;
            }
        }
    }
    return changed;
}

// ─── Endpoints ────────────────────────────────────────────────────────────

// GET /api/files/tree
export const getTree = (_req: Request, res: Response) => {
    try {
        const build = (dir: string): FileNode => {
            const name = path.basename(dir);
            const children: FileNode[] = [];
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    children.push(build(path.join(dir, entry.name)));
                }
            }
            const rel = path.relative(FILES_ROOT, dir).split(path.sep).join('/');
            return { name, relPath: rel || '/', isCategory: DEFAULT_ROOT_FOLDERS.includes(name as (typeof DEFAULT_ROOT_FOLDERS)[number]), children };
        };
        res.json({ ok: true, root: build(FILES_ROOT) });
    } catch (error: unknown) {
        res.status(500).json({ ok: false, message: errMsg(error) });
    }
};

async function getVideoCodec(filePath: string): Promise<string> {
    try {
        const { stdout } = await execFileAsync(FFPROBE_BIN, [
            '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt',
            '-of', 'default=noprint_wrappers=1:nokey=0', filePath,
        ]);
        return String(stdout).toLowerCase();
    } catch {
        return '';
    }
}

/**
 * Gera sob demanda um H.264 leve para formatos que o Chromium/Electron não
 * decodifica (principalmente MOV HEVC 10-bit de iPhone). O original nunca é
 * alterado e continua sendo a fonte de qualidade da exportação.
 */
export const preparePreviewSource = async (req: Request, res: Response) => {
    try {
        const relPath = typeof req.body?.relPath === 'string' ? req.body.relPath : '';
        if (!relPath) return res.status(400).json({ ok: false, message: 'Arquivo não informado.' });
        const sourcePath = safeResolve(FILES_ROOT, relPath);
        if (!sourcePath.startsWith(FILES_ROOT) || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
            return res.status(404).json({ ok: false, message: 'Arquivo não encontrado.' });
        }
        if (typeOf(categoryOf(sourcePath)) !== 'video') {
            return res.status(400).json({ ok: false, message: 'O item não é um vídeo.' });
        }

        const codec = await getVideoCodec(sourcePath);
        const durationSec = await getMediaDuration(sourcePath);
        // H.264 8-bit é reproduzido nativamente; não desperdiçar espaço.
        if (codec.includes('codec_name=h264') && !codec.includes('10le') && !codec.includes('12le')) {
            return res.json({ ok: true, publicUrl: toPublicUrl(relPath), durationSec, transcoded: false });
        }

        const stat = fs.statSync(sourcePath);
        const cacheKey = createHash('sha256')
            .update(`${sourcePath}\0${stat.size}\0${stat.mtimeMs}`)
            .digest('hex');
        const outputPath = path.join(PREVIEW_CACHE_ROOT, `${cacheKey}.mp4`);
        let job = previewJobs.get(cacheKey);
        if (!job) {
            job = (async () => {
                if (fs.existsSync(outputPath) && fs.statSync(outputPath).size >= 1024) return outputPath;
                const partialPath = `${outputPath}.partial.mp4`;
                try {
                    if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
                    await execFileAsync(FFMPEG_BIN, [
                        '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
                        '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'veryfast',
                        '-crf', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
                        '-movflags', '+faststart', partialPath,
                    ], { maxBuffer: 1024 * 1024 * 4 });
                    if (!fs.existsSync(partialPath) || fs.statSync(partialPath).size < 1024) {
                        throw new Error('O proxy gerado ficou vazio.');
                    }
                    fs.renameSync(partialPath, outputPath);
                    return outputPath;
                } finally {
                    if (fs.existsSync(partialPath)) {
                        try { fs.unlinkSync(partialPath); } catch { /* noop */ }
                    }
                }
            })().finally(() => previewJobs.delete(cacheKey));
            previewJobs.set(cacheKey, job);
        }
        await job;
        return res.json({
            ok: true,
            publicUrl: `/preview-cache/${encodeURIComponent(cacheKey)}.mp4`,
            durationSec,
            transcoded: true,
        });
    } catch (error: unknown) {
        return res.status(500).json({ ok: false, message: errMsg(error) });
    }
};

interface FileNode {
    name: string;
    relPath: string;
    isCategory: boolean;
    children: FileNode[];
}

// GET /api/files/list?path=Músicas
export const listItems = (req: Request, res: Response) => {
    try {
        const rel = (req.query.path as string) || '';
        const dir = rel ? safeResolve(FILES_ROOT, rel) : FILES_ROOT;
        // Defensive: o resultado nunca pode escapar de FILES_ROOT.
        if (!dir.startsWith(FILES_ROOT)) {
            return res.status(400).json({ ok: false, message: 'Caminho inválido.' });
        }
        if (!fs.existsSync(dir)) {
            return res.json({ ok: true, folders: [], files: [] });
        }
        const index = readIndex();
        const byRel = new Map(index.map((e) => [e.relPath.split(path.sep).join('/'), e]));
        let indexChanged = false;

        const folders: Array<{ name: string; relPath: string }> = [];
        const files: Array<FileEntry & { size: number }> = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const childRel = path.join(rel, entry.name).split(path.sep).join('/');
            if (entry.isDirectory()) {
                folders.push({ name: entry.name, relPath: childRel });
            } else if (entry.isFile()) {
                const full = path.join(dir, entry.name);
                const meta = byRel.get(childRel);
                const size = fs.statSync(full).size;
                if (meta) {
                    // O diretório de dados muda entre modo local, instalável e
                    // atualizações. O relPath é estável; o caminho absoluto salvo
                    // no índice pode ficar antigo mesmo com o arquivo presente.
                    if (path.resolve(meta.filePath) !== path.resolve(full) || meta.publicUrl !== toPublicUrl(childRel)) {
                        meta.filePath = full;
                        meta.relPath = childRel;
                        meta.publicUrl = toPublicUrl(childRel);
                        indexChanged = true;
                    }
                    files.push({ ...meta, filePath: full, relPath: childRel, publicUrl: toPublicUrl(childRel), size });
                } else {
                    // Arquivo no disco sem entrada no índice (ex: colado manualmente).
                    files.push({
                        id: '', category: tryCategory(entry.name), name: entry.name,
                        relPath: childRel, publicUrl: toPublicUrl(childRel), filePath: full,
                        type: tryType(entry.name), size, createdAt: new Date(0).toISOString(),
                    });
                }
            }
        }
        if (indexChanged) writeIndex(index);
        res.json({ ok: true, folders, files });
    } catch (error: unknown) {
        res.status(500).json({ ok: false, message: errMsg(error) });
    }
};

function tryCategory(name: string): Category {
    try {
        return categoryOf(name);
    } catch {
        return 'Imagens';
    }
}
function tryType(name: string): FileEntry['type'] {
    return typeOf(tryCategory(name));
}

// POST /api/files/folder  { parent, name }
export const createFolder = (req: Request, res: Response) => {
    try {
        const parent = (req.body.parent as string) || '';
        const name = sanitizeName(req.body.name as string);
        const parentDir = parent ? safeResolve(FILES_ROOT, parent) : FILES_ROOT;
        if (!parentDir.startsWith(FILES_ROOT)) {
            return res.status(400).json({ ok: false, message: 'Caminho inválido.' });
        }
        const newDir = path.join(parentDir, name);
        if (fs.existsSync(newDir)) {
            return res.status(409).json({ ok: false, message: 'Já existe uma pasta com esse nome.' });
        }
        fs.mkdirSync(newDir, { recursive: true });
        res.json({ ok: true, relPath: path.join(parent, name).split(path.sep).join('/') });
    } catch (error: unknown) {
        res.status(400).json({ ok: false, message: errMsg(error) });
    }
};

// POST /api/files/upload  (multipart, campo "file" + form "parent")
export const uploadFile = async (req: Request, res: Response) => {
    try {
        if (!req.file) return res.status(400).json({ ok: false, message: 'Nenhum arquivo enviado.' });
        const parent = (req.body.parent as string) || '';
        const parentDir = parent ? safeResolve(FILES_ROOT, parent) : FILES_ROOT;
        if (!parentDir.startsWith(FILES_ROOT)) {
            return res.status(400).json({ ok: false, message: 'Caminho inválido.' });
        }

        const originalName = req.file.originalname;
        const category = categoryOf(originalName); // lança se extensão não for mídia
        const id = uuidv4();
        const ext = extOf(originalName);
        const newName = `${id}${ext}`;
        const target = path.join(parentDir, newName);
        const relPath = path.join(parent, newName).split(path.sep).join('/');

        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        fs.renameSync(req.file.path, target);

        const entry = await registerFile(target, relPath, {
            category,
            name: path.basename(originalName, ext).slice(0, 100) + ext,
        });
        res.json({ ok: true, entry });
    } catch (error: unknown) {
        // Limpa temp do multer em caso de erro.
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
        }
        res.status(400).json({ ok: false, message: errMsg(error) });
    }
};

// POST /api/files/import-paths
// Uso exclusivo do processo principal do Electron para colar arquivos copiados
// no Windows Explorer sem carregar vídeos grandes inteiros na memória do renderer.
export const importLocalPaths = async (req: Request, res: Response) => {
    const importToken = process.env.LOCAL_FILE_IMPORT_TOKEN;
    if (!importToken || req.get('X-Local-File-Import') !== importToken) {
        return res.status(403).json({ ok: false, message: 'Importação local não autorizada.' });
    }

    const rawPaths = Array.isArray(req.body?.paths) ? req.body.paths.slice(0, 50) : [];
    if (rawPaths.length === 0) {
        return res.status(400).json({ ok: false, message: 'Nenhum arquivo foi encontrado na área de transferência.' });
    }

    const parent = typeof req.body?.parent === 'string' ? req.body.parent : '';
    let parentDir: string;
    try {
        parentDir = parent ? safeResolve(FILES_ROOT, parent) : FILES_ROOT;
        if (!parentDir.startsWith(FILES_ROOT)) throw new Error('Caminho inválido.');
        await fs.promises.mkdir(parentDir, { recursive: true });
    } catch (error: unknown) {
        return res.status(400).json({ ok: false, message: errMsg(error) });
    }

    const entries: FileEntry[] = [];
    const errors: string[] = [];

    for (const rawPath of rawPaths) {
        const sourcePath = typeof rawPath === 'string' ? rawPath.trim() : '';
        let targetPath = '';
        try {
            if (!sourcePath || !path.isAbsolute(sourcePath)) throw new Error('caminho inválido');
            const stat = await fs.promises.stat(sourcePath);
            if (!stat.isFile()) throw new Error('não é um arquivo');

            const originalName = path.basename(sourcePath);
            const category = categoryOf(originalName);
            const ext = extOf(originalName);
            const storedName = `${uuidv4()}${ext}`;
            targetPath = path.join(parentDir, storedName);
            const relPath = path.join(parent, storedName).split(path.sep).join('/');

            await fs.promises.copyFile(sourcePath, targetPath);
            const entry = await registerFile(targetPath, relPath, {
                category,
                name: path.basename(originalName, ext).slice(0, 100) + ext,
            });
            entries.push(entry);
        } catch (error: unknown) {
            if (targetPath && fs.existsSync(targetPath)) {
                try { await fs.promises.unlink(targetPath); } catch { /* noop */ }
            }
            errors.push(`${path.basename(sourcePath) || 'Item'}: ${errMsg(error)}`);
        }
    }

    if (entries.length === 0) {
        return res.status(400).json({
            ok: false,
            imported: 0,
            errors,
            message: errors[0] || 'Nenhum arquivo pôde ser importado.',
        });
    }

    return res.json({ ok: true, imported: entries.length, entries, errors });
};

// POST /api/files/import-export
// O MP4 acabou de ser renderizado no diretório temporário do sistema. Em vez de
// obrigar o usuário a encontrá-lo e reenviá-lo, copiamos diretamente para a
// biblioteca local. Aceitamos somente artefatos efêmeros criados pelo export.
export const importExportedFile = async (req: Request, res: Response) => {
    let targetPath = '';
    try {
        const sourcePath = typeof req.body?.sourcePath === 'string' ? path.resolve(req.body.sourcePath) : '';
        const tempRoot = path.resolve(os.tmpdir());
        const relative = sourcePath ? path.relative(tempRoot, sourcePath) : '..';
        if (!sourcePath || relative.startsWith('..') || path.isAbsolute(relative) || !/^mileto-final-[\w-]+\.mp4$/i.test(path.basename(sourcePath))) {
            throw new Error('Arquivo de exportação inválido.');
        }
        const sourceStat = await fs.promises.stat(sourcePath);
        if (!sourceStat.isFile()) throw new Error('O MP4 temporário não foi encontrado.');

        const parent = typeof req.body?.parent === 'string' && req.body.parent ? req.body.parent : 'Vídeos';
        const parentDir = safeResolve(FILES_ROOT, parent);
        if (!parentDir.startsWith(FILES_ROOT)) throw new Error('Pasta de destino inválida.');
        await fs.promises.mkdir(parentDir, { recursive: true });

        const requestedName = typeof req.body?.name === 'string' ? req.body.name : 'MeuVideo_Mileto.mp4';
        const originalName = extOf(requestedName) ? requestedName : `${requestedName}.mp4`;
        const storedName = `${uuidv4()}${extOf(originalName) || '.mp4'}`;
        targetPath = path.join(parentDir, storedName);
        const relPath = path.join(parent, storedName).split(path.sep).join('/');
        await fs.promises.copyFile(sourcePath, targetPath);
        const entry = await registerFile(targetPath, relPath, {
            category: 'Vídeos',
            name: path.basename(originalName).slice(0, 120),
        });
        res.json({ ok: true, entry });
    } catch (error: unknown) {
        if (targetPath && fs.existsSync(targetPath)) await fs.promises.unlink(targetPath).catch(() => undefined);
        res.status(400).json({ ok: false, message: errMsg(error) });
    }
};

// PATCH /api/files/rename  { id, name }
export const renameItem = (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const newName = sanitizeName(req.body.name as string);
        const index = readIndex();
        const entry = index.find((e) => e.id === id);
        if (!entry) return res.status(404).json({ ok: false, message: 'Item não encontrado.' });

        const oldPublic = entry.publicUrl;
        const dir = path.dirname(entry.filePath);
        const ext = extOf(entry.name);
        // Mantém a extensão original (renomear não muda o tipo).
        const finalName = ext && !extOf(newName) ? newName + ext : newName;
        const newFilePath = path.join(dir, finalName);
        if (fs.existsSync(newFilePath) && newFilePath !== entry.filePath) {
            return res.status(409).json({ ok: false, message: 'Já existe um item com esse nome.' });
        }
        fs.renameSync(entry.filePath, newFilePath);

        const newRel = path.join(path.dirname(entry.relPath.split('/').join(path.sep)), finalName).split(path.sep).join('/');
        entry.filePath = newFilePath;
        entry.name = finalName;
        entry.relPath = newRel;
        entry.publicUrl = toPublicUrl(newRel);
        writeIndex(index);

        const touched = reconcileProjects(oldPublic, entry.publicUrl);
        res.json({ ok: true, entry, projectsUpdated: touched });
    } catch (error: unknown) {
        res.status(400).json({ ok: false, message: errMsg(error) });
    }
};

// POST /api/files/move  { id, destPath }
export const moveItem = async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const requestedRelPath = typeof req.body?.relPath === 'string' ? req.body.relPath : '';
        const destRel = (req.body.destPath as string) || '';
        const index = readIndex();
        const entry = index.find((e) => (id && e.id === id) || (requestedRelPath && e.relPath === requestedRelPath));
        const sourcePath = existingEntryPath(entry, requestedRelPath);
        if (!sourcePath) return res.status(404).json({ ok: false, message: 'Arquivo local não encontrado.' });

        const destDir = destRel ? safeResolve(FILES_ROOT, destRel) : FILES_ROOT;
        if (!destDir.startsWith(FILES_ROOT)) {
            return res.status(400).json({ ok: false, message: 'Destino inválido.' });
        }
        const displayName = entry?.name || path.basename(sourcePath);
        const newFilePath = path.join(destDir, displayName);
        if (path.resolve(newFilePath) === path.resolve(sourcePath)) {
            return res.status(409).json({ ok: false, message: 'O arquivo já está nesta pasta.' });
        }
        if (fs.existsSync(newFilePath)) {
            return res.status(409).json({ ok: false, message: 'Já existe um item com esse nome no destino.' });
        }
        const oldPublic = entry?.publicUrl || toPublicUrl(requestedRelPath);
        await fs.promises.rename(sourcePath, newFilePath);

        const newRel = path.join(destRel, displayName).split(path.sep).join('/');
        if (!entry) {
            const created = await registerFile(newFilePath, newRel, { name: displayName });
            const touched = reconcileProjects(oldPublic, created.publicUrl);
            return res.json({ ok: true, entry: created, projectsUpdated: touched });
        }
        entry.filePath = newFilePath;
        entry.relPath = newRel;
        entry.publicUrl = toPublicUrl(newRel);
        // Categoria pode mudar se moveram entre pastas de categoria diferentes — revalida.
        try {
            entry.category = categoryOf(entry.name);
            entry.type = typeOf(entry.category);
        } catch { /* mantém */ }
        writeIndex(index);

        const touched = reconcileProjects(oldPublic, entry.publicUrl);
        res.json({ ok: true, entry, projectsUpdated: touched });
    } catch (error: unknown) {
        res.status(400).json({ ok: false, message: errMsg(error) });
    }
};

// POST /api/files/copy  { id, destPath }
export const copyItem = async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        const requestedRelPath = typeof req.body?.relPath === 'string' ? req.body.relPath : '';
        const destRel = (req.body.destPath as string) || '';
        const index = readIndex();
        const entry = index.find((e) => (id && e.id === id) || (requestedRelPath && e.relPath === requestedRelPath));
        const sourcePath = existingEntryPath(entry, requestedRelPath);
        if (!sourcePath) return res.status(404).json({ ok: false, message: 'Arquivo local não encontrado.' });

        const destDir = destRel ? safeResolve(FILES_ROOT, destRel) : FILES_ROOT;
        if (!destDir.startsWith(FILES_ROOT)) {
            return res.status(400).json({ ok: false, message: 'Destino inválido.' });
        }
        // Cópia = NOVO arquivo independente (nova id, nova entrada no índice).
        const copyId = uuidv4();
        const displayName = entry?.name || path.basename(sourcePath);
        const ext = extOf(displayName);
        const copyName = `${copyId}${ext}`;
        const copyPath = path.join(destDir, copyName);
        await fs.promises.copyFile(sourcePath, copyPath);

        const copyRel = path.join(destRel, copyName).split(path.sep).join('/');
        const copyEntry = await registerFile(copyPath, copyRel, {
            ...(entry?.category ? { category: entry.category } : {}),
            name: displayName,
            durationSec: entry?.durationSec,
        });
        res.json({ ok: true, entry: copyEntry });
    } catch (error: unknown) {
        res.status(400).json({ ok: false, message: errMsg(error) });
    }
};

// DELETE /api/files/item  { id }
export const deleteItem = (req: Request, res: Response) => {
    try {
        // Aceita id no body (DELETE sem body em alguns clients) ou query.
        const id = (req.body?.id as string) || (req.query.id as string);
        const requestedRelPath = (req.body?.relPath as string) || (req.query.relPath as string);
        const index = readIndex();
        const idx = index.findIndex((e) => (id && e.id === id) || (requestedRelPath && e.relPath === requestedRelPath));
        if (idx === -1 && !requestedRelPath) {
            return res.status(404).json({ ok: false, message: 'Item não encontrado.' });
        }

        // Arquivos antigos colados manualmente podem existir sem entrada no índice.
        // Permite removê-los pelo caminho relativo, sempre confinado em FILES_ROOT.
        if (idx === -1) {
            const target = safeResolve(FILES_ROOT, requestedRelPath);
            if (!target.startsWith(FILES_ROOT) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
                return res.status(404).json({ ok: false, message: 'Arquivo local não encontrado.' });
            }
            fs.unlinkSync(target);
            const touched = reconcileProjects(toPublicUrl(requestedRelPath), null);
            return res.json({ ok: true, projectsUpdated: touched });
        }

        const entry = index[idx];
        const oldPublic = entry.publicUrl;
        const filePath = existingEntryPath(entry, requestedRelPath);
        if (filePath) fs.unlinkSync(filePath);
        index.splice(idx, 1);
        writeIndex(index);

        // Zera as referências nos projetos (não remove o projeto, só invalida a mídia).
        const touched = reconcileProjects(oldPublic, null);
        res.json({ ok: true, projectsUpdated: touched });
    } catch (error: unknown) {
        res.status(400).json({ ok: false, message: errMsg(error) });
    }
};

function errMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
