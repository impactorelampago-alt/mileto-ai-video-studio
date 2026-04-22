import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(BASE_DATA_PATH, 'data/projects');

// Garante que o diretório raiz de projetos exista — se estiver vazio, listProjects
// simplesmente devolve []. Evita 500 quando o app é aberto pela primeira vez.
if (!fs.existsSync(PROJECTS_DIR)) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

export const listProjects = async (_req: Request, res: Response) => {
    try {
        if (!fs.existsSync(PROJECTS_DIR)) {
            return res.json({ ok: true, drafts: [] });
        }

        const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
        const drafts: Array<{
            projectId: string;
            title: string;
            updatedAt: string | null;
            exported: boolean;
            mediaCount: number;
            duration: number;
        }> = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const dataPath = path.join(PROJECTS_DIR, entry.name, 'ad-data.json');
            if (!fs.existsSync(dataPath)) continue;

            try {
                const raw = fs.readFileSync(dataPath, 'utf-8');
                const parsed = JSON.parse(raw) as {
                    adData?: { title?: string; narrationText?: string };
                    mediaTakes?: Array<{ trim?: { start?: number; end?: number } }>;
                    updatedAt?: string;
                    exported?: boolean;
                    title?: string;
                };

                const title =
                    (parsed.title && parsed.title.trim()) ||
                    (parsed.adData?.title && parsed.adData.title.trim()) ||
                    (parsed.adData?.narrationText
                        ? parsed.adData.narrationText.trim().slice(0, 50)
                        : '') ||
                    'Rascunho sem título';

                const mediaCount = Array.isArray(parsed.mediaTakes) ? parsed.mediaTakes.length : 0;
                const duration = Array.isArray(parsed.mediaTakes)
                    ? parsed.mediaTakes.reduce((acc, t) => {
                          const s = t?.trim?.start ?? 0;
                          const e = t?.trim?.end ?? 0;
                          return acc + Math.max(0, e - s);
                      }, 0)
                    : 0;

                drafts.push({
                    projectId: entry.name,
                    title,
                    updatedAt: parsed.updatedAt || null,
                    exported: !!parsed.exported,
                    mediaCount,
                    duration,
                });
            } catch (err) {
                console.warn('[Projects] Falha ao ler rascunho', entry.name, err);
            }
        }

        // Mais recente primeiro
        drafts.sort((a, b) => {
            const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return tb - ta;
        });

        res.json({ ok: true, drafts });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Projects] Erro ao listar:', msg);
        res.status(500).json({ ok: false, message: msg });
    }
};

export const deleteProject = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        if (!projectId) return res.status(400).json({ ok: false, message: 'projectId ausente' });

        // Proteção contra path traversal
        if (projectId.includes('..') || projectId.includes('/') || projectId.includes('\\')) {
            return res.status(400).json({ ok: false, message: 'projectId inválido' });
        }

        const projectPath = path.join(PROJECTS_DIR, projectId);
        if (fs.existsSync(projectPath)) {
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
        res.json({ ok: true });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Projects] Erro ao deletar:', msg);
        res.status(500).json({ ok: false, message: msg });
    }
};

export const getProjectData = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const pId = projectId || 'default';
        const projectPath = path.join(PROJECTS_DIR, pId);
        const dataPath = path.join(projectPath, 'ad-data.json');

        if (!fs.existsSync(dataPath)) {
            // Return null or default?
            // If not found, return 404 or empty object so frontend uses default
            return res.status(404).json({ ok: false, message: 'Project data not found' });
        }

        const raw = fs.readFileSync(dataPath, 'utf-8');
        const data = JSON.parse(raw);
        res.json({ ok: true, data });
    } catch (error: any) {
        console.error('Error getting project data:', error);
        res.status(500).json({ ok: false, message: error.message });
    }
};

export const saveProjectData = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const pId = projectId || 'default';
        const { data } = req.body;

        if (!data) {
            return res.status(400).json({ ok: false, message: 'No data provided' });
        }

        const projectPath = path.join(PROJECTS_DIR, pId);
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath, { recursive: true });
        }

        const dataPath = path.join(projectPath, 'ad-data.json');

        // Merge with existing if needed? Or overwrite?
        // For simple persistence, overwrite is fine if we send full object.
        // But to be safe, maybe read existing and merge?
        // Let's overwrite for now as frontend should have full state.

        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');

        res.json({ ok: true, message: 'Project saved' });
    } catch (error: any) {
        console.error('Error saving project data:', error);
        res.status(500).json({ ok: false, message: error.message });
    }
};
