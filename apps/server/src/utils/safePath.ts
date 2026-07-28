import path from 'path';

/**
 * Utilitários de segurança de caminho e host.
 *
 * O servidor local roda com CORS aberto e recebe caminhos/URLs vindos do cliente.
 * Sem estas checagens, `path.join(base, entradaDoCliente)` com `../../..` escapa do
 * diretório de dados (leitura/escrita arbitrária) e `axios.get(urlDoCliente)` vira
 * SSRF (ler metadados de nuvem, varrer a rede interna). Centralizar aqui garante a
 * mesma proteção em todos os resolvers (stt, project, upload, audio, video, proxy).
 */

/** Resolve `segments` sob `base` e LANÇA se o resultado escapar de `base`. */
export function safeResolve(base: string, ...segments: string[]): string {
    const resolvedBase = path.resolve(base);
    const target = path.resolve(resolvedBase, ...segments.map((s) => String(s)));
    if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
        throw new Error('Caminho fora do diretório permitido.');
    }
    return target;
}

/** O caminho ABSOLUTO está contido em uma das raízes permitidas? (defesa contra clobber). */
export function isWithinRoots(target: string, roots: string[]): boolean {
    const resolved = path.resolve(String(target));
    return roots.some((r) => {
        const rr = path.resolve(r);
        return resolved === rr || resolved.startsWith(rr + path.sep);
    });
}

/** Segmento de nome seguro (projectId, etc.): só [A-Za-z0-9._-], sem separadores nem `..`. */
export function isSafeSegment(seg: unknown): seg is string {
    return typeof seg === 'string' && seg.length > 0 && seg !== '.' && seg !== '..' && /^[A-Za-z0-9._-]+$/.test(seg);
}

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./, /^172\.(1[6-9]|2\d|3[0-1])\./];

/**
 * URL http(s) apontando para host PÚBLICO? Bloqueia esquemas não-http, loopback,
 * faixas privadas e link-local (anti-SSRF). Não cobre DNS-rebinding (host público
 * que resolve para IP privado) — para mídia de CDN é proteção suficiente por ora.
 */
export function isSafeRemoteUrl(raw: string): boolean {
    let u: URL;
    try {
        u = new URL(String(raw));
    } catch {
        return false;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '::') return false;
    // IPv6 ULA (fc00::/7) e link-local (fe80::)
    if (host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && PRIVATE_V4.some((r) => r.test(host))) return false;
    return true;
}
