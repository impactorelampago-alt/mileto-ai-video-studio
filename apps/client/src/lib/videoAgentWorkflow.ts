import { API_BASE_URL } from './apiBase';
import { backgroundTrimEndForNarration } from './audioAutoFit';
import { repairCaptionCurrencySegments } from './captionCurrency';
import { gatewayApi, type OpsAsset, type OpsViewContext } from './gateway';
import { invalidatedNarrationDerivatives, narrationSourceKey } from './narrationState';
import {
    bindTitlesToBrandPalette,
    resolveOpsProjectBrand,
    type ResolvedOpsProjectBrand,
} from './opsProjectBrand';
import { localAuthHeaders } from './serverAuth';
import type {
    AdData,
    CaptionStyle,
    MediaTake,
    TitleGenerationDiagnostic,
    TitleGenerationTimings,
    TitleHook,
} from '../types';
import { normalizeHydratedCaptionStyle } from './captionStyleMigration';
import type { OpsExportMetadata } from '../context/ExportJobsContext';

type ApiEnvelope<T> = {
    ok?: boolean;
    message?: string;
    code?: string;
    retryable?: boolean;
    requestId?: string;
    phase?: string;
    data?: T;
    [key: string]: unknown;
};

export class LocalApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
        readonly retryable: boolean,
        readonly requestId?: string,
        readonly phase?: string,
    ) {
        super(message);
        this.name = 'LocalApiError';
    }
}

const readApi = async <T>(response: Response): Promise<T & ApiEnvelope<T>> => {
    const data = await response.json().catch(() => ({})) as T & ApiEnvelope<T>;
    if (!response.ok || data.ok === false) {
        throw new LocalApiError(
            data.message || `Erro HTTP ${response.status}`,
            response.status,
            data.code || 'local_api_failed',
            data.retryable === true,
            data.requestId,
            data.phase,
        );
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
    const backgroundTrimEnd = backgroundTrimEndForNarration({
        backgroundTrimStart: input.audioConfig.background.trimStart,
        backgroundOffsetSec: input.audioConfig.background.offsetSec,
        narrationDurationSec: narrationDuration,
        narrationOffsetSec: input.audioConfig.narration.offsetSec,
    });
    const audioConfig = {
        narration: {
            ...input.audioConfig.narration,
            trimStart: 0,
            trimEnd: narrationDuration,
        },
        background: {
            ...input.audioConfig.background,
            trimEnd: backgroundTrimEnd,
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
        titleGenerationSummary: undefined,
    };
};

export const AUTOMATIC_TITLES_UNAVAILABLE_WARNING =
    'Títulos automáticos indisponíveis; vídeo concluído sem títulos';
export const AUTOMATIC_TITLES_FALLBACK_WARNING =
    'Títulos gerados pelo fallback local após indisponibilidade da IA.';

export type AutomaticTitleGenerationOutcome = {
    adData: AdData;
    source: 'ai' | 'local' | 'none';
    warning?: string;
    diagnostic?: TitleGenerationDiagnostic;
};

export const TITLE_AI_REQUEST_DEADLINE_MS = 55_000;
export const TITLE_LOCAL_FALLBACK_DEADLINE_MS = 20_000;

export type TitleGenerationProgressPhase = 'brand' | 'ai' | 'fallback' | 'completed';

export interface TitleGenerationProgress {
    phase: TitleGenerationProgressPhase;
    message: string;
}

export interface AutomaticTitleGenerationOptions {
    signal?: AbortSignal;
    resolvedBrand?: ResolvedOpsProjectBrand;
    aiDeadlineMs?: number;
    localFallbackDeadlineMs?: number;
    onProgress?: (progress: TitleGenerationProgress) => void;
}

const elapsedMs = (startedAt: number) => Math.max(0, Math.round(Date.now() - startedAt));

const positiveDeadline = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) && Number(value) > 0 ? Math.round(Number(value)) : fallback;

const titleGenerationAbortError = () => {
    const error = new Error('Geração de títulos cancelada.');
    error.name = 'AbortError';
    return error;
};

export const isTitleGenerationAbortError = (error: unknown) =>
    error instanceof Error && error.name === 'AbortError';

const runTitleRequestWithDeadline = async <T>(
    operation: (signal: AbortSignal) => Promise<T>,
    deadlineMs: number,
    parentSignal: AbortSignal | undefined,
    phase: 'ai' | 'local_fallback',
): Promise<T> => {
    if (parentSignal?.aborted) throw titleGenerationAbortError();
    const controller = new AbortController();
    let timedOut = false;
    const onParentAbort = () => controller.abort();
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    const timeout = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, deadlineMs);
    try {
        return await operation(controller.signal);
    } catch (error) {
        if (parentSignal?.aborted) throw titleGenerationAbortError();
        if (timedOut) {
            throw new LocalApiError(
                phase === 'ai'
                    ? 'A IA excedeu o tempo seguro; iniciando o fallback local.'
                    : 'O fallback local excedeu o tempo seguro.',
                0,
                'title_generation_timeout',
                true,
                undefined,
                phase,
            );
        }
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
        parentSignal?.removeEventListener('abort', onParentAbort);
    }
};

