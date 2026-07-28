import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import type { AdData, MediaTake, CaptionStyle, ApiKeys, MusicTrack, CustomVoice } from '../types';
import { gatewayApi, type SharedAsset } from '../lib/gateway';
import { localAuthHeaders } from '../lib/serverAuth';
import { API_BASE_URL } from '../lib/apiBase';

export const SHOW_DEBUG_FEATURES = false;

// Geração de imagem e vídeo por IA fica DESLIGADA no v1. Volta numa versão
// futura com as APIs trocadas (vídeo=Seedance, imagem=Banana/Gemini) —
// ver ROADMAP-IMAGEM-VIDEO.md. Basta virar para true quando reativar.
export const ENABLE_MEDIA_AI = false;

const ACTIVE_DRAFT_STORAGE_KEY = 'mileto_active_draft_id';
const ACTIVE_DRAFT_SCOPE_KEY = 'mileto_active_draft_scope';

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
    addMediaTakes: (_takes: MediaTake[]) => void;
    removeMediaTake: (_id: string) => void;
    clearMediaTakes: () => void;

    captionStyle: CaptionStyle | null;
    setCaptionStyle: (_style: CaptionStyle) => void;

    musicLibrary: MusicTrack[];
    setMusicLibrary: React.Dispatch<React.SetStateAction<MusicTrack[]>>;
    selectedMusicId: string | null;
    setSelectedMusicId: (_id: string | null) => void;
    loadMusicLibrary: () => Promise<void>;

    projectId: string;
    draftScope: 'local' | 'shared';
    setDraftScope: (_scope: 'local' | 'shared') => void;
    draftTitle: string;
    setDraftTitle: (_title: string) => void;
    saveProject: (_opts?: { exported?: boolean; keepalive?: boolean; lastStep?: number }) => Promise<boolean>;
    loadProject: () => Promise<void>;
    startNewDraft: (_opts?: { scope?: 'local' | 'shared'; title?: string }) => string;
    loadDraft: (_id: string, _scope?: 'local' | 'shared') => Promise<number | null>;
    publishDraftToShared: (_id: string) => Promise<boolean>;
    hasDraftContent: () => boolean;

    customVoices: CustomVoice[];
    addCustomVoice: (voice: CustomVoice) => void;
    removeCustomVoice: (id: string) => void;
    renameCustomVoice: (id: string, newName: string) => void;

    isDebugMode: boolean;
    setIsDebugMode: React.Dispatch<React.SetStateAction<boolean>>;
}

type LoadedDraftData = {
    title?: string;
    adData?: Partial<AdData>;
    mediaTakes?: MediaTake[];
    captionStyle?: CaptionStyle | null;
    selectedMusicId?: string | null;
    exported?: boolean;
    saveRevision?: number;
    lastStep?: number;
};

const serializeTakeForDraft = (take: MediaTake): MediaTake => {
    const { file: _localFile, ...serializableTake } = take;
    void _localFile;
    if (take.externalMedia?.source !== 'mileto_ops') return serializableTake;
    return {
        ...serializableTake,
        // URLs-capability e caminhos do cache pertencem somente a este PC.
        url: '',
        fileUrl: '',
        proxyUrl: '',
        backendPath: undefined,
        externalMedia: { ...take.externalMedia, cacheId: null },
    };
};

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

const mergeAdData = (data?: Partial<AdData>): AdData => ({
    ...defaultAdData,
    ...(data || {}),
    audioConfig: {
        narration: {
            ...defaultAdData.audioConfig.narration,
            ...(data?.audioConfig?.narration || {}),
        },
        background: {
            ...defaultAdData.audioConfig.background,
            ...(data?.audioConfig?.background || {}),
        },
    },
});

const WizardContext = createContext<WizardContextType | undefined>(undefined);

