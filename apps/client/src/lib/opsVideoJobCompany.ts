import type { OpsVideoJob } from './gateway';
import type { BrandPalette } from '../types';

export type OpsVideoJobProjectCompany = {
    id: string;
    name: string;
    source: 'mileto_ops_company';
    /** Paleta pronta enviada pelo Ops (hex, até 6; 1ª = principal). Opcional. */
    palette?: string[];
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Paleta inline do job (settings.projectCompany.palette). Elimina a dependência
 * do contexto de visão para pintar legendas e títulos: o Ops envia as cores
 * exatas da empresa junto do job. Entradas inválidas são descartadas
 * individualmente; sem nenhuma cor válida, retorna null (comportamento atual).
 */
export const paletteFromOpsProjectCompany = (settings: unknown): BrandPalette | null => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
    const company = (settings as Record<string, unknown>).projectCompany;
    if (!company || typeof company !== 'object' || Array.isArray(company)) return null;
    const raw = (company as Record<string, unknown>).palette;
    if (!Array.isArray(raw)) return null;
    const colors = Array.from(new Set(
        raw
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim().toLowerCase())
            .filter((value) => HEX_COLOR.test(value))
    )).slice(0, 6);
    if (!colors.length) return null;
    return {
        primary: colors[0],
        secondary: colors[1] ?? colors[0],
        tertiary: colors[2] ?? colors[1] ?? colors[0],
        all: colors,
    };
};

export type OpsVideoJobCompanyResolution = {
    id: string;
    name?: string;
    source: 'mileto_ops_company' | 'legacy_job_company_id';
    authoritative: boolean;
    fallbackUsed: boolean;
    fallbackReason?: 'settings.projectCompany_absent';
    legacyCompanyId?: string;
};

export type OpsVideoJobCompanyContractError = {
    code: 'ops_project_company_invalid' | 'ops_project_company_missing';
    message: string;
};

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const nonEmptyString = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/**
 * Resolve a empresa que pertence ao projeto do job.
 *
 * `settings.projectCompany` e autoritativo quando o campo existe. Um contrato
 * presente, mas malformado, nunca pode cair para `job.companyId`, pois esse ID
 * legado pode representar a agencia/conta que enviou o trabalho.
 */
export const resolveOpsVideoJobCompany = (
    job: Pick<OpsVideoJob, 'companyId' | 'settings'>,
): OpsVideoJobCompanyResolution => {
    const settings = job.settings && typeof job.settings === 'object' && !Array.isArray(job.settings)
        ? job.settings
        : {};
    const hasProjectCompany = own(settings, 'projectCompany');

    if (hasProjectCompany) {
        const candidate = settings.projectCompany;
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            throw new Error(
                'ops_project_company_invalid: settings.projectCompany foi enviado, mas nao e um objeto valido. O fallback legado foi bloqueado.',
            );
        }
        const source = candidate as Record<string, unknown>;
        const id = nonEmptyString(source.id);
        const name = nonEmptyString(source.name);
        if (!id || !name || source.source !== 'mileto_ops_company') {
            throw new Error(
                'ops_project_company_invalid: settings.projectCompany deve conter id, name e source="mileto_ops_company". O fallback legado foi bloqueado.',
            );
        }
        return {
            id,
            name,
            source: 'mileto_ops_company',
            authoritative: true,
            fallbackUsed: false,
            legacyCompanyId: nonEmptyString(job.companyId) || undefined,
        };
    }

    const legacyCompanyId = nonEmptyString(job.companyId);
    if (!legacyCompanyId) {
        throw new Error(
            'ops_project_company_missing: O job nao informou settings.projectCompany nem o companyId legado.',
        );
    }
    return {
        id: legacyCompanyId,
        source: 'legacy_job_company_id',
        authoritative: false,
        fallbackUsed: true,
        fallbackReason: 'settings.projectCompany_absent',
        legacyCompanyId,
    };
};

/**
 * Normaliza o job assim que ele entra no cliente. Isso garante que todos os
 * consumidores existentes de `job.companyId` usem a empresa do projeto, sem
 * depender da agencia, da conta atual ou do ultimo projeto aberto.
 */
export const normalizeOpsVideoJobProjectCompany = (job: OpsVideoJob): OpsVideoJob => {
    try {
        const projectCompanyResolution = resolveOpsVideoJobCompany(job);
        return {
            ...job,
            companyId: projectCompanyResolution.id,
            projectCompanyResolution,
            projectCompanyContractError: undefined,
        };
    } catch (error) {
        // A leitura do job precisa sobreviver para o executor conseguir fazer o
        // claim e devolver a falha estruturada ao Ops. O preflight bloqueia
        // qualquer uso de `companyId` enquanto este erro estiver presente.
        const message = error instanceof Error ? error.message : 'ops_project_company_invalid: Contrato de empresa invalido.';
        const match = message.match(/^(ops_project_company_invalid|ops_project_company_missing):\s*(.+)$/i);
        return {
            ...job,
            projectCompanyResolution: undefined,
            projectCompanyContractError: {
                code: (match?.[1] || 'ops_project_company_invalid') as OpsVideoJobCompanyContractError['code'],
                message: match?.[2] || message,
            },
        };
    }
};
