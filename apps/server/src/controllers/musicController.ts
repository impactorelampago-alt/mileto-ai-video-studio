import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import {
    FILES_ROOT,
    readIndex,
    writeIndex,
    registerFile,
    reconcileProjects,
    toPublicUrl,
    type FileEntry,
} from './fileExplorerController';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');

// Músicas agora moram em files/Músicas (índice central). O diretório legado music/ só
// existe durante a migração; novos uploads nunca passam por aqui.
const MUSIC_DIR = path.join(FILES_ROOT, 'Músicas');
const LEGACY_LIBRARY_JSON = path.join(BASE_DATA_PATH, 'data/music_library.json');

if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

interface MusicTrack {
    id: string;
    originalName: string;
    displayName: string;
    filePath: string;
    publicUrl: string;
    durationSec: number;
    createdAt: string;
    source?: 'system' | 'user';
    systemKey?: string;
    locked?: boolean;
}

const SYSTEM_TRACKS: MusicTrack[] = [
    {
        id: 'system-music:batida-1',
        originalName: '1 - Batida.mp3',
        displayName: '1 - Batida',
        filePath: 'system-music/batida-1.mp3',
        publicUrl: '/system-music/batida-1.mp3',
        durationSec: 76.584,
        createdAt: '2026-08-05T00:00:00.000Z',
        source: 'system',
        systemKey: 'batida-1',
        locked: true,
    },
    {
        id: 'system-music:blogueira-1',
        originalName: '1 - Blogueira.mp3',
        displayName: '1 - Blogueira',
        filePath: 'system-music/blogueira-1.mp3',
        publicUrl: '/system-music/blogueira-1.mp3',
        durationSec: 94.272,
        createdAt: '2026-08-05T00:00:00.000Z',
        source: 'system',
        systemKey: 'blogueira-1',
        locked: true,
    },
    {
        id: 'system-music:rodeio-1',
        originalName: '1 - Rodeio.mp3',
        displayName: '1 - Rodeio',
        filePath: 'system-music/rodeio-1.mp3',
        publicUrl: '/system-music/rodeio-1.mp3',
        durationSec: 304.632,
        createdAt: '2026-08-09T00:00:00.000Z',
        source: 'system',
        systemKey: 'rodeio-1',
        locked: true,
    },
];

const normalizeSystemTrackIdentity = (value: string): string => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

const SYSTEM_TRACK_ALIASES: Record<string, string[]> = {
    'system-music:batida-1': ['Batida 1', '1 - Batida', 'batida-1'],
    'system-music:blogueira-1': ['Blogueira 1', '1 - Blogueira', 'blogueira-1'],
    'system-music:rodeio-1': ['Rodeio', 'Rodeio 1', '1 - Rodeio', 'rodeio-1'],
};

function systemTrackFor(track: MusicTrack): MusicTrack | null {
    const identities = [track.id, track.systemKey, track.displayName, track.originalName]
        .filter((identity): identity is string => Boolean(identity));
    return SYSTEM_TRACKS.find((systemTrack) => identities.some((identity) => {
        if (systemTrack.id === identity || systemTrack.systemKey === identity) return true;
        const normalized = normalizeSystemTrackIdentity(identity);
        return normalizeSystemTrackIdentity(systemTrack.displayName) === normalized ||
            normalizeSystemTrackIdentity(systemTrack.originalName) === normalized ||
            (SYSTEM_TRACK_ALIASES[systemTrack.id] || []).some((alias) =>
                normalizeSystemTrackIdentity(alias) === normalized
            );
    })) || null;
}

function withSystemTracks(tracks: MusicTrack[]): MusicTrack[] {
    return [
        ...SYSTEM_TRACKS,
        ...tracks
            .filter((track) => !systemTrackFor(track))
            .map((track) => ({ ...track, source: 'user' as const })),
    ];
}

/** Converte uma entrada do índice (categoria Músicas) no formato MusicTrack do frontend. */
function toTrack(entry: FileEntry): MusicTrack {
    const baseName = entry.name.replace(/\.[^.]+$/, '');
    return {
        id: entry.id,
        originalName: entry.name,
        displayName: baseName,
        filePath: entry.filePath,
        publicUrl: entry.publicUrl,
        durationSec: entry.durationSec ?? 0,
        createdAt: entry.createdAt,
    };
}

/** Lê músicas do índice central. Cai no JSON legado (music_library.json) se o índice
 *  ainda não tiver sido populado pela migração — compatibilidade durante a transição. */
