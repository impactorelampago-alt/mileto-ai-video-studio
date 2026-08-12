export const SUPPORTED_RENDER_FPS = [24, 25, 30, 60] as const;

export type SupportedRenderFps = (typeof SUPPORTED_RENDER_FPS)[number];

export type RenderIntegrityStage = 'preflight' | 'output';

export interface MediaDurationProbe {
    formatDurationSec: number | null;
    videoDurationSec: number | null;
    audioDurationSec: number | null;
    videoFps: number | null;
    videoFrameCount: number | null;
    hasVideo: boolean;
    hasAudio: boolean;
}

export interface RenderIntegrityIssue {
    code: string;
    message: string;
    stream?: 'timeline' | 'video' | 'audio' | 'container';
    expected?: number;
    actual?: number;
    delta?: number;
    tolerance?: number;
    takeIndex?: number;
    takeId?: string;
}

export interface RenderIntegrityDiagnostics {
    status: 'passed' | 'failed';
    stage: RenderIntegrityStage;
    expectedDurationSec: number;
    plannedVideoDurationSec?: number;
    actualVideoDurationSec?: number;
    actualAudioDurationSec?: number;
    containerDurationSec?: number;
    expectedFps: SupportedRenderFps;
    actualVideoFps?: number;
    expectedVideoFrameCount?: number;
    actualVideoFrameCount?: number;
    durationToleranceSec: number;
    videoDurationToleranceSec: number;
    frameTolerance: number;
    issues: RenderIntegrityIssue[];
}

type TimelineTake = {
    start?: unknown;
    end?: unknown;
    speed?: unknown;
};

export type TakeSourceCoverageStatus = 'covered' | 'recoverable' | 'truncated';
export type TakeSourceRecovery = 'none' | 'normal_gap' | 'full_clip';

export interface TakeSourceCoverageResult {
    status: TakeSourceCoverageStatus;
    recovery: TakeSourceRecovery;
    requestedEndSec: number;
    actualVideoDurationSec?: number;
    gapSec: number;
    toleranceSec: number;
    issue?: RenderIntegrityIssue;
}

const finitePositive = (value: unknown): number | null => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const roundDiagnostic = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export const normalizeRenderFps = (value: unknown): SupportedRenderFps => {
    const numeric = Number(value);
    return SUPPORTED_RENDER_FPS.includes(numeric as SupportedRenderFps)
        ? numeric as SupportedRenderFps
        : 30;
};

/**
 * Dois quadros seriam permissivos demais em baixas cadências e o AAC pode
 * acrescentar alguns milissegundos de padding. Cem milissegundos cobre ambos
 * sem aceitar encurtamentos perceptíveis da timeline.
 */
export const renderDurationTolerance = (fps: unknown): number =>
    roundDiagnostic(Math.max(0.1, 2 / normalizeRenderFps(fps)));

/** A stream visual pode divergir no máximo dois quadros da duração pedida. */
export const renderVideoDurationTolerance = (fps: unknown): number =>
    roundDiagnostic(2 / normalizeRenderFps(fps));

/**
 * Confere se a stream visual realmente alcança o fim do corte solicitado.
 *
 * Containers de celular podem declarar alguns quadros a mais que a stream de
 * vídeo. Essa diferença é recuperável quando está dentro da margem normal. Um
 * arquivo completo também pode ter uma cauda curta (por exemplo, áudio de 22 s
 * e vídeo de 21,5 s); nesse caso aceitamos no máximo 1 s e 5% do clipe. Cortes
 * arbitrários ou fontes de fato truncadas falham antes de iniciar o FFmpeg.
 */
