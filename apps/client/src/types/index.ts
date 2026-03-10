export interface TransitionAsset {
    id: string; // Pode ser um ID UUID
    originalName: string;
    savedName?: string;
    publicUrl: string; // Arquivo renderizado no Web server port 3301
    filePath: string; // Absolute path para C++ FFmpeg puxar do disco rigido C://
    durationSec: number;
    category?: string;
    isBuiltIn?: boolean;
}

import { SpeedPresetType } from '../lib/speedRemapping';

export interface SpeedKeyframe {
    id: string;
    position: number;
    speed: number;
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
    replicate?: string;
    runway?: string;
}

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
}

export interface AudioTrackConfig {
    enabled: boolean;
    volume: number; // 0 to 2 (200%)
    speed?: number; // Pitch/Tempo multiplier (e.g., 0.5 to 2.0)
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
    speed?: number; // Pitch/Tempo multiplier (0.5 to 2.0). Default 1.0.
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
}

export interface TitleHook {
    id: string;
    text: string;
    startSec: number;
    durationSec: number;
    isActive: boolean;
    posY: number; // Vertical position percentage (0-100), default 30
    scale?: number; // Size/zoom multiplier (e.g. 0.5 to 2.0), default 1.0
    styleId?: string; // e.g., 'neo-pop', 'solid-ribbon', 'gradient-glow'
    primaryColor?: string; // Primary text or accent color
    secondaryColor?: string; // Secondary background or text color
    animationId?: string; // Defines entrance/exit animation (e.g., 'pop', 'slide', 'fade', 'none')
    fontFamily?: string; // Título fonte (e.g. 'Inter', 'Anton')
    hasSound?: boolean; // Toggles the transition sound effect on/off
}

export interface AdData {
    title: string;
    format: VideoFormat;
    narrationText: string;
    selectedVoiceId: string | null;
    narrationVoiceId?: string;
    narrationAudioUrl: string | null;
    narrationAudioPath: string | null; // For backend reference
    isNarrationGenerated: boolean;
    musicAudioUrl?: string | null;
    audioConfig: AudioConfig; // Kept for backward compatibility
    audioTimeline?: AudioTimeline; // New Data Model
    masterAudioUrl?: string; // Mix of Narration + Background music generated on backend
    narrationDuration?: number;
    captions?: CaptionTrack;
    globalTransition?: TransitionAsset | null;
    transitionVolume?: number; // 0.0 to 1.0, default 1.0 (or mapped to 0-200%)
    transitionMuted?: boolean;
    transitionPath?: string; // Caminho em disco para injetar via Backend Híbrido
    dynamicTitles?: TitleHook[];
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
}

export interface MusicTrack {
    id: string;
    originalName: string;
    displayName: string;
    publicUrl: string;
    filePath: string;
    durationSec: number;
    createdAt: string;
}

// ─── Chat Mileto Types ──────────────────────────────────────────────────────

export interface ChatFolder {
    id: string;
    name: string;
    createdAt: string;
}

export interface ChatSession {
    id: string;
    title: string;
    folderId: string | null;
    model: string;
    createdAt: string;
    updatedAt: string;
}

export interface ChatMessage {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
}
