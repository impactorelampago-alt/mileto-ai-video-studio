import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Request, Response } from 'express';
import ffmpeg from 'fluent-ffmpeg';

// Isola também os arquivos publicados pelo controller, sem tocar nos projetos locais.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-timeline-mix-'));
process.env.USER_DATA_PATH = directory;
const { mixAudio, normalizeAudioTrackConfig, audioTrackTimelineDuration } = require('../src/controllers/audioController') as typeof import('../src/controllers/audioController');
after(() => fs.rmSync(directory, { recursive: true, force: true }));

const bundledTools = path.resolve(__dirname, '../../client/resources/bin');
const ffmpegPath = fs.existsSync(path.join(bundledTools, 'ffmpeg.exe')) ? path.join(bundledTools, 'ffmpeg.exe') : 'ffmpeg';
const ffprobePath = fs.existsSync(path.join(bundledTools, 'ffprobe.exe')) ? path.join(bundledTools, 'ffprobe.exe') : 'ffprobe';
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const sampleRate = 16000;
const wave = Buffer.alloc(44 + sampleRate * 6 * 2);
wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28);
wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36);
wave.writeUInt32LE(wave.length - 44, 40);
for (let index = 0; index < sampleRate * 6; index += 1) {
    const frequency = index < sampleRate * 2 ? 440 : index < sampleRate * 4 ? 880 : 1320;
    wave.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * frequency * index / sampleRate)), 44 + index * 2);
}
fs.writeFileSync(path.join(directory, 'source.wav'), wave);

const segment = (offsetSec: number, trimStart: number, trimEnd: number, volume = 1) => ({
    offsetSec, trimStart, trimEnd, volume, fadeInSec: 0, fadeOutSec: 0,
});
const track = (segments?: ReturnType<typeof segment>[], volume = 1) => ({
    enabled: true, ...segment(0, 0, 6, volume), ...(segments ? { segments } : {}),
});

const mix = async (narration: object, background?: object) => {
    let status = 200;
    let result: Record<string, any> = {};
    const response = {
        status(code: number) { status = code; return this; },
        json(value: typeof result) { result = value; return this; },
    };
    await mixAudio({ body: {
        narrationUrl: '/source.wav', musicUrl: background ? '/source.wav' : null,
        audioConfig: { narration, background: background ?? { enabled: false } },
    } } as Request, response as unknown as Response);
    assert.equal(status, 200, result.message);
    assert.equal(result.ok, true, result.message);
    const audio = execFileSync(ffmpegPath, ['-v', 'error', '-i',
        path.join(directory, 'public/mixes', path.basename(result.masterAudioUrl)),
        '-f', 'f32le', '-ac', '1', '-ar', String(sampleRate), 'pipe:1']);
    return { result, audio };
};

const level = (audio: Buffer, start: number, frequency?: number): number => {
    const length = sampleRate / 4;
    let sum = 0; let real = 0; let imaginary = 0;
    for (let index = 0; index < length; index += 1) {
        const sample = audio.readFloatLE((Math.round(start * sampleRate) + index) * 4);
        sum += sample * sample;
        if (frequency) {
            real += sample * Math.cos(2 * Math.PI * frequency * index / sampleRate);
            imaginary += sample * Math.sin(2 * Math.PI * frequency * index / sampleRate);
        }
    }
    return frequency ? Math.hypot(real, imaginary) * 2 / length : Math.sqrt(sum / length);
};

test('mixagem real remove o meio, mantém a segunda parte e reutiliza somente o cache correto', async () => {
    const config = track([segment(0, 0, 2), segment(2, 4, 6)]);
    const { result, audio } = await mix(config);
    assert.equal(result.expectedDurationSec, 4);
    assert.ok(Math.abs(result.durationSec - 4) < 0.12);
    assert.ok(level(audio, 0.5, 440) > 0.1);
    assert.ok(level(audio, 2.5, 1320) > 0.1, 'segunda parte deve continuar audível');
    assert.ok(level(audio, 2.5, 880) < 0.005, 'trecho removido não pode voltar');
    const cached = await mix(config);
    assert.equal(cached.result.mixIdentity, result.mixIdentity);
    const moved = await mix(track([segment(0, 0, 2), segment(3, 4, 6)]));
    assert.notEqual(moved.result.mixIdentity, result.mixIdentity);
    assert.equal(moved.result.expectedDurationSec, 5);
    assert.ok(level(moved.audio, 2.3) < 0.005, 'lacuna movida deve ser silêncio');
    assert.ok(level(moved.audio, 3.5, 1320) > 0.1);
});

test('mixagem real soma sobreposições e aplica volume por bloco e por faixa', async () => {
    const { result, audio } = await mix(track([segment(0, 0, 2), segment(1, 4, 6, 0.5)], 0.5));
    assert.equal(result.expectedDurationSec, 3);
    const firstLevel = level(audio, 1.3, 440);
    const secondLevel = level(audio, 1.3, 1320);
    assert.ok(firstLevel > 0.07 && firstLevel < 0.1, `nível do primeiro bloco: ${firstLevel}`);
    assert.ok(secondLevel > 0.03 && secondLevel < 0.05, `nível do segundo bloco: ${secondLevel}`);
});

test('narração inteira reconstruída determina o fim do master com música de fundo', async () => {
    const { result, audio } = await mix(track([segment(0, 0, 2), segment(2, 4, 6)]), track(undefined, 0.1));
    assert.equal(result.expectedDurationSec, 4);
    assert.ok(Math.abs(result.durationSec - 4) < 0.12);
    assert.ok(level(audio, 2.5, 1320) > 0.1, 'master não pode terminar no primeiro bloco');
});

test('recorte simples continua removendo o começo e o fim da fonte', async () => {
    const { result, audio } = await mix({ enabled: true, ...segment(0, 2, 4) });
    assert.equal(result.expectedDurationSec, 2);
    assert.ok(level(audio, 0.5, 880) > 0.1);
    assert.ok(level(audio, 0.5, 440) < 0.005);
    assert.ok(level(audio, 1.5, 1320) < 0.005);
});

test('música sem narração aceita recorte e reordenação dos blocos', async () => {
    const { result, audio } = await mix({ enabled: false }, track([segment(0, 4, 6), segment(2, 0, 2)]));
    assert.equal(result.expectedDurationSec, 4);
    assert.ok(level(audio, 0.5, 1320) > 0.1);
    assert.ok(level(audio, 2.5, 440) > 0.1);
    assert.ok(level(audio, 2.5, 880) < 0.005);
});

test('contrato mede todos os blocos e recusa listas e intervalos inválidos', () => {
    assert.equal(audioTrackTimelineDuration(normalizeAudioTrackConfig(track([segment(0, 0, 2), segment(3, 4, 6)]), 1)), 5);
    assert.throws(() => normalizeAudioTrackConfig(track([]), 1), /trechos/);
    assert.throws(() => normalizeAudioTrackConfig(track([segment(0, 4, 2)]), 1), /fim do corte/);
});