export const WizardProvider = ({ children }: { children: ReactNode }) => {
    const [apiKeys, setApiKeys] = useState<ApiKeys>(() => {
        // NENHUMA chave chumbada aqui. Este arquivo vai para o Git e é empacotado
        // no instalador — um app Electron não guarda segredo, qualquer pessoa abre
        // o .asar e lê. Chave entra só pelo modal de Configurações.
        const defaults = {
            gemini: '',
            openai: '',
            fishAudio: '',
            elevenLabs: '',
            replicate: '',
            runway: '',
            seedance: '',
        };

        // Chaves que já vazaram no histórico do Git: se estiverem salvas na máquina
        // de alguém, são apagadas na inicialização para forçar a troca.
        const REVOKED_FISH_KEYS = new Set([
            '6607173b195648c580bda6f4e15497de',
            'b9b6ca3a75c940ad96cc7833bd803669',
        ]);
        const REVOKED_OPENAI_KEYS = new Set([
            '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',
        ]);
        try {
            const stored = localStorage.getItem('mileto_api_keys');
            if (stored) {
                const parsed = JSON.parse(stored);
                // Ensure properly merged object, handling null/non-object results
                if (parsed && typeof parsed === 'object') {
                    const storedFish = REVOKED_FISH_KEYS.has(parsed.fishAudio) ? '' : parsed.fishAudio;
                    const storedOpenai = REVOKED_OPENAI_KEYS.has(parsed.openai) ? '' : parsed.openai;
                    return {
                        gemini: parsed.gemini || defaults.gemini,
                        openai: storedOpenai || defaults.openai,
                        fishAudio: storedFish || defaults.fishAudio,
                        elevenLabs: parsed.elevenLabs || defaults.elevenLabs,
                        replicate: parsed.replicate || defaults.replicate,
                        runway: parsed.runway || defaults.runway,
                        seedance: parsed.seedance || defaults.seedance,
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
    const [draftScopeState, setDraftScopeState] = useState<'local' | 'shared'>(() => {
        try {
            return localStorage.getItem(ACTIVE_DRAFT_SCOPE_KEY) === 'shared' ? 'shared' : 'local';
        } catch {
            return 'local';
        }
    });
    const [draftTitle, setDraftTitle] = useState('');
    const sharedAssetCacheRef = useRef(new Map<string, SharedAsset>());
    const initialDraftLoadCompleteRef = useRef(false);
    const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveRevisionRef = useRef(Date.now() * 1000);
    const lastSavedFingerprintRef = useRef('');
    // Garante a mesma ordem de gravação para rascunhos locais e compartilhados.
    // Sem a fila, uma sincronização de mídia mais lenta podia terminar depois de
    // uma edição recente e sobrescrever a linha do tempo nova com estado antigo.
    const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));

    const setDraftScope = React.useCallback((scope: 'local' | 'shared') => {
        setDraftScopeState(scope);
        try {
            localStorage.setItem(ACTIVE_DRAFT_SCOPE_KEY, scope);
        } catch {
            // ignore
        }
    }, []);

    // Custom Voices (Persisted in LocalStorage)
    const [customVoices, setCustomVoices] = useState<CustomVoice[]>(() => {
        try {
            const stored = localStorage.getItem('mileto_custom_voices');
            const parsed: CustomVoice[] = stored ? JSON.parse(stored) : [];
            // Vozes salvas antes do suporte multi-provedor são todas da Fish Audio.
            return parsed.map((v) => ({ ...v, provider: v.provider ?? 'fishAudio' }));
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
    const stateRef = useRef({ projectId, adData, mediaTakes, captionStyle, selectedMusicId, draftScope: draftScopeState, draftTitle });
    useEffect(() => {
        stateRef.current = { projectId, adData, mediaTakes, captionStyle, selectedMusicId, draftScope: draftScopeState, draftTitle };
    });

    const hasDraftContent = React.useCallback(() => {
        const s = stateRef.current;
        return (
            !!s.draftTitle.trim() ||
            !!s.adData.title?.trim() ||
            !!s.adData.narrationText?.trim() ||
            s.mediaTakes.length > 0 ||
            (s.adData.captions?.segments?.length ?? 0) > 0 ||
            (s.adData.dynamicTitles?.length ?? 0) > 0
        );
    }, []);

    const importLocalAsset = React.useCallback(async (input: {
        sourceUrl?: string | null;
        backendPath?: string | null;
        name: string;
        parent: 'Músicas' | 'Imagens' | 'Vídeos';
    }): Promise<SharedAsset> => {
        const cacheKey = input.backendPath || input.sourceUrl || '';
        const cached = sharedAssetCacheRef.current.get(cacheKey);
        if (cached) return cached;

        const headers = { ...(await localAuthHeaders()), 'Content-Type': 'application/json' };
        const response = await fetch(`${API_BASE_URL}/api/shared/files/import-local`, {
            method: 'POST',
            headers,
            body: JSON.stringify(input),
        });
        const result = await response.json();
        if (!response.ok || !result.ok || !result.entry) {
            throw new Error(result.message || 'Falha ao compartilhar a mídia local.');
        }
        const entry = result.entry as SharedAsset;
        if (cacheKey) sharedAssetCacheRef.current.set(cacheKey, entry);
        return entry;
    }, []);

    const isLocalMedia = (url?: string | null, backendPath?: string | null) => {
        if (backendPath) return true;
        if (!url) return false;
        if (url.startsWith('/') || /^(blob:|file:)/i.test(url)) return true;
        try {
            const host = new URL(url).hostname.toLowerCase();
            return host === 'localhost' || host === '127.0.0.1' || host === '::1';
        } catch {
            return false;
        }
    };

    const fileNameFrom = (url: string | null | undefined, fallback: string) => {
        if (!url) return fallback;
        try {
            return decodeURIComponent(new URL(url, 'http://localhost').pathname.split('/').pop() || fallback);
        } catch {
            return fallback;
        }
    };

    const prepareSharedPayload = React.useCallback(async (payload: {
        adData: AdData;
        mediaTakes: MediaTake[];
        captionStyle: CaptionStyle | null;
        selectedMusicId: string | null;
        updatedAt: string;
        exported: boolean;
        title: string;
    }) => {
        const nextAd = { ...payload.adData };

        const syncAudio = async (
            urlKey: 'narrationAudioUrl' | 'musicAudioUrl' | 'masterAudioUrl',
            idKey: 'sharedNarrationAssetId' | 'sharedMusicAssetId' | 'sharedMasterAssetId',
            fallbackName: string,
            backendPath?: string | null,
        ) => {
            const sourceUrl = nextAd[urlKey];
            if (isLocalMedia(sourceUrl, backendPath)) {
                const entry = await importLocalAsset({
                    sourceUrl,
                    backendPath,
                    name: fileNameFrom(sourceUrl, fallbackName),
                    parent: 'Músicas',
                });
                nextAd[urlKey] = entry.publicUrl;
                nextAd[idKey] = entry.id;
                return entry;
            }
            return null;
        };

        await syncAudio(
            'narrationAudioUrl',
            'sharedNarrationAssetId',
            'narracao.mp3',
            nextAd.narrationAudioPath,
        );
        const musicEntry = await syncAudio('musicAudioUrl', 'sharedMusicAssetId', 'musica.mp3');
        await syncAudio('masterAudioUrl', 'sharedMasterAssetId', 'mixagem.mp3');
        if (!musicEntry && nextAd.musicAudioUrl && payload.selectedMusicId) {
            nextAd.sharedMusicAssetId = payload.selectedMusicId;
        }
        nextAd.narrationAudioPath = null;

        const nextTakes = await Promise.all(payload.mediaTakes.map(async (take) => {
            const serializableTake = serializeTakeForDraft(take);
            // Ativos do Ops permanecem referências externas. Copiá-los para o R2
            // do AI Video exige uma ação futura, separada e explícita do usuário.
            if (take.externalMedia?.source === 'mileto_ops') return serializableTake;
            const sourceUrl = take.fileUrl || take.url;
            if (!isLocalMedia(sourceUrl, take.backendPath)) return serializableTake;
            const entry = await importLocalAsset({
                sourceUrl,
                backendPath: take.backendPath,
                name: take.fileName || fileNameFrom(sourceUrl, take.type === 'image' ? 'imagem.png' : 'video.mp4'),
                parent: take.type === 'image' ? 'Imagens' : 'Vídeos',
            });
            return {
                ...serializableTake,
                sharedAssetId: entry.id,
                url: entry.publicUrl,
                fileUrl: entry.publicUrl,
                proxyUrl: entry.publicUrl,
                backendPath: undefined,
            };
        }));

        return {
            ...payload,
            adData: nextAd,
            mediaTakes: nextTakes,
            selectedMusicId: musicEntry?.id || payload.selectedMusicId,
        };
    }, [importLocalAsset]);

    const hydrateSharedPayload = React.useCallback(async (data: LoadedDraftData): Promise<LoadedDraftData> => {
        const nextAd = data.adData ? { ...data.adData } : undefined;
        const nextTakes = Array.isArray(data.mediaTakes) ? data.mediaTakes.map((take) => ({ ...take })) : [];
        const ids = new Set<string>();
        for (const take of nextTakes) if (take.sharedAssetId) ids.add(take.sharedAssetId);
        if (nextAd?.sharedNarrationAssetId) ids.add(nextAd.sharedNarrationAssetId);
        if (nextAd?.sharedMusicAssetId) ids.add(nextAd.sharedMusicAssetId);
        if (nextAd?.sharedMasterAssetId) ids.add(nextAd.sharedMasterAssetId);

        const assets = new Map<string, SharedAsset>();
        await Promise.all([...ids].map(async (id) => {
            try {
                assets.set(id, await gatewayApi.sharedAsset(id));
            } catch {
                // Mantém a URL anterior para permitir diagnóstico de um item removido.
            }
        }));
        for (const take of nextTakes) {
            const asset = take.sharedAssetId ? assets.get(take.sharedAssetId) : null;
            if (asset) {
                take.url = asset.publicUrl;
                take.fileUrl = asset.publicUrl;
                take.proxyUrl = asset.publicUrl;
            }
        }
        await Promise.all(nextTakes.map(async (take) => {
            if (take.externalMedia?.source !== 'mileto_ops' || !take.externalMedia.referenceId) return;
            // Remove qualquer capability/caminho persistido por versões anteriores
            // antes de pedir uma materialização novamente autorizada.
            take.url = '';
            take.fileUrl = '';
            take.proxyUrl = '';
            take.backendPath = undefined;
            take.externalMedia = { ...take.externalMedia, cacheId: null };
            try {
                const response = await fetch(`${API_BASE_URL}/api/ops/cache/materialize`, {
                    method: 'POST',
                    headers: { ...(await localAuthHeaders()), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ referenceId: take.externalMedia.referenceId }),
                });
                const result = await response.json();
                if (!response.ok || !result.ok || !result.source) {
                    throw new Error(result.message || 'Falha ao recuperar mídia do Mileto Ops.');
                }
                const source = result.source;
                const absoluteUrl = (url?: string | null) =>
                    !url ? '' : /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
                take.url = absoluteUrl(source.url);
                take.fileUrl = absoluteUrl(source.url);
                take.proxyUrl = absoluteUrl(source.proxyUrl);
                take.backendPath = source.path;
                take.originalDurationSeconds = Number(source.duration || take.originalDurationSeconds || 0);
                take.externalMedia = source.externalMedia || take.externalMedia;
            } catch (error) {
                console.warn('[Draft] Não foi possível materializar referência do Mileto Ops:', (error as Error).message);
            }
        }));
        if (nextAd) {
            const narration = nextAd.sharedNarrationAssetId ? assets.get(nextAd.sharedNarrationAssetId) : null;
            const music = nextAd.sharedMusicAssetId ? assets.get(nextAd.sharedMusicAssetId) : null;
            const master = nextAd.sharedMasterAssetId ? assets.get(nextAd.sharedMasterAssetId) : null;
            if (narration) nextAd.narrationAudioUrl = narration.publicUrl;
            if (music) nextAd.musicAudioUrl = music.publicUrl;
            if (master) nextAd.masterAudioUrl = master.publicUrl;
        }
        return { ...data, adData: nextAd, mediaTakes: nextTakes };
    }, []);

    const saveProject = React.useCallback((opts?: { exported?: boolean; keepalive?: boolean; lastStep?: number }): Promise<boolean> => {
        const current = stateRef.current;
        const s = {
            ...current,
            mediaTakes: current.mediaTakes.map(serializeTakeForDraft),
        };
        const exported = !!opts?.exported;
        // Não criar rascunhos vazios (só salva se houver conteúdo OU se for export).
        if (!exported && !hasDraftContent()) return Promise.resolve(true);

        const fingerprint = JSON.stringify({
            projectId: s.projectId,
            draftScope: s.draftScope,
            draftTitle: s.draftTitle,
            adData: s.adData,
            mediaTakes: s.mediaTakes,
            captionStyle: s.captionStyle,
            selectedMusicId: s.selectedMusicId,
        });
        if (!exported && fingerprint === lastSavedFingerprintRef.current) return Promise.resolve(true);
        const revision = ++saveRevisionRef.current;
        const routeStep = Number(window.location.pathname.match(/\/wizard\/step\/(\d+)/)?.[1] || 1);
        const lastStep = Math.max(1, Math.min(4, opts?.lastStep ?? routeStep));

        const title =
            s.draftTitle.trim() ||
            s.adData.title?.trim() ||
            s.adData.narrationText?.trim().slice(0, 60) ||
            'Rascunho sem título';

        const persist = async (): Promise<boolean> => {
            try {
                const payload = {
                    adData: s.adData,
                    mediaTakes: s.mediaTakes,
                    captionStyle: s.captionStyle,
                    selectedMusicId: s.selectedMusicId,
                    updatedAt: new Date().toISOString(),
                    exported,
                    title,
                    saveRevision: revision,
                    lastStep,
                };
                if (s.draftScope === 'shared') {
                    const sharedPayload = await prepareSharedPayload(payload);
                    await gatewayApi.saveSharedDraft(
                        s.projectId,
                        title,
                        sharedPayload as unknown as Record<string, unknown>,
                    );
                } else {
                    const res = await fetch(
                        `${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${s.projectId}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ data: payload }),
                            keepalive: !!opts?.keepalive,
                        }
                    );
                    const json = await res.json();
                    if (!res.ok || !json.ok) throw new Error(json.message || 'Falha ao salvar o projeto.');
                }
                lastSavedFingerprintRef.current = fingerprint;
                console.log(`[Draft] Salvo (${exported ? 'exportado' : 'rascunho'}):`, s.projectId);
                return true;
            } catch (err) {
                console.error('Failed to save project:', err);
                return false;
            }
        };

        // O unload não pode aguardar a fila: keepalive dispara imediatamente. As
        // gravações normais são serializadas, inclusive no ambiente compartilhado.
        if (opts?.keepalive) return persist();
        const queued = saveQueueRef.current.then(persist, persist);
        saveQueueRef.current = queued;
        return queued;
    }, [hasDraftContent, prepareSharedPayload]);

    const publishDraftToShared = React.useCallback(async (id: string): Promise<boolean> => {
        try {
            const response = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${id}`);
            const result = await response.json();
            if (!response.ok || !result.ok || !result.data) {
                throw new Error(result.message || 'Não foi possível abrir o rascunho local.');
            }

            const data = result.data as LoadedDraftData;
            const title =
                data.title?.trim() ||
                data.adData?.title?.trim() ||
                data.adData?.narrationText?.trim().slice(0, 60) ||
                'Rascunho sem título';
            const localPayload = {
                ...data,
                adData: mergeAdData(data.adData),
                mediaTakes: Array.isArray(data.mediaTakes) ? data.mediaTakes : [],
                captionStyle: data.captionStyle ?? null,
                selectedMusicId: data.selectedMusicId ?? null,
                updatedAt: new Date().toISOString(),
                exported: !!data.exported,
                title,
            };
            const sharedPayload = await prepareSharedPayload(localPayload);
            await gatewayApi.saveSharedDraft(id, title, sharedPayload as unknown as Record<string, unknown>);
            return true;
        } catch (error) {
            console.error('Failed to publish local draft:', error);
            return false;
        }
    }, [prepareSharedPayload]);

    const applyLoadedDraft = React.useCallback((data: LoadedDraftData) => {
        setDraftTitle(data.title || data.adData?.title || '');
        if (data.adData) setAdData(mergeAdData(data.adData));
        setMediaTakes(Array.isArray(data.mediaTakes) ? data.mediaTakes : []);
        if (Object.prototype.hasOwnProperty.call(data, 'captionStyle')) {
            setCaptionStyle(data.captionStyle ?? null);
        }
        setSelectedMusicIdState(data.selectedMusicId ?? null);
    }, []);

    const loadProject = React.useCallback(async () => {
        try {
            if (draftScopeState === 'shared') {
                const json = await gatewayApi.sharedDraft(projectId);
                if (json.ok && json.data) {
                    applyLoadedDraft(await hydrateSharedPayload(json.data as LoadedDraftData));
                }
                return;
            }
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${projectId}`);
            if (res.status === 404) return;

            const json = await res.json();
            if (json.ok && json.data) {
                applyLoadedDraft(await hydrateSharedPayload(json.data as LoadedDraftData));
                console.log('Project loaded, updated at:', json.data.updatedAt);
            }
        } catch (err) {
            console.error('Failed to load project:', err);
        }
    }, [projectId, draftScopeState, applyLoadedDraft, hydrateSharedPayload]);

    const loadDraft = React.useCallback(async (id: string, scope: 'local' | 'shared' = draftScopeState): Promise<number | null> => {
        initialDraftLoadCompleteRef.current = false;
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        try {
            let data: LoadedDraftData;
            if (scope === 'shared') {
                const json = await gatewayApi.sharedDraft(id);
                if (!json.ok || !json.data) return null;
                data = await hydrateSharedPayload(json.data as LoadedDraftData);
            } else {
                const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${id}`);
                if (!res.ok) return null;
                const json = await res.json();
                if (!json.ok || !json.data) return null;
                data = await hydrateSharedPayload(json.data as LoadedDraftData);
            }

            setProjectId(id);
            setDraftScope(scope);
            try {
                localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, id);
            } catch {
                // ignore
            }
            applyLoadedDraft(data);
            lastSavedFingerprintRef.current = '';
            window.setTimeout(() => {
                initialDraftLoadCompleteRef.current = true;
            }, 0);
            return Math.max(1, Math.min(4, Number(data.lastStep) || 1));
        } catch (err) {
            console.error('Failed to load draft:', err);
            initialDraftLoadCompleteRef.current = true;
            return null;
        }
    }, [applyLoadedDraft, draftScopeState, hydrateSharedPayload, setDraftScope]);

    const startNewDraft = React.useCallback((opts?: { scope?: 'local' | 'shared'; title?: string }): string => {
        initialDraftLoadCompleteRef.current = false;
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        const newId = generateDraftId();
        setProjectId(newId);
        // Todo projeto nasce no computador. Compartilhar é uma ação posterior e
        // explícita, para não enviar rascunhos ou mídias ao R2 sem intenção.
        setDraftScope('local');
        setDraftTitle(opts?.title?.trim() || '');
        try {
            localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, newId);
        } catch {
            // ignore
        }
        setAdData(defaultAdData);
        setMediaTakes([]);
        setCaptionStyle(defaultCaptionStyle);
        setSelectedMusicIdState(null);
        lastSavedFingerprintRef.current = '';
        window.setTimeout(() => {
            initialDraftLoadCompleteRef.current = true;
        }, 0);
        return newId;
    }, [defaultCaptionStyle, setDraftScope]);

    // Tenta recuperar o rascunho ativo no mount (sobrevive a refresh do Electron).
    // Se não existir no servidor (404), mantém os defaults — é um projeto novo.
    useEffect(() => {
        let active = true;
        void loadProject().finally(() => {
            if (active) initialDraftLoadCompleteRef.current = true;
        });
        return () => {
            active = false;
        };
    }, []);

    // Toda a linha do tempo vira um checkpoint poucos milissegundos depois de
    // qualquer mudança: takes, cortes, ordem, legendas, títulos, áudio e estilo.
    useEffect(() => {
        if (!initialDraftLoadCompleteRef.current) return;
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(() => {
            void saveProject();
        }, 700);
        return () => {
            if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        };
    }, [adData, captionStyle, draftScopeState, draftTitle, mediaTakes, projectId, saveProject, selectedMusicId]);

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

    const addMediaTakes = React.useCallback((takes: MediaTake[]) => {
        if (!takes.length) return;
        const mutedTakes = takes.map((take) => ({ ...take, muteOriginalAudio: true }));
        setMediaTakes((current) => {
            const ids = new Set(current.map((take) => take.id));
            return [...current, ...mutedTakes.filter((take) => !ids.has(take.id))];
        });
    }, []);

    const removeMediaTake = React.useCallback((id: string) => {
        setMediaTakes((prev) => prev.filter((s) => s.id !== id));
    }, []);

    const clearMediaTakes = React.useCallback(() => {
        setMediaTakes((current) => {
            for (const take of current) {
                if (take.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(take.objectUrl);
            }
            return [];
        });
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

    // Trocar a música cria uma nova fonte de áudio. Cortes e offsets pertenciam à
    // faixa anterior; reaproveitá-los pode deixar a nova faixa com duração negativa
    // (spinner eterno/onda vazia no editor). A seleção só muda quando o ID existe na
    // biblioteca atualmente visível e o mix antigo é invalidado.
    const setSelectedMusicId = React.useCallback((id: string | null) => {
        const track = id ? musicLibrary.find((candidate) => candidate.id === id) : null;
        if (id && !track) return;

        setSelectedMusicIdState(id);
        const nextUrl = track
            ? (/^https?:\/\//.test(track.publicUrl)
                ? track.publicUrl
                : `${API_BASE_URL}${track.publicUrl}`)
            : null;

        setAdData((ad) => ({
            ...ad,
            musicAudioUrl: nextUrl,
            masterAudioUrl: undefined,
            audioConfig: {
                ...ad.audioConfig,
                background: {
                    ...ad.audioConfig.background,
                    offsetSec: 0,
                    trimStart: 0,
                    trimEnd: undefined,
                },
            },
            audioTimeline: ad.audioTimeline
                ? {
                    ...ad.audioTimeline,
                    tracks: ad.audioTimeline.tracks.map((timelineTrack) =>
                        timelineTrack.id === 'bgm'
                            ? { ...timelineTrack, clips: [] }
                            : timelineTrack
                    ),
                }
                : ad.audioTimeline,
        }));
    }, [musicLibrary]);

    const contextValue = React.useMemo(
        () => ({
            apiKeys,
            setApiKey,
            adData,
            updateAdData,
            mediaTakes,
            setMediaTakes,
            addMediaTake,
            addMediaTakes,
            removeMediaTake,
            clearMediaTakes,
            captionStyle,
            setCaptionStyle,
            musicLibrary,
            setMusicLibrary,
            selectedMusicId,
            setSelectedMusicId,
            loadMusicLibrary,
            projectId,
            draftScope: draftScopeState,
            setDraftScope,
            draftTitle,
            setDraftTitle,
            saveProject,
            loadProject,
            startNewDraft,
            loadDraft,
            publishDraftToShared,
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
            addMediaTakes,
            removeMediaTake,
            clearMediaTakes,
            captionStyle,
            musicLibrary,
            selectedMusicId,
            setSelectedMusicId,
            loadMusicLibrary,
            projectId,
            draftScopeState,
            setDraftScope,
            draftTitle,
            saveProject,
            loadProject,
            startNewDraft,
            loadDraft,
            publishDraftToShared,
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
