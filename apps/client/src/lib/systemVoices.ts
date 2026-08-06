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
        name: 'Thales Impacto',
        desc: 'Voz original, marcante',
        provider: 'fishAudio',
        preset: createPreset(1.4, 5, SYSTEM_MUSIC_IDS.batida),
    },
    {
        id: '15c9660604bc4c5585838456a48e4eee',
        name: 'Padrão Masculina',
        desc: 'Voz imposta, vendas',
        provider: 'fishAudio',
        preset: createPreset(1, 0, null),
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
        preset: createPreset(1, 0, null),
    },
    {
        id: '5c7c62ef7fc545908c8de8feab76a272',
        name: 'Locutor Rádio',
        desc: 'Locução de rádio, impacto',
        provider: 'fishAudio',
        preset: createPreset(1.45, 5, SYSTEM_MUSIC_IDS.batida),
    },
];

export const SYSTEM_VOICE_IDS = new Set(SYSTEM_VOICES.map((voice) => voice.id));

export const DEFAULT_SYSTEM_VOICE = SYSTEM_VOICES[0];

export const findVoicePreset = (id?: string | null): VoicePreset | undefined =>
    SYSTEM_VOICES.find((voice) => voice.id === id)?.preset;
