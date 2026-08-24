import type {
    MediaTake,
    NarrationIsolationSettings,
    TakeAudioMode,
    TakeAudioSettings,
} from '../types';

type NarrationAudioSource = {
    narrationAudioUrl?: string | null;
    narrationAudioPath?: string | null;
    sharedNarrationAssetId?: string | null;
    narrationIsolation?: NarrationIsolationSettings | null;
};

export interface EffectiveNarrationAudio {
    variant: 'original' | 'isolated';
    url: string | null;
    path: string | null;
    /** Existe somente na variante original, mas permanece acessível sem narrowing. */
    sharedAssetId?: string;
}

export interface TakeAudioMixItem {
    id: string;
    audioMode: Exclude<TakeAudioMode, 'off'>;
    volume: number;
    sourceUrl?: string;
    sourcePath?: string;
    isolatedAudioUrl?: string;
    isolatedAudioPath?: string;
    trim: { start: number; end: number };
    timelineStartSec: number;
    speed: number;
}

const cleanString = (value: unknown): string => (
    typeof value === 'string' ? value.trim() : ''
);

const finiteNumber = (value: unknown): number | null => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

/**
 * Assinatura pequena e determinística para estado de UI. A validação do cache
 * de áudio no servidor usa SHA-256 dos bytes; esta chave serve somente para
 * impedir que uma variante derivada seja aplicada a outra fonte no cliente.
 */
