export interface TransitionAsset {
    id: string; // Pode ser um ID UUID
    originalName: string;
    savedName?: string;
    publicUrl: string; // Arquivo renderizado no Web server port 3301
    filePath: string; // Absolute path para C++ FFmpeg puxar do disco rigido C://
    durationSec: number;
    category?: string;
    isBuiltIn?: boolean;
    description?: string;
    scope?: 'local' | 'shared';
    sharedAssetId?: string;
    identityCode?: string;
    fileSize?: number;
}

import { SpeedPresetType } from '../lib/speedRemapping';

export interface SpeedKeyframe {
    id: string;
    position: number;
    speed: number;
}

export type TakeZoomType = 'zoom-in' | 'zoom-out' | 'zoom-in-out';

export interface TakeMotionEffect {
    type: TakeZoomType;
    /** Ampliação adicional no ponto mais fechado. 0.12 = 12%. */
    intensity: number;
    /** Ponto de interesse dentro do quadro, em porcentagem. */
    focalX: number;
    focalY: number;
    easing: 'linear' | 'smooth';
}

export type VideoEnhancementIntensity = 'soft' | 'balanced' | 'strong';

export interface VideoEnhancementSettings {
    /** Correção automática de cor, contraste e ruído. A nitidez é controlada separadamente. */
    enabled: boolean;
    intensity: VideoEnhancementIntensity;
    /** Nitidez padrão para todos os takes, de 0 a 100. */
    globalSharpness: number;
}

export interface TakeSharpnessSettings {
    /** `inherit` usa o valor global; `off` desliga; `custom` usa `amount`. */
    mode: 'inherit' | 'off' | 'custom';
    amount: number;
}

export interface TakeEnhancementSettings {
    /** `inherit` segue o tratamento global; `off` desliga; `custom` usa os valores deste take. */
    mode: 'inherit' | 'off' | 'custom';
    enabled: boolean;
    intensity: VideoEnhancementIntensity;
}

export interface ExternalMediaReference {
    source: 'mileto_ops';
    referenceId: string;
    connectionId: string;
    accountId: string;
    companyId: string;
    folderId?: string | null;
    assetId: string;
    mid?: string | null;
    version?: string | null;
    checksum?: string | null;
    opsUpdatedAt?: string | null;
    cacheId?: string | null;
    /** Identidade não secreta usada para obter um contextId novo ao restaurar o projeto. */
    viewContext?: {
        mode: 'self' | 'team' | 'profile';
        label: string;
        subtitle: string;
    } | null;
}

export interface MediaTake {
    id: string;
    file?: File; // Optional because it might be just a reference after upload? Or keep it.
    fileName: string;
    originalDurationSeconds: number;
    url: string; // restored
    backendPath?: string; // restored
    fileUrl?: string; // URL for the uploaded file
    proxyUrl?: string; // URL for the optimized proxy video
    sharedAssetId?: string; // Referência estável do item no ambiente compartilhado
    externalMedia?: ExternalMediaReference; // Referência estável; nunca contém signed URL/token do Ops
    objectUrl?: string; // Local blob URL (temporary)
    type: 'video' | 'image';
    objectFit?: 'cover' | 'contain';
    // Single Segment Data
    trim: {
        start: number;
        end: number;
    };
    speedPresetId?: SpeedPresetType;
    muteOriginalAudio?: boolean;
    motionEffect?: TakeMotionEffect;
    enhancement?: TakeEnhancementSettings;
    sharpness?: TakeSharpnessSettings;
    transition?: {
        asset: TransitionAsset;
        volume: number;
        muted: boolean;
    };
}

export interface ApiKeys {
    gemini: string;
    openai: string;
    fishAudio: string;
    elevenLabs: string;
    replicate?: string;
    runway?: string;
    seedance?: string;
}

/** Provedores de TTS suportados. Espelha `services/ttsTypes.ts` no servidor. */
export type TtsProvider = 'fishAudio' | 'elevenLabs';

