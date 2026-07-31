import type {
    MediaTake,
    TakeEnhancementSettings,
    TakeSharpnessSettings,
    VideoEnhancementIntensity,
    VideoEnhancementSettings,
} from '../types';

export const DEFAULT_VIDEO_ENHANCEMENT: VideoEnhancementSettings = {
    enabled: false,
    intensity: 'balanced',
    globalSharpness: 0,
};

export const VIDEO_ENHANCEMENT_INTENSITIES: Array<{
    id: VideoEnhancementIntensity;
    label: string;
    description: string;
}> = [
    { id: 'soft', label: 'Suave', description: 'Correção discreta e natural.' },
    { id: 'balanced', label: 'Equilibrada', description: 'Melhora recomendada para a maioria dos takes.' },
    { id: 'strong', label: 'Forte', description: 'Mais contraste, cor e redução de ruído.' },
];

export const clampSharpness = (value: unknown): number => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(Math.min(100, Math.max(0, numeric)));
};

export const normalizeVideoEnhancement = (
    settings?: Partial<VideoEnhancementSettings> | null
): VideoEnhancementSettings => {
    const intensity: VideoEnhancementIntensity =
        settings?.intensity === 'soft' || settings?.intensity === 'strong' ? settings.intensity : 'balanced';
    return {
        enabled: settings?.enabled === true,
        intensity,
        globalSharpness: clampSharpness(settings?.globalSharpness),
    };
};

export const normalizeTakeSharpness = (
    settings?: Partial<TakeSharpnessSettings> | null
): TakeSharpnessSettings => {
    const mode = settings?.mode === 'off' || settings?.mode === 'custom' ? settings.mode : 'inherit';
    return { mode, amount: clampSharpness(settings?.amount) };
};

export const normalizeTakeEnhancement = (
    settings?: Partial<TakeEnhancementSettings> | null
): TakeEnhancementSettings => {
    const mode = settings?.mode === 'off' || settings?.mode === 'custom' ? settings.mode : 'inherit';
    const intensity: VideoEnhancementIntensity =
        settings?.intensity === 'soft' || settings?.intensity === 'strong' ? settings.intensity : 'balanced';
    return { mode, enabled: settings?.enabled === true, intensity };
};

export const resolveTakeEnhancement = (
    take: Pick<MediaTake, 'enhancement'>,
    settings?: Partial<VideoEnhancementSettings> | null
): VideoEnhancementSettings => {
    const global = normalizeVideoEnhancement(settings);
    const local = normalizeTakeEnhancement(take.enhancement);
    if (local.mode === 'inherit') return global;
    return {
        ...global,
        enabled: local.mode === 'custom' && local.enabled,
        intensity: local.intensity,
    };
};

export const resolveTakeSharpness = (
    take: Pick<MediaTake, 'sharpness'>,
    settings?: Partial<VideoEnhancementSettings> | null
): number => {
    const global = normalizeVideoEnhancement(settings).globalSharpness;
    const local = normalizeTakeSharpness(take.sharpness);
    if (local.mode === 'off') return 0;
    return local.mode === 'custom' ? local.amount : global;
};

export const enhancementPreviewCss = (
    settings?: Partial<VideoEnhancementSettings> | null,
    sharpness = 0,
    svgFilterId?: string
): string => {
    const normalized = normalizeVideoEnhancement(settings);
    const correction = normalized.enabled
        ? normalized.intensity === 'soft'
            ? 'brightness(1.006) contrast(1.025) saturate(1.035)'
            : normalized.intensity === 'strong'
              ? 'brightness(1.012) contrast(1.06) saturate(1.075)'
              : 'brightness(1.008) contrast(1.04) saturate(1.055)'
        : '';
    const sharpen = sharpness > 0 && svgFilterId ? `url(#${svgFilterId})` : '';
    return [correction, sharpen].filter(Boolean).join(' ') || 'none';
};

export const sharpnessKernel = (amount: number): string => {
    // A prévia usa um kernel conservador; o render final emprega unsharp no FFmpeg.
    const value = (clampSharpness(amount) / 100) * 0.32;
    return `0 ${(-value).toFixed(4)} 0 ${(-value).toFixed(4)} ${(1 + value * 4).toFixed(4)} ${(-value).toFixed(4)} 0 ${(-value).toFixed(4)} 0`;
};

export const sharpnessLabel = (amount: number): string => {
    const normalized = clampSharpness(amount);
    if (normalized === 0) return 'Desligada';
    if (normalized <= 30) return 'Suave';
    if (normalized <= 65) return 'Média';
    return 'Forte';
};
