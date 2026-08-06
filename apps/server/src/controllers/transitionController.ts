import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID as uuidv4 } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const transitionsDir = path.join(BASE_DATA_PATH, 'public/transitions');
const builtInTransitionsDir = process.env.BUILTIN_TRANSITIONS_PATH
    || path.join(__dirname, '..', '..', 'public', 'transitions', 'builtins');

const FILM_BURN_TRANSITION = {
    id: 'builtin-film-burn-08',
    originalName: 'Film Burn 08.mp4',
    publicUrl: '/system-transitions/film-burn-08.mp4',
    filePath: path.join(builtInTransitionsDir, 'film-burn-08.mp4'),
    durationSec: 1,
    category: 'Essencial',
    isBuiltIn: true,
    identityCode: 'mileto:film-burn-08',
    createdAt: '2026-08-05T00:00:00.000Z',
};

const normalizedTransitionName = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

// Ensure directory exists
if (!fs.existsSync(transitionsDir)) {
    fs.mkdirSync(transitionsDir, { recursive: true });
}

const readUserTransitions = (): any[] => {
    const libraryPath = path.join(BASE_DATA_PATH, 'data/transition_library.json');
    if (!fs.existsSync(libraryPath)) return [];
    return JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
};

export const uploadTransition = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'No file uploaded' });
        }

        const originalName = req.file.originalname;
        const ext = path.extname(originalName);
        const id = uuidv4();
        const filename = `${id}${ext}`;
        const targetPath = path.join(transitionsDir, filename);

        // Move the file from temp to public/transitions
        fs.copyFileSync(req.file.path, targetPath);
        fs.unlinkSync(req.file.path); // remove from temp

        // Extract duration
        const durationSec = await new Promise<number>((resolve) => {
            ffmpeg.ffprobe(targetPath, (err, metadata) => {
                if (err) return resolve(1.0); // Assume 1 second fallback
                resolve(metadata.format.duration || 1.0);
            });
        });

        const newTransition = {
            id,
            originalName,
            publicUrl: `/transitions/${filename}`,
            filePath: targetPath,
            durationSec,
            category: String(req.body.category || 'Meus efeitos'),
            isBuiltIn: false,
            createdAt: new Date().toISOString(),
        };

        // Save to transition_library.json
        const libraryPath = path.join(BASE_DATA_PATH, 'data/transition_library.json');
        let library: any[] = [];
        if (fs.existsSync(libraryPath)) {
            library = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
        }
        library.push(newTransition);
        fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2));

        res.json({ ok: true, message: 'Transition uploaded successfully', transition: newTransition });
    } catch (e: unknown) {
        console.error('[Transitions] Error uploading transition:', e);
        res.status(500).json({ ok: false, message: (e as Error).message });
    }
};

export const listTransitions = async (_req: Request, res: Response) => {
    try {
        const reservedName = normalizedTransitionName(FILM_BURN_TRANSITION.originalName);
        const userTransitions = readUserTransitions()
            .filter((transition) => normalizedTransitionName(String(transition.originalName || '')) !== reservedName)
            .map((transition) => ({ ...transition, isBuiltIn: false }));
        res.json({ ok: true, transitions: [FILM_BURN_TRANSITION, ...userTransitions] });
    } catch (e: unknown) {
        console.error('[Transitions] Error listing transitions:', e);
        res.status(500).json({ ok: false, message: (e as Error).message });
    }
};

export const deleteTransition = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const libraryPath = path.join(BASE_DATA_PATH, 'data/transition_library.json');

        if (id.startsWith('builtin-')) {
            return res.status(403).json({ ok: false, message: 'Os efeitos incluídos não podem ser removidos.' });
        }

        if (!fs.existsSync(libraryPath)) {
            return res.status(404).json({ ok: false, message: 'Library not found' });
        }

        const library = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
        const transitionIndex = library.findIndex((t: { id: string }) => t.id === id);

        if (transitionIndex === -1) {
            return res.status(404).json({ ok: false, message: 'Transition not found' });
        }

        const transition = library[transitionIndex];

        // Remover arquivo físico
        if (transition.filePath && fs.existsSync(transition.filePath)) {
            fs.unlinkSync(transition.filePath);
        }

        // Remover do array
        library.splice(transitionIndex, 1);

        // Salvar JSON atualizado
        fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2));

        res.json({ ok: true, message: 'Transition deleted successfully' });
    } catch (e: unknown) {
        console.error('[Transitions] Error deleting transition:', e);
        res.status(500).json({ ok: false, message: (e as Error).message });
    }
};
