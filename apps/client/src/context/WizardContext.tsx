import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import type { AdData, MediaTake, CaptionStyle, ApiKeys, MusicTrack, CustomVoice } from '../types';
import { DEFAULT_VIDEO_ENHANCEMENT, normalizeVideoEnhancement } from '../lib/videoEnhancement';
import { gatewayApi, type SharedAsset } from '../lib/gateway';
import { localAuthHeaders } from '../lib/serverAuth';
import { API_BASE_URL } from '../lib/apiBase';
import { DEFAULT_SYSTEM_VOICE } from '../lib/systemVoices';
import {
    invalidateOpsCompanyContext,
    refreshOpsTakeUrl,
    resolveOpsCompanyContext,
    restoreCachedOpsTake,
    withResolvedOpsContext,
} from '../lib/opsMediaRecovery';
import {
    isSystemMusicId,
    SYSTEM_MUSIC_IDS,
    SYSTEM_MUSIC_PATHS,
    SYSTEM_MUSIC_TRACKS,
    systemMusicTrackFor,
    withSystemMusicTracks,
} from '../lib/systemMusic';

export const SHOW_DEBUG_FEATURES = false;

// Geração de imagem e vídeo por IA fica DESLIGADA no v1. Volta numa versão
// futura com as APIs trocadas (vídeo=Seedance, imagem=Banana/Gemini) —
// ver ROADMAP-IMAGEM-VIDEO.md. Basta virar para true quando reativar.
export const ENABLE_MEDIA_AI = false;

const ACTIVE_DRAFT_STORAGE_KEY = 'mileto_active_draft_id';
const ACTIVE_DRAFT_SCOPE_KEY = 'mileto_active_draft_scope';
const DRAFT_RECOVERY_STORAGE_PREFIX = 'mileto_draft_recovery_v1';

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
    startNewDraft: (_opts?: { id?: string; scope?: 'local' | 'shared'; title?: string }) => string;
    applyProjectSnapshot: (_snapshot: {
        projectId: string;
        title: string;
        adData: AdData;
        mediaTakes: MediaTake[];
        captionStyle?: CaptionStyle | null;
        selectedMusicId?: string | null;
    }) => void;
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
    updatedAt?: string;
};

type DraftRecoveryEnvelope = {
    capturedAt: number;
    data: LoadedDraftData;
};

const draftRecoveryStorageKey = (projectId: string, scope: 'local' | 'shared') =>
    `${DRAFT_RECOVERY_STORAGE_PREFIX}:${scope}:${projectId}`;

const readDraftRecovery = (projectId: string, scope: 'local' | 'shared'): DraftRecoveryEnvelope | null => {
    try {
        const raw = localStorage.getItem(draftRecoveryStorageKey(projectId, scope));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as DraftRecoveryEnvelope;
        if (!parsed || !Number.isFinite(parsed.capturedAt) || !parsed.data || typeof parsed.data !== 'object') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
};

const preferRecoverySnapshot = (
    persisted: LoadedDraftData | null,
    recovery: DraftRecoveryEnvelope | null
): LoadedDraftData | null => {
    if (!recovery) return persisted;
    if (!persisted) return recovery.data;
    const persistedAt = Date.parse(persisted.updatedAt || '');
    return !Number.isFinite(persistedAt) || recovery.capturedAt > persistedAt ? recovery.data : persisted;
};

const serializeTakeForDraft = (take: MediaTake): MediaTake => {
    const { file: _localFile, ...serializableTake } = take;
    void _localFile;
    if (take.externalMedia?.source !== 'mileto_ops') return serializableTake;
    return {
        ...serializableTake,
        // URLs-capability e caminhos absolutos nunca entram no rascunho. O
        // cacheId, porém, é a chave estável e não secreta que permite a este
        // computador reabrir o take sem depender novamente do Ops.
        url: '',
        fileUrl: '',
        proxyUrl: '',
        backendPath: undefined,
        externalMedia: { ...take.externalMedia },
    };
};

const DEFAULT_NARRATION_TEXT = '';

const defaultAdData: AdData = {
    title: '',
    format: '9:16',
    narrationText: DEFAULT_NARRATION_TEXT,
    selectedVoiceId: DEFAULT_SYSTEM_VOICE.id,
    selectedVoiceProvider: DEFAULT_SYSTEM_VOICE.provider,
    voiceSettings: { ...DEFAULT_SYSTEM_VOICE.preset.voiceSettings },
    narrationAudioUrl: null,
    narrationAudioPath: null,
    isNarrationGenerated: false,
    musicAudioUrl: `${API_BASE_URL}${SYSTEM_MUSIC_PATHS[SYSTEM_MUSIC_IDS.batida]}`,
    audioConfig: {
        narration: { ...DEFAULT_SYSTEM_VOICE.preset.audioConfig.narration },
        background: { ...DEFAULT_SYSTEM_VOICE.preset.audioConfig.background },
    },
    globalTransition: null,
    videoEnhancement: DEFAULT_VIDEO_ENHANCEMENT,
    transitionRotation: 0,
    transitionVolume: 1.0,
    transitionMuted: false,
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
    id: 'hacker-matrix',
    name: 'Hacker Matrix',
    previewClass: '',
    fontFamily: 'Montserrat',
    fontSize: 20,
    strokeWidth: 4,
    activeColor: '#00E676',
    baseColor: '#FFFFFF',
    strokeColor: '#000000',
    verticalPosition: 23,
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
    videoEnhancement: normalizeVideoEnhancement(data?.videoEnhancement),
});