export const analyzeTakeSourceCoverage = (input: {
    takeIndex: number;
    takeId?: unknown;
    start: unknown;
    end: unknown;
    originalDurationSeconds?: unknown;
    sourceProbe: MediaDurationProbe;
    probeFailed?: boolean;
    outputFps: unknown;
}): TakeSourceCoverageResult => {
    const takeIndex = Math.max(0, Math.floor(Number(input.takeIndex) || 0));
    const rawTakeId = typeof input.takeId === 'string' ? input.takeId.trim() : '';
    // IDs normais são UUIDs/tokens. Nunca ecoar um valor que se pareça com
    // caminho, URL ou outro identificador privado vindo do cliente.
    const takeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(rawTakeId)
        ? rawTakeId
        : `take-${takeIndex + 1}`;
    const start = Number(input.start);
    const end = Number(input.end);
    const requestedEnd = Number.isFinite(end) && end > 0 ? end : 0;
    const actualDuration = input.sourceProbe.videoDurationSec;
    const actual = actualDuration != null && Number.isFinite(actualDuration) && actualDuration > 0
        ? actualDuration
        : null;
    const tolerance = renderDurationTolerance(input.outputFps);
    const gap = actual && requestedEnd > 0
        ? Math.max(0, requestedEnd - actual)
        : Math.max(0, requestedEnd);

    const result = (
        status: TakeSourceCoverageStatus,
        recovery: TakeSourceRecovery,
        issue?: RenderIntegrityIssue,
    ): TakeSourceCoverageResult => ({
        status,
        recovery,
        requestedEndSec: roundDiagnostic(requestedEnd),
        actualVideoDurationSec: safeDiagnosticNumber(actual),
        gapSec: roundDiagnostic(gap),
        toleranceSec: tolerance,
        issue,
    });

    if (input.probeFailed) {
        return result('truncated', 'none', {
            code: 'render_take_source_probe_failed',
            message: `Não foi possível verificar o take ${takeIndex + 1} antes da exportação. Tente novamente.`,
            stream: 'video',
            takeIndex,
            takeId,
        });
    }

    const streamIsUsable = input.sourceProbe.hasVideo
        && actual != null
        && Number.isFinite(start)
        && start >= 0
        && actual > start;
    if (streamIsUsable && gap <= 0) return result('covered', 'none');
    if (streamIsUsable && gap <= tolerance) return result('recoverable', 'normal_gap');

    const originalDuration = finitePositive(input.originalDurationSeconds);
    const formatDuration = input.sourceProbe.formatDurationSec;
    const originalMatchesFullClip = originalDuration != null
        && Math.abs(originalDuration - requestedEnd) <= tolerance;
    const legacyFullClip = originalDuration == null
        && Number.isFinite(start)
        && Math.abs(start) <= 1e-6
        && formatDuration != null
        && Number.isFinite(formatDuration)
        && Math.abs(formatDuration - requestedEnd) <= tolerance;
    const withinFullClipRecovery = streamIsUsable
        && requestedEnd > 0
        && gap <= 1
        && Number.isFinite(start)
        && requestedEnd > start
        && gap / (requestedEnd - start) <= 0.05
        && (originalMatchesFullClip || legacyFullClip);
    if (withinFullClipRecovery) return result('recoverable', 'full_clip');

    const issue: RenderIntegrityIssue = {
        code: 'render_take_source_truncated',
        message: `O take ${takeIndex + 1} termina antes do corte planejado. Selecione novamente o vídeo original ou ajuste o fim do corte.`,
        stream: 'video',
        expected: safeDiagnosticNumber(requestedEnd),
        actual: safeDiagnosticNumber(actual),
        delta: actual == null ? undefined : roundDiagnostic(actual - requestedEnd),
        tolerance,
        takeIndex,
        takeId,
    };
    return result('truncated', 'none', issue);
};

export const takeTimelineDuration = (take: TimelineTake): number => {
    const start = Number(take.start);
    const end = Number(take.end);
    const rawDuration = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0;
    if (!(rawDuration > 0)) return 0;

    if (typeof take.speed === 'number' && Number.isFinite(take.speed) && take.speed > 0) {
        return rawDuration / take.speed;
    }
    return rawDuration;
};

