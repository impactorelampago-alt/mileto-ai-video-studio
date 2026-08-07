import { API_BASE_URL } from './apiBase';
import { repairCaptionCurrencySegments } from './captionCurrency';
import { gatewayApi, type OpsAsset, type OpsViewContext } from './gateway';
import { invalidatedNarrationDerivatives, narrationSourceKey } from './narrationState';
import { bindTitlesToBrandPalette, resolveOpsProjectBrand } from './opsProjectBrand';
import { localAuthHeaders } from './serverAuth';
import type { AdData, CaptionStyle, MediaTake, TitleHook } from '../types';
import type { OpsExportMetadata } from '../context/ExportJobsContext';

type ApiEnvelope<T> = {
    ok?: boolean;
    message?: string;
    code?: string;
    data?: T;
    [key: string]: unknown;
};

const readApi = async <T>(response: Response): Promise<T & ApiEnvelope<T>> => {
    const data = await response.json().catch(() => ({})) as T & ApiEnvelope<T>;
    if (!response.ok || data.ok === false) {
        throw new Error(`${data.code ? `${data.code}: ` : ''}${data.message || `Erro HTTP ${response.status}`}`);
    }
    return data;
};

export const generateNarrationAndMix = async (input: AdData): Promise<AdData> => {
    const narrationText = input.narrationText.trim();
    if (!narrationText) throw new Error('agent_narration_missing: O agente não forneceu a narração final.');

    const response = await fetch(`${API_BASE_URL}/api/tts/generate-narration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await localAuthHeaders()) },
        body: JSON.stringify({
            text: narrationText,
            voiceId: input.selectedVoiceId,
            provider: input.selectedVoiceProvider || 'fishAudio',
            voiceSettings: input.voiceSettings,
        }),
    });
    const narration = await readApi<{ url?: string; duration?: number }>(response);
    if (!narration.url) throw new Error('tts_audio_missing: A síntese terminou sem devolver o áudio.');

    const narrationUrl = /^https?:\/\//i.test(narration.url)
        ? narration.url
        : `${API_BASE_URL}${narration.url}`;
    const narrationDuration = Number(narration.duration || 0);
    if (!Number.isFinite(narrationDuration) || narrationDuration <= 0) {
        throw new Error('tts_duration_invalid: A síntese terminou sem uma duração válida.');
    }
    const audioConfig = {
        narration: {
            ...input.audioConfig.narration,
            trimEnd: narrationDuration,
        },
        background: {
            ...input.audioConfig.background,
            trimEnd: narrationDuration,
        },
    };
    let next: AdData = {
        ...input,
        ...invalidatedNarrationDerivatives(),
        narrationText,
        narrationSource: 'tts',
        isNarrationGenerated: true,
        narrationAudioUrl: narrationUrl,
        narrationDuration,
        audioConfig,
        audioTimeline: undefined,
    };

    const mix = await fetch(`${API_BASE_URL}/api/audio/mix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            narrationUrl,
            musicUrl: input.musicAudioUrl,
            audioConfig,
        }),
    });
    const mixed = await readApi<{ masterAudioUrl?: string }>(mix);
    if (!mixed.masterAudioUrl) throw new Error('audio_mix_missing: A mixagem não devolveu o áudio final.');
    next = {
        ...next,
        masterAudioUrl: /^https?:\/\//i.test(mixed.masterAudioUrl)
            ? mixed.masterAudioUrl
            : `${API_BASE_URL}${mixed.masterAudioUrl}`,
    };
    return next;
};

interface MaterializedOpsSource {
    type?: MediaTake['type'];
    duration?: number;
    fileName?: string;
    url?: string;
    proxyUrl?: string;
    path?: string;
    externalMedia?: MediaTake['externalMedia'];
}

const absoluteLocalUrl = (value?: string | null) => {
    if (!value) return '';
    return /^https?:\/\//i.test(value) ? value : `${API_BASE_URL}${value}`;
};

