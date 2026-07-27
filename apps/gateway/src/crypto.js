import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Hash de senha com scrypt (embutido no Node, sem dependência externa).
 * Formato guardado: scrypt$<salt-hex>$<hash-hex>.
 */
export const hashPassword = (password) => {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
};

export const verifyPassword = (password, stored) => {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(hashHex, 'hex');
    // timingSafeEqual exige buffers do mesmo tamanho
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
};

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const b64uJson = (obj) => b64u(JSON.stringify(obj));

/**
 * Token de sessão assinado (formato compacto tipo JWT, HMAC-SHA256).
 * Payload: { sub: userId, jti: tokenId, role, exp }.
 */
export const signToken = (payload) => {
    const header = b64uJson({ alg: 'HS256', typ: 'JWT' });
    const body = b64uJson(payload);
    const sig = crypto.createHmac('sha256', config.tokenSecret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
};

export const verifyToken = (token) => {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', config.tokenSecret).update(`${header}.${body}`).digest('base64url');
    // comparação em tempo constante
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return null;
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
};

export const newId = () => crypto.randomUUID();

// ── Criptografia de segredos em repouso (chaves de IA no banco) ─────────────
// AES-256-GCM. Idealmente a chave de criptografia é INDEPENDENTE do TOKEN_SECRET
// (senão um único vazamento do TOKEN_SECRET permite forjar token de super_admin E
// descriptografar todas as chaves de API). Defina SECRET_ENCRYPTION_KEY para separar.
// Sem ela, cai no TOKEN_SECRET (comportamento anterior) — assim os segredos já
// gravados continuam descriptografáveis; troque só com re-encriptação planejada.
const encSource = process.env.SECRET_ENCRYPTION_KEY || config.tokenSecret;
const encKey = crypto.scryptSync(encSource, 'mileto-secret-salt', 32);

export const encryptSecret = (plain) => {
    if (!plain) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
};

export const decryptSecret = (stored) => {
    if (!stored) return '';
    try {
        const [ivHex, tagHex, dataHex] = String(stored).split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
        return '';
    }
};

// Tokens do Mileto Ops usam uma chave própria e OBRIGATÓRIA. Não existe fallback
// para TOKEN_SECRET: comprometer a assinatura da sessão AI não pode também abrir
// os refresh tokens da integração. O prefixo v1 permite rotação/formato futuro.
const opsKey = config.ops.tokenEncryptionKey
    ? crypto.scryptSync(config.ops.tokenEncryptionKey, 'mileto-ops-token-v1', 32)
    : null;

export const encryptOpsToken = (plain) => {
    if (!plain) return '';
    if (!opsKey) throw new Error('Criptografia da integração Mileto Ops não configurada.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', opsKey, iv);
    const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decryptOpsToken = (stored) => {
    if (!stored) return '';
    if (!opsKey) throw new Error('Criptografia da integração Mileto Ops não configurada.');
    const [version, ivHex, tagHex, dataHex] = String(stored).split(':');
    if (version !== 'v1' || !ivHex || !tagHex || !dataHex) {
        throw new Error('Token da integração Mileto Ops possui formato inválido.');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', opsKey, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
};
