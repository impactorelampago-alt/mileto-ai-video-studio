-- Cofre pessoal de projetos e arquivos. Migração aditiva e idempotente.
BEGIN;

ALTER TABLE media_items DROP CONSTRAINT IF EXISTS media_items_visibility_check;
ALTER TABLE media_items ADD CONSTRAINT media_items_visibility_check
    CHECK (visibility IN ('library', 'project', 'backup'));

CREATE TABLE IF NOT EXISTS private_backup_projects (
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    data JSONB NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at TIMESTAMPTZ,
    purge_after TIMESTAMPTZ,
    PRIMARY KEY (org_id, user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_private_backup_projects_owner
    ON private_backup_projects(org_id, user_id, updated_at DESC) WHERE trashed_at IS NULL;

CREATE TABLE IF NOT EXISTS private_backup_files (
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id UUID NOT NULL,
    asset_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE RESTRICT,
    rel_path TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    source_mtime TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_private_backup_files_asset ON private_backup_files(asset_item_id);

CREATE TABLE IF NOT EXISTS private_backup_project_assets (
    org_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    project_id TEXT NOT NULL,
    asset_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE RESTRICT,
    PRIMARY KEY (org_id, user_id, project_id, asset_item_id),
    FOREIGN KEY (org_id, user_id, project_id)
        REFERENCES private_backup_projects(org_id, user_id, project_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_private_backup_project_assets_item
    ON private_backup_project_assets(asset_item_id);

COMMIT;