export const sanitizeTitleGenerationServerTimings = (value: unknown): Record<string, number> | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const allowedKeys = new Set(['companyPalette', 'configuration', 'generation', 'formatting', 'editorialReview', 'total']);
    const timings: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value).slice(0, 24)) {
        if (!allowedKeys.has(key) || typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue;
        timings[key] = Math.min(Number.MAX_SAFE_INTEGER, Math.round(raw));
    }
    return Object.keys(timings).length ? timings : undefined;
};

const safeTitleDiagnostic = (error: unknown) => error instanceof LocalApiError
    ? {
        code: error.code,
        status: error.status,
        phase: error.phase,
        requestId: error.requestId,
    }
    : {
        code: error instanceof TypeError ? 'title_network_failed' : 'title_generation_failed',
        status: 0,
    };

const uniqueTitleDiagnostics = (
    diagnostics: Array<TitleGenerationDiagnostic | undefined>,
): TitleGenerationDiagnostic[] => {
    const seen = new Set<string>();
    return diagnostics.filter((diagnostic): diagnostic is TitleGenerationDiagnostic => {
        if (!diagnostic?.code && !diagnostic?.status && !diagnostic?.phase && !diagnostic?.requestId) return false;
        const key = JSON.stringify(diagnostic);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

export const generateAutomaticTitlesResilient = async (
    input: AdData,
    options: AutomaticTitleGenerationOptions = {},
): Promise<AutomaticTitleGenerationOutcome> => {
    const operationStartedAt = Date.now();
    const sourceKey = narrationSourceKey(input);
    const captions = input.captions?.sourceKey === sourceKey ? input.captions : undefined;
    if (!captions?.segments?.length) {
        const warning = AUTOMATIC_TITLES_UNAVAILABLE_WARNING;
        options.onProgress?.({ phase: 'completed', message: warning });
        return {
            adData: {
                ...input,
                dynamicTitles: [],
                dynamicTitlesSourceKey: sourceKey,
                titleGenerationSummary: {
                    requested: true,
                    outcome: 'none',
                    titleCount: 0,
                    clientRequests: 0,
                    warning,
                    diagnostic: { code: 'title_captions_missing', status: 0, phase: 'captions' },
                    generatedAt: new Date().toISOString(),
                },
            },
            source: 'none',
            warning,
            diagnostic: { code: 'title_captions_missing', status: 0, phase: 'captions' },
        };
    }

    let brandPalette = input.brandPalette;
    let brandPaletteUpdatedAt = input.brandPaletteUpdatedAt;
    let companyId: string | null = null;
    let opsViewContextId: string | null = null;
    const brandStartedAt = Date.now();
    options.onProgress?.({ phase: 'brand', message: 'Confirmando empresa e paleta do projeto…' });
    try {
        if (options.signal?.aborted) throw titleGenerationAbortError();
        const brand = options.resolvedBrand || await resolveOpsProjectBrand(input.opsCompany, { signal: options.signal });
        brandPalette = brand.required ? brand.palette : input.brandPalette;
        brandPaletteUpdatedAt = brand.required ? brand.paletteUpdatedAt : input.brandPaletteUpdatedAt;
        companyId = brand.company?.id || null;
        opsViewContextId = brand.context?.contextId || null;
    } catch (error) {
        if (isTitleGenerationAbortError(error) || options.signal?.aborted) throw titleGenerationAbortError();
        // A indisponibilidade do diretório de marcas não transforma títulos em
        // etapa fatal. O servidor ainda pode executar os detectores locais com a
        // paleta já persistida no projeto, sem alterar empresa ou destino do job.
        console.warn('[title-generation]', {
            event: 'brand_resolution_fallback',
            ...safeTitleDiagnostic(error),
        });
    }
    const brandResolutionMs = elapsedMs(brandStartedAt);

    let clientRequests = 0;
    let aiRequestMs: number | undefined;
    let localFallbackRequestMs: number | undefined;
    type TitleResponse = {
        titles?: TitleHook[];
        source?: 'ai' | 'local' | 'none';
        warning?: string;
        diagnostic?: AutomaticTitleGenerationOutcome['diagnostic'];
        attempts?: number;
        configSource?: string;
        semanticCoverage?: NonNullable<AdData['titleGenerationSummary']>['semanticCoverage'];
        metrics?: NonNullable<AdData['titleGenerationSummary']>['metrics'];
        editorialReview?: NonNullable<AdData['titleGenerationSummary']>['editorialReview'];
        warnings?: NonNullable<AdData['titleGenerationSummary']>['warnings'];
        timingsMs?: unknown;
    };
    const request = async (mode: 'ai' | 'local') => {
        clientRequests += 1;
        const startedAt = Date.now();
        const isAi = mode === 'ai';
        options.onProgress?.({
            phase: isAi ? 'ai' : 'fallback',
            message: isAi
                ? 'Gerando ganchos com IA…'
                : 'A IA não respondeu a tempo. Aplicando fallback local…',
        });
        try {
            const headers = { 'Content-Type': 'application/json', ...(await localAuthHeaders()) };
            return await runTitleRequestWithDeadline(async (signal) => {
                const response = await fetch(`${API_BASE_URL}/api/video/generate-titles`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        script: input.narrationText,
                        captions,
                        format: input.format,
                        brandPalette,
                        companyId,
                        opsViewContextId,
                        mode,
                    }),
                    signal,
                });
                return readApi<TitleResponse>(response);
            }, positiveDeadline(
                isAi ? options.aiDeadlineMs : options.localFallbackDeadlineMs,
                isAi ? TITLE_AI_REQUEST_DEADLINE_MS : TITLE_LOCAL_FALLBACK_DEADLINE_MS,
            ), options.signal, isAi ? 'ai' : 'local_fallback');
        } finally {
            if (isAi) aiRequestMs = elapsedMs(startedAt);
            else localFallbackRequestMs = elapsedMs(startedAt);
        }
    };

    let primaryData: Awaited<ReturnType<typeof request>> | null = null;
    let fallbackData: Awaited<ReturnType<typeof request>> | null = null;
    let lastError: unknown;
    const requestDiagnostics: TitleGenerationDiagnostic[] = [];
    try {
        primaryData = await request('ai');
    } catch (error) {
        if (isTitleGenerationAbortError(error) || options.signal?.aborted) throw titleGenerationAbortError();
        lastError = error;
        requestDiagnostics.push(safeTitleDiagnostic(error));
    }

    if (primaryData === null) {
        try {
            fallbackData = await request('local');
        } catch (error) {
            if (isTitleGenerationAbortError(error) || options.signal?.aborted) throw titleGenerationAbortError();
            lastError = error;
            requestDiagnostics.push(safeTitleDiagnostic(error));
        }
    }

    const data = fallbackData?.titles?.length ? fallbackData : (primaryData?.titles?.length ? primaryData : fallbackData || primaryData);
    const serverAttempts = Number(primaryData?.attempts || 0) + Number(fallbackData?.attempts || 0);
    const attemptsBySource = {
        ...(primaryData ? { ai: Number(primaryData.attempts || 0) } : {}),
        ...(fallbackData ? { fallback: Number(fallbackData.attempts || 0) } : {}),
    };
    const metricsBySource = {
        ...(primaryData?.source === 'local'
            ? { fallback: primaryData.metrics }
            : (primaryData?.metrics ? { ai: primaryData.metrics } : {})),
        ...(fallbackData?.metrics ? { fallback: fallbackData.metrics } : {}),
    };
    const diagnostics = uniqueTitleDiagnostics([
        primaryData?.diagnostic,
        ...requestDiagnostics,
        fallbackData?.diagnostic,
    ]);
    const timingSnapshot = (): TitleGenerationTimings => {
        const server = sanitizeTitleGenerationServerTimings(data?.timingsMs);
        return {
            clientTotalMs: elapsedMs(operationStartedAt),
            brandResolutionMs,
            ...(aiRequestMs !== undefined ? { aiRequestMs } : {}),
            ...(localFallbackRequestMs !== undefined ? { localFallbackRequestMs } : {}),
            ...(server ? { server } : {}),
        };
    };

    if (!data?.titles?.length) {
        const diagnostic = data?.diagnostic || diagnostics[0] || safeTitleDiagnostic(lastError);
        const warning = data?.warning || AUTOMATIC_TITLES_UNAVAILABLE_WARNING;
        const warnings = [
            ...(primaryData?.warnings || []),
            ...(fallbackData?.warnings || []),
        ];
        if (!warnings.some((item) => item.code === 'automatic_titles_unavailable')) {
            warnings.push({ code: 'automatic_titles_unavailable', message: warning });
        }
        console.warn('[title-generation]', { event: 'completed_without_titles', ...diagnostic });
        options.onProgress?.({ phase: 'completed', message: warning });
        return {
            adData: {
                ...input,
                brandPalette,
                brandPaletteUpdatedAt,
                dynamicTitles: [],
                dynamicTitlesSourceKey: sourceKey,
                titleGenerationSummary: {
                    requested: true,
                    outcome: 'none',
                    titleCount: 0,
                    serverAttempts,
                    clientRequests,
                    configSource: data?.configSource,
                    semanticCoverage: data?.semanticCoverage,
                    metrics: data?.metrics,
                    editorialReview: data?.editorialReview,
                    attemptsBySource,
                    metricsBySource,
                    timings: timingSnapshot(),
                    warning,
                    warnings,
                    diagnostic,
                    diagnostics,
                    generatedAt: new Date().toISOString(),
                },
            },
            source: 'none',
            warning,
            diagnostic,
        };
    }

    const fallbackUsed = data.source === 'local' || data === fallbackData;
    const responseWarning = data.warning?.trim();
    const warningMessages = [
        ...(fallbackUsed && !responseWarning?.includes(AUTOMATIC_TITLES_FALLBACK_WARNING)
            ? [AUTOMATIC_TITLES_FALLBACK_WARNING]
            : []),
        ...(responseWarning ? [responseWarning] : []),
    ].filter((message, index, all) => all.indexOf(message) === index);
    const warning = warningMessages.join(' ') || undefined;
    const warnings = [...(data.warnings || [])];
    if (fallbackUsed && !warnings.some((item) => item.code === 'title_fallback_used')) {
        warnings.unshift({ code: 'title_fallback_used', message: AUTOMATIC_TITLES_FALLBACK_WARNING });
    }
    const diagnostic = fallbackUsed ? (primaryData?.diagnostic || diagnostics[0] || data.diagnostic) : data.diagnostic;
    options.onProgress?.({
        phase: 'completed',
        message: fallbackUsed ? 'Títulos prontos pelo fallback local.' : 'Títulos gerados com IA.',
    });

    const next: AdData = {
        ...input,
        brandPalette,
        brandPaletteUpdatedAt,
        dynamicTitles: data.titles.map((title) => ({ ...title, isActive: true, hasSound: true })),
        dynamicTitlesSourceKey: sourceKey,
        titleGenerationSummary: {
            requested: true,
            outcome: fallbackUsed ? 'fallback' : 'ai',
            titleCount: data.titles.length,
            serverAttempts,
            clientRequests,
            configSource: data.configSource,
            semanticCoverage: data.semanticCoverage,
            metrics: data.metrics,
            editorialReview: data.editorialReview,
            attemptsBySource,
            metricsBySource,
            timings: timingSnapshot(),
            warning,
            warnings,
            diagnostic,
            diagnostics,
            generatedAt: new Date().toISOString(),
        },
    };
    return {
        adData: { ...next, dynamicTitles: bindTitlesToBrandPalette(next) },
        source: fallbackUsed ? 'local' : 'ai',
        warning,
        diagnostic,
    };
};

export const generateAutomaticTitles = async (
    input: AdData,
    options: AutomaticTitleGenerationOptions = {},
): Promise<AdData> => {
    const result = await generateAutomaticTitlesResilient(input, options);
    return result.adData;
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
    const frameOverlay = input.adData.frameOverlay
        ? serializeAutomatedTake(input.adData.frameOverlay)
        : undefined;
    const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(input.projectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            data: {
                adData: { ...input.adData, frameOverlay, title: input.title },
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
    fontSize: 16,
    strokeWidth: 1,
    activeColor: '#00e676',
    baseColor: '#ffffff',
    strokeColor: '#000000',
    verticalPosition: 23,
    textCase: 'uppercase',
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
        captionStyle: normalizeHydratedCaptionStyle(data.captionStyle) || { ...DEFAULT_AUTOMATED_CAPTION_STYLE },
        selectedMusicId: data.selectedMusicId || null,
        exported: Boolean(data.exported),
        title: String(data.title || data.adData.title || '').trim(),
    };
};

export { deterministicShuffle } from './opsTakeSelection';
