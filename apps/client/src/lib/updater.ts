/* eslint-disable @typescript-eslint/no-explicit-any */

export type UpdateStatus =
    | { type: 'idle' }
    | { type: 'checking' }
    | { type: 'available'; version: string }
    | { type: 'not-available'; version?: string }
    | { type: 'progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
    | { type: 'downloaded'; version: string }
    | { type: 'error'; message: string };

function getIpc(): any | null {
    try {
        const w = window as any;
        if (!w.require) return null;
        const electron = w.require('electron');
        return electron.ipcRenderer || null;
    } catch {
        return null;
    }
}

export const updater = {
    isAvailable(): boolean {
        return !!getIpc();
    },
    async check() {
        const ipc = getIpc();
        if (!ipc) return { ok: false, message: 'Auto-update disponível apenas no app instalado.' };
        return ipc.invoke('update:check') as Promise<{ ok: boolean; message?: string; currentVersion?: string; updateInfo?: { version: string; releaseDate: string } | null }>;
    },
    async download() {
        const ipc = getIpc();
        if (!ipc) return { ok: false, message: 'IPC indisponível' };
        return ipc.invoke('update:download') as Promise<{ ok: boolean; message?: string }>;
    },
    async install() {
        const ipc = getIpc();
        if (!ipc) return { ok: false, message: 'IPC indisponível' };
        return ipc.invoke('update:install') as Promise<{ ok: boolean }>;
    },
    async getCurrentVersion(): Promise<string | null> {
        const ipc = getIpc();
        if (!ipc) return null;
        return ipc.invoke('update:get-current-version');
    },
    onStatus(listener: (s: UpdateStatus) => void): () => void {
        const ipc = getIpc();
        if (!ipc) return () => {};
        const handler = (_e: unknown, payload: UpdateStatus) => listener(payload);
        ipc.on('update:status', handler);
        return () => ipc.removeListener('update:status', handler);
    },
};
