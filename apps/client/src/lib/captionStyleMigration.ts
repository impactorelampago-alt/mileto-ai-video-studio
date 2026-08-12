import type { CaptionStyle } from '../types';

export const HACKER_MATRIX_PRESET_REVISION = 2;

const hasLegacyHackerMatrixSignature = (style: CaptionStyle): boolean =>
    style.id === 'hacker-matrix' &&
    style.name === 'Hacker Matrix' &&
    style.fontFamily === 'Montserrat' &&
    style.baseColor.toUpperCase() === '#FFFFFF' &&
    style.strokeColor.toUpperCase() === '#000000' &&
    style.verticalPosition === 23 &&
    (style.presetRevision ?? 0) < HACKER_MATRIX_PRESET_REVISION;

const hasLegacyHackerMatrixGeometry = (style: CaptionStyle): boolean =>
    (style.fontSize === 20 && (style.strokeWidth === 4 || style.strokeWidth === 1)) ||
    (style.fontSize === 16 && style.strokeWidth === 1);

/**
 * Atualiza somente as assinaturas exatas dos antigos padrões Hacker Matrix.
 * Qualquer desvio é tratado como uma customização do usuário e preservado.
 * A cor ativa não participa da assinatura porque pode vir da marca do projeto.
 */
export const normalizeHydratedCaptionStyle = <T extends CaptionStyle | null | undefined>(style: T): T => {
    if (!style || !hasLegacyHackerMatrixSignature(style) || !hasLegacyHackerMatrixGeometry(style)) return style;
    return {
        ...style,
        fontSize: 16,
        strokeWidth: 1,
        presetRevision: HACKER_MATRIX_PRESET_REVISION,
    } as T;
};
