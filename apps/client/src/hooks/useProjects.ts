import { useState, useEffect, useCallback } from 'react';
import type { AdData, MediaTake, CaptionStyle } from '../types';

export interface DraftProject {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    format: string;
    thumbnail: string | null;
    adData: AdData;
    mediaTakes: (MediaTake & { fileMissing?: boolean })[];
    captionStyle: CaptionStyle | null;
    selectedMusicId: string | null;
}

// Robust IPC caller: tries contextBridge first, then falls back to direct require
const ipc = {
    invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
        // 1. Try contextBridge (preload.js exposes these)
        const api = (window as any).electronAPI;
        if (api) {
            switch (channel) {
                case 'projects-list':
                    return api.projectsList();
                case 'project-save':
                    return api.projectSave(args[0]);
                case 'project-delete':
                    return api.projectDelete(args[0]);
                case 'project-check-files':
                    return api.projectCheckFiles(args[0]);
            }
        }
        // 2. Fallback: direct ipcRenderer via nodeIntegration
        try {
            const { ipcRenderer } = (window as any).require('electron');
            return ipcRenderer.invoke(channel, ...args);
        } catch (err) {
            console.error('[IPC] Neither electronAPI nor require(electron) available', err);
            return null;
        }
    },
};

export const useProjects = () => {
    const [projects, setProjects] = useState<DraftProject[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            setLoading(true);
            const list = (await ipc.invoke('projects-list')) as DraftProject[] | null;
            setProjects(list || []);
        } catch (err) {
            console.error('[useProjects] Failed to list projects:', err);
            setProjects([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const saveProject = useCallback(async (project: Omit<DraftProject, 'createdAt'> & { createdAt?: string }) => {
        const now = new Date().toISOString();
        const full: DraftProject = {
            createdAt: now,
            ...project,
            updatedAt: now,
        };
        await ipc.invoke('project-save', full);
        setProjects((prev) => {
            const idx = prev.findIndex((p) => p.id === full.id);
            if (idx >= 0) {
                const next = [...prev];
                next[idx] = full;
                return next;
            }
            return [full, ...prev];
        });
        return full;
    }, []);

    const deleteProject = useCallback(async (projectId: string) => {
        await ipc.invoke('project-delete', projectId);
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
    }, []);

    const recheckFiles = useCallback(async (project: DraftProject): Promise<DraftProject> => {
        const checks = (await ipc.invoke(
            'project-check-files',
            project.mediaTakes.map((t) => ({ id: t.id, backendPath: t.backendPath }))
        )) as { id: string; fileMissing: boolean }[] | null;

        if (!checks) return project;
        const checkMap = new Map(checks.map((c) => [c.id, c.fileMissing]));
        return {
            ...project,
            mediaTakes: project.mediaTakes.map((t) => ({
                ...t,
                fileMissing: checkMap.get(t.id) ?? t.fileMissing ?? false,
            })),
        };
    }, []);

    return { projects, loading, refresh, saveProject, deleteProject, recheckFiles };
};