function readLibrary(): MusicTrack[] {
    const fromIndex = readIndex()
        .filter((e) => e.category === 'Músicas')
        .map(toTrack);
    if (fromIndex.length > 0) return withSystemTracks(fromIndex);
    // Fallback legado: mostra o que existia antes da migração rodar.
    try {
        if (fs.existsSync(LEGACY_LIBRARY_JSON)) {
            return withSystemTracks(JSON.parse(fs.readFileSync(LEGACY_LIBRARY_JSON, 'utf-8')));
        }
    } catch {
        /* corrompido: ignora */
    }
    return [...SYSTEM_TRACKS];
}

// POST /api/music/upload
export const uploadMusic = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'Nenhum arquivo enviado' });
        }

        const id = uuidv4();
        const ext = path.extname(req.file.originalname);
        const newFileName = `${id}${ext}`;
        const targetPath = path.join(MUSIC_DIR, newFileName);

        // Move de uploads/ para files/Músicas/
        fs.renameSync(req.file.path, targetPath);

        const originalName = req.file.originalname;

        // Registra no índice central (fonte da verdade). relPath usa separador URL "/".
        const relPath = `Músicas/${newFileName}`;
        const entry = await registerFile(targetPath, relPath, {
            category: 'Músicas',
            name: originalName.slice(0, 100),
        });

        res.json({ ok: true, track: toTrack(entry) });
    } catch (error: unknown) {
        console.error('Music Upload Error:', error);
        const msg = error instanceof Error ? error.message : 'Erro desconhecido';
        res.status(500).json({ ok: false, message: msg });
    }
};

// GET /api/music/list
export const listMusic = (_req: Request, res: Response) => {
    try {
        const library = readLibrary();
        res.json({ ok: true, tracks: library });
    } catch (error: unknown) {
        console.error('Music List Error:', error);
        const msg = error instanceof Error ? error.message : 'Erro desconhecido';
        res.status(500).json({ ok: false, message: msg });
    }
};

// PATCH /api/music/:id
export const renameMusic = (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { displayName } = req.body;

        if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
            return res.status(400).json({ ok: false, message: 'displayName é obrigatório' });
        }

        const trimmed = displayName.trim().slice(0, 60);

        const index = readIndex();
        const entry = index.find((e) => e.id === id && e.category === 'Músicas');
        if (!entry) {
            return res.status(404).json({ ok: false, message: 'Música não encontrada' });
        }

        // Renomeia preservando a extensão e o diretório atuais.
        const oldPublic = entry.publicUrl;
        const ext = path.extname(entry.name);
        const dir = path.dirname(entry.filePath);
        const newName = ext ? trimmed + ext : trimmed;
        const newFilePath = path.join(dir, newName);
        if (fs.existsSync(newFilePath) && newFilePath !== entry.filePath) {
            return res.status(409).json({ ok: false, message: 'Já existe uma música com esse nome.' });
        }
        fs.renameSync(entry.filePath, newFilePath);
        entry.filePath = newFilePath;
        entry.name = newName;
        const newRel = path.join(path.dirname(entry.relPath.split('/').join(path.sep)), newName).split(path.sep).join('/');
        entry.relPath = newRel;
        entry.publicUrl = toPublicUrl(newRel);
        writeIndex(index);

        reconcileProjects(oldPublic, entry.publicUrl);
        res.json({ ok: true, track: toTrack(entry) });
    } catch (error: unknown) {
        console.error('Music Rename Error:', error);
        const msg = error instanceof Error ? error.message : 'Erro desconhecido';
        res.status(500).json({ ok: false, message: msg });
    }
};

// DELETE /api/music/:id
export const deleteMusic = (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const index = readIndex();
        const idx = index.findIndex((e) => e.id === id && e.category === 'Músicas');

        if (idx === -1) {
            return res.status(404).json({ ok: false, message: 'Música não encontrada' });
        }

        const entry = index[idx];

        // Remove o arquivo físico e a entrada do índice.
        if (fs.existsSync(entry.filePath)) {
            fs.unlinkSync(entry.filePath);
        }
        index.splice(idx, 1);
        writeIndex(index);

        // Invalida as referências nos projetos (zera a URL, não apaga o projeto).
        reconcileProjects(entry.publicUrl, null);
        res.json({ ok: true });
    } catch (error: unknown) {
        console.error('Music Delete Error:', error);
        const msg = error instanceof Error ? error.message : 'Erro desconhecido';
        res.status(500).json({ ok: false, message: msg });
    }
};
