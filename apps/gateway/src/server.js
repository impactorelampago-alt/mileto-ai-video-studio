import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { query } from './db.js';
import { login, logout, requireAuth, requireSuperAdmin, requireOwner } from './auth.js';
import { proxyTts, proxyChat, proxyStt } from './providers.js';
import { estimateUnits, debitAndLog, getBalance } from './meter.js';
import { resolveTier, getSystemPrompt } from './settings.js';
import * as admin from './admin.js';
import * as account from './account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

// Upload de áudio das legendas em memória (limite do Whisper = 25MB).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// CORS liberado para o app local. Em produção, restrinja à origem do app.
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'mileto-gateway' }));

// ── Autenticação ────────────────────────────────────────────────────────────
app.post('/auth/login', login);
app.post('/auth/logout', requireAuth, logout);

app.get('/auth/me', requireAuth, async (req, res) => {
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
});

// ── Proxy de IA (autenticado + medido por organização) ──────────────────────
app.post('/v1/tts', requireAuth, async (req, res) => {
    try {
        if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
        const { text, voiceId, provider = 'fishAudio', voiceSettings } = req.body || {};
        if (!text || !voiceId) return res.status(400).json({ ok: false, message: 'Faltam text e voiceId.' });

        const { audio, demo } = await proxyTts({ provider, voiceId, text, voiceSettings });
        const units = estimateUnits(provider, 'tts', text);

        let meta;
        try {
            meta = await debitAndLog({ orgId: req.user.orgId, userId: req.user.id, provider, kind: 'tts', units, demo });
        } catch (e) {
            if (e.code === 'INSUFFICIENT_CREDIT') return res.status(402).json({ ok: false, message: e.message });
            throw e;
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('X-Mileto-Demo', String(demo));
        res.setHeader('X-Mileto-Charged', String(meta.charged));
        res.setHeader('X-Mileto-Balance', String(meta.balanceAfter));
        res.send(audio);
    } catch (e) {
        console.error('[gateway] /v1/tts', e.message);
        res.status(500).json({ ok: false, message: e.message });
    }
});

app.post('/v1/chat', requireAuth, async (req, res) => {
    try {
        if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
        const { messages, model = 'mileto-plus', reasoning, locale = 'pt-BR', system, json } = req.body || {};
        if (!Array.isArray(messages) || !messages.length) {
            return res.status(400).json({ ok: false, message: 'Faltam messages.' });
        }

        // Tier Mileto → provider+modelo real. O system vem do painel (persona do
        // Chat Mileto), a menos que o chamador mande um `system` próprio — é o caso
        // da geração de títulos, que tem instrução dedicada e não a persona.
        const { provider, model: realModel } = await resolveTier(model);
        const sys = typeof system === 'string' && system.trim() ? system : await getSystemPrompt(locale);
        const fullMessages = sys ? [{ role: 'system', content: sys }, ...messages] : messages;

        const { text, demo } = await proxyChat({ messages: fullMessages, model: realModel, provider, reasoning, json: !!json });
        const promptChars = fullMessages.map((m) => m.content || '').join(' ');
        const units = estimateUnits(provider, 'chat', promptChars + text);

        let meta;
        try {
            meta = await debitAndLog({ orgId: req.user.orgId, userId: req.user.id, provider, kind: 'chat', units, demo });
        } catch (e) {
            if (e.code === 'INSUFFICIENT_CREDIT') return res.status(402).json({ ok: false, message: e.message });
            throw e;
        }

        res.json({ ok: true, text, demo, charged: meta.charged, balance: meta.balanceAfter });
    } catch (e) {
        console.error('[gateway] /v1/chat', e.message);
        res.status(500).json({ ok: false, message: e.message });
    }
});

app.post('/v1/stt', requireAuth, upload.single('audio'), async (req, res) => {
    try {
        if (!req.user.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
        if (!req.file) return res.status(400).json({ ok: false, message: 'Envie o arquivo de áudio (campo "audio").' });
        const language = String(req.body?.language || 'pt').slice(0, 5);

        const { words, durationSec, demo } = await proxyStt({
            audio: req.file.buffer,
            filename: req.file.originalname || 'audio.mp3',
            language,
        });

        let meta;
        try {
            meta = await debitAndLog({
                orgId: req.user.orgId,
                userId: req.user.id,
                provider: 'openai',
                kind: 'stt',
                units: durationSec,
                demo,
            });
        } catch (e) {
            if (e.code === 'INSUFFICIENT_CREDIT') return res.status(402).json({ ok: false, message: e.message });
            throw e;
        }

        res.json({ ok: true, words, demo, charged: meta.charged, balance: meta.balanceAfter });
    } catch (e) {
        console.error('[gateway] /v1/stt', e.message);
        res.status(500).json({ ok: false, message: e.message });
    }
});

// ── Super admin (control plane) ─────────────────────────────────────────────
const sa = [requireAuth, requireSuperAdmin];
app.get('/admin/overview', sa, admin.overview);
app.get('/admin/orgs', sa, admin.listOrgs);
app.post('/admin/orgs', sa, admin.createOrg);
app.get('/admin/orgs/:id', sa, admin.orgDetail);
app.post('/admin/orgs/:id/credits', sa, admin.addCredits);
app.post('/admin/orgs/:id/status', sa, admin.setStatus);
app.post('/admin/orgs/:id/plan', sa, admin.setPlan);
app.get('/admin/ia', sa, admin.getIa);
app.post('/admin/ia/key', sa, admin.setIaKey);
app.post('/admin/ia/multiplier', sa, admin.setIaMultiplier);
app.get('/admin/models', sa, admin.getModels);
app.post('/admin/models', sa, admin.setModel);
app.get('/admin/prompt', sa, admin.getChatPrompt);
app.post('/admin/prompt', sa, admin.setChatPrompt);
app.get('/admin/credits', sa, admin.getCredits);
app.post('/admin/credits', sa, admin.setCredit);

// ── Cliente (owner/member) — sempre escopado na própria org ─────────────────
app.get('/account/usage', requireAuth, account.usage);
app.get('/account/team', requireAuth, account.listTeam);
app.post('/account/team', requireAuth, requireOwner, account.addMember);
app.delete('/account/team/:userId', requireAuth, requireOwner, account.removeMember);

// ── Painel do super admin (HTML estático) ───────────────────────────────────
app.use('/admin-ui', express.static(path.join(__dirname, '..', 'public')));
app.get('/', (_req, res) => res.redirect('/admin-ui/'));

app.listen(config.port, () => {
    console.log(`[gateway] ouvindo em http://localhost:${config.port}`);
    console.log(`[gateway] painel do super admin: http://localhost:${config.port}/admin-ui/`);
    console.log('[gateway] chaves de IA: gerencie na aba IA do painel (sem chave = modo demo).');
});
