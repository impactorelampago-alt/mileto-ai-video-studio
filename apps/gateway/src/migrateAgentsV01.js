import { pool } from './db.js';

const SQL = `
CREATE TABLE IF NOT EXISTS ai_generation_jobs (
    id UUID PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    agent_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    media_kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitting',
    provider_task_id TEXT,
    result_url_enc TEXT,
    mime_type TEXT,
    prompt_hash CHAR(64) NOT NULL,
    reserved NUMERIC(14,4) NOT NULL DEFAULT 0,
    provider_cost NUMERIC(14,6) NOT NULL DEFAULT 0,
    charged NUMERIC(14,4) NOT NULL DEFAULT 0,
    billing_status TEXT NOT NULL DEFAULT 'reserved',
    usage_units BIGINT,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_org_time ON ai_generation_jobs(org_id, created_at DESC);
`;

try {
    await pool.query(SQL);
    console.log('[migrate:agents-v01] migration aditiva aplicada.');
} catch (error) {
    console.error('[migrate:agents-v01] falhou:', error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