export const materializeOpsTake = async (
    asset: OpsAsset,
    context: OpsViewContext,
    takeId: string = crypto.randomUUID(),
): Promise<MediaTake> => {
    if (!['video', 'image'].includes(asset.kind)) {
        throw new Error(`ops_asset_not_visual: ${asset.name} não é um vídeo ou imagem.`);
    }
    const reference = await gatewayApi.createOpsReference(asset.id, context.contextId);
    const response = await fetch(`${API_BASE_URL}/api/ops/cache/materialize`, {
        method: 'POST',
        headers: {
            ...(await localAuthHeaders()),
            'Content-Type': 'application/json',
            'X-Ops-View-Context': context.contextId,
        },
        body: JSON.stringify({ referenceId: reference.id }),
    });
    const result = await readApi<{ source?: MaterializedOpsSource }>(response);
    const source = result.source;
    if (!source) throw new Error(`ops_asset_materialization_missing: ${asset.name} não foi materializado.`);
    const type: MediaTake['type'] = source.type === 'image' ? 'image' : 'video';
    const duration = Number(source.duration || (type === 'image' ? 3.5 : 0));
    if (type === 'video' && (!Number.isFinite(duration) || duration <= 0)) {
        throw new Error(`ops_asset_duration_invalid: ${asset.name} não possui duração válida.`);
    }
    return {
        id: takeId,
        fileName: source.fileName || asset.name,
        originalDurationSeconds: duration,
        url: absoluteLocalUrl(source.url),
        fileUrl: absoluteLocalUrl(source.url),
        proxyUrl: absoluteLocalUrl(source.proxyUrl) || absoluteLocalUrl(source.url),
        backendPath: source.path,
        externalMedia: source.externalMedia ? {
            ...source.externalMedia,
            viewContext: {
                mode: context.mode,
                label: context.label,
                subtitle: context.subtitle,
            },
        } : undefined,
        type,
        trim: { start: 0, end: duration },
    };
};

export const generateAutomaticCaptions = async (input: AdData): Promise<AdData> => {
    const audioUrl = input.narrationAudioUrl || input.masterAudioUrl;
    if (!audioUrl) throw new Error('caption_audio_missing: A narração ainda não foi gerada.');
    const response = await fetch(`${API_BASE_URL}/api/stt/generate-captions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await localAuthHeaders()) },
        body: JSON.stringify({ audioUrl, narrationText: input.narrationText }),
    });
    const data = await readApi<{ segments?: NonNullable<AdData['captions']>['segments']; review?: NonNullable<AdData['captions']>['review'] }>(response);
    if (!data.segments?.length) throw new Error('caption_segments_missing: Nenhuma legenda foi gerada.');
    return {
        ...input,
        captions: {
            enabled: true,
            language: 'pt-BR',
            presetId: 'karaoke-yellow',
            segments: repairCaptionCurrencySegments(data.segments),
            sourceKey: narrationSourceKey(input),
            review: data.review,
        },
        dynamicTitles: [],
        dynamicTitlesSourceKey: undefined,
    };
};

export const generateAutomaticTitles = async (input: AdData): Promise<AdData> => {
    const sourceKey = narrationSourceKey(input);
    const captions = input.captions?.sourceKey === sourceKey ? input.captions : undefined;
    if (!captions?.segments?.length) throw new Error('title_captions_missing: Gere as legendas antes dos títulos.');
    const brand = await resolveOpsProjectBrand(input.opsCompany);
    const brandPalette = brand.required ? brand.palette : input.brandPalette;
    const response = await fetch(`${API_BASE_URL}/api/video/generate-titles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await localAuthHeaders()) },
        body: JSON.stringify({
            script: input.narrationText,
            captions,
            format: input.format,
            brandPalette,
            companyId: brand.company?.id || null,
            opsViewContextId: brand.context?.contextId || null,
        }),
    });
    const data = await readApi<{ titles?: TitleHook[] }>(response);
    if (!data.titles?.length) throw new Error('title_generation_empty: Nenhum gatilho configurado foi encontrado na narração.');
    const next: AdData = {
        ...input,
        brandPalette,
        brandPaletteUpdatedAt: brand.required ? brand.paletteUpdatedAt : input.brandPaletteUpdatedAt,
        dynamicTitles: data.titles.map((title) => ({ ...title, isActive: true, hasSound: true })),
        dynamicTitlesSourceKey: sourceKey,
    };
    return { ...next, dynamicTitles: bindTitlesToBrandPalette(next) };
};

