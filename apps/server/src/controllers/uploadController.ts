import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import { safeResolve, isSafeSegment } from '../utils/safePath';

export const uploadImage = async (req: Request, res: Response) => {
    try {
        if (!req.file) return res.status(400).json({ ok: false, message: 'No file uploaded' });

        const projectId = req.body.projectId;
        if (!isSafeSegment(projectId)) {
            return res.status(400).json({ ok: false, message: 'projectId inválido ou ausente' });
        }
        const tempPath = req.file.path;
        // A extensão já vem saneada do multer (derivada do mimetype); mantém consistência.
        const ext = path.extname(req.file.filename) || path.extname(req.file.originalname);
        const newFileName = `${uuidv4()}${ext}`;

        // apps/server/data/projects/<projectId>/uploads/images/ — resolvido com containment.
        const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
        const projectDir = safeResolve(BASE_DATA_PATH, 'data/projects', projectId, 'uploads/images');

        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }

        const targetPath = path.join(projectDir, newFileName);

        // Move file
        fs.renameSync(tempPath, targetPath);

        // Public URL (served via express.static pointing to data dir)
        const publicUrl = `/data/projects/${projectId}/uploads/images/${newFileName}`;

        res.json({
            ok: true,
            asset: {
                id: uuidv4(),
                type: 'image',
                path: targetPath,
                publicUrl: publicUrl,
                fileName: req.file.originalname,
            },
        });
    } catch (error: any) {
        console.error('Image Upload Error:', error);
        res.status(500).json({ ok: false, message: error.message });
    }
};
