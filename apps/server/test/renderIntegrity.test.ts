import test from 'node:test';
import assert from 'node:assert/strict';
import {
    analyzeTakeSourceCoverage,
    normalizeRenderFps,
    planTimelineFrames,
    plannedTimelineDuration,
    RenderIntegrityError,
    renderDurationTolerance,
    validateRenderedOutput,
    validateRenderPreflight,
    type MediaDurationProbe,
} from '../src/services/renderIntegrity';

const audioProbe = (duration: number): MediaDurationProbe => ({
    formatDurationSec: duration,
    videoDurationSec: null,
    audioDurationSec: duration,
    videoFps: null,
    videoFrameCount: null,
    hasVideo: false,
    hasAudio: true,
});

const outputProbe = (duration: number, fps: number): MediaDurationProbe => ({
    formatDurationSec: duration,
    videoDurationSec: duration,
    audioDurationSec: duration,
    videoFps: fps,
    videoFrameCount: Math.ceil(duration * fps),
    hasVideo: true,
    hasAudio: true,
});

const sourceVideoProbe = (videoDuration: number | null, formatDuration: number | null): MediaDurationProbe => ({
    formatDurationSec: formatDuration,
    videoDurationSec: videoDuration,
    audioDurationSec: formatDuration,
    videoFps: 29.97,
    videoFrameCount: null,
    hasVideo: videoDuration != null,
    hasAudio: formatDuration != null,
});

test('aceita e preserva as cadências suportadas 24, 25, 30 e 60 fps', () => {
    for (const fps of [24, 25, 30, 60]) {
        assert.equal(normalizeRenderFps(fps), fps);
        assert.ok(renderDurationTolerance(fps) >= 0.1);
    }
    assert.equal(normalizeRenderFps(29.97), 30);
});

test('calcula a duração visual planejada considerando velocidade uniforme', () => {
    assert.equal(plannedTimelineDuration([
        { start: 0, end: 2, speed: 1 },
        { start: 1, end: 4, speed: 2 },
        { start: 0, end: 1.25, speed: 'zoom-only' },
    ]), 4.75);
});

test('aceita cauda recuperável de clipe completo sem confundir com corte arbitrário', () => {
    const coverage = analyzeTakeSourceCoverage({
        takeIndex: 0,
        takeId: 'take-completo',
        start: 0,
        end: 22,
        originalDurationSeconds: 22,
        sourceProbe: sourceVideoProbe(21.5, 22),
        outputFps: 30,
    });

    assert.equal(coverage.status, 'recoverable');
    assert.equal(coverage.recovery, 'full_clip');
    assert.equal(coverage.gapSec, 0.5);
    assert.equal(coverage.issue, undefined);
});

test('aceita margem normal de mux e o legado somente quando o container representa o clipe inteiro', () => {
    const normalGap = analyzeTakeSourceCoverage({
        takeIndex: 0,
        start: 4,
        end: 10,
        sourceProbe: sourceVideoProbe(9.94, 12),
        outputFps: 30,
    });
    assert.equal(normalGap.status, 'recoverable');
    assert.equal(normalGap.recovery, 'normal_gap');

    const legacyFullClip = analyzeTakeSourceCoverage({
        takeIndex: 1,
        start: 0,
        end: 22,
        sourceProbe: sourceVideoProbe(21.5, 22),
        outputFps: 30,
    });
    assert.equal(legacyFullClip.status, 'recoverable');
    assert.equal(legacyFullClip.recovery, 'full_clip');
});

test('recusa fonte truncada antes do render com diagnóstico seguro do take', () => {
    const coverage = analyzeTakeSourceCoverage({
        takeIndex: 3,
        takeId: 'take-truncado',
        start: 0,
        end: 1.2,
        originalDurationSeconds: 1.2,
        sourceProbe: sourceVideoProbe(0.5, 1.2),
        outputFps: 30,
    });

    assert.equal(coverage.status, 'truncated');
    assert.equal(coverage.issue?.code, 'render_take_source_truncated');
    assert.equal(coverage.issue?.takeIndex, 3);
    assert.equal(coverage.issue?.takeId, 'take-truncado');
    assert.match(coverage.issue?.message || '', /take 4/i);
    assert.doesNotMatch(JSON.stringify(coverage), /[A-Z]:\\|file_path|AppData/i);

    const diagnostics = validateRenderPreflight({
        expectedDurationSec: 1.2,
        plannedVideoDurationSec: 1.2,
        audioProbe: audioProbe(1.2),
        outputFps: 30,
        takeSourceIssues: coverage.issue ? [coverage.issue] : [],
    });
    assert.equal(diagnostics.status, 'failed');
    assert.equal(diagnostics.stage, 'preflight');
    assert.equal(diagnostics.issues[0]?.code, 'render_take_source_truncated');
});

test('limita recuperação pela duração do corte, não pela duração total da fonte', () => {
    const coverage = analyzeTakeSourceCoverage({
        takeIndex: 0,
        start: 20,
        end: 22,
        originalDurationSeconds: 22,
        sourceProbe: sourceVideoProbe(21.5, 22),
        outputFps: 30,
    });

    assert.equal(coverage.status, 'truncated');
    assert.equal(coverage.issue?.code, 'render_take_source_truncated');
});

