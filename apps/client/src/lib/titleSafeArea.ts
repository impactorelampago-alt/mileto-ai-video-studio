import type { CaptionStyle, VideoFormat } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type CaptionGeometry = Pick<CaptionStyle, 'fontSize' | 'strokeWidth' | 'verticalPosition'>;

/**
 * Linha superior da faixa reservada para a legenda, em coordenadas do palco (0-100%).
 * Reservamos duas linhas, contorno e uma folga visual para que animações de título não
 * encostem na legenda durante a entrada/saída.
 */
export const captionSafeTopPercent = (
    style: Partial<CaptionGeometry> | null | undefined,
    format: VideoFormat = '9:16'
) => {
    if (!style) return undefined;

    const designHeight = format === '1:1' ? 360 : 640;
    const fontSize = clamp(style.fontSize ?? 20, 8, 80);
    const strokeWidth = clamp(style.strokeWidth ?? 1, 0, 12);
    const bottom = clamp(style.verticalPosition ?? 23, 0, 90);
    const twoLineHeightPx = fontSize * 2.4;
    const strokeOverflowPx = strokeWidth * 2;
    const reservedHeightPercent = ((twoLineHeightPx + strokeOverflowPx) / designHeight) * 100;

    return clamp(100 - bottom - reservedHeightPercent - 3.5, 34, 82);
};
