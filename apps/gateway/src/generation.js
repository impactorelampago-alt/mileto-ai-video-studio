import { createHash, randomUUID } from 'node:crypto';
import { query, pool } from './db.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { resolveAgent, getKey } from './settings.js';
import { quoteFixedProviderCost, reserve, release, settleFixed } from './meter.js';
import { createSeedanceVideo, fetchProviderMedia, generateGeminiImage, getSeedanceVideo } from './mediaProviders.js';

const safeText = (value, max = 12000) => String(value || '').trim().slice(0, max);
const publicStatus = (status) => {
    if (status === 'submitting' || status === 'queued') return { status: 'queued', progress: 8 };
    if (status === 'running') return { status: 'running', progress: 55 };
    if (status === 'succeeded') return { status: 'succeeded', progress: 100 };
    return { status: 'failed', progress: 100 };
};

const promptFromSpec = (spec, kind) => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Especificação de produção inválida.');
    const main = safeText(kind === 'image' ? spec.prompt : spec.masterPrompt || spec.prompt, 10000);
    if (!main) throw new Error('O agente não preparou um prompt de produção válido.');
    const negative = safeText(spec.negativePrompt, 2000);
    return negative ? `${main}\n\nEvitar: ${negative}` : main;
};

const readyAgent = async (id, kind, tier) => {
    const agent = await resolveAgent(id, 'pt-BR', tier);
    if (!agent.enabled) {
        const error = new Error(`${agent.label} está desativado no Super Admin.`);
        error.status = 409;
        error.code = 'AGENT_DISABLED';
        throw error;
    }
    if (agent.kind !== kind) throw new Error('Agente incompatível com o tipo de geração.');
    if (!agent.generationModel || !agent.generationProvider || !(agent.generationCostUsd > 0)) {
        const error = new Error(`Configure modelo, motor e custo máximo do nível ${agent.tier} antes de gerar.`);
        error.status = 409;
        error.code = 'GENERATION_NOT_READY';
        throw error;
    }
    const key = await getKey(agent.generationProvider);
    if (!key) {
        const error = new Error(`A chave de ${agent.generationProvider} ainda não foi configurada.`);
        error.status = 409;
        error.code = 'GENERATION_KEY_MISSING';
        throw error;
    }
    return { agent, key };
};

const reserveForGeneration = async (orgId, charged) => {
    try {
        return await reserve({ orgId, estCharge: charged, demo: false });
    } catch (error) {
        if (error.code === 'INSUFFICIENT_CREDIT') error.status = 402;
        if (error.code === 'ORG_SUSPENDED') error.status = 403;
        if (error.code === 'ORG_NOT_FOUND') error.status = 404;
        throw error;
    }
};

export const generateImage = async (req, res) => {
    if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
    const tier = safeText(req.body?.tier || req.body?.model || 'mileto', 30);
    const { agent, key } = await readyAgent('image_director', 'image', tier);
    if (agent.generationProvider !== 'gemini') {
        return res.status(409).json({ ok: false, code: 'GENERATION_PROVIDER_UNSUPPORTED', message: 'Motor de imagem ainda não suportado.' });
    }
    const prompt = promptFromSpec(req.body?.spec, 'image');
    const quote = await quoteFixedProviderCost(agent.generationCostUsd, 'image');
    const reserved = await reserveForGeneration(req.user.orgId, quote.charged);
    let result;
    try {
        result = await generateGeminiImage({
            key,
            model: agent.generationModel,
            prompt,
            aspectRatio: req.body?.spec?.aspectRatio,
            imageSize: req.body?.imageSize,
        });
    } catch (error) {
        await release({ orgId: req.user.orgId, reserved, demo: false }).catch(() => {});
        throw error;
    }
    const meta = await settleFixed({
        orgId: req.user.orgId,
        userId: req.user.id,
        provider: agent.generationProvider,
        model: agent.generationModel,
        kind: 'image',
        providerCost: quote.providerCost,
        charged: quote.charged,
        demo: false,
        reserved,
    });
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', String(result.bytes.length));
    res.setHeader('X-Mileto-Charged', String(meta.charged));
    res.setHeader('X-Mileto-Balance', String(meta.balanceAfter));
    res.send(result.bytes);
};

