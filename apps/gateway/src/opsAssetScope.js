const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const invalidScope = () =>
    Object.assign(new Error('Escopo de pasta do Mileto Ops inválido.'), {
        status: 400,
        code: 'ops_folder_scope_invalid',
    });

/**
 * Contrato Ops v0.1.2:
 * undefined = busca global; root = raiz real; UUID = somente a pasta informada.
 */
export const normalizeOpsFolderScope = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value) || typeof value === 'object') throw invalidScope();
    const scope = String(value).trim();
    if (!scope) return undefined;
    if (scope === 'root') return 'root';
    if (!UUID.test(scope)) throw invalidScope();
    return scope;
};

