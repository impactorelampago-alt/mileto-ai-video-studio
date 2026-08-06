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

-- Jobs assíncronos de vídeo por IA. IDs/URLs do fornecedor ficam apenas no gateway.
CREATE TABLE IF NOT EXISTS ai_generation_jobs (
    id                 UUID PRIMARY KEY,
    org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
    agent_id           TEXT NOT NULL,
    tier               TEXT NOT NULL,
    media_kind         TEXT NOT NULL,
    provider           TEXT NOT NULL,
    model              TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'submitting',
    provider_task_id   TEXT,
    result_url_enc     TEXT,
    mime_type          TEXT,
    prompt_hash        CHAR(64) NOT NULL,
    reserved           NUMERIC(14,4) NOT NULL DEFAULT 0,
    provider_cost      NUMERIC(14,6) NOT NULL DEFAULT 0,
    charged            NUMERIC(14,4) NOT NULL DEFAULT 0,
    billing_status     TEXT NOT NULL DEFAULT 'reserved',
    usage_units        BIGINT,
    error_code         TEXT,
    error_message      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at       TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_org_time ON ai_generation_jobs(org_id, created_at DESC);

-- Configurações da plataforma, incluindo as chaves de IA (a "IA universal").
-- Valores de segredo ficam CRIPTOGRAFADOS. Servem a todos os usuários.
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Personalizacoes de IA da agencia. O prompt global continua em settings;
-- estas linhas guardam somente a sobreposicao da propria organizacao.
CREATE TABLE IF NOT EXISTS org_agent_prompt_overrides (
    org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent_id      TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    updated_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, agent_id),
    CHECK (agent_id IN ('director', 'prompt_sales', 'image_director', 'video_director'))
);

CREATE TABLE IF NOT EXISTS org_title_generator_settings (
    org_id     BIGINT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    config     JSONB NOT NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
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

-- Sequência legível por empresa: VID-000001, AUD-000002, IMG-000003.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS next_asset_number BIGINT NOT NULL DEFAULT 1;

-- O blob é o conteúdo físico único no R2. A restrição por organização evita
-- duplicar bytes sem compartilhar informação ou propriedade entre clientes.
CREATE TABLE IF NOT EXISTS media_blobs (
    id          UUID PRIMARY KEY,
    org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    sha256      CHAR(64) NOT NULL,
    size_bytes  BIGINT NOT NULL,
    mime_type   TEXT NOT NULL,
    object_key  TEXT NOT NULL,
    asset_code  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, sha256, size_bytes),
    UNIQUE (org_id, asset_code)
);

CREATE TABLE IF NOT EXISTS shared_folders (
    id          UUID PRIMARY KEY,
    org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    parent_path TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL,
    created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, path)
);

-- Vários itens/pastas/projetos podem referenciar o mesmo blob. Copiar um item
-- cria somente outra linha aqui; não cria outro objeto no R2.
CREATE TABLE IF NOT EXISTS media_items (
    id           UUID PRIMARY KEY,
    org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    blob_id      UUID NOT NULL REFERENCES media_blobs(id) ON DELETE RESTRICT,
    parent_path  TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL,
    name         TEXT NOT NULL,
    media_type   TEXT NOT NULL,
    visibility   TEXT NOT NULL DEFAULT 'library' CHECK (visibility IN ('library', 'project')),
    duration_sec NUMERIC,
    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at   TIMESTAMPTZ,
    purge_after  TIMESTAMPTZ
);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'library';
CREATE INDEX IF NOT EXISTS idx_media_items_org_path ON media_items(org_id, parent_path) WHERE trashed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_items_trash ON media_items(org_id, trashed_at DESC) WHERE trashed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS shared_drafts (
    id          UUID PRIMARY KEY,
    org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    data        JSONB NOT NULL,
    created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at  TIMESTAMPTZ,
    purge_after TIMESTAMPTZ,
    UNIQUE (org_id, id)
);
ALTER TABLE shared_drafts ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE shared_drafts ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_shared_drafts_org_updated ON shared_drafts(org_id, updated_at DESC) WHERE trashed_at IS NULL;

-- Mantém a mídia de um rascunho viva mesmo se sua referência visível for enviada
-- para a lixeira. O blob só pode ser removido depois que o rascunho também expirar.
CREATE TABLE IF NOT EXISTS shared_draft_assets (
    draft_id      UUID NOT NULL REFERENCES shared_drafts(id) ON DELETE CASCADE,
    asset_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE RESTRICT,
    org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    PRIMARY KEY (draft_id, asset_item_id)
);
CREATE INDEX IF NOT EXISTS idx_shared_draft_assets_item ON shared_draft_assets(asset_item_id);

-- Narrações e mixagens já referenciadas por rascunhos antigos são arquivos
-- internos do projeto. Mantemos o item acessível ao rascunho, mas fora da
-- biblioteca compartilhada visível.
UPDATE media_items i
   SET visibility = 'project'
 WHERE visibility = 'library'
   AND EXISTS (
       SELECT 1
         FROM shared_drafts d
        WHERE d.org_id = i.org_id
          AND (
              d.data #>> '{adData,sharedNarrationAssetId}' = i.id::text
              OR d.data #>> '{adData,sharedMasterAssetId}' = i.id::text
          )
   );

