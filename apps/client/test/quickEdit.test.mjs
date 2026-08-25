import assert from 'node:assert/strict';
import test from 'node:test';

import { automaticCutTakes } from '../src/lib/automaticCuts.ts';

const videoTake = (id, duration) => ({
    id,
    type: 'video',
    fileName: `${id}.mp4`,
    fileUrl: `file:///${id}.mp4`,
    originalDurationSeconds: duration,
    trim: { start: 0, end: duration },
    speedPresetId: 'normal',
});

const timelineDuration = (takes) => takes.reduce(
    (total, take) => total + take.trim.end - take.trim.start,
    0,
);

test('preenche a cauda de 0,464 s que antes era aceita e bloqueava o download', () => {
    const narrationDuration = 14.576;
    const result = automaticCutTakes(
        [videoTake('take-1', 7.056), videoTake('take-2', 7.056)],
        narrationDuration,
        (_source, index) => `loop-${index}`,
    );

    assert.equal(result.looped, true);
    assert.equal(result.takes.length, 3);
    assert.equal(result.takes.at(-1).id, 'loop-0');
    assert.ok(Math.abs(result.takes.at(-1).trim.end - 0.464) < 1e-9);
    assert.ok(Math.abs(timelineDuration(result.takes) - narrationDuration) < 0.001);
});

test('não cria loop quando os takes disponíveis já cobrem a narração', () => {
    const narrationDuration = 14.576;
    const result = automaticCutTakes(
        [videoTake('take-1', 8), videoTake('take-2', 8)],
        narrationDuration,
        (_source, index) => `loop-${index}`,
    );

    assert.equal(result.looped, false);
    assert.equal(result.takes.length, 2);
    assert.ok(Math.abs(timelineDuration(result.takes) - narrationDuration) < 0.001);
    assert.ok(result.takes.every((take) => take.speedPresetId === 'normal'));
});
