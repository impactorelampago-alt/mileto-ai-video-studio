import { pool, query } from './db.js';
import { hashPassword } from './crypto.js';
import { config } from './config.js';
import { DEFAULT_CHAT_PROMPT } from './defaultPrompt.js';

/**
 * Cria o SUPER ADMIN (você) e um CLIENTE DEMO para o painel ter o que mostrar.
 * Idempotente: rodar de novo não duplica nem reseta senha.
 */
const run = async () => {
    const email = config.admin.email.toLowerCase().trim();

    // ── Super admin (sem organização) ──
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) {
        console.log(`[seed] super admin já existe: ${email}`);
    } else {
        await query(`INSERT INTO users (org_id, email, password_hash, name, role) VALUES (NULL,$1,$2,$3,'super_admin')`, [
            email,
            hashPassword(config.admin.password),
            'Super Admin',
        ]);
        console.log(`[seed] super admin criado: ${email} (senha do .env)`);
    }

    // ── Primeiro cliente real (definido no .env: SEED_OWNER_*) ──
    const seatsByPlan = { solo: 1, business: 5, enterprise: 25 };
    const owner = config.seedOwner;
    if (owner.email && owner.password) {
        const oEmail = owner.email.toLowerCase().trim();
        const hasOwner = await query('SELECT 1 FROM users WHERE email = $1', [oEmail]);
        if (!hasOwner.rows[0]) {
            const org = (
                await query('INSERT INTO organizations (name, plan, max_seats) VALUES ($1,$2,$3) RETURNING id', [
                    owner.org,
                    owner.plan,
                    seatsByPlan[owner.plan] || 1,
                ])
            ).rows[0];
            await query(`INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,'owner')`, [
                org.id,
                oEmail,
                hashPassword(owner.password),
                owner.org,
            ]);
            await query('INSERT INTO credits (org_id, balance) VALUES ($1, 50000)', [org.id]);
            await query(`INSERT INTO credit_events (org_id, amount, reason) VALUES ($1, 50000, 'Crédito inicial')`, [
                org.id,
            ]);
            console.log(`[seed] cliente criado: ${owner.org} (${oEmail}) — plano ${owner.plan}, 50.000 créditos`);
        } else {
            console.log(`[seed] cliente ${oEmail} já existe.`);
        }
    } else {
        console.log('[seed] SEED_OWNER_EMAIL/PASSWORD não definidos no .env — nenhum cliente criado.');
    }

    // ── Prompt padrão do chat, se ainda não existir ──
    const hasPrompt = await query(`SELECT 1 FROM settings WHERE key = 'chat_prompt'`);
    if (!hasPrompt.rows[0]) {
        await query(`INSERT INTO settings (key, value) VALUES ('chat_prompt', $1)`, [DEFAULT_CHAT_PROMPT]);
        console.log('[seed] prompt padrão do chat gravado.');
    } else {
        console.log('[seed] prompt do chat já existe.');
    }

    await pool.end();
};

run().catch((e) => {
    console.error('[seed] falhou:', e.message);
    process.exit(1);
});
