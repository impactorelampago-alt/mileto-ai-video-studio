-- Promove a configuração visual validada pela Impacto Relampago a padrão Mileto.
-- O gateway normaliza o JSON para a versão vigente ao lê-lo. Organizações podem
-- continuar criando sua própria sobreposição ou voltar a este padrão global.
INSERT INTO settings (key, value, updated_at)
SELECT
    'title_generator_config',
    organization_config.config::text,
    now()
FROM (
    SELECT title_settings.config
      FROM org_title_generator_settings title_settings
      JOIN organizations organization
        ON organization.id = title_settings.org_id
     WHERE organization.name = 'Impacto Relampago'
     ORDER BY title_settings.updated_at DESC
     LIMIT 1
) AS organization_config
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;
