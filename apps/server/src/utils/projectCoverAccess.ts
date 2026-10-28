import fs from 'fs';
import path from 'path';
import { isWithinRoots } from './safePath';

const EXTENSIONS = {
    image: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']),
    video: new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']),
};

/** Um JSON de projeto não pode autorizar sozinho a leitura de um arquivo do PC. */
export const resolveProjectCover = (base: string, candidate: string, type: 'image' | 'video'): string | null => {
    try {
        if (!path.isAbsolute(candidate) || !EXTENSIONS[type].has(path.extname(candidate).toLowerCase())) return null;
        const resolved = fs.realpathSync(candidate);
        if (!EXTENSIONS[type].has(path.extname(resolved).toLowerCase())) return null;
        if (!fs.statSync(resolved).isFile()) return null;
        const roots = ['files', 'uploads', 'videos', 'ops-cache', 'preview-cache', 'frame_cache', 'data/projects']
            .map(folder => path.join(base, folder));
        const realRoots = roots.filter(root => fs.existsSync(root)).map(root => fs.realpathSync(root));
        if (isWithinRoots(resolved, realRoots)) return resolved;

        // Referências externas legadas só sobrevivem se já constarem no índice
        // gerido pelo servidor. Um symlink dentro do acervo não concede acesso fora dele.
        const index: unknown = JSON.parse(fs.readFileSync(path.join(base, 'data/files_index.json'), 'utf8'));
        if (!Array.isArray(index)) return null;
        for (const entry of index) {
            if (!entry || typeof entry.id !== 'string' || !entry.id || entry.type !== type || typeof entry.filePath !== 'string') continue;
            if (!path.isAbsolute(entry.filePath) || isWithinRoots(entry.filePath, roots)) continue;
            try { if (fs.realpathSync(entry.filePath) === resolved) return resolved; } catch { /* referência obsoleta */ }
        }
    } catch { /* ausente, índice inválido ou arquivo não autorizado */ }
    return null;
};
