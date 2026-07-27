import { query, pool } from './db.js';
import { hashPassword } from './crypto.js';
import { PLAN_SEATS } from './admin.js';

/**
 * Rotas do CLIENTE (owner/member), sempre escopadas em req.user.orgId.
 * NUNCA aceitam orgId do corpo — o cliente só enxerga a própria organização.
 */

/** GET /account/usage — últimas gerações + movimentações de crédito da org. */
export const usage = async (req, res) => {
    const orgId = req.user.orgId;
    const recent = (
        await query(
            `SELECT provider, kind, units, charged, demo, created_at
             FROM usage_ledger WHERE org_id = $1 ORDER BY created_at DESC LIMIT 30`,
            [orgId]
        )
    ).rows;
    const last30 = (
        await query(
            `SELECT COALESCE(SUM(charged),0) AS credits, COUNT(*) AS calls
             FROM usage_ledger WHERE org_id = $1 AND created_at > now() - interval '30 days'`,
            [orgId]
        )
    ).rows[0];
    res.json({ ok: true, recent, last30: { credits: Number(last30.credits), calls: Number(last30.calls) } });
};

/** GET /account/team — membros da própria organização. */
export const listTeam = async (req, res) => {
    const rows = (
        await query(
            `SELECT id, email, name, role, status, created_at FROM users WHERE org_id = $1 ORDER BY created_at`,
            [req.user.orgId]
        )
    ).rows;
    res.json({ ok: true, team: rows });
};

/** POST /account/team — owner adiciona um membro (respeita assentos do plano). */
export const addMember = async (req, res) => {
    const { email, name, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, message: 'Informe email e senha do membro.' });
    const cleanEmail = String(email).toLowerCase().trim();

    // Transação com a org TRAVADA: contar assentos e inserir precisam ser atômicos,
    // senão dois POST simultâneos passam ambos na checagem e estouram o max_seats.
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const org = (
            await client.query('SELECT plan, max_seats FROM organizations WHERE id = $1 FOR UPDATE', [req.user.orgId])
        ).rows[0];
        if (!org) {
            await client.query('ROLLBACK');
            return res.status(404).json({ ok: false, message: 'Organização não encontrada.' });
        }
        const seatsUsed = Number(
            (await client.query('SELECT COUNT(*) AS c FROM users WHERE org_id = $1', [req.user.orgId])).rows[0].c
        );
        if (seatsUsed >= (org.max_seats || PLAN_SEATS[org.plan] || 1)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ ok: false, message: 'Limite de membros do seu plano atingido.' });
        }
        if ((await client.query('SELECT 1 FROM users WHERE email = $1', [cleanEmail])).rows[0]) {
            await client.query('ROLLBACK');
            return res.status(409).json({ ok: false, message: 'Já existe usuário com esse email.' });
        }
        await client.query(
            `INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,'member')`,
            [req.user.orgId, cleanEmail, hashPassword(password), name || null]
        );
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        // Violação da UNIQUE de email vira 409 amigável em vez de 500.
        if (e.code === '23505') return res.status(409).json({ ok: false, message: 'Já existe usuário com esse email.' });
        throw e;
    } finally {
        client.release();
    }
};

/** DELETE /account/team/:userId — owner remove um membro (não a si mesmo, não outro owner). */
export const removeMember = async (req, res) => {
    const userId = Number(req.params.userId);
    const target = (await query('SELECT id, org_id, role FROM users WHERE id = $1', [userId])).rows[0];
    if (!target || target.org_id !== req.user.orgId) {
        return res.status(404).json({ ok: false, message: 'Membro não encontrado.' });
    }
    if (target.role === 'owner') return res.status(403).json({ ok: false, message: 'Não é possível remover o dono.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM tokens WHERE user_id = $1', [userId]); // derruba sessões
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ ok: false, message: e.message });
    } finally {
        client.release();
    }
};
