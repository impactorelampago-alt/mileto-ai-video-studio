import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    // ── Auto-update ───────────────────────────────────────────────
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateStatus: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('update-status', handler);
        return () => ipcRenderer.removeListener('update-status', handler);
    },

    // ── Project persistence ───────────────────────────────────────
    projectsList: () => ipcRenderer.invoke('projects-list'),
    projectSave: (project) => ipcRenderer.invoke('project-save', project),
    projectDelete: (projectId) => ipcRenderer.invoke('project-delete', projectId),
    projectCheckFiles: (takes) => ipcRenderer.invoke('project-check-files', takes),
});