test('falha de probe da fonte é temporária e não acusa truncamento', () => {
    const coverage = analyzeTakeSourceCoverage({
        takeIndex: 2,
        takeId: 'C:\\Users\\Pessoa\\video.mp4',
        start: 0,
        end: 10,
        sourceProbe: sourceVideoProbe(null, null),
        probeFailed: true,
        outputFps: 30,
    });
    assert.equal(coverage.issue?.code, 'render_take_source_probe_failed');
    assert.equal(coverage.issue?.takeId, 'take-3');

    const diagnostics = validateRenderPreflight({
        expectedDurationSec: 10,
        plannedVideoDurationSec: 10,
        audioProbe: audioProbe(10),
        outputFps: 30,
        takeSourceIssues: coverage.issue ? [coverage.issue] : [],
    });
    const error = new RenderIntegrityError(diagnostics);
    assert.equal(error.code, 'render_take_source_probe_failed');
    assert.equal(error.retryable, true);
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /truncad|caminho|AppData/i);
});

test('pré-validação permite reserva visual e áudio alinhado', () => {
    const diagnostics = validateRenderPreflight({
        expectedDurationSec: 24.163188,
        plannedVideoDurationSec: 24.2,
        audioProbe: audioProbe(24.189388),
        outputFps: 30,
    });
    assert.equal(diagnostics.status, 'passed');
    assert.deepEqual(diagnostics.issues, []);
});

test('narração maior que a sequência visual bloqueia a entrega', () => {
    const diagnostics = validateRenderPreflight({
        expectedDurationSec: 20,
        plannedVideoDurationSec: 16,
        audioProbe: audioProbe(20),
        outputFps: 30,
    });
    assert.equal(diagnostics.status, 'failed');
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_visual_timeline_short'));
});

test('áudio mestre curto ou longo é recusado antes do render', () => {
    for (const sourceDuration of [9.6, 10.4]) {
        const diagnostics = validateRenderPreflight({
            expectedDurationSec: 10,
            plannedVideoDurationSec: 10,
            audioProbe: audioProbe(sourceDuration),
            outputFps: 30,
        });
        assert.equal(diagnostics.status, 'failed');
        assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_source_audio_duration_mismatch'));
    }
});

test('recusa take positivo que não ocupa um quadro sem deslocar os takes seguintes', () => {
    const takes = [
        { start: 0, end: 0.001, speed: 1 },
        { start: 0, end: 1, speed: 1 },
    ];
    const framePlan = planTimelineFrames(takes, 30);
    assert.deepEqual(framePlan.frameCounts, [0, 31]);
    assert.deepEqual(framePlan.unrepresentableTakeIndices, [0]);

    const diagnostics = validateRenderPreflight({
        expectedDurationSec: 1,
        plannedVideoDurationSec: plannedTimelineDuration(takes),
        audioProbe: audioProbe(1),
        outputFps: 30,
        unrepresentableTakeCount: 1,
    });
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_take_too_short_for_fps'));
});

test('saída alinhada passa em toda cadência suportada', () => {
    for (const fps of [24, 25, 30, 60]) {
        const duration = 3.2;
        const diagnostics = validateRenderedOutput({
            expectedDurationSec: duration,
            media: outputProbe(duration, fps),
            outputFps: fps,
        });
        assert.equal(diagnostics.status, 'passed', `${fps} fps deveria passar`);
        assert.equal(diagnostics.actualVideoDurationSec, duration);
        assert.equal(diagnostics.actualAudioDurationSec, duration);
    }
});

test('MP4 truncado ou dessincronizado é rejeitado mesmo contendo as duas streams', () => {
    const diagnostics = validateRenderedOutput({
        expectedDurationSec: 24.163188,
        media: {
            formatDurationSec: 19.534,
            videoDurationSec: 19.534,
            audioDurationSec: 19.534,
            videoFps: 30,
            videoFrameCount: 586,
            hasVideo: true,
            hasAudio: true,
        },
        outputFps: 30,
    });
    assert.equal(diagnostics.status, 'failed');
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_video_duration_mismatch'));
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_audio_duration_mismatch'));
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_video_frame_count_mismatch'));
});

test('diferença entre fim do vídeo e do áudio é diagnosticada separadamente', () => {
    const diagnostics = validateRenderedOutput({
        expectedDurationSec: 10,
        media: {
            ...outputProbe(10, 30),
            audioDurationSec: 9.7,
        },
        outputFps: 30,
    });
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_av_desynchronized'));
});

test('falha fechado quando ffprobe só conhece a duração do container', () => {
    const diagnostics = validateRenderedOutput({
        expectedDurationSec: 10,
        media: {
            formatDurationSec: 10,
            videoDurationSec: null,
            audioDurationSec: null,
            videoFps: 60,
            videoFrameCount: null,
            hasVideo: true,
            hasAudio: true,
        },
        outputFps: 60,
    });
    assert.equal(diagnostics.status, 'failed');
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_video_duration_unmeasurable'));
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_audio_duration_unmeasurable'));
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_video_frame_count_unmeasurable'));
});

test('a tolerância visual não aceita vários quadros ausentes em 60 fps', () => {
    const diagnostics = validateRenderedOutput({
        expectedDurationSec: 10,
        media: {
            ...outputProbe(10, 60),
            videoDurationSec: 9.91,
            videoFrameCount: 595,
        },
        outputFps: 60,
    });
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_video_duration_mismatch'));
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_video_frame_count_mismatch'));
});

test('um único quadro final ausente também bloqueia CTA e entrega', () => {
    const diagnostics = validateRenderedOutput({
        expectedDurationSec: 1.5,
        media: {
            formatDurationSec: 1.5,
            videoDurationSec: 44 / 30,
            audioDurationSec: 1.5,
            videoFps: 30,
            videoFrameCount: 44,
            hasVideo: true,
            hasAudio: true,
        },
        outputFps: 30,
    });
    assert.equal(diagnostics.status, 'failed');
    assert.equal(diagnostics.frameTolerance, 0);
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_video_frame_count_mismatch'));
});
