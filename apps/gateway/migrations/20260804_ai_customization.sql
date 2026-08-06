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
