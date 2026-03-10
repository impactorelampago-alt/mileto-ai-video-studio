import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import type { AdData, MediaTake, CaptionStyle, ApiKeys, MusicTrack, CustomVoice } from '../types';
import type { DraftProject } from '../hooks/useProjects';

export const SHOW_DEBUG_FEATURES = true;

interface WizardContextType {
    apiKeys: ApiKeys;
    setApiKey: (_key: keyof ApiKeys, _value: string) => void;

    adData: AdData;
    updateAdData: (_data: Partial<AdData>) => void;

    mediaTakes: MediaTake[];
    setMediaTakes: React.Dispatch<React.SetStateAction<MediaTake[]>>;
    addMediaTake: (_take: MediaTake) => void;
    removeMediaTake: (_id: string) => void;

    captionStyle: CaptionStyle | null;
    setCaptionStyle: (_style: CaptionStyle) => void;

    musicLibrary: MusicTrack[];
    setMusicLibrary: React.Dispatch<React.SetStateAction<MusicTrack[]>>;
    selectedMusicId: string | null;
    setSelectedMusicId: (_id: string | null) => void;
    loadMusicLibrary: () => Promise<void>;

    projectId: string;
    saveProject: () => Promise<void>;
    loadProject: () => Promise<void>;
    loadDraft: (draft: DraftProject) => void;
    startNewProject: () => string;

    customVoices: CustomVoice[];
    addCustomVoice: (voice: CustomVoice) => void;
    removeCustomVoice: (id: string) => void;
    renameCustomVoice: (id: string, newName: string) => void;

    isDebugMode: boolean;
    setIsDebugMode: React.Dispatch<React.SetStateAction<boolean>>;
}

const DEFAULT_NARRATION_TEXT = '';

const defaultAdData: AdData = {
    title: '',
    format: '9:16',
    narrationText: DEFAULT_NARRATION_TEXT,
    selectedVoiceId: 'd7cdad0d54464bcfade4be58791c6f3d', // Thales Impacto
    narrationAudioUrl: null,
    narrationAudioPath: null,
    isNarrationGenerated: false,
    musicAudioUrl: null,
    audioConfig: {
        narration: {
            enabled: true,
            volume: 1,
            offsetSec: 0,
            trimStart: 0,
            fadeInSec: 0,
            fadeOutSec: 1, // Slight fade out for narration
        },
        background: {
            enabled: true,
            volume: 0.05, // Lower background volume
            offsetSec: 0,
            trimStart: 0,
            fadeInSec: 2, // Smooth fade in
            fadeOutSec: 2, // Smooth fade out
        },
    },
    globalTransition: null,
    transitionVolume: 1.0,
    transitionMuted: false,
};

const WizardContext = createContext<WizardContextType | undefined>(undefined);

