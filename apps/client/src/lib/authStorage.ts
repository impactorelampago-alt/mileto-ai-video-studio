/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Guarda o token de sessão do usuário.
 *
 * No app instalado (Electron), delega para o processo principal, que cifra o
 * token com safeStorage (DPAPI no Windows) num arquivo em userData — nunca fica
 * em texto no localStorage, que qualquer um lê abrindo o DevTools.
 *
 * No navegador (dev sem Electron), cai para sessionStorage: some ao fechar a
 * aba, o que é aceitável só para desenvolvimento.
 */

function getIpc(): any | null {
    try {
        const w = window as any;
        if (!w.require) return null;
        return w.require('electron').ipcRenderer || null;
    } catch {
        return null;
    }
}

const SESSION_KEY = 'mileto_auth_token';
let temporaryToken: string | null | undefined;
let revision = 0;

function temporary(): string | null | undefined {
    if (temporaryToken !== undefined) return temporaryToken;
    try {
        const value = sessionStorage.getItem(SESSION_KEY);
        if (value !== null) return value || null;
    } catch { /* a memória ainda funciona sem sessionStorage */ }
    return undefined;
}

function keepTemporary(token: string | null, persist = true): void {
    temporaryToken = token;
    // Vazio é uma marca de logout: não recuperar um token antigo se a remoção
    // do arquivo cifrado falhar e esta janela for recarregada.
    if (persist) {
        try { sessionStorage.setItem(SESSION_KEY, token || ''); } catch { /* só memória */ }
    }
}

function forgetTemporary(): void {
    temporaryToken = undefined;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* sem armazenamento */ }
}

export const authStorage = {
    async get(): Promise<string | null> {
        const fallback = temporary();
        if (fallback !== undefined) return fallback;
        const currentRevision = revision;
        const ipc = getIpc();
        if (ipc) {
            try {
                const value: unknown = await ipc.invoke('auth:get');
                if (revision !== currentRevision) return authStorage.get();
                return typeof value === 'string' && value ? value : null;
            } catch {
                /* cai para sessionStorage */
            }
        }
        return temporary() ?? null;
    },

    async set(token: string): Promise<void> {
        const currentRevision = ++revision;
        // Enquanto o IPC trabalha, use somente memória. O caminho normal com
        // safeStorage não precisa gravar uma cópia em sessionStorage.
        keepTemporary(token, false);
        const ipc = getIpc();
        if (ipc) {
            try {
                const saved: unknown = await ipc.invoke('auth:set', token);
                if (saved === true && revision === currentRevision) {
                    forgetTemporary();
                    return;
                }
            } catch {
                /* preserva o fallback temporário, inclusive quando o IPC retorna false */
            }
        }
        if (revision === currentRevision) keepTemporary(token);
    },

    async clear(expectedToken?: string): Promise<boolean> {
        const usedTemporary = temporary() !== undefined;
        if (expectedToken !== undefined) {
            const beforeRead = revision;
            const token = await authStorage.get();
            if (revision !== beforeRead || token !== expectedToken) return false;
        }
        const currentRevision = ++revision;
        keepTemporary(null);
        const ipc = getIpc();
        if (ipc) {
            try {
                const result: unknown = await ipc.invoke('auth:clear', expectedToken);
                if (revision !== currentRevision) return false;
                if (result === true) forgetTemporary();
                else if (result && typeof result === 'object' && 'reason' in result && result.reason === 'session-changed') {
                    if (usedTemporary) return true;
                    forgetTemporary();
                    return false;
                }
            } catch {
                /* a marca temporária impede recuperar a sessão encerrada */
            }
        } else {
            forgetTemporary();
        }
        return revision === currentRevision;
    },
};
