import express from 'express';
import multer from 'multer';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { query } from './db.js';
import { login, logout, requireAuth, requireSuperAdmin, requireOwner } from './auth.js';
import { proxyTts, proxyChat, proxyStt, hasKey } from './providers.js';
import { estimateUnits, priceOf, reserve, settle, release, getBalance } from './meter.js';
import { resolveTier, getSystemPrompt, resolveAgent } from './settings.js';
import { agentRequiresStrictJsonOutput } from './agentDefaults.js';
import { CHAT_SCRIPT_OUTPUT_CONTRACT } from './defaultPrompt.js';
import { ensureNarrationSalesVoiceDirection, userRequestedCleanNarration } from './narrationDirection.js';
import { normalizeSpokenNumbersPtBr } from './spokenNumbers.js';
import { normalizeSpokenPronunciationPtBr } from './spokenPronunciation.js';
import * as admin from './admin.js';
import * as account from './account.js';
import * as shared from './shared.js';
import * as opsIntegration from './opsIntegration.js';
import * as generation from './generation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));

// Upload de áudio das legendas em memória (limite do Whisper = 25MB).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const opsExportUpload = multer({
    storage: multer.diskStorage({ destination: os.tmpdir() }),
    limits: { fileSize: Number(process.env.OPS_EXPORT_MAX_BYTES || 512 * 1024 * 1024) },
});

/** Envolve handler/middleware async para que rejeições virem o error-middleware (Express 4 não faz isso). */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Mantém proxies reversos informados enquanto um modelo de raciocínio trabalha.
 * Espaços antes do JSON são válidos e impedem que o OpenResty interprete o
 * silêncio do provedor como uma conexão travada.
 */
const beginJsonHeartbeat = (res, intervalMs = 15000) => {
    let finished = false;
    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('\n');

    const timer = setInterval(() => {
        if (!finished && !res.destroyed && !res.writableEnded) res.write(' ');
    }, intervalMs);
    timer.unref?.();

    const stop = () => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
    };

    return {
        stop,
        finish(payload) {
            stop();
            if (res.destroyed || res.writableEnded) return false;
            res.end(JSON.stringify(payload));
            return true;
        },
    };
};

/** Traduz erros de cobrança (reserve) em status HTTP; repassa o resto ao error-middleware. */
const billingError = (res, e) => {
    if (e.code === 'INSUFFICIENT_CREDIT') return res.status(402).json({ ok: false, message: e.message });
    if (e.code === 'ORG_SUSPENDED') return res.status(403).json({ ok: false, message: e.message });
    if (e.code === 'ORG_NOT_FOUND') return res.status(404).json({ ok: false, message: e.message });
    throw e;
};

// CORS liberado para o app local. Em produção, restrinja à origem do app.
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Ops-View-Context');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Valida qualquer :id / :userId de rota como inteiro positivo antes do handler (evita NaN -> erro de SQL).
const intParam = (name) => (req, res, next, val) => {
    if (!/^\d+$/.test(String(val))) return res.status(400).json({ ok: false, message: `${name} inválido.` });
    next();
};
app.param('id', intParam('id'));
app.param('userId', intParam('userId'));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'mileto-gateway' }));

// Callback OAuth do Ops: público porque é aberto pelo navegador, porém vinculado
// a state de uso único, expiração e PKCE persistidos no gateway.
app.get('/v1/integrations/mileto-ops/callback', asyncHandler(opsIntegration.authorizationCallback));
// O consentimento atual do Ops responde com redirect 307 após um formulário POST,
// portanto o navegador preserva o método no callback. Aceitar os dois métodos é
// seguro porque code/state continuam obrigatórios, de uso único e validados por PKCE.
app.post('/v1/integrations/mileto-ops/callback', asyncHandler(opsIntegration.authorizationCallback));
// A rota pública usa um ticket aleatório, efêmero e mantido apenas em memória.
// O grant original do Ops nunca sai do gateway.
app.get('/v1/integrations/mileto-ops/media/:ticket', asyncHandler(opsIntegration.proxyMedia));

// ── Autenticação ────────────────────────────────────────────────────────────
app.post('/auth/login', asyncHandler(login));
app.post('/auth/logout', asyncHandler(requireAuth), asyncHandler(logout));

