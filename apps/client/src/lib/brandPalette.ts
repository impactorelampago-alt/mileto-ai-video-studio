import type { BrandPalette } from '../types';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const normalizeColor = (value: unknown): string | null => {
    const color = typeof value === 'string' ? value.trim() : '';
    return HEX_COLOR.test(color) ? color.toLowerCase() : null;
};

export const normalizeBrandPalette = (value: BrandPalette | null | undefined): BrandPalette | null => {
    if (!value) return null;
    const primary = normalizeColor(value.primary);
    const secondary = normalizeColor(value.secondary);
    const tertiary = normalizeColor(value.tertiary);
    if (!primary || !secondary || !tertiary) return null;

    const all = Array.from(new Set(
        [primary, secondary, tertiary, ...(Array.isArray(value.all) ? value.all : [])]
            .map(normalizeColor)
            .filter((color): color is string => Boolean(color))
    ));
    return { primary, secondary, tertiary, all };
};

const relativeLuminance = (color: string): number => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
    );
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

export const contrastingTextColor = (background: string): '#000000' | '#ffffff' => {
    const normalized = normalizeColor(background);
    if (!normalized) return '#ffffff';
    const luminance = relativeLuminance(normalized);
    const contrastWithBlack = (luminance + 0.05) / 0.05;
    const contrastWithWhite = 1.05 / (luminance + 0.05);
    return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
};

export const brandTitleColors = (
    value: BrandPalette | null | undefined,
    index = 0
): { primaryColor: string; secondaryColor: '#000000' | '#ffffff' } | null => {
    const palette = normalizeBrandPalette(value);
    if (!palette) return null;
    const compositionColors = [palette.primary, palette.secondary, palette.tertiary];
    const primaryColor = compositionColors[Math.abs(index) % compositionColors.length];
    return { primaryColor, secondaryColor: contrastingTextColor(primaryColor) };
};
