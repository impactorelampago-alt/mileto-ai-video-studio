const OPS_PRODUCTION_ORIGINS = Object.freeze([
    'https://miletoops.com',
    'https://apoloops.com',
]);

/**
 * Mantém a validação de mídia fechada, mas reconhece os dois domínios oficiais
 * durante a migração do Mileto Ops. Instalações com uma origem própria não
 * herdam essa exceção.
 */
export const opsMediaOriginsFor = (baseUrl) => {
    const configuredOrigin = new URL(String(baseUrl)).origin;
    const allowedOrigins = new Set([configuredOrigin]);
    if (OPS_PRODUCTION_ORIGINS.includes(configuredOrigin)) {
        OPS_PRODUCTION_ORIGINS.forEach((origin) => allowedOrigins.add(origin));
    }
    return allowedOrigins;
};
