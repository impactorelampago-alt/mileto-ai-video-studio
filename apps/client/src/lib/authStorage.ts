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

export const authStorage = {
    async get(): Promise<string | null> {
        const ipc = getIpc();
        if (ipc) {
            try {
                return (await ipc.invoke('auth:get')) as string | null;
            } catch {
                /* cai para sessionStorage */
            }
        }
        try {
            return sessionStorage.getItem(SESSION_KEY);
        } catch {
            return null;
        }
    },

    async set(token: string): Promise<void> {
        const ipc = getIpc();
        if (ipc) {
            try {
                await ipc.invoke('auth:set', token);
                return;
            } catch {
                /* cai para sessionStorage */
            }
        }
        try {
            sessionStorage.setItem(SESSION_KEY, token);
        } catch {
            /* sem persistência disponível */
        }
    },

    async clear(): Promise<void> {
        const ipc = getIpc();
        if (ipc) {
            try {
                await ipc.invoke('auth:clear');
            } catch {
                /* ignora */
            }
        }
        try {
            sessionStorage.removeItem(SESSION_KEY);
        } catch {
            /* ignora */
        }
    },
};
