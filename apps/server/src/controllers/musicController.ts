import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');

const MUSIC_DIR = path.join(BASE_DATA_PATH, 'music');
const LIBRARY_JSON = path.join(BASE_DATA_PATH, 'data/music_library.json');

// Ensure dirs exist
if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });
const dataDir = path.join(BASE_DATA_PATH, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

interface MusicTrack {
    id: string;
    originalName: string;
    displayName: string;
    filePath: string;
    publicUrl: string;
    durationSec: number;
    createdAt: string;
}

function readLibrary(): MusicTrack[] {
    try {
        if (fs.existsSync(LIBRARY_JSON)) {
            return JSON.parse(fs.readFileSync(LIBRARY_JSON, 'utf-8'));
        }
    } catch {
        /* corrupted file, start fresh */
    }
    return [];
}

function writeLibrary(tracks: MusicTrack[]): void {
    fs.writeFileSync(LIBRARY_JSON, JSON.stringify(tracks, null, 2), 'utf-8');
}

async function getAudioDuration(filePath: string): Promise<number> {
    try {
        const { stdout } = await execAsync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
        );
        const dur = parseFloat(stdout.trim());
        return isNaN(dur) ? 0 : dur;
    } catch {
        return 0;
    }
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

        // Move from uploads/ to music/
        fs.renameSync(req.file.path, targetPath);

        const durationSec = await getAudioDuration(targetPath);

        // displayName = filename without extension
        const originalName = req.file.originalname;
        const displayName = path.basename(originalName, ext);

        const track: MusicTrack = {
            id,
            originalName,
            displayName,
            filePath: targetPath,
            publicUrl: `/music/${newFileName}`,
            durationSec,
            createdAt: new Date().toISOString(),
        };

        const library = readLibrary();
        library.push(track);
        writeLibrary(library);

        res.json({ ok: true, track });
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

        const library = readLibrary();
        const track = library.find((t) => t.id === id);
        if (!track) {
            return res.status(404).json({ ok: false, message: 'Música não encontrada' });
        }

        track.displayName = trimmed;
        writeLibrary(library);

        res.json({ ok: true, track });
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
        const library = readLibrary();
        const idx = library.findIndex((t) => t.id === id);

        if (idx === -1) {
            return res.status(404).json({ ok: false, message: 'Música não encontrada' });
        }

        const track = library[idx];

        // Delete file from disk
        if (fs.existsSync(track.filePath)) {
            fs.unlinkSync(track.filePath);
        }

        library.splice(idx, 1);
        writeLibrary(library);

        res.json({ ok: true });
    } catch (error: unknown) {
        console.error('Music Delete Error:', error);
        const msg = error instanceof Error ? error.message : 'Erro desconhecido';
        res.status(500).json({ ok: false, message: msg });
    }
};
