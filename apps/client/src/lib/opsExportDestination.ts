export const OPS_EXPORT_DEFAULT_FOLDER_NAME = 'VÍDEOS PRONTOS (ANÚNCIO)';

type OpsFolderCandidate = {
    id: string;
    name: string;
    parentId?: string | null;
};

type OpsCompanyCandidate = {
    id: string;
    kind?: string;
};

export const normalizeOpsFolderName = (name: string) => name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('pt-BR');

export const findDefaultOpsExportFolder = <T extends OpsFolderCandidate>(folders: T[]): T | null => {
    const expected = normalizeOpsFolderName(OPS_EXPORT_DEFAULT_FOLDER_NAME);
    const roots = folders.filter((folder) => folder.parentId == null);
    const exact = roots.filter((folder) => normalizeOpsFolderName(folder.name) === expected);
    return exact.length === 1 ? exact[0] : null;
};

export const findProjectOpsExportCompany = <T extends OpsCompanyCandidate>(
    companies: T[],
    projectCompanyId: string,
): T | null => companies.find((company) => company.id === projectCompanyId && company.kind !== 'archive') || null;