const finalizeVideoBilling = async (id, outcome, usageUnits = 1, error = {}) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const job = (await client.query('SELECT * FROM ai_generation_jobs WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!job || job.billing_status !== 'reserved') {
            await client.query('COMMIT');
            return;
        }
        if (outcome === 'succeeded' || outcome === 'tracking_failed') {
            await client.query(
                `INSERT INTO usage_ledger (org_id, user_id, provider, model, kind, units, provider_cost, charged, demo)
                 VALUES ($1,$2,$3,$4,'video',$5,$6,$7,false)`,
                [job.org_id, job.user_id, job.provider, job.model, Math.max(1, Math.round(Number(usageUnits) || 1)), job.provider_cost, job.charged]
            );
            if (outcome === 'succeeded') {
                await client.query(
                    `UPDATE ai_generation_jobs SET status='succeeded', billing_status='settled', usage_units=$2,
                        completed_at=now(), updated_at=now() WHERE id=$1`,
                    [id, Math.max(1, Math.round(Number(usageUnits) || 1))]
                );
            } else {
                await client.query(
                    `UPDATE ai_generation_jobs SET status='failed', billing_status='settled', usage_units=$2,
                        error_code=$3, error_message=$4, completed_at=now(), updated_at=now() WHERE id=$1`,
                    [
                        id,
                        Math.max(1, Math.round(Number(usageUnits) || 1)),
                        safeText(error.code, 100) || 'TRACKING_FAILED',
                        safeText(error.message, 500) || 'O provedor iniciou a geração, mas o acompanhamento falhou.',
                    ]
                );
            }
        } else {
            await client.query('UPDATE credits SET balance = balance + $2, updated_at=now() WHERE org_id=$1', [
                job.org_id,
                job.reserved,
            ]);
            await client.query(
                `UPDATE ai_generation_jobs SET status='failed', billing_status='released', error_code=$2,
                    error_message=$3, completed_at=now(), updated_at=now() WHERE id=$1`,
                [id, safeText(error.code, 100) || null, safeText(error.message, 500) || 'A geração falhou.']
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
};

export const createVideo = async (req, res) => {
    if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
    const tier = safeText(req.body?.tier || req.body?.model || 'mileto', 30);
    const { agent, key } = await readyAgent('video_director', 'video', tier);
    if (agent.generationProvider !== 'seedance') {
        return res.status(409).json({ ok: false, code: 'GENERATION_PROVIDER_UNSUPPORTED', message: 'Motor de vídeo ainda não suportado.' });
    }
    const prompt = promptFromSpec(req.body?.spec, 'video');
    const quote = await quoteFixedProviderCost(agent.generationCostUsd, 'video');
    const reserved = await reserveForGeneration(req.user.orgId, quote.charged);
    const id = randomUUID();
    try {
        await query(
            `INSERT INTO ai_generation_jobs
                (id, org_id, user_id, agent_id, tier, media_kind, provider, model, status, prompt_hash, reserved, provider_cost, charged)
             VALUES ($1,$2,$3,$4,$5,'video',$6,$7,'submitting',$8,$9,$10,$11)`,
            [
                id,
                req.user.orgId,
                req.user.id,
                agent.id,
                agent.tier,
                agent.generationProvider,
                agent.generationModel,
                createHash('sha256').update(prompt).digest('hex'),
                reserved,
                quote.providerCost,
                quote.charged,
            ]
        );
    } catch (error) {
        await release({ orgId: req.user.orgId, reserved, demo: false }).catch(() => {});
        throw error;
    }
    let task;
    try {
        task = await createSeedanceVideo({
            key,
            model: agent.generationModel,
            prompt,
            aspectRatio: req.body?.spec?.aspectRatio,
            durationSec: req.body?.durationSec || req.body?.spec?.totalDurationSec,
            resolution: req.body?.resolution,
        });
    } catch (error) {
        await finalizeVideoBilling(id, 'failed', 0, { code: 'PROVIDER_CREATE_FAILED', message: error.message });
        throw error;
    }
    try {
        await query(
            `UPDATE ai_generation_jobs SET provider_task_id=$2, status='queued', updated_at=now() WHERE id=$1`,
            [id, task.taskId]
        );
        res.status(202).json({ ok: true, job: { id, status: 'queued', progress: 8 } });
    } catch (error) {
        // O provedor já aceitou o trabalho e pode cobrar por ele. Nesta situação
        // conciliamos a reserva em vez de devolver créditos indevidamente.
        await finalizeVideoBilling(id, 'tracking_failed', 1, {
            code: 'PROVIDER_TRACKING_FAILED',
            message: 'O vídeo foi aceito pelo provedor, mas não foi possível registrar seu acompanhamento.',
        });
        throw error;
    }
};

const getOwnedJob = async (id, orgId) =>
    (await query('SELECT * FROM ai_generation_jobs WHERE id=$1 AND org_id=$2', [id, orgId])).rows[0] || null;

export const videoStatus = async (req, res) => {
    if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
    let job = await getOwnedJob(req.params.generationId, req.user.orgId);
    if (!job) return res.status(404).json({ ok: false, message: 'Geração não encontrada.' });
    if (['submitting', 'queued', 'running'].includes(job.status) && job.provider_task_id) {
        const key = await getKey(job.provider);
        if (key) {
            const state = await getSeedanceVideo({ key, taskId: job.provider_task_id });
            if (state.status === 'succeeded') {
                if (!state.videoUrl) throw new Error('O Seedance concluiu sem devolver o vídeo.');
                await query(
                    `UPDATE ai_generation_jobs SET result_url_enc=$2, mime_type='video/mp4', updated_at=now() WHERE id=$1`,
                    [job.id, encryptSecret(state.videoUrl)]
                );
                await finalizeVideoBilling(job.id, 'succeeded', state.usageUnits);
            } else if (state.status === 'failed' || state.status === 'expired') {
                await finalizeVideoBilling(job.id, 'failed', 0, {
                    code: state.errorCode || state.status.toUpperCase(),
                    message: state.errorMessage || 'O provedor não concluiu o vídeo.',
                });
            } else {
                await query('UPDATE ai_generation_jobs SET status=$2, updated_at=now() WHERE id=$1', [job.id, state.status]);
            }
            job = await getOwnedJob(job.id, req.user.orgId);
        }
    }
    const state = publicStatus(job.status);
    res.json({
        ok: true,
        job: {
            id: job.id,
            ...state,
            kind: 'video',
            error: state.status === 'failed' ? job.error_message || 'A geração não foi concluída.' : null,
            createdAt: job.created_at,
            completedAt: job.completed_at,
        },
    });
};

export const videoContent = async (req, res) => {
    if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
    const job = await getOwnedJob(req.params.generationId, req.user.orgId);
    if (!job) return res.status(404).json({ ok: false, message: 'Geração não encontrada.' });
    if (job.status !== 'succeeded' || !job.result_url_enc) {
        return res.status(409).json({ ok: false, message: 'O vídeo ainda não está disponível.' });
    }
    const media = await fetchProviderMedia(decryptSecret(job.result_url_enc));
    res.setHeader('Content-Type', media.mimeType || job.mime_type || 'video/mp4');
    if (media.length) res.setHeader('Content-Length', String(media.length));
    res.setHeader('Content-Disposition', 'attachment; filename="mileto-ai-video.mp4"');
    media.body.on('error', (error) => {
        if (!res.headersSent) res.status(502).end();
        else res.destroy(error);
    });
    media.body.pipe(res);
};
