import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewPath = path.resolve(
    __dirname,
    '../../client/src/components/VideoSequencePreview.tsx',
);
const previewSource = fs.readFileSync(previewPath, 'utf8');

const advanceStart = previewSource.indexOf('            const advanceTrack = () => {');
const tailStart = previewSource.indexOf('            const advanceContractTail = () => {');
const advanceEnd = previewSource.indexOf(
    '\n            const intervalId = setInterval(tick, checkInterval);',
    advanceStart,
);

assert.ok(advanceStart >= 0 && advanceEnd > advanceStart, 'advanceTrack não foi encontrado no preview');
assert.ok(tailStart >= 0 && tailStart < advanceStart, 'helper da cauda contratual não foi encontrado');

const advanceTrackSource = previewSource.slice(tailStart, advanceEnd);
const buildAdvanceTrack = new Function(
    'dependencies',
    `with (dependencies) { ${advanceTrackSource}\nreturn advanceTrack; }`,
);

const runLastTakeEnd = (audioEnded, masterTime = audioEnded ? 24 : 20) => {
    const calls = {
        stopAll: 0,
        takeIndexes: [],
        takeTimes: [],
        audioTimes: [],
    };
    const audio = {
        currentTime: masterTime,
        duration: 24,
        ended: audioEnded,
        paused: audioEnded,
    };
    const take = {
        id: 'take-unico',
        type: 'video',
        trim: { start: 0, end: 20 },
    };

    const advanceTrack = buildAdvanceTrack({
        activeVideo: 1,
        advancingRef: { current: false },
        audioDuration: 24,
        audioMasterRef: { current: audio },
        audioTimeRef: { current: masterTime },
        checkInterval: 30,
        beginBuffering() {},
        currentTake: take,
        currentTakeIndex: 0,
        finishBuffering() {},
        isPlaying: true,
        isStandaloneTakePreview: false,
        masterAudioUrl: '/narrations/otica-reis.mp3',
        playbackSourceFor: () => '/takes/take-unico.mp4',
        setActiveVideo() {},
        setAudioTime: (value) => calls.audioTimes.push(value),
        setCurrentTakeIndex: (value) => calls.takeIndexes.push(value),
        setCurrentTimeInTake: (value) => calls.takeTimes.push(value),
        stopAll: () => { calls.stopAll += 1; },
        takes: [take],
        takesDuration: 20,
        toast: { error() {} },
        totalDuration: 24,
        videoRef1: { current: { pause() {} } },
        videoRef2: { current: { pause() {} } },
        window: {
            clearTimeout() {},
            setTimeout() { return 1; },
        },
    });

    advanceTrack();
    return { audio, calls };
};

test('preview não reinicia no fim dos takes enquanto a narração ainda é audível', () => {
    const beforeNarrationEnd = runLastTakeEnd(false);

    assert.equal(
        beforeNarrationEnd.calls.stopAll,
        0,
        'o fim visual aos 20s não pode parar a narração que termina aos 24s',
    );
    assert.equal(
        beforeNarrationEnd.audio.currentTime,
        20,
        'o relógio do áudio não pode voltar a zero antes da última fala',
    );
    assert.deepEqual(beforeNarrationEnd.calls.audioTimes, [20.03], 'o relógio avança pela cauda, sem voltar a zero');
    assert.deepEqual(beforeNarrationEnd.calls.takeTimes, [20], 'o último quadro continua sustentado');

    const afterNarrationEnd = runLastTakeEnd(true);
    assert.equal(afterNarrationEnd.calls.stopAll, 1);
    assert.equal(afterNarrationEnd.audio.currentTime, 0);
    assert.deepEqual(afterNarrationEnd.calls.audioTimes, [0]);
});

test('áudio legado terminado cedo não encerra a duração canônica do preview', () => {
    const { audio, calls } = runLastTakeEnd(true, 20);
    assert.equal(calls.stopAll, 0);
    assert.equal(audio.currentTime, 20);
    assert.deepEqual(calls.audioTimes, [20.03]);
    assert.deepEqual(calls.takeTimes, [20]);
});

test('captura da cauda do audio cai no ultimo take, nao no primeiro', () => {
    const extractStart = previewSource.indexOf('            extractFrameSync: async (');
    const extractEnd = previewSource.indexOf('\n                // Force local react states', extractStart);
    assert.ok(
        extractStart >= 0 && extractEnd > extractStart,
        'extractFrameSync não foi encontrado no preview',
    );
    const extractMappingSource = previewSource.slice(extractStart, extractEnd);

    assert.match(
        extractMappingSource,
        /let targetTakeIndex = takes\.length;[\s\S]*?if \(targetTakeIndex >= takes\.length\) \{[\s\S]*?targetTakeIndex = Math\.max\(0, takes\.length - 1\);/,
    );
});