export const TTS_PROVIDERS: { id: TtsProvider; label: string; apiKeyField: keyof ApiKeys }[] = [
    { id: 'fishAudio', label: 'Fish Audio', apiKeyField: 'fishAudio' },
    { id: 'elevenLabs', label: 'ElevenLabs', apiKeyField: 'elevenLabs' },
];

/**
 * Ajustes manuais de voz. Faixas conforme a documentação de cada fornecedor —
 * ver PESQUISA-NARRACAO-IA.md.
 *
 * `stability` é INVERTIDO: menor = mais emoção. Só vale para ElevenLabs.
 */
export interface VoiceSettings {
    speed: number; // 0.5 – 2.0 (recomendado 0.80 – 1.25)
    volume: number; // dB, -20 a +20 (recomendado -5 a +5) · só Fish Audio
    stability: number; // 0.0 – 1.0 (recomendado 0.30 – 0.45) · só ElevenLabs
    similarityBoost: number; // 0.0 – 1.0 · só ElevenLabs
    fishModel: FishModel;
}

/**
 * Modelos da Fish Audio. Vai no header `model` da requisição.
 * Só o S2 entende a sintaxe [bracket] de emoção — no S1 as tags são LIDAS em voz alta.
 */
export type FishModel = 's2.1-pro-free' | 's2-pro' | 's1';

export const FISH_MODELS: { id: FishModel; label: string; note: string; tags: boolean }[] = [
    {
        id: 's2-pro',
        label: 'S2 Pro · recomendado',
        note: 'Melhor qualidade de voz, com SLA. É o padrão do Mileto para narração profissional.',
        tags: true,
    },
    {
        id: 's2.1-pro-free',
        label: 'S2.1 Pro · econômico',
        note: 'Mais barato, sem SLA — o áudio pode ser usado para treinar os modelos do fornecedor.',
        tags: true,
    },
    { id: 's1', label: 'S1 · legado', note: 'Modelo antigo. Não entende tags de emoção.', tags: false },
];

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
    speed: 1,
    volume: 0,
    stability: 0.4, // preset "Conversational" da ElevenLabs
    similarityBoost: 0.75,
    // Pro por padrão: a voz é melhor. É o que o cliente enxerga como "Mileto".
    fishModel: 's2-pro',
};

export type VideoFormat = '9:16' | '16:9' | '4:5' | '1:1';

export interface VoiceModel {
    id: string;
    name: string;
    description: string;
    elevenVoiceId: string;
    previewText: string;
    isCustom: boolean;
    tags: string[];
}

export interface CustomVoice {
    id: string;
    name: string;
    description?: string;
    /** Vozes salvas antes do suporte multi-provedor não têm o campo — trata-se como Fish Audio. */
    provider?: TtsProvider;
    /** Ajustes aplicados ao escolher esta voz. Ausente em vozes antigas. */
    preset?: VoicePreset;
}

export interface VoicePreset {
    voiceSettings: VoiceSettings;
    musicTrackId: string | null;
    audioConfig: AudioConfig;
}

export interface AudioTrackConfig {
    enabled: boolean;
    volume: number; // 0 to 2 (200%)
    offsetSec: number; // Start playing at global time X
    trimStart: number; // Skip first X seconds of source
    trimEnd?: number; // Stop playing source at X seconds (if undefined, play to end)
    fadeInSec: number;
    fadeOutSec: number;
    url?: string | null; // For background music
    trackId?: string | null; // For background music ID reference
}

export interface AudioConfig {
    narration: AudioTrackConfig;
    background: AudioTrackConfig;
}

export interface AudioClip {
    id: string;
    sourceUrl: string;
    name: string;
    startSec: number; // Position in timeline (seconds)
    inSec: number; // Start point in source file (seconds)
    outSec: number; // End point in source file (seconds)
    fadeInSec: number;
    fadeOutSec: number;
    volume: number; // 0 to 1
}

export interface TimelineTrack {
    id: string;
    label: string;
    type: 'audio';
    enabled: boolean;
    volume: number; // 0 to 1
    muted: boolean;
    solo: boolean;
    clips: AudioClip[];
}

export interface AudioTimeline {
    durationSec: number;
    tracks: TimelineTrack[];
}

export interface CaptionWord {
    text: string;
    start: number; // Absolute time in seconds
    end: number;
}