app.get(
    '/auth/me',
    asyncHandler(requireAuth),
    asyncHandler(async (req, res) => {
        const { rows } = await query(
            `SELECT u.id, u.email, u.name, u.role, u.org_id,
                    o.name AS org_name, o.plan AS org_plan, o.max_seats,
                    (SELECT COUNT(*) FROM users x WHERE x.org_id = u.org_id) AS seats_used
             FROM users u LEFT JOIN organizations o ON o.id = u.org_id
             WHERE u.id = $1`,
            [req.user.id]
        );
        const u = rows[0] || {};
        const balance = req.user.orgId ? await getBalance(req.user.orgId) : null;
        res.json({
            ok: true,
            user: {
                id: u.id,
                email: u.email,
                name: u.name,
                role: u.role,
                orgId: u.org_id,
                orgName: u.org_name,
                orgPlan: u.org_plan,
                maxSeats: u.max_seats,
                seatsUsed: u.seats_used != null ? Number(u.seats_used) : null,
            },
            balance,
        });
    })
);

// ── Proxy de IA (autenticado + medido por organização) ──────────────────────
// Padrão em TODOS: RESERVA o crédito estimado ANTES de chamar o fornecedor pago
// (impede sangria por saldo 0 e gasto duplo por concorrência), chama, e concilia
// pelo consumo real. Se o fornecedor falha, devolve a reserva.

