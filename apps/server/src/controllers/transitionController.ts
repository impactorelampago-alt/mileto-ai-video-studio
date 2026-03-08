import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
const transitionsDir = path.join(BASE_DATA_PATH, 'public/transitions');

// Ensure directory exists
if (!fs.existsSync(transitionsDir)) {
    fs.mkdirSync(transitionsDir, { recursive: true });
}

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
        const libraryPath = path.join(BASE_DATA_PATH, 'data/transition_library.json');
        if (!fs.existsSync(libraryPath)) {
            return res.json({ ok: true, transitions: [] });
        }
        const library = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
        res.json({ ok: true, transitions: library });
    } catch (e: unknown) {
        console.error('[Transitions] Error listing transitions:', e);
        res.status(500).json({ ok: false, message: (e as Error).message });
    }
};

export const deleteTransition = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const libraryPath = path.join(BASE_DATA_PATH, 'data/transition_library.json');

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
