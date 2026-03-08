import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export const uploadImage = async (req: Request, res: Response) => {
    try {
        if (!req.file) return res.status(400).json({ ok: false, message: 'No file uploaded' });

        const projectId = req.body.projectId;
        const tempPath = req.file.path;
        const ext = path.extname(req.file.originalname);
        const newFileName = `${uuidv4()}${ext}`;

        // Define target directory structure
        // apps/server/data/projects/<projectId>/uploads/images/
        const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..');
        const projectDir = path.join(BASE_DATA_PATH, 'data/projects', projectId, 'uploads/images');

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
