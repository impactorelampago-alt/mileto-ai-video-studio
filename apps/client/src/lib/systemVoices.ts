import { DEFAULT_VOICE_SETTINGS, type TtsProvider, type VoicePreset } from '../types';
import { DEFAULT_PRESET_AUDIO_CONFIG, SYSTEM_MUSIC_IDS } from './systemMusic';
import {
    applySystemVoicePresetOverride,
    compactSystemVoicePresetOverride,
    isEmptySystemVoicePresetOverride,
    migrateLegacySystemVoicePresetOverrides,
    type SystemVoicePresetOverride,
} from './systemVoicePresetOverrides';

export interface SystemVoice {
    id: string;
    /** Chave editorial segura para contexto de IA; nunca é o reference ID do provedor. */
    catalogKey: string;
    name: string;
    desc: string;
    provider: TtsProvider;
    preset: VoicePreset;
}

const createPreset = (
    speed: number,
    volume: number,
    musicTrackId: string | null,
    // Volumes de mixagem do preset (0..N). Ausente = padrão global
    // (narração 100%, música 30%).
    audioVolumes?: { narration?: number; background?: number },
): VoicePreset => ({
    voiceSettings: { ...DEFAULT_VOICE_SETTINGS, speed, volume },
    musicTrackId,
    audioConfig: {
        narration: {
            ...DEFAULT_PRESET_AUDIO_CONFIG.narration,
            ...(audioVolumes?.narration !== undefined ? { volume: audioVolumes.narration } : {}),
        },
        background: {
            ...DEFAULT_PRESET_AUDIO_CONFIG.background,
            ...(audioVolumes?.background !== undefined ? { volume: audioVolumes.background } : {}),
        },
    },
});

/**
 * Vozes que acompanham o produto, com o preset editorial aplicado ao serem
 * selecionadas. O usuário ainda pode ajustar tudo dentro do projeto.
 */
export const SYSTEM_VOICES: SystemVoice[] = [
    {
        id: 'd7cdad0d54464bcfade4be58791c6f3d',
        catalogKey: 'mv-system-01',
        name: 'Padrão Masculina',
        desc: 'Voz marcante, vendas',
        provider: 'fishAudio',
        preset: createPreset(1.4, 5, SYSTEM_MUSIC_IDS.batida),
    },
    {
        id: '64ea557cd80c4fb99a96b209763f4ec9',
        catalogKey: 'mv-system-02',
        name: 'Padrão Feminina',
        desc: 'Voz clara, explicativa',
        provider: 'fishAudio',
        preset: createPreset(1.2, 5, SYSTEM_MUSIC_IDS.blogueira),
    },
    {
        id: 'fffaeef680cf41cdaff2c65d8cdd8650',
        catalogKey: 'mv-system-03',
        name: 'Rodeio',
        desc: 'Locução animada, eventos',
        provider: 'fishAudio',
        // Padrão do Rodeio: narração 110%, música de fundo 25%.
        preset: createPreset(1, 0, SYSTEM_MUSIC_IDS.rodeio, { narration: 1.1, background: 0.25 }),
    },
    {
        id: '5c7c62ef7fc545908c8de8feab76a272',
        catalogKey: 'mv-system-04',
        name: 'Locutor Rádio',
        desc: 'Locução de rádio, impacto',
        provider: 'fishAudio',
        preset: createPreset(1.45, 5, SYSTEM_MUSIC_IDS.batida),
    },
];

const RODEIO_SYSTEM_VOICE_ID = 'fffaeef680cf41cdaff2c65d8cdd8650';

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

const LEGACY_SYSTEM_VOICE_PRESETS_KEY = 'mileto_system_voice_presets_v1';
const SYSTEM_VOICE_PRESETS_KEY = 'mileto_system_voice_presets_v2';

const readStoredRecord = <T,>(key: string): Record<string, T> | null => {
    if (typeof window === 'undefined') return null;
    try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || 'null');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const readPresetOverrides = (): Record<string, SystemVoicePresetOverride> => {
    if (typeof window === 'undefined') return {};
    const current = readStoredRecord<SystemVoicePresetOverride>(SYSTEM_VOICE_PRESETS_KEY);
    if (current) return current;

    const legacy = readStoredRecord<VoicePreset>(LEGACY_SYSTEM_VOICE_PRESETS_KEY) || {};
    const fallbackByVoiceId = Object.fromEntries(
        SYSTEM_VOICES.map((voice) => [voice.id, voice.preset]),
    );
    const legacyRodeioPreset = createPreset(1, 0, null);
    const migrated = migrateLegacySystemVoicePresetOverrides(legacy, {
        canonicalVoiceId: (id) => canonicalSystemVoiceId(id) || id,
        fallbackByVoiceId,
        bundledUpgrades: {
            // Antes da v1.4.22, salvar o padrão original do Rodeio gravava um
            // snapshot sem música. Esse snapshot não era uma escolha explícita
            // e não deve esconder a faixa Rodeio adicionada ao produto.
            [RODEIO_SYSTEM_VOICE_ID]: {
                from: legacyRodeioPreset,
                to: fallbackByVoiceId[RODEIO_SYSTEM_VOICE_ID],
            },
        },
    });
    try {
        window.localStorage.setItem(SYSTEM_VOICE_PRESETS_KEY, JSON.stringify(migrated));
    } catch {
        // O fallback canônico continua disponível quando o armazenamento falha.
    }
    return migrated;
};

export const effectiveSystemVoicePreset = (id?: string | null): VoicePreset | undefined => {
    const canonicalId = canonicalSystemVoiceId(id);
    const fallback = SYSTEM_VOICES.find((voice) => voice.id === canonicalId)?.preset;
    if (!fallback || !canonicalId) return fallback;
    const overrides = readPresetOverrides();
    const override = overrides[canonicalId] || (id ? overrides[id] : undefined);
    return applySystemVoicePresetOverride(fallback, override);
};

export const saveSystemVoicePreset = (id: string, preset: VoicePreset) => {
    if (typeof window === 'undefined' || !SYSTEM_VOICE_IDS.has(id)) return;
    const canonicalId = canonicalSystemVoiceId(id);
    const fallback = SYSTEM_VOICES.find((voice) => voice.id === canonicalId)?.preset;
    if (!canonicalId || !fallback) return;
    const next = { ...readPresetOverrides() };
    const override = compactSystemVoicePresetOverride(fallback, preset);
    if (isEmptySystemVoicePresetOverride(override)) delete next[canonicalId];
    else next[canonicalId] = override;
    window.localStorage.setItem(SYSTEM_VOICE_PRESETS_KEY, JSON.stringify(next));
};

export const findVoicePreset = (id?: string | null): VoicePreset | undefined =>
    effectiveSystemVoicePreset(id);
