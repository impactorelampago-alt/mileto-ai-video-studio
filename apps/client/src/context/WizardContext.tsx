import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { AdData, MediaTake, CaptionStyle, ApiKeys, MusicTrack, CustomVoice } from '../types';

export const SHOW_DEBUG_FEATURES = false;

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
            openai: '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',
            fishAudio: '6607173b195648c580bda6f4e15497de',
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
    const [selectedMusicId, setSelectedMusicIdState] = useState<string | null>(null); // Start with no music selected
    const [projectId] = useState('default');

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
    const saveProject = React.useCallback(async () => {
        try {
            const payload = {
                adData,
                mediaTakes,
                captionStyle,
                selectedMusicId,
                updatedAt: new Date().toISOString(),
            };
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${projectId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: payload }),
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.message);
            console.log('Project saved:', json.message);
        } catch (err) {
            console.error('Failed to save project:', err);
        }
    }, [adData, mediaTakes, captionStyle, selectedMusicId, projectId]);

    const loadProject = React.useCallback(async () => {
        try {
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${projectId}`);
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

    // Load on mount
    useEffect(() => {
        loadProject();
    }, [loadProject]);

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
                    setAdData((ad) => ({
                        ...ad,
                        musicAudioUrl: `${((window as any).API_BASE_URL || 'http://localhost:3301')}${track.publicUrl}`,
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
