const OPS_PRODUCTION_ORIGINS = [
    'https://miletoops.com',
    'https://apoloops.com',
] as const;

/**
 * Mantém a validação de mídia fechada, mas reconhece os dois domínios oficiais
 * durante a migração do Mileto Ops. Instalações com uma origem própria não
 * herdam essa exceção.
 */
export const opsMediaOriginsFor = (baseUrl: string): ReadonlySet<string> => {
    const configuredOrigin = new URL(baseUrl).origin;
    const allowedOrigins = new Set<string>([configuredOrigin]);
    if (OPS_PRODUCTION_ORIGINS.includes(configuredOrigin as typeof OPS_PRODUCTION_ORIGINS[number])) {
        OPS_PRODUCTION_ORIGINS.forEach((origin) => allowedOrigins.add(origin));
    }
    return allowedOrigins;
};