const sourceKey = (namespace: 'narration' | 'take', identity: string): string => {
    let hash = 2166136261;
    const value = `${namespace}\u0000${identity}`;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${namespace}-original-v1-${(hash >>> 0).toString(16)}`;
};

/**
 * Identifica o original sem depender de uma URL assinada que pode ser renovada.
 * O asset compartilhado é imutável; fontes locais usam o caminho persistente e,
 * na ausência dele, a URL disponível.
 */
export const narrationOriginalSourceKey = (source: NarrationAudioSource): string | null => {
    const sharedAssetId = cleanString(source.sharedNarrationAssetId);
    if (sharedAssetId) return sourceKey('narration', `shared:${sharedAssetId}`);

    const path = cleanString(source.narrationAudioPath);
    if (path) return sourceKey('narration', `path:${path}`);

    const url = cleanString(source.narrationAudioUrl);
    return url ? sourceKey('narration', `url:${url}`) : null;
};

/**
 * Para fontes do Ops, asset + versão/checksum vencem URLs temporárias. Para o
 * Compartilhado, o ID estável vence a URL assinada. Arquivos locais usam o
 * caminho do backend sempre que ele existe.
 */
export const takeOriginalSourceKey = (take: MediaTake): string => {
    const external = take.externalMedia;
    if (external?.source === 'mileto_ops') {
        const assetId = cleanString(external.assetId);
        if (assetId) {
            const revision = cleanString(external.checksum)
                || cleanString(external.version)
                || cleanString(external.mid);
            return sourceKey(
                'take',
                `ops:${cleanString(external.connectionId)}:${assetId}:${revision}`,
            );
        }
    }

    const sharedAssetId = cleanString(take.sharedAssetId);
    if (sharedAssetId) return sourceKey('take', `shared:${sharedAssetId}`);

    const backendPath = cleanString(take.backendPath);
    if (backendPath) return sourceKey('take', `path:${backendPath}`);

    const url = cleanString(take.fileUrl) || cleanString(take.url);
    if (url) return sourceKey('take', `url:${url}`);
    // `MediaTake.url` é obrigatório no contrato, mas rascunhos antigos ou
    // corrompidos ainda podem chegar vazios. A identidade de último recurso não
    // torna a fonte utilizável; apenas mantém a checagem de obsolescência tipada.
    return sourceKey(
        'take',
        `missing:${cleanString(take.id)}:${cleanString(take.fileName)}:${finiteNumber(take.originalDurationSeconds) ?? ''}`,
    );
};

/**
 * Projetos anteriores não possuem `audio`; por contrato isso significa `off`,
 * mesmo quando o antigo `muteOriginalAudio` era false.
 */
export const normalizeTakeAudio = (
    value: TakeAudioSettings | null | undefined,
): TakeAudioSettings => {
    const mode: TakeAudioMode = value?.mode === 'original' || value?.mode === 'isolated'
        ? value.mode
        : 'off';
    const rawVolume = finiteNumber(value?.volume);
    const volume = rawVolume == null ? 1 : Math.min(2, Math.max(0, rawVolume));
    return {
        mode,
        volume,
        isolatedAudioUrl: cleanString(value?.isolatedAudioUrl) || null,
        isolatedAudioPath: cleanString(value?.isolatedAudioPath) || null,
        isolationSourceKey: cleanString(value?.isolationSourceKey) || undefined,
    };
};

export const hasCurrentTakeIsolation = (take: MediaTake): boolean => {
    const audio = normalizeTakeAudio(take.audio);
    const currentSourceKey = takeOriginalSourceKey(take);
    return Boolean(
        currentSourceKey
        && audio.isolationSourceKey === currentSourceKey
        && (audio.isolatedAudioUrl || audio.isolatedAudioPath),
    );
};

/**
 * Isolada só se torna efetiva quando foi criada a partir do original atual e a
 * saída ainda existe no estado. Qualquer inconsistência cai no original.
 */
export const resolveEffectiveNarrationAudio = (
    source: NarrationAudioSource,
): EffectiveNarrationAudio => {
    const originalKey = narrationOriginalSourceKey(source);
    const isolation = source.narrationIsolation;
    const isolatedUrl = cleanString(isolation?.isolatedAudioUrl) || null;
    const isolatedPath = cleanString(isolation?.isolatedAudioPath) || null;
    if (
        isolation?.activeVariant === 'isolated'
        && originalKey
        && cleanString(isolation.isolationSourceKey) === originalKey
        && (isolatedUrl || isolatedPath)
    ) {
        return {
            variant: 'isolated',
            url: isolatedUrl,
            path: isolatedPath,
        };
    }

    const sharedAssetId = cleanString(source.sharedNarrationAssetId) || undefined;
    return {
        variant: 'original',
        url: cleanString(source.narrationAudioUrl) || null,
        path: cleanString(source.narrationAudioPath) || null,
        ...(sharedAssetId ? { sharedAssetId } : {}),
    };
};

const takePlaybackSpeed = (take: MediaTake, audioEnabled: boolean): number => {
    const preset = take.speedPresetId;
    if (!preset || preset === 'normal') return 1;
    if (audioEnabled) {
        throw new Error(
            `take_audio_speed_unsupported: O take ${take.id} usa remapeamento não linear; `
            + 'o áudio foi recusado para preservar o lip-sync.',
        );
    }
    // As curvas visuais atuais preservam a duração total. Takes sem áudio ainda
    // participam do cursor da timeline com duração 1x.
    return 1;
};

/**
 * Converte a sequência visual no contrato de `/api/audio/mix-takes`. Todos os
 * takes avançam o cursor, porém somente os que fizeram opt-in entram no áudio.
 */
export const buildTakeAudioMixItems = (takes: MediaTake[]): TakeAudioMixItem[] => {
    let timelineCursor = 0;
    const items: TakeAudioMixItem[] = [];

    for (const take of takes) {
        const audio = normalizeTakeAudio(take.audio);
        const audioEnabled = audio.mode !== 'off';
        const start = finiteNumber(take.trim?.start) ?? 0;
        const end = finiteNumber(take.trim?.end) ?? start;
        const rawDuration = Math.max(0, end - start);
        const speed = takePlaybackSpeed(take, audioEnabled);
        const timelineStartSec = timelineCursor;
        timelineCursor += rawDuration / speed;

        if (!audioEnabled) continue;
        if (take.type !== 'video') {
            throw new Error(
                `take_audio_source_unsupported: O take ${take.id} não é um vídeo e não pode fornecer áudio.`,
            );
        }
        if (start < 0 || end <= start) {
            throw new Error(`take_audio_trim_invalid: O corte de áudio do take ${take.id} é inválido.`);
        }

        const common = {
            id: take.id,
            audioMode: audio.mode as Exclude<TakeAudioMode, 'off'>,
            volume: audio.volume,
            trim: { start, end },
            timelineStartSec,
            speed,
        };

        if (audio.mode === 'isolated') {
            if (!hasCurrentTakeIsolation(take)) {
                throw new Error(
                    `take_audio_isolation_stale: A voz isolada do take ${take.id} não pertence à fonte atual.`,
                );
            }
            items.push({
                ...common,
                audioMode: 'isolated',
                ...(audio.isolatedAudioUrl ? { isolatedAudioUrl: audio.isolatedAudioUrl } : {}),
                ...(audio.isolatedAudioPath ? { isolatedAudioPath: audio.isolatedAudioPath } : {}),
            });
            continue;
        }

        const sourceUrl = cleanString(take.fileUrl) || cleanString(take.url);
        const sourcePath = cleanString(take.backendPath);
        if (!sourceUrl && !sourcePath) {
            throw new Error(
                `take_audio_source_unavailable: O áudio original do take ${take.id} não está disponível.`,
            );
        }
        items.push({
            ...common,
            audioMode: 'original',
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(sourcePath ? { sourcePath } : {}),
        });
    }

    return items;
};