app.post(
    '/v1/tts',
    asyncHandler(requireAuth),
    asyncHandler(async (req, res) => {
        if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
        const { text, voiceId, provider = 'fishAudio', voiceSettings } = req.body || {};
        if (!text || !voiceId) return res.status(400).json({ ok: false, message: 'Faltam text e voiceId.' });

        // Última barreira antes do Fish Audio: também protege textos digitados ou
        // colados manualmente, não apenas roteiros criados pelo agente.
        const spokenText = provider === 'fishAudio'
            ? normalizeSpokenPronunciationPtBr(normalizeSpokenNumbersPtBr(text))
            : text;

        const demo = !(await hasKey(provider));
        const units = estimateUnits(provider, 'tts', spokenText); // texto conhecido → estimativa exata
        const { charged: estCharge } = await priceOf(provider, null, units, 'tts');

        let reserved;
        try {
            reserved = await reserve({ orgId: req.user.orgId, estCharge, demo });
        } catch (e) {
            return billingError(res, e);
        }

        let result;
        try {
            result = await proxyTts({ provider, voiceId, text: spokenText, voiceSettings });
        } catch (e) {
            await release({ orgId: req.user.orgId, reserved, demo }).catch(() => {});
            console.error('[gateway] /v1/tts provedor', e.message);
            return res.status(502).json({ ok: false, message: `Falha no provedor de voz: ${e.message}` });
        }

        const meta = await settle({
            orgId: req.user.orgId,
            userId: req.user.id,
            provider,
            model: null,
            kind: 'tts',
            units,
            demo: result.demo,
            reserved,
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('X-Mileto-Demo', String(result.demo));
        res.setHeader('X-Mileto-Charged', String(meta.charged));
        res.setHeader('X-Mileto-Balance', String(meta.balanceAfter));
        res.send(result.audio);
    })
);

app.post(
    '/v1/chat',
    asyncHandler(requireAuth),
    asyncHandler(async (req, res) => {
        if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
        const { messages, model = 'mileto-plus', reasoning, locale = 'pt-BR', system, json, agentId } = req.body || {};
        if (!Array.isArray(messages) || !messages.length) {
            return res.status(400).json({ ok: false, message: 'Faltam messages.' });
        }

        const hasCustomSystem = typeof system === 'string' && system.trim();
        // Chamadas internas com `system` continuam usando os tiers legados. Todo o
        // chat do produto passa pelo Diretor (ou por um especialista explicitamente
        // solicitado), cuja configuraÃ§Ã£o real nunca sai deste gateway.
        const selectedAgent = hasCustomSystem
            ? null
            : await resolveAgent(String(agentId || 'director'), locale, model, req.user.orgId);
        if (selectedAgent && !selectedAgent.enabled) {
            return res.status(409).json({
                ok: false,
                code: 'AGENT_DISABLED',
                message: `${selectedAgent.label} estÃ¡ desativado no Super Admin.`,
            });
        }
        const tier = selectedAgent ? null : await resolveTier(model);
        const provider = selectedAgent?.provider || tier.provider;
        const realModel = selectedAgent?.model || tier.model;
        const realReasoning = selectedAgent?.reasoning || reasoning;
        const maxOutputTokens = selectedAgent?.maxOutputTokens || 4096;
        const baseSystem = hasCustomSystem ? system : selectedAgent?.systemPrompt || (await getSystemPrompt(locale));
        // Somente o Diretor recebe o contrato do compositor do app. Especialistas
        // possuem contratos JSON prÃ³prios em seus prompts versionados.
        const sys = selectedAgent?.id === 'director'
            ? [baseSystem, CHAT_SCRIPT_OUTPUT_CONTRACT].filter(Boolean).join('\n\n')
            : baseSystem;
        const fullMessages = sys ? [{ role: 'system', content: sys }, ...messages] : messages;

        const demo = !(await hasKey(provider));
        const promptChars = fullMessages.map((m) => m.content || '').join(' ');
        // Estimativa como TETO (prompt + saída máxima) para reservar o suficiente.
        const estUnits = estimateUnits(provider, 'chat', promptChars) + maxOutputTokens;
        const { charged: estCharge } = await priceOf(provider, realModel, estUnits, 'chat');

        let reserved;
        try {
            reserved = await reserve({ orgId: req.user.orgId, estCharge, demo });
        } catch (e) {
            return billingError(res, e);
        }

        const upstreamController = new AbortController();
        const heartbeat = beginJsonHeartbeat(res);
        let providerFinished = false;
        const closeUpstream = () => {
            heartbeat.stop();
            if (!providerFinished) upstreamController.abort();
        };
        res.once('close', closeUpstream);

        let result;
        try {
            result = await proxyChat({
                messages: fullMessages,
                model: realModel,
                provider,
                reasoning: realReasoning,
                // Imagem e vídeo possuem contratos estritamente estruturados.
                // Prompt e Vendas conversa durante o briefing e só emite JSON
                // quando o próprio prompt identificar uma entrega de produção.
                json: selectedAgent ? agentRequiresStrictJsonOutput(selectedAgent.id) : !!json,
                maxOutputTokens,
                signal: upstreamController.signal,
            });
            if (selectedAgent?.id === 'prompt_sales') {
                result.text = ensureNarrationSalesVoiceDirection(result.text, {
                    allowClean: userRequestedCleanNarration(messages),
                });
            }
            providerFinished = true;
        } catch (e) {
            providerFinished = true;
            await release({ orgId: req.user.orgId, reserved, demo }).catch(() => {});
            if (e?.code !== 'CHAT_CLIENT_DISCONNECTED') {
                console.error('[gateway] /v1/chat provedor', e.message);
            }
            heartbeat.finish({
                ok: false,
                status: e?.code === 'CHAT_PROVIDER_TIMEOUT' ? 504 : 502,
                code: e?.code || 'CHAT_PROVIDER_ERROR',
                message:
                    e?.code === 'CHAT_PROVIDER_TIMEOUT'
                        ? 'O agente levou mais tempo que o limite para concluir. Tente novamente.'
                        : 'Não foi possível concluir a resposta do agente. Tente novamente.',
            });
            return;
        }

        // Unidades REAIS: tokens do fornecedor (inclui reasoning oculto); senão estima por texto.
        const realUnits =
            result.usageTokens && result.usageTokens > 0
                ? result.usageTokens
                : estimateUnits(provider, 'chat', promptChars + (result.text || ''));

        try {
            const meta = await settle({
                orgId: req.user.orgId,
                userId: req.user.id,
                provider,
                model: realModel,
                kind: 'chat',
                units: realUnits,
                demo: result.demo,
                reserved,
            });

            heartbeat.finish({
                ok: true,
                text: result.text,
                demo: result.demo,
                charged: meta.charged,
                balance: meta.balanceAfter,
                ...(selectedAgent
                    ? {
                        agent: {
                            id: selectedAgent.id,
                            label: selectedAgent.label,
                            version: selectedAgent.version,
                            tier: selectedAgent.tier,
                        },
                    }
                    : {}),
            });
        } catch (error) {
            console.error('[gateway] /v1/chat conciliação', error?.message || error);
            heartbeat.finish({
                ok: false,
                status: 500,
                code: 'CHAT_SETTLEMENT_ERROR',
                message: 'A resposta foi processada, mas o servidor não conseguiu concluir a operação com segurança.',
            });
        } finally {
            res.off('close', closeUpstream);
            heartbeat.stop();
        }
    })
);

app.post(
    '/v1/stt',
    asyncHandler(requireAuth),
    upload.single('audio'),
    asyncHandler(async (req, res) => {
        if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
        if (!req.file) return res.status(400).json({ ok: false, message: 'Envie o arquivo de áudio (campo "audio").' });
        const language = String(req.body?.language || 'pt').slice(0, 5);

        const demo = !(await hasKey('openai'));
        // Estimativa de duração pelo tamanho do arquivo (mp3 ~128kbps ≈ 16000 bytes/s) + folga.
        const bytes = req.file.size || req.file.buffer.length || 0;
        const estSeconds = Math.ceil(bytes / 16000) + 5;
        const { charged: estCharge } = await priceOf('openai', null, estSeconds, 'stt');

        let reserved;
        try {
            reserved = await reserve({ orgId: req.user.orgId, estCharge, demo });
        } catch (e) {
            return billingError(res, e);
        }

        let result;
        try {
            result = await proxyStt({
                audio: req.file.buffer,
                filename: req.file.originalname || 'audio.mp3',
                language,
            });
        } catch (e) {
            await release({ orgId: req.user.orgId, reserved, demo }).catch(() => {});
            console.error('[gateway] /v1/stt provedor', e.message);
            return res.status(502).json({ ok: false, message: `Falha na transcrição: ${e.message}` });
        }

        const meta = await settle({
            orgId: req.user.orgId,
            userId: req.user.id,
            provider: 'openai',
            model: null,
            kind: 'stt',
            units: result.durationSec,
            demo: result.demo,
            reserved,
        });

        res.json({ ok: true, words: result.words, demo: result.demo, charged: meta.charged, balance: meta.balanceAfter });
    })
);

// Mídia gerada por agentes. Chaves, modelos e URLs do fornecedor permanecem no gateway.
app.post('/v1/generations/image', asyncHandler(requireAuth), asyncHandler(generation.generateImage));
app.post('/v1/generations/video', asyncHandler(requireAuth), asyncHandler(generation.createVideo));
app.get('/v1/generations/video/:generationId', asyncHandler(requireAuth), asyncHandler(generation.videoStatus));
app.get(
    '/v1/generations/video/:generationId/content',
    asyncHandler(requireAuth),
    asyncHandler(generation.videoContent)
);

// ── Super admin (control plane) ─────────────────────────────────────────────
const sa = [asyncHandler(requireAuth), requireSuperAdmin];
app.get('/admin/overview', sa, asyncHandler(admin.overview));
app.get('/admin/orgs', sa, asyncHandler(admin.listOrgs));
app.post('/admin/orgs', sa, asyncHandler(admin.createOrg));
app.get('/admin/orgs/:id', sa, asyncHandler(admin.orgDetail));
app.post('/admin/orgs/:id/credits', sa, asyncHandler(admin.addCredits));
app.post('/admin/orgs/:id/status', sa, asyncHandler(admin.setStatus));
app.post('/admin/orgs/:id/plan', sa, asyncHandler(admin.setPlan));
app.get('/admin/ia', sa, asyncHandler(admin.getIa));
app.post('/admin/ia/key', sa, asyncHandler(admin.setIaKey));
app.post('/admin/ia/multiplier', sa, asyncHandler(admin.setIaMultiplier));
app.get('/admin/models', sa, asyncHandler(admin.getModels));
app.post('/admin/models', sa, asyncHandler(admin.setModel));
app.get('/admin/prompt', sa, asyncHandler(admin.getChatPrompt));
app.post('/admin/prompt', sa, asyncHandler(admin.setChatPrompt));
app.get('/admin/agents', sa, asyncHandler(admin.getAgents));
app.post('/admin/agents/:agentId', sa, asyncHandler(admin.setAgent));
app.get('/admin/agents/:agentId/history', sa, asyncHandler(admin.getAgentHistory));
app.post('/admin/agents/:agentId/rollback', sa, asyncHandler(admin.rollbackAgent));
app.post('/admin/agents/:agentId/test', sa, asyncHandler(admin.testAgent));
app.get('/admin/title-generator', sa, asyncHandler(admin.getTitleGenerator));
app.post('/admin/title-generator', sa, asyncHandler(admin.setTitleGenerator));
app.get('/admin/credits', sa, asyncHandler(admin.getCredits));
app.post('/admin/credits', sa, asyncHandler(admin.setCredit));

// ── Cliente (owner/member) — sempre escopado na própria org ─────────────────
app.get('/account/usage', asyncHandler(requireAuth), asyncHandler(account.usage));
app.get('/account/team', asyncHandler(requireAuth), asyncHandler(account.listTeam));
app.post('/account/team', asyncHandler(requireAuth), requireOwner, asyncHandler(account.addMember));
app.delete('/account/team/:userId', asyncHandler(requireAuth), requireOwner, asyncHandler(account.removeMember));
app.get('/account/ai/chat', asyncHandler(requireAuth), requireOwner, asyncHandler(account.getAiChat));
app.put('/account/ai/chat/:agentId', asyncHandler(requireAuth), requireOwner, asyncHandler(account.setAiChatPrompt));
app.get('/account/ai/title-generator', asyncHandler(requireAuth), requireOwner, asyncHandler(account.getAiTitleGenerator));
app.put('/account/ai/title-generator', asyncHandler(requireAuth), requireOwner, asyncHandler(account.setAiTitleGenerator));
app.get('/v1/ai/title-generator', asyncHandler(requireAuth), asyncHandler(account.effectiveAiTitleGenerator));

// Ambiente compartilhado (R2 + metadados por organização)
const authed = asyncHandler(requireAuth);

// Integração Mileto Ops. Conectar, sincronizar e confirmar vínculos são ações do
// dono; navegar na biblioteca exige somente usuário autenticado e já vinculado.
app.get('/v1/integrations/mileto-ops/connection', authed, asyncHandler(opsIntegration.integrationStatus));
app.post('/v1/integrations/mileto-ops/connections', authed, requireOwner, asyncHandler(opsIntegration.startConnection));
app.delete('/v1/integrations/mileto-ops/connection', authed, requireOwner, asyncHandler(opsIntegration.disconnect));
app.post('/v1/integrations/mileto-ops/sync/users', authed, requireOwner, asyncHandler(opsIntegration.syncUsers));
app.get('/v1/integrations/mileto-ops/sync/conflicts', authed, requireOwner, asyncHandler(opsIntegration.listConflicts));
app.put('/v1/integrations/mileto-ops/user-links/:aiUserId', authed, requireOwner, asyncHandler(opsIntegration.confirmUserLink));
app.delete('/v1/integrations/mileto-ops/user-links/:aiUserId', authed, requireOwner, asyncHandler(opsIntegration.removeUserLink));
app.get('/v1/integrations/mileto-ops/view-contexts', authed, asyncHandler(opsIntegration.listViewContexts));
app.get('/v1/integrations/mileto-ops/companies', authed, asyncHandler(opsIntegration.listCompanies));
app.get('/v1/integrations/mileto-ops/companies/:companyId', authed, asyncHandler(opsIntegration.getCompany));
app.get('/v1/integrations/mileto-ops/companies/:companyId/folders', authed, asyncHandler(opsIntegration.listFolders));
app.post('/v1/integrations/mileto-ops/companies/:companyId/folders', authed, asyncHandler(opsIntegration.createFolder));
app.patch('/v1/integrations/mileto-ops/folders/:folderId', authed, asyncHandler(opsIntegration.updateFolder));
app.delete('/v1/integrations/mileto-ops/folders/:folderId', authed, asyncHandler(opsIntegration.deleteFolder));
app.get('/v1/integrations/mileto-ops/companies/:companyId/assets', authed, asyncHandler(opsIntegration.listAssets));
app.get('/v1/integrations/mileto-ops/video-jobs/next', authed, asyncHandler(opsIntegration.nextVideoJob));
app.post('/v1/integrations/mileto-ops/video-jobs/:jobId/claim', authed, asyncHandler(opsIntegration.claimVideoJob));
app.patch('/v1/integrations/mileto-ops/video-jobs/:jobId', authed, asyncHandler(opsIntegration.updateVideoJob));
app.post('/v1/integrations/mileto-ops/companies/:companyId/assets/export', authed, opsExportUpload.single('file'), asyncHandler(opsIntegration.uploadExport));
app.get('/v1/integrations/mileto-ops/assets/:assetId', authed, asyncHandler(opsIntegration.getAsset));
app.post('/v1/integrations/mileto-ops/assets/:assetId/:kind-url', authed, asyncHandler(opsIntegration.getAssetUrl));
app.post('/v1/integrations/mileto-ops/references', authed, asyncHandler(opsIntegration.createReference));
app.get('/v1/integrations/mileto-ops/references/:referenceId', authed, asyncHandler(opsIntegration.getReference));
app.post('/v1/integrations/mileto-ops/references/:referenceId/download', authed, asyncHandler(opsIntegration.getReferenceDownload));

app.get('/shared/status', authed, asyncHandler(shared.storageStatus));
app.get('/shared/files/tree', authed, asyncHandler(shared.tree));
app.get('/shared/files/list', authed, asyncHandler(shared.list));
app.get('/shared/files/trash', authed, asyncHandler(shared.trash));
app.post('/shared/files/folder', authed, asyncHandler(shared.createFolder));
app.post('/shared/files/upload/prepare', authed, asyncHandler(shared.prepareUpload));
app.post('/shared/files/upload/complete', authed, asyncHandler(shared.completeUpload));
app.patch('/shared/files/rename', authed, asyncHandler(shared.renameItem));
app.post('/shared/files/move', authed, asyncHandler(shared.moveItem));
app.post('/shared/files/copy', authed, asyncHandler(shared.copyItem));
app.get('/shared/files/item/:assetId', authed, asyncHandler(shared.getItem));
app.delete('/shared/files/item/:assetId', authed, asyncHandler(shared.trashItem));
app.post('/shared/files/item/:assetId/restore', authed, asyncHandler(shared.restoreItem));
app.get('/shared/drafts', authed, asyncHandler(shared.listDrafts));
app.get('/shared/drafts/:draftId', authed, asyncHandler(shared.getDraft));
app.put('/shared/drafts/:draftId', authed, asyncHandler(shared.saveDraft));
app.delete('/shared/drafts/:draftId', authed, asyncHandler(shared.trashDraft));
// Ação explícita para clientes desktop e proxies que tratam DELETE de forma
// diferente. Mantemos DELETE por compatibilidade com versões anteriores.
app.post('/shared/drafts/:draftId/trash', authed, asyncHandler(shared.trashDraft));

// ── Painel do super admin (HTML estático) ───────────────────────────────────
app.use('/admin-ui', express.static(path.join(__dirname, '..', 'public')));
app.get('/', (_req, res) => res.redirect('/admin-ui/'));

// Error-middleware global: nada de resposta pendurada por exceção não tratada.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('[gateway] erro não tratado:', err && err.message ? err.message : err);
    if (res.headersSent) return;
    const status = err?.code === 'LIMIT_FILE_SIZE'
        ? 413
        : Number(err?.status) || 500;
    res.status(status).json({
        ok: false,
        code: err?.code === 'LIMIT_FILE_SIZE' ? 'ops_export_too_large' : err?.code || undefined,
        message: err?.code === 'LIMIT_FILE_SIZE'
            ? 'O MP4 excede o limite de 512 MB para exportação ao Mileto Ops.'
            : Number(err?.status) ? err.message : 'Erro interno no servidor.',
        requestId: err?.requestId || undefined,
    });
});

app.listen(config.port, () => {
    console.log(`[gateway] ouvindo em http://localhost:${config.port}`);
    console.log(`[gateway] painel do super admin: http://localhost:${config.port}/admin-ui/`);
    console.log('[gateway] chaves de IA: gerencie na aba IA do painel (sem chave = modo demo).');
});

// Limpeza oportunista: itens permanecem 30 dias na lixeira e blobs só somem
// quando a última referência expira. Erro de R2 nunca derruba o gateway.
const purgeTimer = setInterval(() => {
    shared.purgeExpired().catch((error) => console.error('[gateway][shared] falha ao limpar lixeira:', error.message));
    opsIntegration
        .purgeExpiredAttempts()
        .catch((error) => console.error('[gateway][ops] falha ao limpar autorizações expiradas:', error.message));
}, 6 * 60 * 60 * 1000);
purgeTimer.unref();