export const plannedTimelineDuration = (takes: TimelineTake[]): number =>
    roundDiagnostic(takes.reduce((total, take) => total + takeTimelineDuration(take), 0));

export const expectedTimelineFrameCount = (durationSec: unknown, fps: unknown): number => {
    const duration = finitePositive(durationSec);
    if (!duration) return 0;
    // A pequena margem evita transformar um produto matematicamente inteiro em
    // um quadro adicional por ruído de ponto flutuante.
    return Math.ceil(duration * normalizeRenderFps(fps) - 1e-9);
};

export interface TimelineFramePlan {
    frameCounts: number[];
    frameBoundaries: number[];
    totalFrameCount: number;
    unrepresentableTakeIndices: number[];
}

/**
 * Quantiza os limites acumulados da timeline. Isso impede que o arredondamento
 * de cada take acumule erro e, ao mesmo tempo, recusa takes que não ocupam nem
 * um quadro na cadência escolhida em vez de roubar quadros dos takes finais.
 */
export const planTimelineFrames = (
    takes: TimelineTake[],
    fpsValue: unknown,
): TimelineFramePlan => {
    const fps = normalizeRenderFps(fpsValue);
    let cumulativeDuration = 0;
    let previousBoundary = 0;
    const frameCounts: number[] = [];
    const frameBoundaries: number[] = [];
    const unrepresentableTakeIndices: number[] = [];

    takes.forEach((take, index) => {
        cumulativeDuration += takeTimelineDuration(take);
        const scaledBoundary = cumulativeDuration * fps;
        const nextBoundary = index === takes.length - 1
            ? Math.ceil(scaledBoundary - 1e-9)
            : Math.round(scaledBoundary);
        const frameCount = nextBoundary - previousBoundary;
        if (frameCount <= 0) unrepresentableTakeIndices.push(index);
        frameCounts.push(Math.max(0, frameCount));
        frameBoundaries.push(nextBoundary);
        previousBoundary = nextBoundary;
    });

    return {
        frameCounts,
        frameBoundaries,
        totalFrameCount: Math.max(0, previousBoundary),
        unrepresentableTakeIndices,
    };
};

const issueForDuration = (
    code: string,
    message: string,
    stream: RenderIntegrityIssue['stream'],
    expected: number,
    actual: number,
    tolerance: number,
): RenderIntegrityIssue => ({
    code,
    message,
    stream,
    expected: roundDiagnostic(expected),
    actual: roundDiagnostic(actual),
    delta: roundDiagnostic(actual - expected),
    tolerance,
});

const safeDiagnosticNumber = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value) ? undefined : roundDiagnostic(value);

