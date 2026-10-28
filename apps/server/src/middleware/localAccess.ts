import { timingSafeEqual } from 'crypto';
import type { RequestHandler } from 'express';

export const LOCAL_ACCESS_HEADER = 'X-Mileto-Local-Token';
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

const sameToken = (provided: string | undefined, expected: string): boolean => {
    if (!provided || !expected) return false;
    const actual = Buffer.from(provided);
    const target = Buffer.from(expected);
    return actual.length === target.length && timingSafeEqual(actual, target);
};

export const localAccess = ({ token, allowDevBrowser = false }: {
    token: string;
    allowDevBrowser?: boolean;
}): RequestHandler => (req, res, next) => {
    const remote = req.socket.remoteAddress;
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (loopback && (sameToken(req.get(LOCAL_ACCESS_HEADER), token) || sameToken(req.get('X-Local-File-Import'), token))) {
        next();
        return;
    }

    // Desenvolvimento sem Electron: só o Vite local na porta prevista. Em
    // produção, ou quando há uma capacidade configurada, nunca há esta exceção.
    if (loopback && !token && allowDevBrowser) {
        const origin = req.get('Origin');
        let refererOrigin = '';
        try { refererOrigin = new URL(req.get('Referer') || '').origin; } catch { /* sem referer válido */ }
        if (origin ? DEV_ORIGINS.has(origin) : ['GET', 'HEAD'].includes(req.method) && DEV_ORIGINS.has(refererOrigin)) {
            next();
            return;
        }
    }
    res.status(401).json({ ok: false, code: 'LOCAL_ACCESS_DENIED', message: 'Acesso ao servidor local não autorizado.' });
};
