import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import type { AdData, MediaTake, CaptionStyle, ApiKeys, MusicTrack, CustomVoice } from '../types';

export const SHOW_DEBUG_FEATURES = false;

const ACTIVE_DRAFT_STORAGE_KEY = 'mileto_active_draft_id';

const generateDraftId = (): string => {
    try {
        // Disponível em navegadores modernos/Electron
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // fallthrough
    }
    return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

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
    saveProject: (_opts?: { exported?: boolean }) => Promise<void>;
    loadProject: () => Promise<void>;
    startNewDraft: () => string;
    loadDraft: (_id: string) => Promise<boolean>;
    hasDraftContent: () => boolean;

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
            fishAudio: 'b9b6ca3a75c940ad96cc7833bd803669',
            replicate: '',
            runway: '',
        };
        const EXPIRED_FISH_KEYS = new Set(['6607173b195648c580bda6f4e15497de']);
        const EXPIRED_OPENAI_KEYS = new Set([
            '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',
        ]);
        try {
            const stored = localStorage.getItem('mileto_api_keys');
            if (stored) {
                const parsed = JSON.parse(stored);
                // Ensure properly merged object, handling null/non-object results
                if (parsed && typeof parsed === 'object') {
                    const storedFish = EXPIRED_FISH_KEYS.has(parsed.fishAudio) ? '' : parsed.fishAudio;
                    const storedOpenai = EXPIRED_OPENAI_KEYS.has(parsed.openai) ? '' : parsed.openai;
                    return {
                        gemini: parsed.gemini || defaults.gemini,
                        openai: storedOpenai || defaults.openai,
                        fishAudio: storedFish || defaults.fishAudio,
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
    const [selectedMusicId, setSelectedMusicIdState] = useState<string | null>(null); // Start with no music selected
    const [projectId, setProjectId] = useState<string>(() => {
        // Sobrevive ao refresh do Electron: se havia um rascunho ativo, reuso o id.
        try {
            const stored = localStorage.getItem(ACTIVE_DRAFT_STORAGE_KEY);
            if (stored) return stored;
        } catch {
            // ignore
        }
        const fresh = generateDraftId();
        try {
            localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, fresh);
        } catch {
            // ignore
        }
        return fresh;
    });

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

    // ── Persistence ────────────────────────────────────────────────
    // Refs espelham o estado mais recente — evita closures stale quando
    // saveProject é chamado fora de React (ex.: no unmount do wizard).
    const stateRef = useRef({ projectId, adData, mediaTakes, captionStyle, selectedMusicId });
    useEffect(() => {
        stateRef.current = { projectId, adData, mediaTakes, captionStyle, selectedMusicId };
    });

    const hasDraftContent = React.useCallback(() => {
        const s = stateRef.current;
        return (
            !!s.adData.title?.trim() ||
            !!s.adData.narrationText?.trim() ||
            s.mediaTakes.length > 0 ||
            (s.adData.captions?.segments?.length ?? 0) > 0 ||
            (s.adData.dynamicTitles?.length ?? 0) > 0
        );
    }, []);

    const saveProject = React.useCallback(async (opts?: { exported?: boolean }) => {
        const s = stateRef.current;
        const exported = !!opts?.exported;
        // Não criar rascunhos vazios (só salva se houver conteúdo OU se for export).
        if (!exported && !hasDraftContent()) return;

        const title =
            s.adData.title?.trim() ||
            s.adData.narrationText?.trim().slice(0, 60) ||
            'Rascunho sem título';

        try {
            const payload = {
                adData: s.adData,
                mediaTakes: s.mediaTakes,
                captionStyle: s.captionStyle,
                selectedMusicId: s.selectedMusicId,
                updatedAt: new Date().toISOString(),
                exported,
                title,
            };
            const res = await fetch(
                `${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${s.projectId}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: payload }),
                }
            );
            const json = await res.json();
            if (!json.ok) throw new Error(json.message);
            console.log(`[Draft] Salvo (${exported ? 'exportado' : 'rascunho'}):`, s.projectId);
        } catch (err) {
            console.error('Failed to save project:', err);
        }
    }, [hasDraftContent]);

    const applyLoadedDraft = React.useCallback((data: {
        adData?: Partial<AdData>;
        mediaTakes?: MediaTake[];
        captionStyle?: CaptionStyle | null;
        selectedMusicId?: string | null;
    }) => {
        if (data.adData) setAdData({ ...defaultAdData, ...data.adData });
        setMediaTakes(Array.isArray(data.mediaTakes) ? data.mediaTakes : []);
        if (data.captionStyle) setCaptionStyle(data.captionStyle);
        setSelectedMusicIdState(data.selectedMusicId ?? null);
    }, []);

    const loadProject = React.useCallback(async () => {
        try {
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${projectId}`);
            if (res.status === 404) return;

            const json = await res.json();
            if (json.ok && json.data) {
                applyLoadedDraft(json.data);
                console.log('Project loaded, updated at:', json.data.updatedAt);
            }
        } catch (err) {
            console.error('Failed to load project:', err);
        }
    }, [projectId, applyLoadedDraft]);

    const loadDraft = React.useCallback(async (id: string): Promise<boolean> => {
        try {
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${id}`);
            if (!res.ok) return false;
            const json = await res.json();
            if (!json.ok || !json.data) return false;

            setProjectId(id);
            try {
                localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, id);
            } catch {
                // ignore
            }
            applyLoadedDraft(json.data);
            return true;
        } catch (err) {
            console.error('Failed to load draft:', err);
            return false;
        }
    }, [applyLoadedDraft]);

    const startNewDraft = React.useCallback((): string => {
        const newId = generateDraftId();
        setProjectId(newId);
        try {
            localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, newId);
        } catch {
            // ignore
        }
        setAdData(defaultAdData);
        setMediaTakes([]);
        setCaptionStyle(defaultCaptionStyle);
        setSelectedMusicIdState(null);
        return newId;
    }, [defaultCaptionStyle]);

    // Tenta recuperar o rascunho ativo no mount (sobrevive a refresh do Electron).
    // Se não existir no servidor (404), mantém os defaults — é um projeto novo.
    useEffect(() => {
        loadProject();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Persist API keys whenever they change
    useEffect(() => {
        try {
            localStorage.setItem('mileto_api_keys', JSON.stringify(apiKeys));
        } catch (error) {
            console.error('Failed to persist api keys', error);
        }
    }, [apiKeys]);

    const setApiKey = React.useCallback((key: keyof ApiKeys, value: string) => {
        setApiKeys((prev) => ({ ...prev, [key]: value }));
    }, []);

    const updateAdData = React.useCallback((data: Partial<AdData>) => {
        setAdData((prev) => ({ ...prev, ...data }));
    }, []);

    const addMediaTake = React.useCallback((take: MediaTake) => {
        // Automatically mute all new takes per user request
        const mutedTake = { ...take, muteOriginalAudio: true };
        setMediaTakes((prev) => [...prev, mutedTake]);
    }, []);

    const removeMediaTake = React.useCallback((id: string) => {
        setMediaTakes((prev) => prev.filter((s) => s.id !== id));
    }, []);

    // Music library — fetch from backend
    const loadMusicLibrary = React.useCallback(async () => {
        try {
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/music/list`);
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
        setSelectedMusicIdState(id);
        if (id) {
            setMusicLibrary((prev) => {
                const track = prev.find((t) => t.id === id);
                if (track) {
                    const isAbsolute = /^https?:\/\//.test(track.publicUrl);
                    setAdData((ad) => ({
                        ...ad,
                        musicAudioUrl: isAbsolute
                            ? track.publicUrl
                            : `${((window as any).API_BASE_URL || 'http://localhost:3301')}${track.publicUrl}`,
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
            startNewDraft,
            loadDraft,
            hasDraftContent,
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
            startNewDraft,
            loadDraft,
            hasDraftContent,
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
