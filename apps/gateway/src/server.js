import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { query } from './db.js';
import { login, logout, requireAuth, requireSuperAdmin, requireOwner } from './auth.js';
import { proxyTts, proxyChat, proxyStt, hasKey } from './providers.js';
import { estimateUnits, priceOf, reserve, settle, release, getBalance } from './meter.js';
import { resolveTier, getSystemPrompt } from './settings.js';
import { CHAT_SCRIPT_OUTPUT_CONTRACT } from './defaultPrompt.js';
import * as admin from './admin.js';
import * as account from './account.js';
import * as shared from './shared.js';
import * as opsIntegration from './opsIntegration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));

// Upload de áudio das legendas em memória (limite do Whisper = 25MB).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** Envolve handler/middleware async para que rejeições virem o error-middleware (Express 4 não faz isso). */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

        const demo = !(await hasKey(provider));
        const units = estimateUnits(provider, 'tts', text); // texto conhecido → estimativa exata
        const { charged: estCharge } = await priceOf(provider, null, units, 'tts');

        let reserved;
        try {
            reserved = await reserve({ orgId: req.user.orgId, estCharge, demo });
        } catch (e) {
            return billingError(res, e);
        }

        let result;
        try {
            result = await proxyTts({ provider, voiceId, text, voiceSettings });
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
        const { messages, model = 'mileto-plus', reasoning, locale = 'pt-BR', system, json } = req.body || {};
        if (!Array.isArray(messages) || !messages.length) {
            return res.status(400).json({ ok: false, message: 'Faltam messages.' });
        }

        const { provider, model: realModel } = await resolveTier(model);
        const hasCustomSystem = typeof system === 'string' && system.trim();
        const baseSystem = hasCustomSystem ? system : await getSystemPrompt(locale);
        // The stored admin prompt can predate this feature. Append the app output
        // contract at request time so title + script works without rewriting settings.
        const sys = hasCustomSystem
            ? baseSystem
            : [baseSystem, CHAT_SCRIPT_OUTPUT_CONTRACT].filter(Boolean).join('\n\n');
        const fullMessages = sys ? [{ role: 'system', content: sys }, ...messages] : messages;

        const demo = !(await hasKey(provider));
        const promptChars = fullMessages.map((m) => m.content || '').join(' ');
        // Estimativa como TETO (prompt + saída máxima) para reservar o suficiente.
        const estUnits = estimateUnits(provider, 'chat', promptChars) + 4096;
        const { charged: estCharge } = await priceOf(provider, realModel, estUnits, 'chat');

        let reserved;
        try {
            reserved = await reserve({ orgId: req.user.orgId, estCharge, demo });
        } catch (e) {
            return billingError(res, e);
        }

        let result;
        try {
            result = await proxyChat({ messages: fullMessages, model: realModel, provider, reasoning, json: !!json });
        } catch (e) {
            await release({ orgId: req.user.orgId, reserved, demo }).catch(() => {});
            console.error('[gateway] /v1/chat provedor', e.message);
            return res.status(502).json({ ok: false, message: `Falha no provedor de IA: ${e.message}` });
        }

        // Unidades REAIS: tokens do fornecedor (inclui reasoning oculto); senão estima por texto.
        const realUnits =
            result.usageTokens && result.usageTokens > 0
                ? result.usageTokens
                : estimateUnits(provider, 'chat', promptChars + (result.text || ''));

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

        res.json({ ok: true, text: result.text, demo: result.demo, charged: meta.charged, balance: meta.balanceAfter });
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
app.get('/admin/credits', sa, asyncHandler(admin.getCredits));
app.post('/admin/credits', sa, asyncHandler(admin.setCredit));

// ── Cliente (owner/member) — sempre escopado na própria org ─────────────────
app.get('/account/usage', asyncHandler(requireAuth), asyncHandler(account.usage));
app.get('/account/team', asyncHandler(requireAuth), asyncHandler(account.listTeam));
app.post('/account/team', asyncHandler(requireAuth), requireOwner, asyncHandler(account.addMember));
app.delete('/account/team/:userId', asyncHandler(requireAuth), requireOwner, asyncHandler(account.removeMember));

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
app.get('/v1/integrations/mileto-ops/companies', authed, asyncHandler(opsIntegration.listCompanies));
app.get('/v1/integrations/mileto-ops/companies/:companyId/folders', authed, asyncHandler(opsIntegration.listFolders));
app.get('/v1/integrations/mileto-ops/companies/:companyId/assets', authed, asyncHandler(opsIntegration.listAssets));
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

// ── Painel do super admin (HTML estático) ───────────────────────────────────
app.use('/admin-ui', express.static(path.join(__dirname, '..', 'public')));
app.get('/', (_req, res) => res.redirect('/admin-ui/'));

// Error-middleware global: nada de resposta pendurada por exceção não tratada.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('[gateway] erro não tratado:', err && err.message ? err.message : err);
    if (res.headersSent) return;
    res.status(Number(err?.status) || 500).json({
        ok: false,
        code: err?.code || undefined,
        message: Number(err?.status) ? err.message : 'Erro interno no servidor.',
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
