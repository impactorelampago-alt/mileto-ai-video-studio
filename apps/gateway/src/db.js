import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Sem este listener, um erro num cliente OCIOSO (Postgres reinicia, TCP cai) vira
// exceção não capturada e DERRUBA o processo inteiro do gateway. Aqui só logamos;
// o pool descarta o cliente ruim e segue.
pool.on('error', (err) => {
    console.error('[gateway][db] erro em cliente ocioso do pool:', err.message);
});

export const query = (text, params) => pool.query(text, params);

/**
 * Hierarquia de contas do Mileto (v2):
 *
 *   SUPER ADMIN (o dono da plataforma — você)
 *      gerencia todos os clientes, saldos, planos. org_id = NULL.
 *
 *   ORGANIZATION (o cliente que comprou o serviço)
 *      tem um plano, um saldo de créditos e um ou mais usuários.
 *      plano 'solo' = 1 assento; 'business'/'enterprise' = vários (equipe).
 *
 *   USER (quem loga)
 *      role 'owner'  = dono da conta do cliente
 *      role 'member' = membro da equipe (só em plano com assentos > 1)
 *      role 'super_admin' = você
 *
 * Créditos e consumo são por ORGANIZAÇÃO — a equipe compartilha o mesmo saldo.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizations (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    plan       TEXT NOT NULL DEFAULT 'solo',   -- solo | business | enterprise
    max_seats  INTEGER NOT NULL DEFAULT 1,
    status     TEXT NOT NULL DEFAULT 'active',  -- active | suspended
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    org_id        BIGINT REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL só para super_admin
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    role          TEXT NOT NULL DEFAULT 'owner',  -- super_admin | owner | member
    status        TEXT NOT NULL DEFAULT 'active',   -- active | suspended
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens (
    id         TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked    BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS credits (
    org_id     BIGINT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    balance    NUMERIC(14,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_ledger (
    id            BIGSERIAL PRIMARY KEY,
    org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    provider      TEXT NOT NULL,
    kind          TEXT NOT NULL,        -- tts | chat
    units         INTEGER NOT NULL,
    provider_cost NUMERIC(14,6) NOT NULL,
    charged       NUMERIC(14,4) NOT NULL,
    demo          BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_org_time ON usage_ledger(org_id, created_at DESC);

-- Configurações da plataforma, incluindo as chaves de IA (a "IA universal").
-- Valores de segredo ficam CRIPTOGRAFADOS. Servem a todos os usuários.
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Movimentações de crédito lançadas pelo super admin (auditoria de quem creditou o quê).
CREATE TABLE IF NOT EXISTS credit_events (
    id         BIGSERIAL PRIMARY KEY,
    org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    amount     NUMERIC(14,4) NOT NULL,   -- positivo = crédito, negativo = estorno
    reason     TEXT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** Reset de desenvolvimento: derruba tudo e recria. NÃO usar com dados reais. */
export const RESET = `
DROP TABLE IF EXISTS credit_events, settings, usage_ledger, credits, tokens, users, organizations CASCADE;
`;