export interface CaptionSegment {
    id: string;
    start: number;
    end: number;
    text: string;
    words: CaptionWord[]; // For karaoke
}

export interface CaptionTrack {
    enabled: boolean;
    language: string; // e.g., 'pt-BR'
    presetId: string | null;
    segments: CaptionSegment[];
    /** Assinatura do áudio+roteiro que originou estas legendas. */
    sourceKey?: string;
    review?: {
        sourceApplied: boolean;
        correctedWords: number;
        formattedValues: number;
    };
}

export type TitleSemanticRole = 'hook' | 'offer_or_benefit' | 'cta';

export interface TitleSemanticCoverage {
    required: TitleSemanticRole[];
    covered: TitleSemanticRole[];
    missing: TitleSemanticRole[];
}

export interface TitleGenerationMetrics {
    rawCandidateCount?: number;
    formattedCandidateCount?: number;
    inTimelineCandidateCount?: number;
    acceptedCount?: number;
    droppedOutOfBoundsOrInvisible?: number;
    droppedByCoverageLimitOrOverlap?: number;
}

export interface TitleGenerationDiagnostic {
    code?: string;
    status?: number;
    phase?: string;
    requestId?: string;
}

export interface TitleGenerationSummary {
    requested: boolean;
    outcome: 'ai' | 'fallback' | 'none' | 'manual' | 'skipped';
    titleCount: number;
    serverAttempts?: number;
    clientRequests?: number;
    configSource?: string;
    semanticCoverage?: TitleSemanticCoverage;
    metrics?: TitleGenerationMetrics;
    /** Mantém separadas as tentativas da IA e do fallback para não apagar a causa da degradação. */
    attemptsBySource?: { ai?: number; fallback?: number };
    metricsBySource?: { ai?: TitleGenerationMetrics; fallback?: TitleGenerationMetrics };
    warning?: string;
    warnings?: Array<{ code: string; message?: string; missingRoles?: TitleSemanticRole[] }>;
    diagnostic?: TitleGenerationDiagnostic;
    diagnostics?: TitleGenerationDiagnostic[];
    generatedAt: string;
}

export interface TitleHook {
    id: string;
    text: string;
    /** Trecho literal da narração que originou a etiqueta visual. */
    sourceText?: string;
    /** Condição comercial preservada fora do texto principal, como A PARTIR DE. */
    qualifierText?: string;
    /** Gatilho editorial que comprovou a seleção deste título. */
    triggerId?: string;
    /** Papéis usados para auditar gancho, oferta/benefício e CTA. */
    semanticRoles?: TitleSemanticRole[];
    startSec: number;
    durationSec: number;
    isActive: boolean;
    posY: number; // Vertical position percentage (0-100), default 30
    posX?: number; // Horizontal position percentage (0-100), default 50
    scale?: number; // Size/zoom multiplier (e.g. 0.5 to 2.0), default 1.0
    scaleX?: number; // Independent horizontal size multiplier, default 1.0
    scaleY?: number; // Independent vertical size multiplier, default 1.0
    textBoxWidthPct?: number; // Text composition width as a percentage of the video frame
    maxWords?: number; // Limite da geração automática; a edição manual permanece livre
    styleId?: string; // e.g., 'neo-pop', 'solid-ribbon', 'gradient-glow'
    primaryColor?: string; // Primary text or accent color
    secondaryColor?: string; // Secondary background or text color
    /** Mantém títulos em modo marca ligados à paleta atual do projeto/empresa. */
    colorBinding?: {
        mode: 'brand';
        paletteSlot: 'rotate' | 'primary' | 'secondary' | 'tertiary';
        secondaryPaletteSlot?: 'rotate' | 'primary' | 'secondary' | 'tertiary';
        rotationIndex?: number;
        fallbackPrimary?: string;
        fallbackSecondary?: string;
    };
    animationId?: string; // Defines entrance/exit animation (e.g., 'pop', 'slide', 'fade', 'none')
    fontFamily?: string; // Título fonte (e.g. 'Inter', 'Anton')
    hasSound?: boolean; // Toggles the transition sound effect on/off
    imageUrl?: string; // URL for uploaded title images
}

