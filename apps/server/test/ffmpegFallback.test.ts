import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const serviceDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-ffmpeg-fallback-'));
process.env.USER_DATA_PATH = serviceDataDirectory;
process.env.DISABLE_GPU_ENCODE = '1';

const {
    FfmpegExecutionError,
    formatFfmpegFilterSeconds,
    getVideoEncoderArgsFor,
    runWithSoftwareEncoderFallback,
    summarizeFfmpegStderr,
}: typeof import('../src/services/ffmpeg') = require('../src/services/ffmpeg');
type HwEncoder = import('../src/services/ffmpeg').HwEncoder;

after(() => fs.rmSync(serviceDataDirectory, { recursive: true, force: true }));

test('repete uma falha de encoder de hardware com libx264', async () => {
    const attempts: HwEncoder[] = [];
    const fallbacks: HwEncoder[] = [];

    const result = await runWithSoftwareEncoderFallback(
        'h264_qsv',
        async (encoder) => {
            attempts.push(encoder);
            if (encoder === 'h264_qsv') throw new Error('device unavailable');
            return 'video-final.mp4';
        },
        (encoder) => fallbacks.push(encoder)
    );

    assert.deepEqual(attempts, ['h264_qsv', 'libx264']);
    assert.deepEqual(fallbacks, ['h264_qsv']);
    assert.deepEqual(result, {
        value: 'video-final.mp4',
        encoder: 'libx264',
        fallbackUsed: true,
    });
    assert.deepEqual(getVideoEncoderArgsFor(result.encoder, { quality: 18, speed: 'fast' }), [
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
    ]);
});

test('não repete quando libx264 já era o encoder primário', async () => {
    let attempts = 0;
    await assert.rejects(
        runWithSoftwareEncoderFallback('libx264', async () => {
            attempts += 1;
            throw new Error('cpu failure');
        }),
        /cpu failure/
    );
    assert.equal(attempts, 1);
});

test('reduz stderr do FFmpeg e remove comando e caminhos locais', () => {
    const stderr = [
        'Command failed: C:\\Program Files\\Mileto\\ffmpeg.exe -y -i C:\\Users\\User\\secret.mp4',
        'configuration: --enable-nvenc --enable-libx264 '.repeat(100),
        "Error opening input file 'C:\\Users\\User\\AppData\\Local\\Temp\\projeto secreto.mp4'.",
        '[h264_qsv @ 000001] Error initializing an MFX session: unsupported (-3)',
        'Nothing was written into output file, because at least one of its streams received no packets.',
    ].join('\n');

    const diagnostic = summarizeFfmpegStderr(stderr);
    const error = new FfmpegExecutionError('h264_qsv', diagnostic);

    assert.match(diagnostic, /Error initializing an MFX session/);
    assert.match(diagnostic, /<arquivo local>/);
    assert.doesNotMatch(diagnostic, /Command failed|ffmpeg\.exe|C:\\Users|secret\.mp4/);
    assert.ok(diagnostic.length <= 640);
    assert.ok(error.message.length < 800);
    assert.equal(error.code, 'ffmpeg_execution_failed');
});

test('serializa tempos de filtro sem notação científica', () => {
    const startFromTimelineMath = 5.810291446861626e-7;
    const durationFromTimelineMath = 1.6927249999999963;

    assert.equal(formatFfmpegFilterSeconds(startFromTimelineMath), '0');
    assert.equal(formatFfmpegFilterSeconds(durationFromTimelineMath), '1.692725');
    assert.doesNotMatch(formatFfmpegFilterSeconds(startFromTimelineMath), /e[+-]?\d+/i);
    assert.throws(() => formatFfmpegFilterSeconds(Number.NaN), /número finito/);
});
