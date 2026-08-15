import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import { resolveLocalSource } from './sharedController';
import { ensureFilesDirs, FILES_ROOT, registerFile, type FileEntry } from './fileExplorerController';
import { getVideoMetadata, sliceVideoSegment } from '../services/ffmpeg';

const MAX_SEGMENTS = 24;
const MIN_SEGMENT_SEC = 0.2;
const SLICE_DIR_SEGMENTS = ['Vídeos', 'Cortes'] as const;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']);

const sanitizeBaseName = (value: unknown, fallback: string): string => {
    const raw = typeof value === 'string' ? value : '';
    const withoutExtension = raw.replace(/\.[a-z0-9]{2,5}$/i, '');
    const cleaned = withoutExtension
        .normalize('NFKC')
        .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    return cleaned || fallback;
};

/**
 * Recorta um vídeo da biblioteca em um ou mais segmentos, salvando cada corte
 * como um arquivo novo em "Vídeos/Cortes" (o original permanece intacto). A
 * origem é confinada ao diretório de dados pelo mesmo resolvedor auditado dos
 * uploads (resolveLocalSource) — funciona tanto para arquivos da biblioteca
 * Local quanto para assets do Mileto Ops já materializados no cache local.
 */
export const sliceLibraryVideo = async (req: Request, res: Response): Promise<void> => {
    try {
        const { sourceUrl, backendPath, baseName, segments } = (req.body || {}) as Record<string, unknown>;

        if (!Array.isArray(segments) || segments.length === 0 || segments.length > MAX_SEGMENTS) {
            res.status(400).json({ ok: false, message: `Envie de 1 a ${MAX_SEGMENTS} trechos para recortar.` });
            return;
        }
        const parsedSegments = segments.map((segment) => ({
            start: Number((segment as Record<string, unknown>)?.start),
            end: Number((segment as Record<string, unknown>)?.end),
        }));
        if (parsedSegments.some(({ start, end }) => !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)) {
            res.status(400).json({ ok: false, message: 'Cada trecho precisa de início e fim válidos (fim maior que início).' });
            return;
        }

        let sourcePath: string;
        try {
            sourcePath = resolveLocalSource(String(sourceUrl || ''), String(backendPath || ''));
        } catch (error) {
            res.status(404).json({ ok: false, message: error instanceof Error ? error.message : 'Mídia não encontrada.' });
            return;
        }
        if (!VIDEO_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) {
            res.status(400).json({ ok: false, message: 'Somente arquivos de vídeo podem ser recortados.' });
            return;
        }

        // Duração real limita o fim de cada trecho (o editor pode mandar um fim
        // levemente além por arredondamento de timeline).
        const metadata = await getVideoMetadata(sourcePath).catch(() => null);
        const durationSec = metadata?.duration && Number.isFinite(metadata.duration) ? metadata.duration : null;
        const boundedSegments = parsedSegments.map(({ start, end }) => ({
            start,
            end: durationSec ? Math.min(end, durationSec) : end,
        }));
        if (boundedSegments.some(({ start, end }) => end - start < MIN_SEGMENT_SEC)) {
            res.status(400).json({ ok: false, message: `Cada trecho precisa ter pelo menos ${MIN_SEGMENT_SEC}s dentro do vídeo.` });
            return;
        }

        ensureFilesDirs();
        const sliceDirAbsolute = path.join(FILES_ROOT, ...SLICE_DIR_SEGMENTS);
        fs.mkdirSync(sliceDirAbsolute, { recursive: true });

        const displayBase = sanitizeBaseName(baseName, sanitizeBaseName(path.basename(sourcePath), 'Video'));
        const formatStamp = (seconds: number) => {
            const total = Math.max(0, Math.round(seconds));
            const minutes = Math.floor(total / 60);
            const rest = total % 60;
            return `${String(minutes).padStart(2, '0')}m${String(rest).padStart(2, '0')}s`;
        };

        const slices: FileEntry[] = [];
        for (let index = 0; index < boundedSegments.length; index += 1) {
            const { start, end } = boundedSegments[index];
            const physicalName = `${uuidv4()}.mp4`;
            const relPath = [...SLICE_DIR_SEGMENTS, physicalName].join('/');
            const targetPath = path.join(sliceDirAbsolute, physicalName);
            await sliceVideoSegment({ sourcePath, startSec: start, endSec: end, targetPath });
            const suffix = boundedSegments.length > 1 ? ` corte ${index + 1}` : ' corte';
            const displayName = `${displayBase}${suffix} [${formatStamp(start)}-${formatStamp(end)}].mp4`;
            slices.push(await registerFile(targetPath, relPath, { category: 'Vídeos', name: displayName }));
        }

        res.json({ ok: true, slices });
    } catch (error) {
        console.error('[video-slice] Falha ao recortar vídeo:', error);
        res.status(500).json({
            ok: false,
            message: error instanceof Error ? error.message : 'Não foi possível recortar o vídeo.',
        });
    }
};