export interface BrandPalette {
    primary: string;
    secondary: string;
    tertiary: string;
    all: string[];
}

export interface OpsProjectCompany {
    id: string;
    name: string;
    /** Identidade não secreta usada apenas para reencontrar um contexto autorizado fresco. */
    viewContextIdentity: string;
    viewContextLabel?: string;
}

export interface AdData {
    title: string;
    format: VideoFormat;
    narrationText: string;
    selectedVoiceId: string | null;
    selectedVoiceProvider?: TtsProvider;
    voiceSettings?: VoiceSettings;
    narrationVoiceId?: string;
    narrationAudioUrl: string | null;
    narrationAudioPath: string | null; // For backend reference
    /** Distingue a síntese baseada no roteiro de uma gravação sem transcrição confiável. */
    narrationSource?: 'tts' | 'recording';
    sharedNarrationAssetId?: string;
    isNarrationGenerated: boolean;
    musicAudioUrl?: string | null;
    sharedMusicAssetId?: string;
    audioConfig: AudioConfig; // Kept for backward compatibility
    audioTimeline?: AudioTimeline; // New Data Model
    masterAudioUrl?: string; // Mix of Narration + Background music generated on backend
    sharedMasterAssetId?: string;
    narrationDuration?: number;
    captions?: CaptionTrack;
    globalTransition?: TransitionAsset | null;
    videoEnhancement?: VideoEnhancementSettings;
    /** Rotação aplicada à transição global no preview e no render final. */
    transitionRotation?: 0 | 90 | 180 | 270;
    transitionVolume?: number; // 0.0 to 1.0, default 1.0 (or mapped to 0-200%)
    transitionMuted?: boolean;
    transitionPath?: string; // Caminho em disco para injetar via Backend Híbrido
    dynamicTitles?: TitleHook[];
    /** Assinatura das legendas/narração usadas pela geração automática. */
    dynamicTitlesSourceKey?: string;
    /** Resumo local e sanitizado da geração; nunca contém prompt, token ou resposta bruta. */
    titleGenerationSummary?: TitleGenerationSummary;
    /** Paleta recebida do Mileto Ops; o contraste de texto e derivado no cliente. */
    brandPalette?: BrandPalette | null;
    brandPaletteUpdatedAt?: string | null;
    /** Empresa que define a marca do projeto; mídias podem vir de outras empresas autorizadas. */
    opsCompany?: OpsProjectCompany | null;
    customOverlayUrl?: string; // Imagem customizada de logo/título no Step4
}

export interface CaptionStyle {
    id: string;
    name: string;
    previewClass: string; // Tailwind class string for preview
    fontFamily?: string; // e.g. 'Impact', 'Montserrat', 'Bebas Neue'
    fontSize: number;
    strokeWidth: number;
    activeColor: string;
    baseColor: string;
    strokeColor: string;
    verticalPosition?: number; // Distance from bottom (percentage 0-100)
    textCase?: 'uppercase' | 'lowercase';
}

export interface MusicTrack {
    id: string;
    originalName: string;
    displayName: string;
    publicUrl: string;
    filePath: string;
    durationSec: number;
    createdAt: string;
    source?: 'system' | 'user';
    systemKey?: string;
    locked?: boolean;
}

// ─── Chat Mileto Types ──────────────────────────────────────────────────────

export interface ChatFolder {
    id: string;
    name: string;
    createdAt: string;
}

export type ChatAgentId = 'director' | 'prompt_sales' | 'image_director' | 'video_director';

export interface ChatSession {
    id: string;
    title: string;
    folderId: string | null;
    model: string;
    /** Agente principal desta conversa. Sessões antigas assumem `director`. */
    agentId?: ChatAgentId;
    createdAt: string;
    updatedAt: string;
}

export interface ChatMessage {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    /** Identidade pública segura; prompt/modelo reais nunca chegam ao renderer. */
    agentId?: ChatAgentId;
    agentLabel?: string;
    agentVersion?: number;
    agentTier?: 'lite' | 'mileto' | 'ultra';
    createdAt: string;
}
