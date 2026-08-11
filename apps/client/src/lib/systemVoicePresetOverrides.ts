import type { VoicePreset } from '../types';

export interface SystemVoicePresetOverride {
    voiceSettings?: Partial<VoicePreset['voiceSettings']>;
    musicTrackId?: string | null;
    audioConfig?: {
        narration?: Partial<VoicePreset['audioConfig']['narration']>;
        background?: Partial<VoicePreset['audioConfig']['background']>;
    };
}

interface BundledPresetUpgrade {
    from: VoicePreset;
    to: VoicePreset;
}

interface LegacyPresetMigrationOptions {
    canonicalVoiceId: (id: string) => string;
    fallbackByVoiceId: Record<string, VoicePreset>;
    bundledUpgrades?: Record<string, BundledPresetUpgrade>;
}

const own = (value: object, key: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(value, key);

const diffObject = <T extends object>(fallback: T, current: T): Partial<T> => {
    const delta: Partial<T> = {};
    for (const key of Object.keys(fallback) as Array<keyof T>) {
        if (!Object.is(current[key], fallback[key])) delta[key] = current[key];
    }
    return delta;
};

const hasKeys = (value?: object): boolean => Boolean(value && Object.keys(value).length);

export const isEmptySystemVoicePresetOverride = (override: SystemVoicePresetOverride): boolean =>
    !hasKeys(override.voiceSettings) &&
    !own(override, 'musicTrackId') &&
    !hasKeys(override.audioConfig?.narration) &&
    !hasKeys(override.audioConfig?.background);

export const applySystemVoicePresetOverride = (
    fallback: VoicePreset,
    override?: SystemVoicePresetOverride,
): VoicePreset => {
    if (!override) return fallback;
    return {
        voiceSettings: { ...fallback.voiceSettings, ...override.voiceSettings },
        musicTrackId: own(override, 'musicTrackId')
            ? override.musicTrackId ?? null
            : fallback.musicTrackId,
        audioConfig: {
            narration: {
                ...fallback.audioConfig.narration,
                ...override.audioConfig?.narration,
            },
            background: {
                ...fallback.audioConfig.background,
                ...override.audioConfig?.background,
            },
        },
    };
};

export const compactSystemVoicePresetOverride = (
    fallback: VoicePreset,
    current: VoicePreset,
): SystemVoicePresetOverride => {
    const voiceSettings = diffObject(fallback.voiceSettings, current.voiceSettings);
    const narration = diffObject(fallback.audioConfig.narration, current.audioConfig.narration);
    const background = diffObject(fallback.audioConfig.background, current.audioConfig.background);
    const override: SystemVoicePresetOverride = {};

    if (hasKeys(voiceSettings)) override.voiceSettings = voiceSettings;
    if (current.musicTrackId !== fallback.musicTrackId) override.musicTrackId = current.musicTrackId;
    if (hasKeys(narration) || hasKeys(background)) {
        override.audioConfig = {};
        if (hasKeys(narration)) override.audioConfig.narration = narration;
        if (hasKeys(background)) override.audioConfig.background = background;
    }
    return override;
};

const samePreset = (left: VoicePreset, right: VoicePreset): boolean =>
    JSON.stringify(left) === JSON.stringify(right);

/**
 * Converte os snapshots completos da v1 em deltas. Assim, uma atualização dos
 * padrões editoriais do produto alcança instalações antigas sem apagar ajustes
 * que o usuário realmente personalizou.
 */
export const migrateLegacySystemVoicePresetOverrides = (
    legacy: Record<string, VoicePreset>,
    options: LegacyPresetMigrationOptions,
): Record<string, SystemVoicePresetOverride> => {
    const migrated: Record<string, SystemVoicePresetOverride> = {};
    const entries = Object.entries(legacy).sort(([left], [right]) => {
        const leftIsCanonical = options.canonicalVoiceId(left) === left;
        const rightIsCanonical = options.canonicalVoiceId(right) === right;
        return Number(leftIsCanonical) - Number(rightIsCanonical);
    });

    for (const [storedId, storedPreset] of entries) {
        const canonicalId = options.canonicalVoiceId(storedId);
        const fallback = options.fallbackByVoiceId[canonicalId];
        if (!fallback || !storedPreset || typeof storedPreset !== 'object') continue;

        const bundledUpgrade = options.bundledUpgrades?.[canonicalId];
        const effectiveStored = bundledUpgrade && samePreset(storedPreset, bundledUpgrade.from)
            ? bundledUpgrade.to
            : storedPreset;
        const override = compactSystemVoicePresetOverride(fallback, effectiveStored);
        if (isEmptySystemVoicePresetOverride(override)) delete migrated[canonicalId];
        else migrated[canonicalId] = override;
    }

    return migrated;
};
