import dns from 'dns/promises';
import net from 'net';
import fetch from 'node-fetch';
import { isSafeRemoteUrl } from '../utils/safePath';

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IFRAMES_PER_PAGE = 8;
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36';

export interface ResolvedHtmlMedia {
    mediaUrl: string;
    referer: string;
    title?: string;
    thumbnail?: string;
}

interface HtmlPage {
    url: string;
    html: string;
}

const decodeHtml = (value: string) =>
    value
        .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
        .replace(/&#x([\da-f]+);/gi, (_match, hexadecimal: string) =>
            String.fromCodePoint(Number.parseInt(hexadecimal, 16))
        )
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .trim();

const readAttribute = (tag: string, name: string): string | undefined => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = tag.match(
        new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
    );
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    return value ? decodeHtml(value) : undefined;
};

const isPrivateAddress = (address: string): boolean => {
    const normalized = address.toLowerCase().split('%')[0];
    const version = net.isIP(normalized);

    if (version === 4) {
        const [a, b] = normalized.split('.').map(Number);
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 198 && (b === 18 || b === 19)) ||
            a >= 224
        );
    }

    if (version === 6) {
        if (normalized.startsWith('::ffff:')) {
            return isPrivateAddress(normalized.slice('::ffff:'.length));
        }
        return (
            normalized === '::' ||
            normalized === '::1' ||
            normalized.startsWith('fc') ||
            normalized.startsWith('fd') ||
            /^fe[89ab]/.test(normalized)
        );
    }

    return true;
};

const assertPublicHttpUrl = async (rawUrl: string): Promise<URL> => {
    if (!isSafeRemoteUrl(rawUrl)) {
        throw new Error('O player apontou para uma URL inválida ou não permitida.');
    }

    const url = new URL(rawUrl);
    if (url.username || url.password) {
        throw new Error('URLs com credenciais embutidas não são permitidas.');
    }

    const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new Error('O player apontou para um endereço de rede não permitido.');
    }
    return url;
};

const fetchHtml = async (rawUrl: string, referer?: string): Promise<HtmlPage> => {
    let currentUrl = rawUrl;

    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        await assertPublicHttpUrl(currentUrl);
        const response = await fetch(currentUrl, {
            redirect: 'manual',
            size: MAX_HTML_BYTES,
            headers: {
                'user-agent': USER_AGENT,
                accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
                ...(referer ? { referer } : {}),
            },
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location || redirect === MAX_REDIRECTS) {
                throw new Error('O player redirecionou vezes demais.');
            }
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }

        if (!response.ok) {
            throw new Error(`O site recusou a leitura do player (${response.status}).`);
        }

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            throw new Error('O endereço não retornou uma página HTML compatível.');
        }

        const html = await response.text();
        if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
            throw new Error('A página do player ultrapassou o limite seguro de análise.');
        }
        return { url: currentUrl, html };
    }

    throw new Error('Não foi possível abrir a página do player.');
};

const resolvePageUrl = (value: string | undefined, pageUrl: string): string | undefined => {
    if (!value || /^(?:data|blob|javascript):/i.test(value)) return undefined;
    try {
        return new URL(value, pageUrl).toString();
    } catch {
        return undefined;
    }
};

const extractMeta = (html: string, names: Set<string>): string | undefined => {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const name = String(readAttribute(tag, 'property') || readAttribute(tag, 'name') || '').toLowerCase();
        if (!names.has(name)) continue;
        const content = readAttribute(tag, 'content');
        if (content) return content;
    }
    return undefined;
};

const extractTitle = (html: string): string | undefined => {
    const metaTitle = extractMeta(html, new Set(['og:title', 'twitter:title']));
    if (metaTitle) return decodeHtml(metaTitle).slice(0, 200);
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    return title ? decodeHtml(title.replace(/<[^>]+>/g, ' ')).slice(0, 200) : undefined;
};

const mediaExtensionPattern = /\.(?:mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|m3u8|mp3|m4a|aac|ogg|opus|wav|flac)(?:$|[?#])/i;

const extractDirectMedia = (html: string, pageUrl: string): string[] => {
    const candidates: string[] = [];
    const mediaTags = html.match(/<(?:video|audio|source)\b[^>]*>/gi) || [];
    for (const tag of mediaTags) {
        const src = resolvePageUrl(readAttribute(tag, 'src'), pageUrl);
        const type = String(readAttribute(tag, 'type') || '').toLowerCase();
        if (src && (type.startsWith('video/') || type.startsWith('audio/') || mediaExtensionPattern.test(src))) {
            candidates.push(src);
        }
    }

    const metaUrl = extractMeta(
        html,
        new Set(['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream'])
    );
    const resolvedMetaUrl = resolvePageUrl(metaUrl, pageUrl);
    if (resolvedMetaUrl) candidates.push(resolvedMetaUrl);

    return [...new Set(candidates)];
};

const extractIframes = (html: string, pageUrl: string): string[] => {
    const urls = (html.match(/<iframe\b[^>]*>/gi) || [])
        .map((tag) => resolvePageUrl(readAttribute(tag, 'src'), pageUrl))
        .filter((value): value is string => Boolean(value));
    return [...new Set(urls)].slice(0, MAX_IFRAMES_PER_PAGE);
};

const resolvePage = async (
    rawUrl: string,
    depth: number,
    visited: Set<string>,
    inheritedTitle?: string,
    inheritedThumbnail?: string,
    parentReferer?: string
): Promise<ResolvedHtmlMedia | null> => {
    if (visited.has(rawUrl)) return null;
    visited.add(rawUrl);

    const page = await fetchHtml(rawUrl, parentReferer);
    const title = extractTitle(page.html) || inheritedTitle;
    const thumbnail =
        resolvePageUrl(extractMeta(page.html, new Set(['og:image', 'twitter:image'])), page.url) || inheritedThumbnail;

    for (const mediaUrl of extractDirectMedia(page.html, page.url)) {
        try {
            await assertPublicHttpUrl(mediaUrl);
            return { mediaUrl, referer: page.url, title, thumbnail };
        } catch {
            // Ignora candidatos inválidos e tenta a próxima fonte declarada no player.
        }
    }

    if (depth >= 2) return null;
    const pageOrigin = new URL(page.url).origin;
    for (const iframeUrl of extractIframes(page.html, page.url)) {
        // O fallback HTML só atravessa frames do próprio site. Players externos
        // continuam a cargo dos extratores oficiais do yt-dlp.
        if (new URL(iframeUrl).origin !== pageOrigin) continue;
        try {
            const resolved = await resolvePage(
                iframeUrl,
                depth + 1,
                visited,
                title,
                thumbnail,
                page.url
            );
            if (resolved) return resolved;
        } catch {
            // Um frame quebrado não deve impedir a análise dos próximos players.
        }
    }

    return null;
};

export const isUnsupportedYtDlpUrl = (error: unknown): boolean =>
    error instanceof Error && /(?:unsupported url|no suitable extractor)/i.test(error.message);

export const resolveEmbeddedHtmlMedia = async (url: string): Promise<ResolvedHtmlMedia> => {
    const resolved = await resolvePage(url, 0, new Set());
    if (!resolved) {
        throw new Error(
            'Este site não possui um player de vídeo ou áudio que o Mileto consiga acessar com segurança.'
        );
    }
    return resolved;
};
