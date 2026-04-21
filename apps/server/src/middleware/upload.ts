import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID as uuidv4 } from 'crypto';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const UPLOADS_DIR = path.join(BASE_DATA_PATH, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
        // Keep original extension
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    },
});

export const upload = multer({
    storage,
    fileFilter: (_req, file, cb) => {
        const allowedTypes = [
            'video/mp4',
            'video/quicktime',
            'video/x-matroska',
            'video/x-msvideo',
            'image/jpeg',
            'image/png',
            'image/webp',
            'audio/mpeg',
            'audio/wav',
            'audio/x-wav',
            'audio/ogg',
            'audio/webm',
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only videos and images are allowed.'));
        }
    },
});