export const WizardProvider = ({ children }: { children: ReactNode }) => {
    const [apiKeys, setApiKeys] = useState<ApiKeys>(() => {
        const defaults = {
            gemini: '',
            openai: '',
            fishAudio: '',
            replicate: '',
            runway: '',
        };
        try {
            const stored = localStorage.getItem('mileto_api_keys');
            if (stored) {
                const parsed = JSON.parse(stored);
                // Ensure properly merged object, handling null/non-object results
                if (parsed && typeof parsed === 'object') {
                    return {
                        gemini: parsed.gemini || defaults.gemini,
                        openai: parsed.openai || defaults.openai,
                        fishAudio: parsed.fishAudio || defaults.fishAudio,
                        replicate: parsed.replicate || defaults.replicate,
                        runway: parsed.runway || defaults.runway,
                    };
                }
            }
        } catch (error) {
            console.error('Failed to parse api keys', error);
        }
        return defaults;
    });

    const [adData, setAdData] = useState<AdData>(defaultAdData);
    const [mediaTakes, setMediaTakes] = useState<MediaTake[]>([]);

    // Default Caption Style is the new advanced Karaoke style
    const defaultCaptionStyle: CaptionStyle = {
        id: 'karaoke-dynamic',
        name: 'Karaokê Dinâmico',
        previewClass: '',
        fontFamily: 'Poppins',
        fontSize: 24,
        strokeWidth: 2,
        activeColor: '#FF0000', // Red
        baseColor: '#FFFFFF', // White
        strokeColor: '#000000', // Black
        verticalPosition: 15, // 15% from bottom by default
    };
    const [captionStyle, setCaptionStyle] = useState<CaptionStyle | null>(defaultCaptionStyle);
    const [musicLibrary, setMusicLibrary] = useState<MusicTrack[]>([]);
    const [selectedMusicId, setSelectedMusicIdState] = useState<string | null>(null);
    // Mutable project ID so startNewProject() can rotate it without remounting Provider
    const [projectId, setProjectId] = useState(() => {
        const stored = sessionStorage.getItem('mileto_current_project_id');
        if (stored) return stored;
        const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        sessionStorage.setItem('mileto_current_project_id', newId);
        return newId;
    });
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Only auto-save AFTER the user has changed something (not on mount)
    const isDirty = useRef(false);

    // Custom Voices (Persisted in LocalStorage)
    const [customVoices, setCustomVoices] = useState<CustomVoice[]>(() => {
        try {
            const stored = localStorage.getItem('mileto_custom_voices');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    });

    const addCustomVoice = (voice: CustomVoice) => {
        setCustomVoices((prev) => {
            const updated = [...prev, voice];
            localStorage.setItem('mileto_custom_voices', JSON.stringify(updated));
            return updated;
        });
    };

    const [isDebugMode, setIsDebugMode] = useState<boolean>(false);

    const removeCustomVoice = (id: string) => {
        setCustomVoices((prev) => {
            const updated = prev.filter((v) => v.id !== id);
            localStorage.setItem('mileto_custom_voices', JSON.stringify(updated));
            return updated;
        });
    };

    const renameCustomVoice = (id: string, newName: string) => {
        setCustomVoices((prev) => {
            const updated = prev.map((v) => (v.id === id ? { ...v, name: newName } : v));
            localStorage.setItem('mileto_custom_voices', JSON.stringify(updated));
            return updated;
        });
    };

    // ── IPC-based auto-save ──────────────────────────────────────────────
    const autoSaveViaIPC = React.useCallback(() => {
        // Dual-fallback: contextBridge first, then direct ipcRenderer
        const invokeProjectSave = (project: DraftProject) => {
            const api = (window as any).electronAPI;
            if (api?.projectSave) {
                return api.projectSave(project);
            }
            try {
                const { ipcRenderer } = (window as any).require('electron');
                return ipcRenderer.invoke('project-save', project);
            } catch (err) {
                console.error('[AutoSave] IPC not available:', err);
            }
        };

        const thumbnail = mediaTakes.length > 0 ? mediaTakes[0].url || mediaTakes[0].proxyUrl || null : null;

        const project: DraftProject = {
            id: projectId,
            title: adData.title || 'Projeto sem título',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            format: adData.format,
            thumbnail,
            adData,
            mediaTakes,
            captionStyle,
            selectedMusicId,
        };
        invokeProjectSave(project)?.catch((err: unknown) => {
            console.error('[AutoSave] Failed:', err);
        });
    }, [adData, mediaTakes, captionStyle, selectedMusicId, projectId]);

    // Debounced auto-save — only after user has changed something (isDirty)
    useEffect(() => {
        if (!isDirty.current) return; // skip initial mount
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => {
            autoSaveViaIPC();
        }, 2000);
        return () => {
            if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        };
    }, [autoSaveViaIPC]);

    // ── Persistence (legacy server-based, kept for dev fallback) ──────────
    const saveProject = React.useCallback(async () => {
        try {
            const payload = {
                adData,
                mediaTakes,
                captionStyle,
                selectedMusicId,
                updatedAt: new Date().toISOString(),
            };
            const res = await fetch(
                `${(window as any).API_BASE_URL || 'http://localhost:3301'}/api/projects/${projectId}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: payload }),
                }
            );
            const json = await res.json();
            if (!json.ok) throw new Error(json.message);
            console.log('Project saved:', json.message);
        } catch (err) {
            console.error('Failed to save project:', err);
        }
    }, [adData, mediaTakes, captionStyle, selectedMusicId, projectId]);

    const loadProject = React.useCallback(async () => {
        try {
            const res = await fetch(
                `${(window as any).API_BASE_URL || 'http://localhost:3301'}/api/projects/${projectId}`
            );
            if (res.status === 404) return; // New project, keep defaults

            const json = await res.json();
            if (json.ok && json.data) {
                const {
                    adData: loadedAd,
                    mediaTakes: loadedTakes,
                    captionStyle: loadedStyle,
                    selectedMusicId: loadedMusic,
                    updatedAt,
                } = json.data;

                if (loadedAd) setAdData((prev) => ({ ...prev, ...loadedAd }));
                if (loadedTakes) setMediaTakes(loadedTakes);
                if (loadedStyle) setCaptionStyle(loadedStyle);
                if (loadedMusic) setSelectedMusicIdState(loadedMusic);

                console.log('Project loaded, updated at:', updatedAt);
            }
        } catch (err) {
            console.error('Failed to load project:', err);
        }
    }, [projectId]);

    // ── Load a saved draft into wizard state ──────────────────────────────
    const loadDraft = React.useCallback((draft: DraftProject) => {
        if (draft.adData) setAdData((prev) => ({ ...prev, ...draft.adData }));
        if (draft.mediaTakes) setMediaTakes(draft.mediaTakes);
        if (draft.captionStyle) setCaptionStyle(draft.captionStyle);
        if (draft.selectedMusicId !== undefined) setSelectedMusicIdState(draft.selectedMusicId);
        // Rotate the projectId so auto-save targets this draft
        setProjectId(draft.id);
        sessionStorage.setItem('mileto_current_project_id', draft.id);
        isDirty.current = false; // don't auto-save immediately on load
    }, []);

    // ── Start a brand-new project (resets state + rotates ID) ─────────────
    const startNewProject = React.useCallback(() => {
        const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        setAdData(defaultAdData);
        setMediaTakes([]);
        setCaptionStyle(defaultCaptionStyle);
        setSelectedMusicIdState(null);
        setProjectId(newId);
        sessionStorage.setItem('mileto_current_project_id', newId);
        isDirty.current = false;
        return newId;
    }, []);

    // Load on mount
    useEffect(() => {
        loadProject();
    }, [loadProject]);

    const setApiKey = React.useCallback((key: keyof ApiKeys, value: string) => {
        setApiKeys((prev) => ({ ...prev, [key]: value }));
    }, []);

    const updateAdData = React.useCallback((data: Partial<AdData>) => {
        isDirty.current = true;
        setAdData((prev) => ({ ...prev, ...data }));
    }, []);

    const addMediaTake = React.useCallback((take: MediaTake) => {
        isDirty.current = true;
        const mutedTake = { ...take, muteOriginalAudio: true };
        setMediaTakes((prev) => [...prev, mutedTake]);
    }, []);

    const removeMediaTake = React.useCallback((id: string) => {
        isDirty.current = true;
        setMediaTakes((prev) => prev.filter((s) => s.id !== id));
    }, []);

    // Music library — fetch from backend
    const loadMusicLibrary = React.useCallback(async () => {
        try {
            const res = await fetch(`${(window as any).API_BASE_URL || 'http://localhost:3301'}/api/music/list`);
            const data = await res.json();
            if (data.ok) {
                setMusicLibrary(data.tracks);
            }
        } catch (err) {
            console.error('Failed to load music library', err);
        }
    }, []);

    // Load music library on mount
    useEffect(() => {
        loadMusicLibrary();
    }, [loadMusicLibrary]);

    // When selectedMusicId changes, update adData.musicAudioUrl
    const setSelectedMusicId = React.useCallback((id: string | null) => {
        isDirty.current = true;
        setSelectedMusicIdState(id);
        if (id) {
            setMusicLibrary((prev) => {
                const track = prev.find((t) => t.id === id);
                if (track) {
                    setAdData((ad) => ({
                        ...ad,
                        musicAudioUrl: `${(window as any).API_BASE_URL || 'http://localhost:3301'}${track.publicUrl}`,
                    }));
                }
                return prev;
            });
        } else {
            setAdData((ad) => ({ ...ad, musicAudioUrl: null }));
        }
    }, []);

    const contextValue = React.useMemo(
        () => ({
            apiKeys,
            setApiKey,
            adData,
            updateAdData,
            mediaTakes,
            setMediaTakes,
            addMediaTake,
            removeMediaTake,
            captionStyle,
            setCaptionStyle,
            musicLibrary,
            setMusicLibrary,
            selectedMusicId,
            setSelectedMusicId,
            loadMusicLibrary,
            projectId,
            saveProject,
            loadProject,
            loadDraft,
            startNewProject,
            customVoices,
            addCustomVoice,
            removeCustomVoice,
            renameCustomVoice,
            isDebugMode,
            setIsDebugMode,
        }),
        [
            apiKeys,
            setApiKey,
            adData,
            updateAdData,
            mediaTakes,
            addMediaTake,
            removeMediaTake,
            captionStyle,
            musicLibrary,
            selectedMusicId,
            setSelectedMusicId,
            loadMusicLibrary,
            projectId,
            saveProject,
            loadProject,
            loadDraft,
            startNewProject,
            customVoices,
            addCustomVoice,
            removeCustomVoice,
            renameCustomVoice,
            isDebugMode,
            setIsDebugMode,
        ]
    );

    return <WizardContext.Provider value={contextValue}>{children}</WizardContext.Provider>;
};

export const useWizard = () => {
    const context = useContext(WizardContext);
    if (context === undefined) {
        throw new Error('useWizard must be used within a WizardProvider');
    }
    return context;
};
