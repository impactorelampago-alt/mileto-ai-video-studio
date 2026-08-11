import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateRenderedOutput } from '../src/services/renderIntegrity';

const ffmpegPath = path.resolve(__dirname, '../../client/resources/bin/ffmpeg.exe');
const ffprobePath = path.resolve(__dirname, '../../client/resources/bin/ffprobe.exe');
const hasBundledBinaries = fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath);
const serviceDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-render-service-data-'));
process.env.USER_DATA_PATH = serviceDataDirectory;
process.env.FFMPEG_PATH = ffmpegPath;
process.env.FFPROBE_PATH = ffprobePath;
process.env.DISABLE_GPU_ENCODE = '1';

after(() => fs.rmSync(serviceDataDirectory, { recursive: true, force: true }));

const runFfmpeg = (args: string[]) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'pipe',
    maxBuffer: 32 * 1024 * 1024,
});

const makeVideo = (directory: string, name: string, fps: number, duration: number, color = '0x2864dc') => {
    const output = path.join(directory, name);
    runFfmpeg([
        '-f', 'lavfi',
        '-i', `color=c=${color}:s=160x90:r=${fps}:d=${duration},drawgrid=w=20:h=15:t=2:c=white@0.85`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        output,
    ]);
    return output;
};

const makeVideoWithTrailingAudio = (
    directory: string,
    name: string,
    fps: number,
    videoDuration: number,
    containerDuration: number,
) => {
    const output = path.join(directory, name);
    runFfmpeg([
        '-f', 'lavfi',
        '-i', `color=c=0x2864dc:s=160x90:r=${fps}:d=${videoDuration},drawgrid=w=20:h=15:t=2:c=white@0.85`,
        '-f', 'lavfi',
        '-i', `anullsrc=r=48000:cl=stereo:d=${containerDuration}`,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        output,
    ]);
    return output;
};

const makeAudio = (directory: string, duration: number) => {
    const output = path.join(directory, `audio-${duration}.wav`);
    runFfmpeg([
        '-f', 'lavfi',
        '-i', `sine=frequency=880:sample_rate=48000:duration=${duration}`,
        '-c:a', 'pcm_s16le',
        output,
    ]);
    return output;
};

const makeImage = (directory: string, name: string, color = '0x28dc64') => {
    const output = path.join(directory, name);
    runFfmpeg([
        '-f', 'lavfi',
        '-i', `color=c=${color}:s=160x90`,
        '-frames:v', '1',
        output,
    ]);
    return output;
};

const makeTransition = (directory: string, duration: number) => {
    const output = path.join(directory, 'transition-visible.mp4');
    runFfmpeg([
        '-f', 'lavfi',
        '-i', `color=c=black:s=160x90:r=25:d=${duration}`,
        '-vf', 'drawbox=x=5:y=5:w=25:h=20:color=magenta@1:t=fill',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        output,
    ]);
    return output;
};

const makeOverlay = (directory: string, name: string, duration: number, ctaStart?: number) => {
    const output = path.join(directory, name);
    const filter = ctaStart == null
        ? 'null'
        : `drawbox=x=5:y=70:w=50:h=12:color=cyan@1:t=fill:replace=1,drawbox=x=40:y=25:w=80:h=40:color=lime@1:t=fill:replace=1:enable='gte(t,${ctaStart})'`;
    runFfmpeg([
        '-f', 'lavfi',
        '-i', `color=c=black@0.0:s=160x90:r=30:d=${duration},format=rgba`,
        '-vf', filter,
        '-c:v', 'qtrle',
        '-pix_fmt', 'argb',
        output,
    ]);
    return output;
};

const firstPixel = (pixels: Buffer) => pixels.subarray(0, 3);

const pixelAt = (filePath: string, at: number, x: number, y: number): Buffer => firstPixel(runFfmpeg([
    '-ss', at.toFixed(3),
    '-i', filePath,
    '-vf', `crop=2:2:${x}:${y},format=rgb24`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    'pipe:1',
]));

const pixelAtFrame = (filePath: string, frameIndex: number, x: number, y: number): Buffer => firstPixel(runFfmpeg([
    '-i', filePath,
    '-vf', `crop=2:2:${x}:${y},select=eq(n\\,${frameIndex}),format=rgb24`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    'pipe:1',
]));