export const validateRenderPreflight = (input: {
    expectedDurationSec: unknown;
    plannedVideoDurationSec: unknown;
    audioProbe: MediaDurationProbe;
    outputFps: unknown;
    invalidTakeCount?: unknown;
    unrepresentableTakeCount?: unknown;
    takeSourceIssues?: RenderIntegrityIssue[];
}): RenderIntegrityDiagnostics => {
    const expected = finitePositive(input.expectedDurationSec) || 0;
    const planned = finitePositive(input.plannedVideoDurationSec) || 0;
    const fps = normalizeRenderFps(input.outputFps);
    const tolerance = renderDurationTolerance(fps);
    const audioDuration = input.audioProbe.audioDurationSec;
    const issues: RenderIntegrityIssue[] = [];

    if (Array.isArray(input.takeSourceIssues)) {
        issues.push(...input.takeSourceIssues.filter((issue) =>
            issue?.code === 'render_take_source_truncated'
            || issue?.code === 'render_take_source_probe_failed'));
    }

    const invalidTakeCount = Math.max(0, Math.floor(Number(input.invalidTakeCount) || 0));
    if (invalidTakeCount > 0) {
        issues.push({
            code: 'render_take_duration_invalid',
            message: `${invalidTakeCount} take(s) possuem duração inválida.`,
            stream: 'video',
            actual: invalidTakeCount,
            expected: 0,
        });
    }

    const unrepresentableTakeCount = Math.max(0, Math.floor(Number(input.unrepresentableTakeCount) || 0));
    if (unrepresentableTakeCount > 0) {
        issues.push({
            code: 'render_take_too_short_for_fps',
            message: `${unrepresentableTakeCount} take(s) não ocupam um quadro inteiro na cadência escolhida.`,
            stream: 'video',
            actual: unrepresentableTakeCount,
            expected: 0,
        });
    }

    if (!expected) {
        issues.push({
            code: 'render_expected_duration_invalid',
            message: 'A duração planejada da timeline é inválida.',
            stream: 'timeline',
        });
    }
    if (!planned) {
        issues.push({
            code: 'render_visual_timeline_invalid',
            message: 'A sequência visual não possui duração válida.',
            stream: 'video',
        });
    } else if (expected && planned < expected - tolerance) {
        issues.push(issueForDuration(
            'render_visual_timeline_short',
            'A sequência de takes termina antes da duração planejada.',
            'video',
            expected,
            planned,
            tolerance,
        ));
    }
    if (!input.audioProbe.hasAudio || audioDuration == null || !(audioDuration > 0)) {
        issues.push({
            code: 'render_audio_stream_missing',
            message: 'O áudio mestre não possui uma stream de áudio mensurável.',
            stream: 'audio',
        });
    } else if (expected && Math.abs(audioDuration - expected) > tolerance) {
        issues.push(issueForDuration(
            'render_source_audio_duration_mismatch',
            'O áudio mestre diverge da duração planejada.',
            'audio',
            expected,
            audioDuration,
            tolerance,
        ));
    }

    return {
        status: issues.length ? 'failed' : 'passed',
        stage: 'preflight',
        expectedDurationSec: roundDiagnostic(expected),
        plannedVideoDurationSec: roundDiagnostic(planned),
        actualAudioDurationSec: safeDiagnosticNumber(audioDuration),
        expectedFps: fps,
        durationToleranceSec: tolerance,
        videoDurationToleranceSec: renderVideoDurationTolerance(fps),
        frameTolerance: 0,
        issues,
    };
};

