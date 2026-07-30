import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeResolve, isSafeSegment } from '../utils/safePath';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(BASE_DATA_PATH, 'data/projects');

type SavedMediaTake = {
    trim?: { start?: number; end?: number };
    type?: 'image' | 'video';
    url?: string;
    fileUrl?: string;
    proxyUrl?: string;
    backendPath?: string;
};

type SavedProjectData = {
    adData?: { title?: string; narrationText?: string };
    mediaTakes?: SavedMediaTake[];
    updatedAt?: string;
    exported?: boolean;
    title?: string;
};

const firstVisualTake = (data: SavedProjectData): SavedMediaTake | undefined =>
    data.mediaTakes?.find((take) => take?.type === 'image' || take?.type === 'video');

const mediaSource = (take?: SavedMediaTake): string | undefined =>
    take
        ? [take.proxyUrl, take.fileUrl, take.url, take.backendPath].find(
              (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
          )
        : undefined;

const isRendererUrl = (candidate: string): boolean =>
    /^https?:\/\//i.test(candidate) ||
    /^\/(?:api|uploads|data|files|videos)\//i.test(candidate) ||
    candidate.startsWith('data:');

const localMediaPath = (candidate: string): string | null => {
    try {
        if (candidate.startsWith('file://')) return fileURLToPath(candidate);
        if (path.isAbsolute(candidate)) return candidate;
    } catch {
        return null;
    }
    return null;
};

const coverForDraft = (projectId: string, take?: SavedMediaTake) => {
    const source = mediaSource(take);
    if (!source || !take?.type) return null;
    if (isRendererUrl(source)) return { url: source, type: take.type };
    if (!localMediaPath(source)) return null;
    return {
        url: `/api/projects/${encodeURIComponent(projectId)}/cover`,
        type: take.type,
    };
};

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
            cover: { url: string; type: 'image' | 'video' } | null;
        }> = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const dataPath = path.join(PROJECTS_DIR, entry.name, 'ad-data.json');
            if (!fs.existsSync(dataPath)) continue;

            try {
                const raw = fs.readFileSync(dataPath, 'utf-8');
                const parsed = JSON.parse(raw) as SavedProjectData;

                // A etapa 1 é a fonte de verdade do título. O campo externo é
                // mantido por compatibilidade com rascunhos antigos.
                const title =
                    (parsed.adData?.title && parsed.adData.title.trim()) ||
                    (parsed.title && parsed.title.trim()) ||
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

                // A capa não é uma cópia da mídia: é somente a primeira mídia
                // visual já referenciada pelo rascunho. O renderer recebe uma
                // URL segura do app, nunca o caminho local do PC.
                const firstVisual = firstVisualTake(parsed);

                drafts.push({
                    projectId: entry.name,
                    title,
                    updatedAt: parsed.updatedAt || null,
                    exported: !!parsed.exported,
                    mediaCount,
                    duration,
                    cover: coverForDraft(entry.name, firstVisual),
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

// Entrega a capa de um rascunho salvo localmente sem enviar o caminho físico
// do arquivo para o renderer. A origem é sempre a primeira mídia já gravada
// no próprio ad-data.json daquele projeto — nunca um caminho informado pela URL.
export const getProjectCover = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        if (!isSafeSegment(projectId)) {
            return res.status(400).json({ ok: false, message: 'projectId inválido' });
        }

        const projectPath = safeResolve(PROJECTS_DIR, projectId);
        const dataPath = path.join(projectPath, 'ad-data.json');
        if (!fs.existsSync(dataPath)) {
            return res.status(404).json({ ok: false, message: 'Rascunho não encontrado' });
        }

        const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as SavedProjectData;
        const source = mediaSource(firstVisualTake(data));
        const requestedPath = source ? localMediaPath(source) : null;
        if (!requestedPath) {
            return res.status(404).json({ ok: false, message: 'Capa local indisponível' });
        }

        const resolvedPath = fs.realpathSync(requestedPath);
        if (!fs.statSync(resolvedPath).isFile()) {
            return res.status(404).json({ ok: false, message: 'Arquivo de capa indisponível' });
        }

        res.setHeader('Cache-Control', 'private, no-store');
        return res.sendFile(resolvedPath);
    } catch (error: unknown) {
        const code = error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
        const message = code === 404 ? 'Arquivo de capa indisponível' : 'Não foi possível carregar a capa';
        return res.status(code).json({ ok: false, message });
    }
};

export const deleteProject = async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        if (!isSafeSegment(projectId)) return res.status(400).json({ ok: false, message: 'projectId inválido' });

        const projectPath = safeResolve(PROJECTS_DIR, projectId);
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
        if (!isSafeSegment(pId)) return res.status(400).json({ ok: false, message: 'projectId inválido' });
        const projectPath = safeResolve(PROJECTS_DIR, pId);
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
        if (!isSafeSegment(pId)) return res.status(400).json({ ok: false, message: 'projectId inválido' });
        const { data } = req.body;

        if (!data) {
            return res.status(400).json({ ok: false, message: 'No data provided' });
        }

        const projectPath = safeResolve(PROJECTS_DIR, pId);
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath, { recursive: true });
        }

        const dataPath = path.join(projectPath, 'ad-data.json');

        // Respostas assíncronas podem chegar fora de ordem. Uma revisão antiga
        // jamais deve apagar uma linha do tempo mais recente.
        if (fs.existsSync(dataPath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
                const previousRevision = Number(existing?.saveRevision || 0);
                const incomingRevision = Number(data?.saveRevision || 0);
                if (previousRevision > 0 && incomingRevision > 0 && incomingRevision < previousRevision) {
                    return res.json({ ok: true, message: 'Stale project revision ignored', stale: true });
                }
            } catch {
                // A cópia anterior ainda será preservada antes da substituição.
            }
        }

        const temporaryPath = path.join(projectPath, `ad-data.${process.pid}.${Date.now()}.tmp`);
        const backupPath = path.join(projectPath, 'ad-data.backup.json');
        fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', flag: 'wx' });
        JSON.parse(fs.readFileSync(temporaryPath, 'utf-8'));
        if (fs.existsSync(dataPath)) fs.copyFileSync(dataPath, backupPath);
        try {
            fs.renameSync(temporaryPath, dataPath);
        } catch {
            // Fallback para versões do Windows que não substituem o destino no rename.
            fs.copyFileSync(temporaryPath, dataPath);
            fs.unlinkSync(temporaryPath);
        }

        res.json({ ok: true, message: 'Project saved' });
    } catch (error: any) {
        console.error('Error saving project data:', error);
        res.status(500).json({ ok: false, message: error.message });
    }
};
