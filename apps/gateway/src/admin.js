import { query, pool } from './db.js';
import { hashPassword } from './crypto.js';
import {
    keyStatus, setKey, getMultiplier, setMultiplier, PROVIDERS,
    getTiers, setTier, TIERS, MODEL_CATALOG, getPrompt, setPrompt,
    CREDIT_FEATURES, getAllMultipliers, setKindMultiplier,
    getAgents as listAgentConfigs, normalizeAgentConfig, publishAgentConfig,
    getAgentHistory as listAgentHistory, rollbackAgentConfig,
} from './settings.js';
import { proxyChat } from './providers.js';
import { agentRequiresStrictJsonOutput } from './agentDefaults.js';
import { getGlobalTitleGeneratorConfig, setGlobalTitleGeneratorConfig } from './orgAi.js';

/** Assentos por plano. Define quantos usuários a organização pode ter. */
export const PLAN_SEATS = { solo: 1, business: 5, enterprise: 25 };

/** GET /admin/overview — números do topo do painel. */
export const overview = async (_req, res) => {
    const { rows } = await query(`
        SELECT
            (SELECT COUNT(*) FROM organizations) AS orgs,
            (SELECT COUNT(*) FROM organizations WHERE status = 'active') AS orgs_active,
            (SELECT COUNT(*) FROM users WHERE role <> 'super_admin') AS users,
            (SELECT COALESCE(SUM(balance),0) FROM credits) AS credits_outstanding,
            (SELECT COALESCE(SUM(charged),0) FROM usage_ledger WHERE created_at > now() - interval '30 days') AS credits_used_30d,
            (SELECT COALESCE(SUM(provider_cost),0) FROM usage_ledger WHERE created_at > now() - interval '30 days') AS provider_cost_30d
    `);
    res.json({ ok: true, overview: rows[0] });
};

/** GET /admin/orgs — lista de clientes com saldo e consumo. */
export const listOrgs = async (_req, res) => {
    const { rows } = await query(`
        SELECT o.id, o.name, o.plan, o.max_seats, o.status, o.created_at,
               COALESCE(c.balance, 0) AS balance,
               (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS seats_used,
               (SELECT COALESCE(SUM(l.charged),0) FROM usage_ledger l WHERE l.org_id = o.id) AS lifetime_used,
               (SELECT MAX(l.created_at) FROM usage_ledger l WHERE l.org_id = o.id) AS last_used
        FROM organizations o
        LEFT JOIN credits c ON c.org_id = o.id
        ORDER BY o.created_at DESC
    `);
    res.json({ ok: true, orgs: rows });
};

/** GET /admin/orgs/:id — detalhe: usuários, últimas chamadas, movimentações de crédito. */
export const orgDetail = async (req, res) => {
    const id = Number(req.params.id);
    const org = (await query('SELECT * FROM organizations WHERE id = $1', [id])).rows[0];
    if (!org) return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });

    const balance = (await query('SELECT balance FROM credits WHERE org_id = $1', [id])).rows[0]?.balance ?? 0;
    const users = (
        await query('SELECT id, email, name, role, status, created_at FROM users WHERE org_id = $1 ORDER BY created_at', [id])
    ).rows;
    const recentUsage = (
        await query(
            `SELECT provider, kind, units, provider_cost, charged, demo, created_at
             FROM usage_ledger WHERE org_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [id]
        )
    ).rows;
    const creditEvents = (
        await query(
            `SELECT amount, reason, created_at FROM credit_events WHERE org_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [id]
        )
    ).rows;

    res.json({ ok: true, org: { ...org, balance }, users, recentUsage, creditEvents });
};

/** POST /admin/orgs — cria cliente + usuário dono + saldo inicial, numa transação. */
export const createOrg = async (req, res) => {
    const { name, plan = 'solo', ownerEmail, ownerName, ownerPassword, initialCredits = 0 } = req.body || {};
    if (!name || !ownerEmail || !ownerPassword) {
        return res.status(400).json({ ok: false, message: 'Informe nome do cliente, email e senha do dono.' });
    }
    const maxSeats = PLAN_SEATS[plan];
    if (!maxSeats) return res.status(400).json({ ok: false, message: 'Plano inválido.' });

    const credits0 = Number(initialCredits);
    if (!Number.isFinite(credits0) || credits0 < 0) {
        return res.status(400).json({ ok: false, message: 'Crédito inicial inválido (não pode ser negativo).' });
    }

    const email = String(ownerEmail).toLowerCase().trim();
    const exists = (await query('SELECT 1 FROM users WHERE email = $1', [email])).rows[0];
    if (exists) return res.status(409).json({ ok: false, message: 'Já existe usuário com esse email.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const org = (
            await client.query(
                'INSERT INTO organizations (name, plan, max_seats) VALUES ($1,$2,$3) RETURNING id',
                [name, plan, maxSeats]
            )
        ).rows[0];
        await client.query(
            `INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,'owner')`,
            [org.id, email, hashPassword(ownerPassword), ownerName || null]
        );
        await client.query('INSERT INTO credits (org_id, balance) VALUES ($1, $2)', [org.id, credits0]);
        if (credits0 > 0) {
            await client.query(
                'INSERT INTO credit_events (org_id, amount, reason, created_by) VALUES ($1,$2,$3,$4)',
                [org.id, credits0, 'Crédito inicial', req.user.id]
            );
        }
        await client.query('COMMIT');
        res.json({ ok: true, orgId: org.id });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ ok: false, message: e.message });
    } finally {
        client.release();
    }
};

