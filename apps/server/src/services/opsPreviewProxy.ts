import path from 'path';

export type OpsPreviewProxyProfile = 'trim' | 'standard';

export interface OpsPreviewCompatibilityInput {
    filePath: string;
    mimeType?: string | null;
    codecName?: string | null;
    pixelFormat?: string | null;
    skipProxy: boolean;
}

const NATIVE_VIDEO_CODECS = new Set(['h264', 'av1', 'vp8', 'vp9']);
const NATIVE_VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const NATIVE_H264_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p', 'nv12']);

/**
 * Decide se o cache precisa de um proxy e qual qualidade usar.
 *
 * O Editor de Cortes pede `skipProxy` para não recodificar MP4/H.264 que o
 * Chromium já toca. Esse atalho não pode ser aplicado a HEVC/ProRes (comuns em
 * `.MOV` de celular): nesses casos geramos um proxy menor e muito mais rápido.
 * O editor principal continua recebendo o proxy padrão de maior resolução.
 */
export const selectOpsPreviewProxyProfile = (
    input: OpsPreviewCompatibilityInput,
): OpsPreviewProxyProfile | null => {
    if (!input.skipProxy) return 'standard';

    const extension = path.extname(input.filePath).toLowerCase();
    const mimeType = String(input.mimeType || '').toLowerCase().split(';')[0].trim();
    const codecName = String(input.codecName || '').toLowerCase().trim();
    const pixelFormat = String(input.pixelFormat || '').toLowerCase().trim();

    if (!NATIVE_VIDEO_EXTENSIONS.has(extension)) return 'trim';
    if (mimeType && !['video/mp4', 'video/quicktime', 'video/webm'].includes(mimeType)) return 'trim';

    // Sem codec confiável, MOV continua conservador: a maioria dos casos que
    // chega sem metadado é HEVC de iPhone, que resulta em tela preta no Electron.
    if (!codecName) return extension === '.mov' || mimeType === 'video/quicktime' ? 'trim' : null;
    if (!NATIVE_VIDEO_CODECS.has(codecName)) return 'trim';
    if (codecName === 'h264' && pixelFormat && !NATIVE_H264_PIXEL_FORMATS.has(pixelFormat)) return 'trim';

    return null;
};