export const prepareOpsExportMetadata = async (
    projectId: string,
    adData: AdData,
    mediaTakeCount: number,
): Promise<OpsExportMetadata> => {
    const response = await fetch(`${API_BASE_URL}/api/ops/exports/metadata`, {
        method: 'POST',
        headers: { ...(await localAuthHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            projectId,
            projectTitle: adData.title,
            narrationText: adData.narrationText,
            mediaTakeCount,
        }),
    });
    const data = await readApi<{ data?: OpsExportMetadata }>(response);
    if (!data.data) throw new Error('ops_export_metadata_missing: Os metadados da exportação não foram gerados.');
    return data.data;
};

const serializeAutomatedTake = (take: MediaTake): MediaTake => {
    const { file: _file, ...serializable } = take;
    void _file;
    if (take.externalMedia?.source !== 'mileto_ops') return serializable;
    return {
        ...serializable,
        url: '',
        fileUrl: '',
        proxyUrl: '',
        backendPath: undefined,
        externalMedia: { ...take.externalMedia },
    };
};

export const persistAutomatedProject = async (input: {
    projectId: string;
    title: string;
    adData: AdData;
    mediaTakes: MediaTake[];
    captionStyle: CaptionStyle;
    selectedMusicId: string | null;
    exported: boolean;
}) => {
    const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(input.projectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            data: {
                adData: { ...input.adData, title: input.title },
                mediaTakes: input.mediaTakes.map(serializeAutomatedTake),
                captionStyle: input.captionStyle,
                selectedMusicId: input.selectedMusicId,
                updatedAt: new Date().toISOString(),
                exported: input.exported,
                title: input.title,
                // The same project can be resumed after an app restart. A
                // monotonic revision prevents an older wizard save from
                // overwriting the agent's latest checkpoint.
                saveRevision: (Date.now() * 1_000) + (input.exported ? 1 : 0),
                lastStep: 4,
            },
        }),
    });
    const data = await readApi<{ ok?: boolean }>(response);
    if (data.ok === false) throw new Error('agent_project_save_failed: O projeto automático não pôde ser salvo neste computador.');
};

export interface AutomatedProjectSnapshot {
    adData: AdData;
    mediaTakes: MediaTake[];
    captionStyle: CaptionStyle;
    selectedMusicId: string | null;
    exported: boolean;
    title: string;
}

const DEFAULT_AUTOMATED_CAPTION_STYLE: CaptionStyle = {
    id: 'agent-default',
    name: 'Padrao do agente',
    previewClass: '',
    fontFamily: 'Anton',
    fontSize: 20,
    strokeWidth: 4,
    activeColor: '#00e676',
    baseColor: '#ffffff',
    strokeColor: '#000000',
    verticalPosition: 23,
};

export const loadAutomatedProject = async (projectId: string): Promise<AutomatedProjectSnapshot | null> => {
    const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}`);
    if (response.status === 404) return null;
    const envelope = await readApi<{ data?: Partial<AutomatedProjectSnapshot> }>(response);
    const data = envelope.data;
    if (!data?.adData || !Array.isArray(data.mediaTakes)) return null;
    return {
        adData: data.adData,
        mediaTakes: data.mediaTakes,
        captionStyle: data.captionStyle || { ...DEFAULT_AUTOMATED_CAPTION_STYLE },
        selectedMusicId: data.selectedMusicId || null,
        exported: Boolean(data.exported),
        title: String(data.title || data.adData.title || '').trim(),
    };
};

export const deterministicShuffle = <T>(items: T[], seed: string): T[] => {
    let state = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        state ^= seed.charCodeAt(index);
        state = Math.imul(state, 16777619);
    }
    const nextRandom = () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const target = Math.floor(nextRandom() * (index + 1));
        [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    return shuffled;
};