-- Integração Mileto Ops. Estas tabelas guardam somente identidade, vínculos,
-- metadados sanitizados e credenciais cifradas; nunca bytes de mídia do Ops.
CREATE TABLE IF NOT EXISTS ops_connections (
    id                       UUID PRIMARY KEY,
    org_id                   BIGINT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    ops_account_id           TEXT,
    ops_account_name         TEXT,
    status                   TEXT NOT NULL DEFAULT 'pending', -- pending | active | revoked | error
    scopes                   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    access_token_enc         TEXT,
    access_token_expires_at  TIMESTAMPTZ,
    refresh_token_enc        TEXT,
    token_key_version        INTEGER NOT NULL DEFAULT 1,
    connected_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
    connected_at             TIMESTAMPTZ,
    revoked_at               TIMESTAMPTZ,
    last_error               TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_authorization_attempts (
    id                  UUID PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reconnect           BOOLEAN NOT NULL DEFAULT FALSE,
    connection_id       UUID REFERENCES ops_connections(id) ON DELETE SET NULL,
    state_hash          CHAR(64) NOT NULL UNIQUE,
    code_verifier_enc   TEXT NOT NULL,
    return_to           TEXT,
    expires_at          TIMESTAMPTZ NOT NULL,
    consumed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_auth_attempts_expiry ON ops_authorization_attempts(expires_at);

CREATE TABLE IF NOT EXISTS ops_user_links (
    id                   UUID PRIMARY KEY,
    org_id               BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id        UUID NOT NULL REFERENCES ops_connections(id) ON DELETE CASCADE,
    ai_user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ops_profile_id       TEXT NOT NULL,
    email_fingerprint    CHAR(64),
    status               TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | unlinked | conflict
    confirmed_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (connection_id, ai_user_id)
);
CREATE INDEX IF NOT EXISTS idx_ops_user_links_org ON ops_user_links(org_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_user_links_confirmed_profile
    ON ops_user_links(connection_id, ops_profile_id) WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS ops_sync_runs (
    id              UUID PRIMARY KEY,
    org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id   UUID NOT NULL REFERENCES ops_connections(id) ON DELETE CASCADE,
    started_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'running', -- running | completed | failed
    stats           JSONB NOT NULL DEFAULT '{}'::JSONB,
    error_code      TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ops_sync_runs_org_time ON ops_sync_runs(org_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ops_sync_conflicts (
    id                  UUID PRIMARY KEY,
    run_id              UUID NOT NULL REFERENCES ops_sync_runs(id) ON DELETE CASCADE,
    org_id              BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ai_user_id          BIGINT REFERENCES users(id) ON DELETE CASCADE,
    ops_profile_id      TEXT,
    email_fingerprint   CHAR(64),
    kind                TEXT NOT NULL, -- unique_match | ambiguous | ops_only | ai_only
    detail              JSONB NOT NULL DEFAULT '{}'::JSONB,
    resolved_at         TIMESTAMPTZ,
    resolved_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_sync_conflicts_open ON ops_sync_conflicts(org_id, created_at DESC)
    WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS external_media_references (
    id                  UUID PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id       UUID NOT NULL REFERENCES ops_connections(id) ON DELETE CASCADE,
    ops_account_id      TEXT NOT NULL,
    ops_company_id      TEXT NOT NULL,
    ops_folder_id       TEXT,
    ops_asset_id        TEXT NOT NULL,
    name                TEXT NOT NULL,
    kind                TEXT NOT NULL,
    mime_type           TEXT,
    size_bytes          BIGINT,
    mid                 TEXT,
    version             TEXT,
    checksum            TEXT,
    ops_updated_at      TIMESTAMPTZ,
    capabilities        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, connection_id, ops_asset_id)
);
CREATE INDEX IF NOT EXISTS idx_external_media_org ON external_media_references(org_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ops_audit_events (
    id                  UUID PRIMARY KEY,
    org_id              BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
    connection_id       UUID REFERENCES ops_connections(id) ON DELETE SET NULL,
    actor_user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action              TEXT NOT NULL,
    resource_type       TEXT,
    resource_id         TEXT,
    result              TEXT NOT NULL,
    request_id          TEXT,
    detail              JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_audit_org_time ON ops_audit_events(org_id, created_at DESC);
`;

/** Reset de desenvolvimento: derruba tudo e recria. NÃO usar com dados reais. */
export const RESET = `
DROP TABLE IF EXISTS ai_generation_jobs, ops_audit_events, external_media_references, ops_sync_conflicts, ops_sync_runs,
    ops_user_links, ops_authorization_attempts, ops_connections,
    shared_draft_assets, shared_drafts, media_items, shared_folders, media_blobs,
    org_title_generator_settings, org_agent_prompt_overrides,
    credit_events, settings, usage_ledger, credits, tokens, users, organizations CASCADE;
`;
