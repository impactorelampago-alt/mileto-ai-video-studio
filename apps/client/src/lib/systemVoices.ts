import { DEFAULT_VOICE_SETTINGS, type TtsProvider, type VoicePreset } from '../types';
import { DEFAULT_PRESET_AUDIO_CONFIG, SYSTEM_MUSIC_IDS } from './systemMusic';

export interface SystemVoice {
    id: string;
    name: string;
    desc: string;
    provider: TtsProvider;
    preset: VoicePreset;
}

const createPreset = (
    speed: number,
    volume: number,
    musicTrackId: string | null,
): VoicePreset => ({
    voiceSettings: { ...DEFAULT_VOICE_SETTINGS, speed, volume },
    musicTrackId,
    audioConfig: {
        narration: { ...DEFAULT_PRESET_AUDIO_CONFIG.narration },
        background: { ...DEFAULT_PRESET_AUDIO_CONFIG.background },
    },
});

/**
 * Vozes que acompanham o produto, com o preset editorial aplicado ao serem
 * selecionadas. O usuário ainda pode ajustar tudo dentro do projeto.
 */
export const SYSTEM_VOICES: SystemVoice[] = [
    {
        id: 'd7cdad0d54464bcfade4be58791c6f3d',
        name: 'Padrão Masculina',
        desc: 'Voz marcante, vendas',
        provider: 'fishAudio',
        preset: createPreset(1.4, 5, SYSTEM_MUSIC_IDS.batida),
    },
    {
        id: '64ea557cd80c4fb99a96b209763f4ec9',
        name: 'Padrão Feminina',
        desc: 'Voz clara, explicativa',
        provider: 'fishAudio',
        preset: createPreset(1.2, 5, SYSTEM_MUSIC_IDS.blogueira),
    },
    {
        id: 'fffaeef680cf41cdaff2c65d8cdd8650',
        name: 'Rodeio',
        desc: 'Locução animada, eventos',
        provider: 'fishAudio',
        preset: createPreset(1, 0, SYSTEM_MUSIC_IDS.rodeio),
    },
    {
        id: '5c7c62ef7fc545908c8de8feab76a272',
        name: 'Locutor Rádio',
        desc: 'Locução de rádio, impacto',
        provider: 'fishAudio',
        preset: createPreset(1.45, 5, SYSTEM_MUSIC_IDS.batida),
    },
];

const LEGACY_SYSTEM_VOICE_ID_MAP: Record<string, string> = {
    // Até a v1.4.21 este era o ID da antiga "Padrão Masculina". Projetos
    // persistidos devem passar a usar a voz masculina atual sem ficar órfãos.
    '15c9660604bc4c5585838456a48e4eee': 'd7cdad0d54464bcfade4be58791c6f3d',
};

export const canonicalSystemVoiceId = (id?: string | null): string | null | undefined =>
    id ? (LEGACY_SYSTEM_VOICE_ID_MAP[id] || id) : id;

export const SYSTEM_VOICE_IDS = new Set([
    ...SYSTEM_VOICES.map((voice) => voice.id),
    ...Object.keys(LEGACY_SYSTEM_VOICE_ID_MAP),
]);

export const DEFAULT_SYSTEM_VOICE = SYSTEM_VOICES[0];

const SYSTEM_VOICE_PRESETS_KEY = 'mileto_system_voice_presets_v1';

const readPresetOverrides = (): Record<string, VoicePreset> => {
    if (typeof window === 'undefined') return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(SYSTEM_VOICE_PRESETS_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

export const effectiveSystemVoicePreset = (id?: string | null): VoicePreset | undefined => {
    const canonicalId = canonicalSystemVoiceId(id);
    const fallback = SYSTEM_VOICES.find((voice) => voice.id === canonicalId)?.preset;
    if (!fallback || !canonicalId) return fallback;
    const overrides = readPresetOverrides();
    const override = overrides[canonicalId] || (id ? overrides[id] : undefined);
    return override ? {
        voiceSettings: { ...fallback.voiceSettings, ...override.voiceSettings },
        musicTrackId: override.musicTrackId ?? null,
        audioConfig: {
            narration: { ...fallback.audioConfig.narration, ...override.audioConfig?.narration },
            background: { ...fallback.audioConfig.background, ...override.audioConfig?.background },
        },
    } : fallback;
};

export const saveSystemVoicePreset = (id: string, preset: VoicePreset) => {
    if (typeof window === 'undefined' || !SYSTEM_VOICE_IDS.has(id)) return;
    window.localStorage.setItem(SYSTEM_VOICE_PRESETS_KEY, JSON.stringify({
        ...readPresetOverrides(),
        [id]: preset,
    }));
};

export const findVoicePreset = (id?: string | null): VoicePreset | undefined =>
    effectiveSystemVoicePreset(id);
