import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ffmpegPath = path.resolve(__dirname, '../../client/resources/bin/ffmpeg.exe');
const ffprobePath = path.resolve(__dirname, '../../client/resources/bin/ffprobe.exe');
const hasBundledBinaries = fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath);
const serviceDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-file-duration-'));

process.env.USER_DATA_PATH = serviceDataDirectory;
process.env.FFMPEG_PATH = ffmpegPath;
process.env.FFPROBE_PATH = ffprobePath;

const explorer = require('../src/controllers/fileExplorerController') as typeof import('../src/controllers/fileExplorerController');

after(() => fs.rmSync(serviceDataDirectory, { recursive: true, force: true }));

function makeVideoWithLongerAudio(name: string): string {
    const output = path.join(explorer.FILES_ROOT, 'Vídeos', name);
    execFileSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=0x2864dc:s=160x160:r=30:d=1',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1.5',
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        output,
    ], { stdio: 'pipe' });
    return output;
}

function makeVideoWithoutDeclaredStreamDuration(name: string): string {
    const output = path.join(explorer.FILES_ROOT, 'Vídeos', name);
    execFileSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=0x28dc64:s=160x160:r=30:d=1.2',
        '-c:v', 'ffv1',
        output,
    ], { stdio: 'pipe' });
    return output;
}

function probeDuration(filePath: string, target: 'format' | 'video'): number {
    const args = target === 'format'
        ? ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]
        : ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', filePath];
    return Number(execFileSync(ffprobePath, args, { encoding: 'utf8' }).trim());
}

function responseCapture() {
    const capture: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
    const response = {
        status(code: number) {
            capture.statusCode = code;
            return response;
        },
        json(body: Record<string, unknown>) {
            capture.body = body;
            return response;
        },
    };
    return { capture, response };
}

test('cadastro de MP4 usa a duração da stream visual, não a duração maior do container', {
    skip: !hasBundledBinaries,
}, async () => {
    const filePath = makeVideoWithLongerAudio('novo-com-audio-maior.mp4');
    assert.ok(probeDuration(filePath, 'format') > 1.4);
    assert.ok(Math.abs(probeDuration(filePath, 'video') - 1) < 0.05);

    const entry = await explorer.registerFile(filePath, 'Vídeos/novo-com-audio-maior.mp4');

    assert.ok(Math.abs(Number(entry.durationSec) - 1) < 0.05, JSON.stringify(entry));
    assert.equal(entry.durationSource, 'visual-stream');
});

test('calcula duração visual por quadros/FPS quando a stream não declara duration', {
    skip: !hasBundledBinaries,
}, async () => {
    const filePath = makeVideoWithoutDeclaredStreamDuration('sem-duration-na-stream.mkv');
    const declaredDuration = probeDuration(filePath, 'video');
    assert.ok(!Number.isFinite(declaredDuration), String(declaredDuration));

    const entry = await explorer.registerFile(filePath, 'Vídeos/sem-duration-na-stream.mkv');

    assert.ok(Math.abs(Number(entry.durationSec) - 1.2) < 0.05, JSON.stringify(entry));
    assert.equal(entry.durationSource, 'visual-stream');
});

test('listagem migra duração antiga e preview devolve a duração visual', {
    skip: !hasBundledBinaries,
}, async () => {
    const relPath = 'Vídeos/antigo-com-audio-maior.mp4';
    const filePath = makeVideoWithLongerAudio('antigo-com-audio-maior.mp4');
    const registered = await explorer.registerFile(filePath, relPath);

    const staleIndex = explorer.readIndex();
    const staleEntry = staleIndex.find((entry) => entry.id === registered.id)!;
    staleEntry.durationSec = 1.5;
    delete staleEntry.durationSource;
    delete staleEntry.durationProbeFingerprint;
    delete staleEntry.durationProbeAttemptedAt;
    explorer.writeIndex(staleIndex);

    const list = responseCapture();
    await explorer.listItems({ query: { path: 'Vídeos' } } as never, list.response as never);
    assert.equal(list.capture.statusCode, 200);
    const listedFiles = list.capture.body?.files as Array<{ id: string; durationSec?: number; durationSource?: string }>;
    const listed = listedFiles.find((entry) => entry.id === registered.id)!;
    assert.ok(Math.abs(Number(listed.durationSec) - 1) < 0.05, JSON.stringify(listed));
    assert.equal(listed.durationSource, 'visual-stream');

    const migrated = explorer.readIndex().find((entry) => entry.id === registered.id)!;
    assert.ok(Math.abs(Number(migrated.durationSec) - 1) < 0.05, JSON.stringify(migrated));
    assert.equal(migrated.durationSource, 'visual-stream');

    const preview = responseCapture();
    await explorer.preparePreviewSource({ body: { relPath } } as never, preview.response as never);
    assert.equal(preview.capture.statusCode, 200);
    assert.equal(preview.capture.body?.ok, true);
    assert.ok(Math.abs(Number(preview.capture.body?.durationSec) - 1) < 0.05, JSON.stringify(preview.capture.body));
});

test('listagem limita migração por request e persiste arquivo colado manualmente com id', {
    skip: !hasBundledBinaries,
}, async () => {
    const source = makeVideoWithLongerAudio('base-migracao.mp4');
    const legacyIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
        const name = `legado-${index}.mp4`;
        const filePath = path.join(explorer.FILES_ROOT, 'Vídeos', name);
        fs.copyFileSync(source, filePath);
        const registered = await explorer.registerFile(filePath, `Vídeos/${name}`);
        legacyIds.push(registered.id);
    }
    const staleIndex = explorer.readIndex();
    for (const entry of staleIndex.filter((candidate) => legacyIds.includes(candidate.id))) {
        entry.durationSec = 1.5;
        delete entry.durationSource;
        delete entry.durationProbeFingerprint;
        delete entry.durationProbeAttemptedAt;
    }
    explorer.writeIndex(staleIndex);

    const manualPath = path.join(explorer.FILES_ROOT, 'Vídeos', 'manual-na-pasta.mp4');
    fs.copyFileSync(source, manualPath);
    fs.unlinkSync(source);

    const list = responseCapture();
    await explorer.listItems({ query: { path: 'Vídeos' } } as never, list.response as never);
    assert.equal(list.capture.statusCode, 200);

    const after = explorer.readIndex();
    const migratedCount = after.filter((entry) =>
        legacyIds.includes(entry.id) && entry.durationSource === 'visual-stream'
    ).length;
    assert.equal(migratedCount, 3);
    const manual = after.find((entry) => entry.relPath === 'Vídeos/manual-na-pasta.mp4');
    assert.ok(manual?.id, JSON.stringify(manual));
});
