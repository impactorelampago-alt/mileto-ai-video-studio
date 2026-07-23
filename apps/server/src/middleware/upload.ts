import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID as uuidv4 } from 'crypto';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const UPLOADS_DIR = path.join(BASE_DATA_PATH, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// A extensão é derivada do MIMETYPE (que também é validado), NUNCA do nome enviado
// pelo cliente. Assim não dá para gravar `<uuid>.html` com script dentro e servi-lo
// como HTML (XSS armazenado no renderer, que roda com nodeIntegration), nem enfiar
// caracteres perigosos na extensão.
const MIME_EXT: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/x-msvideo': '.avi',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
};

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
        const ext = MIME_EXT[file.mimetype] || '.bin';
        cb(null, `${uuidv4()}${ext}`);
    },
});

export const upload = multer({
    storage,
    fileFilter: (_req, file, cb) => {
        if (MIME_EXT[file.mimetype]) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only videos and images are allowed.'));
        }
    },
});
