import type { AdData, CaptionTrack, MediaTake } from '../types';
import { takeOriginalSourceKey } from './audioIsolation.ts';
import { narrationSourceKey } from './narrationState.ts';

const hash = (value: string): string => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
};

/** A legenda extraída acompanha a ordem, a fonte e os recortes dos takes, não a voz de IA. */
export const videoCaptionSourceKey = (takes: MediaTake[]): string => `takes-v1-${hash(JSON.stringify(
    takes.map((take) => [
        take.id,
        take.type,
        takeOriginalSourceKey(take),
        take.trim.start,
        take.trim.end,
        take.speedPresetId || 'normal',
    ]),
))}`;

export const currentCaptionSourceKey = (
    adData: AdData,
    takes: MediaTake[],
): string => adData.captions?.sourceKind === 'takes'
    ? videoCaptionSourceKey(takes)
    : narrationSourceKey(adData);

export const currentCaptionTrack = (
    adData: AdData,
    takes: MediaTake[],
): CaptionTrack | undefined => adData.captions?.sourceKey === currentCaptionSourceKey(adData, takes)
    ? adData.captions
    : undefined;

/** Payload de extração: o áudio original é lido sem alterar o mute do projeto. */
export const videoCaptionMixTakes = (takes: MediaTake[]) => {
    if (!takes.some((take) => take.type === 'video')) {
        throw new Error('Adicione ao menos um take de vídeo para extrair legendas.');
    }
    let timelineStartSec = 0;
    return takes.map((take) => {
        const duration = take.trim.end - take.trim.start;
        if (!Number.isFinite(duration) || duration <= 0 || take.trim.start < 0) {
            throw new Error(`O recorte do take ${take.fileName || take.id} é inválido.`);
        }
        const position = timelineStartSec;
        timelineStartSec += duration;
        if (take.type !== 'video') {
            return { id: take.id, trim: take.trim, timelineStartSec: position };
        }
        if (take.speedPresetId && take.speedPresetId !== 'normal') {
            throw new Error(`O take ${take.fileName || take.id} usa velocidade variável; normalize-o antes de extrair legendas sincronizadas.`);
        }
        const sourceUrl = take.fileUrl || take.url;
        const sourcePath = take.externalMedia || take.sharedAssetId ? undefined : take.backendPath;
        if (!sourceUrl && !sourcePath) {
            throw new Error(`O arquivo do take ${take.fileName || take.id} não está disponível para extração.`);
        }
        return {
            id: take.id,
            audioMode: 'original' as const,
            sourceUrl,
            sourcePath,
            trim: take.trim,
            timelineStartSec: position,
            volume: 1,
        };
    });
};