/** POST /admin/orgs/:id/credits — adiciona (ou estorna) créditos, com registro de auditoria. */
export const addCredits = async (req, res) => {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount);
    const reason = req.body?.reason || 'Ajuste manual';
    if (!Number.isFinite(amount) || amount === 0) {
        return res.status(400).json({ ok: false, message: 'Informe um valor diferente de zero.' });
    }
    const org = (await query('SELECT 1 FROM organizations WHERE id = $1', [id])).rows[0];
    if (!org) return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Trava a linha e impede que um estorno (amount negativo) deixe o saldo negativo.
        const cur = (await client.query('SELECT balance FROM credits WHERE org_id = $1 FOR UPDATE', [id])).rows[0];
        const current = cur ? Number(cur.balance) : 0;
        if (current + amount < 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ ok: false, message: `Estorno maior que o saldo atual (${current}).` });
        }
        await client.query(
            `INSERT INTO credits (org_id, balance) VALUES ($1,$2)
             ON CONFLICT (org_id) DO UPDATE SET balance = credits.balance + $2, updated_at = now()`,
            [id, amount]
        );
        await client.query('INSERT INTO credit_events (org_id, amount, reason, created_by) VALUES ($1,$2,$3,$4)', [
            id,
            amount,
            reason,
            req.user.id,
        ]);
        await client.query('COMMIT');
        const balance = (await query('SELECT balance FROM credits WHERE org_id = $1', [id])).rows[0].balance;
        res.json({ ok: true, balance });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ ok: false, message: e.message });
    } finally {
        client.release();
    }
};

/** POST /admin/orgs/:id/status — suspende ou reativa o cliente. */
export const setStatus = async (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status;
    if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ ok: false, message: 'Status inválido.' });
    }
    const r = await query('UPDATE organizations SET status = $2 WHERE id = $1 RETURNING id', [id, status]);
    if (!r.rows[0]) return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });
    // Suspender a org derruba as sessões ativa dos usuários dela.
    if (status === 'suspended') {
        await query(
            'UPDATE tokens SET revoked = true WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)',
            [id]
        );
    }
    res.json({ ok: true, status });
};

// ── Aba Créditos de IA: multiplicador de revenda por recurso ────────────────

export const getCredits = async (_req, res) => {
    const multipliers = await getAllMultipliers();
    res.json({ ok: true, features: CREDIT_FEATURES, multipliers });
};

export const setCredit = async (req, res) => {
    const { kind, multiplier } = req.body || {};
    if (kind !== 'global' && !CREDIT_FEATURES.some((f) => f.kind === kind)) {
        return res.status(400).json({ ok: false, message: 'Recurso inválido.' });
    }
    const v = Number(multiplier);
    if (!Number.isFinite(v) || v <= 0) {
        return res.status(400).json({ ok: false, message: 'Multiplicador deve ser maior que zero.' });
    }
    if (kind === 'global') await setMultiplier(v);
    else await setKindMultiplier(kind, v);
    res.json({ ok: true });
};

// ── Aba IA: chaves da "IA universal" e multiplicador de revenda ─────────────

/** GET /admin/ia — status das chaves (mascaradas) + multiplicador. */
export const getIa = async (_req, res) => {
    const keys = await keyStatus();
    const multiplier = await getMultiplier();
    res.json({ ok: true, keys, multiplier });
};

/** POST /admin/ia/key — grava (ou limpa) a chave de um provedor. */
export const setIaKey = async (req, res) => {
    const { provider, key } = req.body || {};
    if (!PROVIDERS.some((p) => p.id === provider)) {
        return res.status(400).json({ ok: false, message: 'Provedor inválido.' });
    }
    await setKey(provider, (key || '').trim());
    res.json({ ok: true });
};

/** POST /admin/ia/multiplier — ajusta o multiplicador de revenda. */
export const setIaMultiplier = async (req, res) => {
    const value = Number(req.body?.multiplier);
    if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ ok: false, message: 'Multiplicador deve ser maior que zero.' });
    }
    await setMultiplier(value);
    res.json({ ok: true, multiplier: value });
};

