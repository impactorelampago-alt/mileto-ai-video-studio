import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Readable } from 'stream';
import {
    bearerFrom,
    GatewayGenerationSpec,
    gatewayCreateVideoGeneration,
    gatewayGenerateImage,
    gatewayVideoGenerationContent,
    gatewayVideoGenerationStatus,
} from '../services/gatewayClient';
import { storeAiGeneratedMedia, storeAiGeneratedMediaStream, type FileEntry } from './fileExplorerController';

type GenerationKind = 'image' | 'video';
type LocalGenerationJob = {
    id: string;
    kind: GenerationKind;
    phase: 'downloading' | 'done' | 'error';
    percent: number;
    statusText: string;
    title: string;
    startedAt: number;
    completedAt?: number;
    entry?: FileEntry;
    error?: string;
};

const jobs = new Map<string, LocalGenerationJob>();
const TIER_IDS = new Set(['mileto-lite', 'mileto-plus', 'mileto-ultra', 'lite', 'mileto', 'ultra']);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const publicJob = (job: LocalGenerationJob) => ({
    id: job.id,
    phase: job.phase,
    percent: job.percent,
    step: 'processing',
    stepPercent: job.percent,
    mode: job.kind,
    title: job.title,
    destination: 'Geração por IA',
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    source: 'ai-generation',
    statusText: job.statusText,
    error: job.error,
    track: job.entry
        ? {
            id: job.entry.id,
            displayName: job.entry.name,
            originalName: job.entry.name,
            filePath: job.entry.filePath,
            publicUrl: job.entry.publicUrl,
            durationSec: job.entry.durationSec || (job.kind === 'image' ? 3.5 : 0),
            createdAt: job.entry.createdAt,
            type: job.kind,
        }
        : undefined,
});

const extensionFor = (kind: GenerationKind, mimeType: string) => {
    if (kind === 'video') return '.mp4';
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/webp') return '.webp';
    return '.png';
};

const runGeneration = async (
    job: LocalGenerationJob,
    token: string,
    tier: string,
    spec: GatewayGenerationSpec,
    conversationId: string,
    conversationTitle: string,
    durationSec?: number,
    resolution?: string
) => {
    const metadata = {
        conversationId,
        conversationTitle,
        prompt: String(spec.prompt || spec.masterPrompt || '').slice(0, 12000),
        provider: 'mileto',
        model: tier,
    };
    try {
        if (job.kind === 'image') {
            job.percent = 15;
            job.statusText = 'Diretor de Imagens produzindo';
            const output = await gatewayGenerateImage(token, { tier, spec });
            job.percent = 88;
            job.statusText = 'Salvando no computador';
            job.entry = await storeAiGeneratedMedia(
                output.bytes,
                extensionFor('image', output.mimeType),
                metadata
            );
        } else {
            const remote = await gatewayCreateVideoGeneration(token, { tier, spec, durationSec, resolution });
            job.percent = Math.max(8, remote.job.progress || 8);
            job.statusText = 'Seedance iniciou a produção';
            const started = Date.now();
            let consecutiveStatusErrors = 0;
            while (Date.now() - started < 48 * 60 * 60 * 1000) {
                await wait(5000);
                let state;
                try {
                    state = await gatewayVideoGenerationStatus(token, remote.job.id);
                    consecutiveStatusErrors = 0;
                } catch (error) {
                    consecutiveStatusErrors += 1;
                    job.statusText = 'Reconectando ao acompanhamento';
                    if (consecutiveStatusErrors >= 20) throw error;
                    continue;
                }
                job.percent = Math.max(job.percent, state.job.progress || 10);
                job.statusText = state.job.status === 'queued' ? 'Na fila de produção' : 'Gerando vídeo';
                if (state.job.status === 'failed') throw new Error(state.job.error || 'O vídeo não foi concluído.');
                if (state.job.status === 'succeeded') {
                    job.statusText = 'Salvando no computador';
                    const output = await gatewayVideoGenerationContent(token, remote.job.id);
                    job.entry = await storeAiGeneratedMediaStream(
                        output.stream as Readable,
                        extensionFor('video', output.mimeType),
                        metadata
                    );
                    break;
                }
            }
            if (!job.entry) throw new Error('A geração de vídeo ultrapassou o tempo máximo de acompanhamento.');
        }
        job.phase = 'done';
        job.percent = 100;
        job.statusText = 'Disponível em Geração por IA';
        job.completedAt = Date.now();
    } catch (error) {
        job.phase = 'error';
        job.percent = 100;
        job.statusText = 'Falha na geração';
        job.error = error instanceof Error ? error.message : 'Não foi possível gerar a mídia.';
        job.completedAt = Date.now();
    }
};

export const start = (req: Request, res: Response) => {
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ ok: false, message: 'Sessão Mileto ausente ou expirada.' });
    const kind: GenerationKind = req.body?.kind === 'video' ? 'video' : 'image';
    const tier = String(req.body?.tier || 'mileto-plus');
    const spec = req.body?.spec as GatewayGenerationSpec;
    if (!TIER_IDS.has(tier)) return res.status(400).json({ ok: false, message: 'Nível Mileto inválido.' });
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        return res.status(400).json({ ok: false, message: 'Especificação do agente inválida.' });
    }
    const id = randomUUID();
    const job: LocalGenerationJob = {
        id,
        kind,
        phase: 'downloading',
        percent: 2,
        statusText: 'Preparando geração',
        title: String(req.body?.title || (kind === 'image' ? 'Imagem por IA' : 'Vídeo por IA')).slice(0, 120),
        startedAt: Date.now(),
    };
    jobs.set(id, job);
    void runGeneration(
        job,
        token,
        tier,
        spec,
        String(req.body?.conversationId || id).slice(0, 200),
        String(req.body?.conversationTitle || job.title).slice(0, 200),
        Number(req.body?.durationSec || 0) || undefined,
        typeof req.body?.resolution === 'string' ? req.body.resolution : undefined
    );
    return res.status(202).json({ ok: true, job: publicJob(job) });
};

export const list = (_req: Request, res: Response) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, job] of jobs) {
        if (job.phase !== 'downloading' && (job.completedAt || job.startedAt) < cutoff) jobs.delete(id);
    }
    res.json({ ok: true, jobs: [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).map(publicJob) });
};

export const status = (req: Request, res: Response) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ ok: false, message: 'Geração não encontrada nesta execução.' });
    return res.json({ ok: true, job: publicJob(job) });
};