export const createDefaultAdData = (input: Partial<AdData> = {}): AdData => mergeAdData(input);

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
        // Nunca embutir a credencial revogada no aplicativo distribuído.
        const REVOKED_OPENAI_KEYS = new Set<string>();
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

    // Padrão visual da primeira geração de legendas em todo projeto novo.
    // Ao selecionar a empresa, o Ops substitui o verde pela cor primária da marca.
    const [captionStyle, setCaptionStyle] = useState<CaptionStyle | null>({ ...DEFAULT_CAPTION_STYLE });
    const [musicLibrary, setMusicLibrary] = useState<MusicTrack[]>(SYSTEM_MUSIC_TRACKS);
    const [selectedMusicId, setSelectedMusicIdState] = useState<string | null>(SYSTEM_MUSIC_IDS.batida);
    const systemMusicAliasesRef = useRef<Record<string, string>>({});
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

    // Checkpoint síncrono no armazenamento do renderer. Ele não substitui o
    // arquivo oficial do projeto; serve como rede de proteção enquanto o POST
    // assíncrono ainda está na fila ou quando o Vite/Electron recarrega a tela.
    const writeRecoverySnapshot = React.useCallback(() => {
        if (!initialDraftLoadCompleteRef.current || !hasDraftContent()) return;
        const s = stateRef.current;
        const routeStep = Number(window.location.pathname.match(/\/wizard\/step\/(\d+)/)?.[1] || 1);
        const title =
            s.adData.title?.trim() ||
            s.draftTitle.trim() ||
            s.adData.narrationText?.trim().slice(0, 60) ||
            'Rascunho sem título';
        const capturedAt = Date.now();
        const envelope: DraftRecoveryEnvelope = {
            capturedAt,
            data: {
                adData: { ...s.adData, title },
                mediaTakes: s.mediaTakes.map(serializeTakeForDraft),
                captionStyle: s.captionStyle,
                selectedMusicId: s.selectedMusicId,
                exported: false,
                title,
                saveRevision: saveRevisionRef.current,
                lastStep: Math.max(1, Math.min(4, routeStep)),
                updatedAt: new Date(capturedAt).toISOString(),
            },
        };
        try {
            localStorage.setItem(draftRecoveryStorageKey(s.projectId, s.draftScope), JSON.stringify(envelope));
        } catch (error) {
            // Quota cheia não pode interromper a edição; o autosave em arquivo
            // continua sendo a camada principal.
            console.warn('[Draft] Checkpoint local indisponível:', error);
        }
    }, [hasDraftContent]);

    const importLocalAsset = React.useCallback(async (input: {
        sourceUrl?: string | null;
        backendPath?: string | null;
        name: string;
        parent: 'Músicas' | 'Imagens' | 'Vídeos';
        visibility?: 'library' | 'project';
    }): Promise<SharedAsset> => {
        const cacheKey = `${input.visibility || 'library'}:${input.backendPath || input.sourceUrl || ''}`;
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
            visibility: 'library' | 'project' = 'library',
        ) => {
            const sourceUrl = nextAd[urlKey];
            if (isLocalMedia(sourceUrl, backendPath)) {
                const entry = await importLocalAsset({
                    sourceUrl,
                    backendPath,
                    name: fileNameFrom(sourceUrl, fallbackName),
                    parent: 'Músicas',
                    visibility,
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
            'project',
        );
        const musicEntry = isSystemMusicId(payload.selectedMusicId)
            ? null
            : await syncAudio('musicAudioUrl', 'sharedMusicAssetId', 'musica.mp3');
        await syncAudio('masterAudioUrl', 'sharedMasterAssetId', 'mixagem.mp3', null, 'project');
        if (!musicEntry && nextAd.musicAudioUrl && payload.selectedMusicId && !isSystemMusicId(payload.selectedMusicId)) {
            nextAd.sharedMusicAssetId = payload.selectedMusicId;
        }
        if (isSystemMusicId(payload.selectedMusicId)) {
            nextAd.sharedMusicAssetId = undefined;
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
        const hasOpsReferences = nextTakes.some(
            (take) => take.externalMedia?.source === 'mileto_ops' && Boolean(take.externalMedia.referenceId)
        );
        let canMaterializeOpsLocally = false;
        if (hasOpsReferences) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/ops/cache/status`);
                const status = await response.json();
                // Durante uma atualização, o renderer novo pode voltar antes do
                // servidor interno. A versão antiga removia referências ao receber
                // um 404 do Ops; portanto só materializamos quando o servidor já
                // confirma explicitamente a política segura.
                canMaterializeOpsLocally = response.ok && status?.preservesDraftReferences === true;
            } catch {
                // Builds antigos do servidor local ainda podem exibir o stream remoto.
                canMaterializeOpsLocally = false;
            }
        }
        await Promise.all(nextTakes.map(async (take) => {
            if (take.externalMedia?.source !== 'mileto_ops' || !take.externalMedia.referenceId) return;
            const referenceId = take.externalMedia.referenceId;
            const originalReference = take.externalMedia;
            const previousDuration = Number(take.originalDurationSeconds || 0);
            const followedFullDuration =
                Number(take.trim?.end || 0) <= 0 ||
                (previousDuration > 0 && Math.abs(Number(take.trim?.end || 0) - previousDuration) < 0.05);
            // Remove qualquer capability/caminho persistido por versões anteriores
            // antes de pedir uma materialização novamente autorizada.
            take.url = '';
            take.fileUrl = '';
            take.proxyUrl = '';
            take.backendPath = undefined;
            take.externalMedia = { ...take.externalMedia };
            let lastError: unknown = null;
            let resolvedContext = null;
            try {
                const restored = await restoreCachedOpsTake(take);
                Object.assign(take, restored);
                return;
            } catch (error) {
                // Cache ausente é a única situação em que voltamos ao Ops.
                // Os cards, cortes e efeitos permanecem no rascunho mesmo se o
                // serviço remoto estiver temporariamente indisponível.
                lastError = error;
            }
            try {
                resolvedContext = await resolveOpsCompanyContext(
                    originalReference.companyId,
                    originalReference.viewContext
                );
                take.externalMedia = withResolvedOpsContext(take.externalMedia, resolvedContext);
            } catch (error) {
                lastError = error;
            }
            for (let attempt = 0; canMaterializeOpsLocally && resolvedContext && attempt < 5; attempt += 1) {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/ops/cache/materialize`, {
                        method: 'POST',
                        headers: {
                            ...(await localAuthHeaders()),
                            'Content-Type': 'application/json',
                            'X-Ops-View-Context': resolvedContext.contextId,
                        },
                        body: JSON.stringify({ referenceId }),
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok || !result.ok || !result.source) {
                        if ([401, 403].includes(response.status)) {
                            invalidateOpsCompanyContext(originalReference.companyId);
                            resolvedContext = await resolveOpsCompanyContext(
                                originalReference.companyId,
                                originalReference.viewContext,
                                true
                            );
                            take.externalMedia = withResolvedOpsContext(take.externalMedia, resolvedContext);
                        }
                        const responseError = new Error(result.message || 'Falha ao recuperar mídia do Mileto Ops.');
                        Object.assign(responseError, { status: response.status });
                        throw responseError;
                    }
                    const source = result.source;
                    const absoluteUrl = (url?: string | null) =>
                        !url ? '' : /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
                    take.url = absoluteUrl(source.url);
                    take.fileUrl = absoluteUrl(source.url);
                    take.proxyUrl = absoluteUrl(source.proxyUrl) || take.url;
                    take.backendPath = source.path;
                    const materializedDuration = Number(source.duration || previousDuration || 0);
                    take.originalDurationSeconds = materializedDuration;
                    if (materializedDuration > 0) {
                        const nextEnd = followedFullDuration
                            ? materializedDuration
                            : Math.min(Math.max(0, Number(take.trim?.end || 0)), materializedDuration);
                        take.trim = {
                            start: Math.min(Math.max(0, Number(take.trim?.start || 0)), Math.max(0, nextEnd - 0.05)),
                            end: nextEnd,
                        };
                    }
                    take.externalMedia = withResolvedOpsContext(
                        { ...take.externalMedia, ...(source.externalMedia || {}), source: 'mileto_ops' },
                        resolvedContext
                    );
                    return;
                } catch (error) {
                    lastError = error;
                    const status = Number((error as { status?: number })?.status || 0);
                    if ([404, 410, 422].includes(status)) break;
                    if (attempt < 4) await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
                }
            }
            // O cache local é uma otimização. Se ele não estiver pronto, renovamos
            // a URL assinada do Ops para o take jamais reaparecer como um card vazio.
            try {
                const refreshed = await refreshOpsTakeUrl(take);
                take.url = refreshed.media.url;
                take.fileUrl = refreshed.media.url;
                take.proxyUrl = refreshed.media.url;
                take.externalMedia = withResolvedOpsContext(take.externalMedia, refreshed.context);
            } catch (error) {
                lastError = error;
                console.warn('[Draft] Não foi possível restaurar referência do Mileto Ops:', (lastError as Error)?.message);
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
        return {
            ...data,
            adData: nextAd,
            mediaTakes: nextTakes,
        };
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

        // O título do projeto é a fonte de verdade. O título da lista de
        // rascunhos apenas acompanha esse valor para que a etapa 1, a Home e
        // o arquivo persistido nunca mostrem nomes diferentes.
        const title =
            s.adData.title?.trim() ||
            s.draftTitle.trim() ||
            s.adData.narrationText?.trim().slice(0, 60) ||
            'Rascunho sem título';

        const persist = async (): Promise<boolean> => {
            try {
                const payload = {
                    adData: { ...s.adData, title },
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
                data.adData?.title?.trim() ||
                data.title?.trim() ||
                data.adData?.narrationText?.trim().slice(0, 60) ||
                'Rascunho sem título';
            const localPayload = {
                ...data,
                adData: { ...mergeAdData(data.adData), title },
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
        const title = data.adData?.title?.trim() || data.title?.trim() || '';
        setDraftTitle(title);
        if (data.adData) setAdData(mergeAdData({ ...data.adData, title }));
        setMediaTakes(Array.isArray(data.mediaTakes) ? data.mediaTakes : []);
        if (Object.prototype.hasOwnProperty.call(data, 'captionStyle')) {
            setCaptionStyle(data.captionStyle ?? null);
        }
        setSelectedMusicIdState(data.selectedMusicId ?? null);
    }, []);

    const loadProject = React.useCallback(async () => {
        const recovery = readDraftRecovery(projectId, draftScopeState);
        try {
            if (draftScopeState === 'shared') {
                const json = await gatewayApi.sharedDraft(projectId);
                const selected = preferRecoverySnapshot(
                    json.ok && json.data ? json.data as LoadedDraftData : null,
                    recovery
                );
                if (selected) {
                    applyLoadedDraft(await hydrateSharedPayload(selected));
                }
                return;
            }
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${projectId}`);
            if (res.status === 404) {
                if (recovery) applyLoadedDraft(await hydrateSharedPayload(recovery.data));
                return;
            }

            const json = await res.json();
            const selected = preferRecoverySnapshot(
                json.ok && json.data ? json.data as LoadedDraftData : null,
                recovery
            );
            if (selected) {
                applyLoadedDraft(await hydrateSharedPayload(selected));
                console.log('Project loaded, updated at:', selected.updatedAt);
            }
        } catch (err) {
            console.error('Failed to load project:', err);
            if (recovery) {
                try {
                    applyLoadedDraft(await hydrateSharedPayload(recovery.data));
                } catch (recoveryError) {
                    console.error('Failed to recover local project checkpoint:', recoveryError);
                }
            }
        }
    }, [projectId, draftScopeState, applyLoadedDraft, hydrateSharedPayload]);

    const loadDraft = React.useCallback(async (id: string, scope: 'local' | 'shared' = draftScopeState): Promise<number | null> => {
        initialDraftLoadCompleteRef.current = false;
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        const recovery = readDraftRecovery(id, scope);
        try {
            let persisted: LoadedDraftData | null = null;
            if (scope === 'shared') {
                const json = await gatewayApi.sharedDraft(id);
                if (json.ok && json.data) persisted = json.data as LoadedDraftData;
            } else {
                const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/projects/${id}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.ok && json.data) persisted = json.data as LoadedDraftData;
                }
            }
            const selected = preferRecoverySnapshot(persisted, recovery);
            if (!selected) {
                initialDraftLoadCompleteRef.current = true;
                return null;
            }
            const data = await hydrateSharedPayload(selected);

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
            if (recovery) {
                try {
                    const data = await hydrateSharedPayload(recovery.data);
                    setProjectId(id);
                    setDraftScope(scope);
                    applyLoadedDraft(data);
                    initialDraftLoadCompleteRef.current = true;
                    return Math.max(1, Math.min(4, Number(data.lastStep) || 1));
                } catch (recoveryError) {
                    console.error('Failed to recover selected draft checkpoint:', recoveryError);
                }
            }
            initialDraftLoadCompleteRef.current = true;
            return null;
        }
    }, [applyLoadedDraft, draftScopeState, hydrateSharedPayload, setDraftScope]);

    const applyProjectSnapshot = React.useCallback((snapshot: {
        projectId: string;
        title: string;
        adData: AdData;
        mediaTakes: MediaTake[];
        captionStyle?: CaptionStyle | null;
        selectedMusicId?: string | null;
    }) => {
        initialDraftLoadCompleteRef.current = false;
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        const title = snapshot.title.trim();
        const nextCaptionStyle = snapshot.captionStyle === undefined
            ? { ...DEFAULT_CAPTION_STYLE }
            : snapshot.captionStyle;
        const nextMusicId = snapshot.selectedMusicId === undefined
            ? SYSTEM_MUSIC_IDS.batida
            : snapshot.selectedMusicId;
        setProjectId(snapshot.projectId);
        setDraftScope('local');
        setDraftTitle(title);
        setAdData(snapshot.adData);
        setMediaTakes(snapshot.mediaTakes);
        setCaptionStyle(nextCaptionStyle);
        setSelectedMusicIdState(nextMusicId);
        stateRef.current = {
            projectId: snapshot.projectId,
            adData: snapshot.adData,
            mediaTakes: snapshot.mediaTakes,
            captionStyle: nextCaptionStyle,
            selectedMusicId: nextMusicId,
            draftScope: 'local',
            draftTitle: title,
        };
        lastSavedFingerprintRef.current = '';
        try {
            localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, snapshot.projectId);
            localStorage.setItem(ACTIVE_DRAFT_SCOPE_KEY, 'local');
        } catch {
            // O estado em memória continua válido quando o armazenamento está indisponível.
        }
        initialDraftLoadCompleteRef.current = true;
    }, [setDraftScope]);

    const startNewDraft = React.useCallback((opts?: { id?: string; scope?: 'local' | 'shared'; title?: string }): string => {
        initialDraftLoadCompleteRef.current = false;
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        const newId = opts?.id?.trim() || generateDraftId();
        setProjectId(newId);
        // Todo projeto nasce no computador. Compartilhar é uma ação posterior e
        // explícita, para não enviar rascunhos ou mídias ao R2 sem intenção.
        setDraftScope('local');
        const title = opts?.title?.trim() || '';
        setDraftTitle(title);
        try {
            localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, newId);
        } catch {
            // ignore
        }
        setAdData({ ...defaultAdData, title });
        setMediaTakes([]);
        setCaptionStyle({ ...DEFAULT_CAPTION_STYLE });
        setSelectedMusicIdState(SYSTEM_MUSIC_IDS.batida);
        lastSavedFingerprintRef.current = '';
        window.setTimeout(() => {
            initialDraftLoadCompleteRef.current = true;
        }, 0);
        return newId;
    }, [setDraftScope]);

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
        writeRecoverySnapshot();
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(() => {
            void saveProject();
        }, 700);
        return () => {
            if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        };
    }, [adData, captionStyle, draftScopeState, draftTitle, mediaTakes, projectId, saveProject, selectedMusicId, writeRecoverySnapshot]);

    useEffect(() => {
        const persistBeforeLeave = () => {
            if (!initialDraftLoadCompleteRef.current) return;
            writeRecoverySnapshot();
            void saveProject({ keepalive: true });
        };
        const persistWhenHidden = () => {
            if (document.visibilityState === 'hidden') persistBeforeLeave();
        };

        window.addEventListener('beforeunload', persistBeforeLeave);
        window.addEventListener('pagehide', persistBeforeLeave);
        document.addEventListener('visibilitychange', persistWhenHidden);
        return () => {
            window.removeEventListener('beforeunload', persistBeforeLeave);
            window.removeEventListener('pagehide', persistBeforeLeave);
            document.removeEventListener('visibilitychange', persistWhenHidden);
            // Fast Refresh desmonta o provider sem necessariamente disparar
            // beforeunload. O checkpoint síncrono garante o estado mesmo assim.
            persistBeforeLeave();
        };
    }, [saveProject, writeRecoverySnapshot]);

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
        if (Object.prototype.hasOwnProperty.call(data, 'title')) {
            setDraftTitle(typeof data.title === 'string' ? data.title : '');
        }
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
                const tracks = Array.isArray(data.tracks) ? data.tracks as MusicTrack[] : [];
                for (const track of tracks) {
                    const systemTrack = systemMusicTrackFor(track);
                    if (systemTrack) systemMusicAliasesRef.current[track.id] = systemTrack.id;
                }
                setMusicLibrary(withSystemMusicTracks(tracks));
            }
        } catch (err) {
            console.error('Failed to load music library', err);
        }
    }, []);

    // Load music library on mount
    useEffect(() => {
        loadMusicLibrary();
    }, [loadMusicLibrary]);

    // Instalações anteriores guardavam Batida/Blogueira como uploads comuns com
    // UUID. Convertemos silenciosamente esses IDs para os IDs estáveis do sistema,
    // preservando a URL que já funciona naquela instalação.
    useEffect(() => {
        if (!selectedMusicId) return;
        const canonicalTrack = systemMusicTrackFor(selectedMusicId)
            || systemMusicTrackFor(systemMusicAliasesRef.current[selectedMusicId]);
        if (!canonicalTrack) return;
        const runtimeTrack = musicLibrary.find((track) => track.id === canonicalTrack.id);
        if (!runtimeTrack) return;

        if (selectedMusicId !== canonicalTrack.id) setSelectedMusicIdState(canonicalTrack.id);
        const runtimeUrl = /^https?:\/\//.test(runtimeTrack.publicUrl)
            ? runtimeTrack.publicUrl
            : `${API_BASE_URL}${runtimeTrack.publicUrl}`;
        setAdData((current) => {
            if (current.musicAudioUrl === runtimeUrl && !current.sharedMusicAssetId) return current;
            return { ...current, musicAudioUrl: runtimeUrl, sharedMusicAssetId: undefined };
        });
    }, [musicLibrary, selectedMusicId]);

    // Trocar a música cria uma nova fonte de áudio. Cortes e offsets pertenciam à
    // faixa anterior; reaproveitá-los pode deixar a nova faixa com duração negativa
    // (spinner eterno/onda vazia no editor). A seleção só muda quando o ID existe na
    // biblioteca atualmente visível e o mix antigo é invalidado.
    const setSelectedMusicId = React.useCallback((id: string | null) => {
        const requestedTrack = id ? musicLibrary.find((candidate) => candidate.id === id) : null;
        const canonicalSystemTrack = systemMusicTrackFor(requestedTrack || id);
        const canonicalId = canonicalSystemTrack?.id || id;
        const track = canonicalId
            ? musicLibrary.find((candidate) => candidate.id === canonicalId) ||
              SYSTEM_MUSIC_TRACKS.find((candidate) => candidate.id === canonicalId)
            : null;
        if (id && !track) return;

        setSelectedMusicIdState(canonicalId);
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
            applyProjectSnapshot,
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
            applyProjectSnapshot,
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