// ── Aba IA → Modelo de IA: mapeia os tiers Mileto para o modelo real ────────

export const getModels = async (_req, res) => {
    const tiers = await getTiers();
    res.json({ ok: true, tiers, catalog: MODEL_CATALOG });
};

export const setModel = async (req, res) => {
    const { tier, provider, model } = req.body || {};
    if (!TIERS.some((t) => t.id === tier)) return res.status(400).json({ ok: false, message: 'Tier inválido.' });
    if (!MODEL_CATALOG[provider]) return res.status(400).json({ ok: false, message: 'Provedor inválido.' });
    if (!model || !String(model).trim()) return res.status(400).json({ ok: false, message: 'Informe o modelo.' });
    await setTier(tier, provider, String(model).trim());
    res.json({ ok: true });
};

// ── Aba IA → Prompt: como o assistente responde no chat do app ──────────────

export const getChatPrompt = async (_req, res) => {
    res.json({ ok: true, prompt: await getPrompt() });
};

export const setChatPrompt = async (req, res) => {
    const { prompt } = req.body || {};
    if (typeof prompt !== 'string') return res.status(400).json({ ok: false, message: 'Prompt inválido.' });
    await setPrompt(prompt);
    res.json({ ok: true });
};

export const getTitleGenerator = async (_req, res) => {
    res.json({ ok: true, ...(await getGlobalTitleGeneratorConfig()) });
};

export const setTitleGenerator = async (req, res) => {
    try {
        res.json({ ok: true, ...(await setGlobalTitleGeneratorConfig(req.body?.config)) });
    } catch (error) {
        res.status(400).json({ ok: false, message: error.message || 'Configuracao de titulos invalida.' });
    }
};

// ── Aba IA → Agentes: cérebros especializados, prompts e versões ───────────

export const getAgents = async (_req, res) => {
    res.json({ ok: true, ...(await listAgentConfigs()) });
};

export const setAgent = async (req, res) => {
    try {
        const config = await publishAgentConfig(req.params.agentId || req.params.id, req.body || {}, req.user?.id || null);
        res.json({ ok: true, config });
    } catch (error) {
        res.status(400).json({ ok: false, message: error.message || 'Configuração inválida.' });
    }
};

export const getAgentHistory = async (req, res) => {
    try {
        res.json({ ok: true, history: await listAgentHistory(req.params.agentId || req.params.id) });
    } catch (error) {
        res.status(404).json({ ok: false, message: error.message || 'Agente não encontrado.' });
    }
};

export const rollbackAgent = async (req, res) => {
    try {
        const config = await rollbackAgentConfig(
            req.params.agentId || req.params.id,
            req.body?.version,
            req.user?.id || null
        );
        res.json({ ok: true, config });
    } catch (error) {
        res.status(400).json({ ok: false, message: error.message || 'Não foi possível restaurar a versão.' });
    }
};

/** Testa um rascunho sem publicá-lo e sem devolver prompt/modelo ao app cliente. */
export const testAgent = async (req, res) => {
    try {
        const id = req.params.agentId || req.params.id;
        const config = normalizeAgentConfig(id, req.body?.config || {});
        const tierId = ['lite', 'mileto', 'ultra'].includes(req.body?.tier) ? req.body.tier : 'mileto';
        const tier = config.tiers[tierId];
        const message = String(req.body?.message || '').trim();
        if (!message) return res.status(400).json({ ok: false, message: 'Escreva uma mensagem para o teste.' });
        const locale = String(req.body?.locale || 'Português do Brasil').slice(0, 80);
        const systemPrompt = config.systemPrompt.split('{idioma}').join(locale);
        const result = await proxyChat({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message.slice(0, 12000) },
            ],
            provider: tier.provider,
            model: tier.model,
            reasoning: tier.reasoning,
            json: agentRequiresStrictJsonOutput(id),
            maxOutputTokens: tier.maxOutputTokens,
        });
        res.json({ ok: true, text: result.text, demo: result.demo, tier: tierId });
    } catch (error) {
        res.status(502).json({ ok: false, message: error.message || 'Falha ao testar o agente.' });
    }
};

/** POST /admin/orgs/:id/plan — troca o plano e ajusta os assentos. */
export const setPlan = async (req, res) => {
    const id = Number(req.params.id);
    const plan = req.body?.plan;
    const maxSeats = PLAN_SEATS[plan];
    if (!maxSeats) return res.status(400).json({ ok: false, message: 'Plano inválido.' });
    const r = await query('UPDATE organizations SET plan = $2, max_seats = $3 WHERE id = $1 RETURNING id', [
        id,
        plan,
        maxSeats,
    ]);
    if (!r.rows[0]) return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });
    res.json({ ok: true, plan, maxSeats });
};
