import { API_BASE_URL } from './apiBase';
import { localAuthHeaders } from './serverAuth';

export type AudioIsolationSourceType = 'narration' | 'take';

export interface AudioIsolationResult {
    outputUrl: string;
    outputPath: string | null;
    sourceDuration: number;
    outputDuration: number;
    cacheHit: boolean;
}

const absoluteLocalUrl = (value: string): string => /^https?:\/\//i.test(value)
    ? value
    : `${API_BASE_URL}${value.startsWith('/') ? value : `/${value}`}`;

export const isolateAudioSource = async (input: {
    sourceUrl?: string | null;
    sourcePath?: string | null;
    sourceType: AudioIsolationSourceType;
}): Promise<AudioIsolationResult> => {
    const sourceUrl = String(input.sourceUrl || '').trim();
    const sourcePath = String(input.sourcePath || '').trim();
    if (!sourceUrl && !sourcePath) {
        throw new Error('A fonte original não está disponível para isolamento.');
    }

    const response = await fetch(`${API_BASE_URL}/api/audio/isolate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await localAuthHeaders()) },
        body: JSON.stringify({
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(sourcePath ? { sourcePath } : {}),
            sourceType: input.sourceType,
        }),
    });
    const data = await response.json() as {
        ok?: boolean;
        message?: string;
        outputUrl?: string;
        outputPath?: string;
        sourceDuration?: number;
        outputDuration?: number;
        sourceDurationSeconds?: number;
        isolatedDurationSeconds?: number;
        cacheHit?: boolean;
        demo?: boolean;
    };
    if (!response.ok || !data.ok) {
        throw new Error(data.message || 'Não foi possível isolar a voz.');
    }
    if (data.demo) {
        throw new Error('O servidor devolveu apenas uma demonstração. O original foi preservado e a variante não foi ativada.');
    }

    const outputUrl = String(data.outputUrl || '').trim();
    const sourceDuration = Number(data.sourceDurationSeconds ?? data.sourceDuration);
    const outputDuration = Number(data.isolatedDurationSeconds ?? data.outputDuration);
    if (!outputUrl || !(sourceDuration > 0) || !(outputDuration > 0)) {
        throw new Error('O isolamento terminou sem uma saída completa e verificável.');
    }
    const tolerance = Math.max(0.25, sourceDuration * 0.02);
    if (Math.abs(sourceDuration - outputDuration) > tolerance) {
        throw new Error('A duração da voz isolada divergiu do original. O original foi preservado.');
    }

    return {
        outputUrl: absoluteLocalUrl(outputUrl),
        outputPath: String(data.outputPath || '').trim() || null,
        sourceDuration,
        outputDuration,
        cacheHit: data.cacheHit === true,
    };
};
