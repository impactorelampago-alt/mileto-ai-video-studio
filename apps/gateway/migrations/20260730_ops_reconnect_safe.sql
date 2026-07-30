-- Reconexão OAuth não deve substituir a conexão ativa até o novo grant ser
-- integralmente validado. O vínculo opcional fixa o mesmo registro durante o
-- callback e preserva todos os ops_user_links existentes.
ALTER TABLE ops_authorization_attempts
    ADD COLUMN IF NOT EXISTS reconnect BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ops_authorization_attempts
    ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES ops_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ops_auth_attempts_connection ON ops_authorization_attempts(connection_id);
