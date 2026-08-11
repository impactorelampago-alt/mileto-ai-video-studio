import type { MediaTake } from '../types';
import { gatewayApi } from './gateway';

type SharedAssetLookup = (id: string) => Promise<{ publicUrl?: string | null }>;

export const safeExportMediaName = (fileName: string, fallback = 'midia_compartilhada') => {
    const safeName = Array.from(String(fileName || ''))
        .map((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127 || '\\/:*?"<>|'.includes(character)
                ? '_'
                : character;
        })
        .join('')
        .trim()
        .slice(0, 160);
    return safeName || fallback;
};

const signedSharedUrl = (asset: { publicUrl?: string | null }): string => {
    const publicUrl = String(asset?.publicUrl || '').trim();
    try {
        const parsed = new URL(publicUrl);
        const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
        const r2Suffix = '.r2.cloudflarestorage.com';
        const r2Prefix = hostname.endsWith(r2Suffix)
            ? hostname.slice(0, -r2Suffix.length)
            : '';
        if (
            parsed.protocol !== 'https:' ||
            (parsed.port && parsed.port !== '443') ||
            !r2Prefix ||
            !r2Prefix.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
        ) {
            throw new Error('untrusted');
        }
        return publicUrl;
    } catch {
        throw new Error('O ambiente compartilhado não devolveu um link assinado válido.');
    }
};

export const refreshSharedAudioSourceUrl = async (
    assetId: string | null | undefined,
    currentUrl: string | null | undefined,
    errorCode: string,
    loadSharedAsset: SharedAssetLookup = (id) => gatewayApi.sharedAsset(id),
): Promise<string | null | undefined> => {
    const normalizedAssetId = String(assetId || '').trim();
    if (!normalizedAssetId) return currentUrl;
    try {
        return signedSharedUrl(await loadSharedAsset(normalizedAssetId));
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${errorCode}: ${reason}`);
    }
};

export const refreshSharedTakeForExport = async (
    take: MediaTake,
    loadSharedAsset: SharedAssetLookup = (id) => gatewayApi.sharedAsset(id),
): Promise<MediaTake> => {
    const sharedAssetId = String(take.sharedAssetId || '').trim();
    if (!sharedAssetId) return take;

    const safeTakeName = safeExportMediaName(take.fileName, 'take_compartilhado');
    try {
        const publicUrl = signedSharedUrl(await loadSharedAsset(sharedAssetId));
        // O motor já fechou o snapshot da timeline. Somente a fonte renovável
        // pode mudar neste ponto; cortes, duração e efeitos permanecem idênticos.
        return {
            ...take,
            url: publicUrl,
            fileUrl: publicUrl,
            proxyUrl: publicUrl,
            backendPath: undefined,
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`shared_export_take_unavailable: ${safeTakeName}: ${reason}`);
    }
};

export const refreshSharedMasterAudioForExport = async (
    assetId: string,
    loadSharedAsset: SharedAssetLookup = (id) => gatewayApi.sharedAsset(id),
): Promise<string> => {
    const normalizedAssetId = String(assetId || '').trim();
    if (!normalizedAssetId) {
        throw new Error('shared_export_audio_unavailable: O mix compartilhado perdeu sua identificação.');
    }
    const publicUrl = await refreshSharedAudioSourceUrl(
        normalizedAssetId,
        undefined,
        'shared_export_audio_unavailable',
        loadSharedAsset,
    );
    if (!publicUrl) throw new Error('shared_export_audio_unavailable: O link assinado ficou vazio.');
    return publicUrl;
};