test('zoom-in-out preserva duração com fontes 24, 25, 30 e 60 fps', {
    skip: !hasBundledBinaries,
    timeout: 120_000,
}, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-render-fps-'));

    try {
        // O serviço lê os caminhos dos binários na carga do módulo; o require
        // deliberadamente tardio mantém o teste preso aos binários distribuídos.
        const { buildHybridVideo, probeMediaDurations } = require('../src/services/ffmpeg');
        const duration = 1;
        const audioPath = makeAudio(directory, duration);
        const overlayPath = makeOverlay(directory, 'transparent-overlay.mov', duration);

        for (const sourceFps of [24, 25, 30, 60]) {
            const sourcePath = makeVideo(directory, `source-${sourceFps}.mp4`, sourceFps, duration);
            for (const outputFps of [24, 25, 30, 60]) {
                const outputPath = path.join(directory, `render-${sourceFps}-to-${outputFps}.mp4`);
                await buildHybridVideo({
                    takes: [{
                        id: `take-${sourceFps}`,
                        type: 'video',
                        file_path: sourcePath,
                        start: 0,
                        end: duration,
                        speed: 1,
                        motionEffect: {
                            type: 'zoom-in-out',
                            intensity: 0.2,
                            focalX: 50,
                            focalY: 50,
                            easing: 'smooth',
                        },
                    }],
                    audioPath,
                    overlayPath,
                    outputPath,
                    duration,
                    targetW: 160,
                    targetH: 90,
                    outputFps,
                });

                const probe = await probeMediaDurations(outputPath);
                const diagnostics = validateRenderedOutput({ expectedDurationSec: duration, media: probe, outputFps });
                assert.equal(
                    diagnostics.status,
                    'passed',
                    `${sourceFps}→${outputFps} fps: ${JSON.stringify(diagnostics.issues)}`,
                );
                assert.ok(Math.abs(Number(probe.videoFps) - outputFps) <= 0.01);
                assert.equal(probe.videoFrameCount, outputFps);
            }
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('zoom-in-out com takes mistos, transição e CTA mantém o quadro final', {
    skip: !hasBundledBinaries,
    timeout: 120_000,
}, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-render-cta-'));

    try {
        const { buildHybridVideo, probeMediaDurations } = require('../src/services/ffmpeg');
        const duration = 1.5;
        const first = makeVideo(directory, 'first-24.mp4', 24, 0.75, '0x2864dc');
        const second = makeVideo(directory, 'second-60.mp4', 60, 0.75, '0xdc6428');
        const transition = makeTransition(directory, 0.4);
        const audioPath = makeAudio(directory, duration);
        const overlayPath = makeOverlay(directory, 'cta-overlay.mov', duration, 1.1);
        const outputPath = path.join(directory, 'render-transition-cta.mp4');

        await buildHybridVideo({
            takes: [first, second].map((filePath, index) => ({
                id: `take-${index}`,
                type: 'video' as const,
                file_path: filePath,
                start: 0,
                end: 0.75,
                speed: 1,
                motionEffect: {
                    type: 'zoom-in-out' as const,
                    intensity: 0.18,
                    focalX: index === 0 ? 0 : 100,
                    focalY: 50,
                    easing: 'smooth' as const,
                },
            })),
            transitionPath: transition,
            audioPath,
            overlayPath,
            outputPath,
            duration,
            targetW: 160,
            targetH: 90,
            outputFps: 30,
        });

        const probe = await probeMediaDurations(outputPath);
        const diagnostics = validateRenderedOutput({
            expectedDurationSec: duration,
            media: probe,
            outputFps: 30,
        });
        assert.equal(diagnostics.status, 'passed', JSON.stringify(diagnostics.issues));

        const visibleBase = pixelAt(outputPath, 0.3, 50, 40);
        const duringTransition = pixelAt(outputPath, 0.75, 12, 12);
        const finalFrameIndex = Number(probe.videoFrameCount) - 1;
        const duringCta = pixelAtFrame(outputPath, finalFrameIndex, 80, 44);
        const duringCaption = pixelAtFrame(outputPath, finalFrameIndex, 20, 74);
        assert.equal(visibleBase.length, 3);
        assert.ok(visibleBase.some((channel) => channel > 25),
            `Overlay transparente ocultou o take: RGB=${[...visibleBase].join(',')}`);
        assert.ok(
            duringTransition[0] > duringTransition[1] + 35 && duringTransition[2] > duringTransition[1] + 35,
            `Transição deveria aparecer em magenta, RGB=${[...duringTransition].join(',')}`,
        );
        assert.equal(duringCta.length, 3, `Último quadro ${finalFrameIndex}: ${JSON.stringify(probe)}`);
        assert.ok(duringCta[1] > duringCta[0] + 40 && duringCta[1] > duringCta[2] + 40,
            `CTA final deveria ser verde, RGB=${[...duringCta].join(',')}`);
        assert.ok(duringCaption[1] > 80 && duringCaption[2] > 80,
            `Legenda final deveria permanecer visível em ciano, RGB=${[...duringCaption].join(',')}`);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('imagem sustentada e take acelerado com zoom preservam a timeline', {
    skip: !hasBundledBinaries,
    timeout: 120_000,
}, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-render-image-speed-'));
    try {
        const { buildHybridVideo, probeMediaDurations } = require('../src/services/ffmpeg');
        const duration = 1.2;
        const imagePath = makeImage(directory, 'still.png');
        const videoPath = makeVideo(directory, 'fast-source.mp4', 60, 1.2);
        const audioPath = makeAudio(directory, duration);
        const overlayPath = makeOverlay(directory, 'transparent-overlay.mov', duration);
        const outputPath = path.join(directory, 'render-image-speed.mp4');

        await buildHybridVideo({
            takes: [{
                id: 'still',
                type: 'image',
                file_path: imagePath,
                start: 0,
                end: 0.6,
                speed: 1,
                motionEffect: { type: 'zoom-in-out', intensity: 0.15, focalX: 50, focalY: 50, easing: 'smooth' },
            }, {
                id: 'fast',
                type: 'video',
                file_path: videoPath,
                start: 0,
                end: 1.2,
                speed: 2,
                motionEffect: { type: 'zoom-in-out', intensity: 0.15, focalX: 50, focalY: 50, easing: 'smooth' },
            }],
            audioPath,
            overlayPath,
            outputPath,
            duration,
            targetW: 160,
            targetH: 90,
            outputFps: 25,
        });

        const probe = await probeMediaDurations(outputPath);
        const diagnostics = validateRenderedOutput({ expectedDurationSec: duration, media: probe, outputFps: 25 });
        assert.equal(diagnostics.status, 'passed', JSON.stringify(diagnostics.issues));
        assert.equal(probe.videoFrameCount, 30, JSON.stringify(probe));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('completa take quando a stream visual termina antes do trim planejado', {
    skip: !hasBundledBinaries,
    timeout: 120_000,
}, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-render-short-video-stream-'));
    try {
        const { buildHybridVideo, probeMediaDurations } = require('../src/services/ffmpeg');
        const duration = 1.2;
        const outputFps = 30;
        const sourcePath = makeVideoWithTrailingAudio(directory, 'short-video-stream.mp4', 24, 1.05, duration);
        const audioPath = makeAudio(directory, duration);
        const overlayPath = makeOverlay(directory, 'transparent-overlay.mov', duration);
        const outputPath = path.join(directory, 'render-padded-take.mp4');

        const sourceProbe = await probeMediaDurations(sourcePath);
        const visualDeficit = duration - Number(sourceProbe.videoDurationSec);
        assert.ok(visualDeficit > 2 / outputFps, `Déficit curto insuficiente: ${JSON.stringify(sourceProbe)}`);
        assert.ok(visualDeficit < 0.25, `Déficit curto excedeu o limite: ${JSON.stringify(sourceProbe)}`);

        await buildHybridVideo({
            takes: [{
                id: 'short-video-stream',
                type: 'video',
                file_path: sourcePath,
                start: 0,
                end: duration,
                speed: 1,
            }],
            audioPath,
            overlayPath,
            outputPath,
            duration,
            targetW: 160,
            targetH: 90,
            outputFps,
        });

        const probe = await probeMediaDurations(outputPath);
        const diagnostics = validateRenderedOutput({ expectedDurationSec: duration, media: probe, outputFps });
        assert.equal(diagnostics.status, 'passed', JSON.stringify(diagnostics.issues));
        assert.equal(probe.videoFrameCount, 36, JSON.stringify(probe));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('não mascara take severamente truncado com congelamento longo', {
    skip: !hasBundledBinaries,
    timeout: 120_000,
}, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-render-truncated-video-stream-'));
    try {
        const { buildHybridVideo, probeMediaDurations } = require('../src/services/ffmpeg');
        const duration = 1.2;
        const outputFps = 30;
        const sourcePath = makeVideoWithTrailingAudio(directory, 'truncated-video-stream.mp4', 24, 0.5, duration);
        const audioPath = makeAudio(directory, duration);
        const overlayPath = makeOverlay(directory, 'transparent-overlay.mov', duration);
        const outputPath = path.join(directory, 'render-truncated-take.mp4');

        const sourceProbe = await probeMediaDurations(sourcePath);
        assert.ok(
            duration - Number(sourceProbe.videoDurationSec) > 0.25,
            `A fonte de teste deveria exceder o limite de preenchimento: ${JSON.stringify(sourceProbe)}`,
        );

        await buildHybridVideo({
            takes: [{
                id: 'truncated-video-stream',
                type: 'video',
                file_path: sourcePath,
                start: 0,
                end: duration,
                speed: 1,
            }],
            audioPath,
            overlayPath,
            outputPath,
            duration,
            targetW: 160,
            targetH: 90,
            outputFps,
        });

        const probe = await probeMediaDurations(outputPath);
        const diagnostics = validateRenderedOutput({ expectedDurationSec: duration, media: probe, outputFps });
        assert.equal(diagnostics.status, 'failed', JSON.stringify(diagnostics));
        assert.ok(Number(probe.videoFrameCount) < 36, JSON.stringify(probe));
        assert.ok(diagnostics.issues.some((issue) => issue.code === 'render_video_frame_count_mismatch'));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
