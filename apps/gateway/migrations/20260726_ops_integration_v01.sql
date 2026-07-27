BEGIN;

-- Evita duas ativações simultâneas da mesma integração.
SELECT pg_advisory_xact_lock(hashtext('mileto_gateway_ops_integration_v01'));

DO $$
BEGIN
    IF to_regclass('public.organizations') IS NULL OR to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION 'Pré-requisitos organizations/users ausentes; migration cancelada';
    END IF;
END
$$;

-- Somente identidade, vínculos, metadados sanitizados e credenciais cifradas.
-- Nenhum byte de mídia, grant ou signed URL do Ops é persistido aqui.
CREATE TABLE IF NOT EXISTS ops_connections (
    id                       UUID PRIMARY KEY,
    org_id                   BIGINT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    ops_account_id           TEXT,
    ops_account_name         TEXT,
    status                   TEXT NOT NULL DEFAULT 'pending',
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
    status               TEXT NOT NULL DEFAULT 'confirmed',
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
    status          TEXT NOT NULL DEFAULT 'running',
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
    kind                TEXT NOT NULL,
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
    org_id               BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
    connection_id        UUID REFERENCES ops_connections(id) ON DELETE SET NULL,
    actor_user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action              TEXT NOT NULL,
    resource_type       TEXT,
    resource_id         TEXT,
    result              TEXT NOT NULL,
    request_id          TEXT,
    detail              JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_audit_org_time ON ops_audit_events(org_id, created_at DESC);

COMMIT;