export const validateRenderedOutput = (input: {
    expectedDurationSec: unknown;
    media: MediaDurationProbe;
    outputFps: unknown;
}): RenderIntegrityDiagnostics => {
    const expected = finitePositive(input.expectedDurationSec) || 0;
    const fps = normalizeRenderFps(input.outputFps);
    const audioTolerance = renderDurationTolerance(fps);
    const videoTolerance = renderVideoDurationTolerance(fps);
    const videoDuration = input.media.videoDurationSec;
    const audioDuration = input.media.audioDurationSec;
    const expectedFrameCount = expectedTimelineFrameCount(expected, fps);
    const issues: RenderIntegrityIssue[] = [];

    if (!expected) {
        issues.push({
            code: 'render_expected_duration_invalid',
            message: 'A duração planejada da timeline é inválida.',
            stream: 'timeline',
        });
    }
    if (!input.media.hasVideo) {
        issues.push({
            code: 'render_video_stream_missing',
            message: 'O MP4 não possui uma stream de vídeo.',
            stream: 'video',
        });
    } else if (videoDuration == null || !(videoDuration > 0)) {
        issues.push({
            code: 'render_video_duration_unmeasurable',
            message: 'O ffprobe não conseguiu medir a duração da stream de vídeo.',
            stream: 'video',
        });
    } else if (expected && Math.abs(videoDuration - expected) > videoTolerance) {
        issues.push(issueForDuration(
            'render_video_duration_mismatch',
            'A duração real do vídeo diverge da timeline planejada.',
            'video',
            expected,
            videoDuration,
            videoTolerance,
        ));
    }
    if (!input.media.hasAudio) {
        issues.push({
            code: 'render_audio_stream_missing',
            message: 'O MP4 não possui uma stream de áudio.',
            stream: 'audio',
        });
    } else if (audioDuration == null || !(audioDuration > 0)) {
        issues.push({
            code: 'render_audio_duration_unmeasurable',
            message: 'O ffprobe não conseguiu medir a duração da stream de áudio.',
            stream: 'audio',
        });
    } else if (expected && Math.abs(audioDuration - expected) > audioTolerance) {
        issues.push(issueForDuration(
            'render_audio_duration_mismatch',
            'A duração real do áudio diverge da timeline planejada.',
            'audio',
            expected,
            audioDuration,
            audioTolerance,
        ));
    }
    if (videoDuration != null && audioDuration != null && Math.abs(videoDuration - audioDuration) > audioTolerance) {
        issues.push(issueForDuration(
            'render_av_desynchronized',
            'As streams de vídeo e áudio não terminam juntas.',
            'audio',
            videoDuration,
            audioDuration,
            audioTolerance,
        ));
    }
    if (input.media.videoFps == null || Math.abs(input.media.videoFps - fps) > 0.01) {
        issues.push({
            code: 'render_video_fps_mismatch',
            message: 'A cadência do MP4 não corresponde ao FPS solicitado.',
            stream: 'video',
            expected: fps,
            actual: safeDiagnosticNumber(input.media.videoFps),
            tolerance: 0.01,
        });
    }
    if (input.media.hasVideo && input.media.videoFrameCount == null) {
        issues.push({
            code: 'render_video_frame_count_unmeasurable',
            message: 'O ffprobe não conseguiu contar os quadros da stream de vídeo.',
            stream: 'video',
        });
    } else if (
        expectedFrameCount > 0
        && input.media.videoFrameCount != null
        && input.media.videoFrameCount !== expectedFrameCount
    ) {
        issues.push({
            code: 'render_video_frame_count_mismatch',
            message: 'A quantidade de quadros não cobre a timeline planejada.',
            stream: 'video',
            expected: expectedFrameCount,
            actual: input.media.videoFrameCount,
            delta: input.media.videoFrameCount - expectedFrameCount,
            tolerance: 0,
        });
    }

    return {
        status: issues.length ? 'failed' : 'passed',
        stage: 'output',
        expectedDurationSec: roundDiagnostic(expected),
        actualVideoDurationSec: safeDiagnosticNumber(videoDuration),
        actualAudioDurationSec: safeDiagnosticNumber(audioDuration),
        containerDurationSec: safeDiagnosticNumber(input.media.formatDurationSec),
        expectedFps: fps,
        actualVideoFps: safeDiagnosticNumber(input.media.videoFps),
        expectedVideoFrameCount: expectedFrameCount || undefined,
        actualVideoFrameCount: safeDiagnosticNumber(input.media.videoFrameCount),
        durationToleranceSec: audioTolerance,
        videoDurationToleranceSec: videoTolerance,
        frameTolerance: 0,
        issues,
    };
};

export class RenderIntegrityError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly status: number;

    constructor(readonly diagnostics: RenderIntegrityDiagnostics) {
        const firstIssue = diagnostics.issues[0];
        super(firstIssue?.message || 'A validação de integridade do render falhou.');
        this.name = 'RenderIntegrityError';
        this.code = firstIssue?.code || 'render_integrity_failed';
        this.retryable = this.code === 'render_probe_failed'
            || this.code === 'render_take_source_probe_failed'
            || this.code === 'render_output_missing';
        this.status = this.retryable ? 503 : 422;
    }
}

export const assertRenderIntegrity = (diagnostics: RenderIntegrityDiagnostics) => {
    if (diagnostics.status === 'failed') throw new RenderIntegrityError(diagnostics);
    return diagnostics;
};

export const logRenderIntegrity = (event: string, diagnostics: RenderIntegrityDiagnostics) => {
    // Somente métricas e códigos seguros: nenhum caminho local, payload, token ou stack.
    const method = diagnostics.status === 'failed' ? console.error : console.info;
    method('[render-integrity]', JSON.stringify({ event, ...diagnostics }));
};
