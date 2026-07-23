/**
 * URL base do servidor local do Mileto.
 *
 * ATENÇÃO — NÃO volte a usar `import.meta.env.VITE_API_BASE_URL` direto.
 * O projeto não tem arquivo .env, então essa variável resolve para `undefined`
 * e a template string vira a URL literal "undefined/api/...", que o navegador
 * trata como caminho relativo. O resultado é uma requisição para
 * http://localhost:5173/undefined/api/... que devolve 404 — foi assim que o
 * Chat Mileto e a Biblioteca de Músicas ficaram quebrados.
 *
 * A ordem abaixo é a correta: o Electron injeta window.API_BASE_URL em runtime;
 * a env var fica como escape para builds customizados; e a porta 3301 é o padrão
 * que o electron-main usa ao subir o servidor.
 */
export const API_BASE_URL: string =
    (window as unknown as { API_BASE_URL?: string }).API_BASE_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:3301';

/** Monta uma URL absoluta a partir de um caminho como "/api/music/list". */
export const apiUrl = (path: string): string =>
    `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * URL base do GATEWAY na nuvem (contas, saldo, IA revendida).
 *
 * É um serviço DIFERENTE do servidor local (:3301): as chaves de IA e o controle
 * de créditos vivem aqui, no servidor, nunca no cliente. O app fala direto com o
 * gateway só para autenticação e conta; chat/narração/legendas passam pelo
 * servidor local (que preserva cache e sessões) e este reenvia ao gateway.
 */
export const GATEWAY_BASE_URL: string =
    (window as unknown as { GATEWAY_BASE_URL?: string }).GATEWAY_BASE_URL ||
    import.meta.env.VITE_GATEWAY_BASE_URL ||
    'https://api.miletoaivideo.com.br';

/** Monta uma URL absoluta do gateway a partir de um caminho como "/auth/me". */
export const gatewayUrl = (path: string): string =>
    `${GATEWAY_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
