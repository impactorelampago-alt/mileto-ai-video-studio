import type { OpsVideoJob } from './gateway';

/** Empresa sintética usada pelo Ops para expor o Acervo Impacto à integração. */
export const OPS_SHARED_ARCHIVE_COMPANY_ID = 'ace70000-0000-4ace-8000-000000000001';

const record = (value: unknown): Record<string, unknown> | null => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
);

/**
 * A empresa do projeto continua sendo o destino do vídeo. Somente a leitura
 * dos takes muda para o Acervo Impacto quando o Ops congelou um pool shared.
 */
export const opsTakeSourceCompanyId = (
    job: Pick<OpsVideoJob, 'companyId' | 'settings'>,
): string => {
    const settings = record(job.settings);
    const takeSelection = record(settings?.takeSelection);
    return takeSelection?.sourceScope === 'shared'
        ? OPS_SHARED_ARCHIVE_COMPANY_ID
        : job.companyId;
};
