import { query } from './db.js';
import { verifyPassword, signToken, verifyToken, newId } from './crypto.js';

const THIRTY_DAYS = 30 * 24 * 60 * 60;

/** POST /auth/login — email + senha → token de sessão. */
export const login = async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, message: 'Informe email e senha.' });

    const { rows } = await query(
        `SELECT u.*, o.status AS org_status, o.name AS org_name, o.plan AS org_plan
         FROM users u LEFT JOIN organizations o ON o.id = u.org_id
         WHERE u.email = $1`,
        [String(email).toLowerCase().trim()]
    );
    const user = rows[0];

    // Mensagem genérica de propósito: não revela se o email existe.
    if (!user || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ ok: false, message: 'Email ou senha incorretos.' });
    }
    if (user.status !== 'active') {
        return res.status(403).json({ ok: false, message: 'Usuário suspenso. Fale com o suporte.' });
    }
    // Cliente com organização suspensa (ex.: pagamento atrasado) não entra — super admin não tem org.
    if (user.org_id && user.org_status !== 'active') {
        return res.status(403).json({ ok: false, message: 'Conta suspensa. Regularize para voltar a usar.' });
    }

    const jti = newId();
    const exp = Math.floor(Date.now() / 1000) + THIRTY_DAYS;
    await query('INSERT INTO tokens (id, user_id, expires_at) VALUES ($1, $2, to_timestamp($3))', [jti, user.id, exp]);

    const token = signToken({ sub: user.id, jti, role: user.role, org: user.org_id, exp });
    res.json({
        ok: true,
        token,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            orgId: user.org_id,
            orgName: user.org_name,
            orgPlan: user.org_plan,
        },
    });
};

/** Middleware: exige token válido e não revogado. Preenche req.user. */
export const requireAuth = async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, message: 'Não autenticado.' });

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ ok: false, message: 'Sessão inválida ou expirada.' });

    const { rows } = await query('SELECT revoked FROM tokens WHERE id = $1', [payload.jti]);
    if (!rows[0] || rows[0].revoked) return res.status(401).json({ ok: false, message: 'Sessão encerrada.' });

    req.user = { id: payload.sub, role: payload.role, orgId: payload.org, jti: payload.jti };
    next();
};

export const requireSuperAdmin = (req, res, next) => {
    if (req.user?.role !== 'super_admin') {
        return res.status(403).json({ ok: false, message: 'Acesso restrito ao super admin.' });
    }
    next();
};

/** Dono da organização — pode gerenciar a equipe da própria conta. */
export const requireOwner = (req, res, next) => {
    if (req.user?.role !== 'owner') {
        return res.status(403).json({ ok: false, message: 'Apenas o dono da conta pode fazer isso.' });
    }
    if (!req.user?.orgId) return res.status(403).json({ ok: false, message: 'Conta sem organização.' });
    next();
};

/** POST /auth/logout — revoga a sessão atual. */
export const logout = async (req, res) => {
    await query('UPDATE tokens SET revoked = true WHERE id = $1', [req.user.jti]);
    res.json({ ok: true });
};
