import assert from 'node:assert/strict';
import test from 'node:test';

import {
    automaticCutTakes,
    fillTimelineTailPreservingCuts,
} from '../src/lib/automaticCuts.ts';

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

test('repara a cauda de snapshot legado sem redistribuir os cortes existentes', () => {
    const originalTakes = [videoTake('take-1', 7.056), videoTake('take-2', 7.056)];
    const result = fillTimelineTailPreservingCuts(
        originalTakes,
        14.576,
        (_source, index) => `tail-${index}`,
    );

    assert.equal(result.filled, true);
    assert.equal(result.addedTakeCount, 1);
    assert.equal(result.takes.length, 3);
    assert.deepEqual(result.takes.slice(0, 2), originalTakes);
    assert.equal(result.takes.at(-1).id, 'tail-0');
    assert.ok(Math.abs(result.takes.at(-1).trim.end - 0.464) < 1e-9);
    assert.ok(Math.abs(timelineDuration(result.takes) - 14.576) < 0.001);
});

test('mantém por referência uma timeline que já cobre o áudio', () => {
    const originalTakes = [videoTake('take-1', 8), videoTake('take-2', 8)];
    const result = fillTimelineTailPreservingCuts(originalTakes, 14.576);

    assert.equal(result.filled, false);
    assert.strictEqual(result.takes, originalTakes);
    assert.deepEqual(result.takes, originalTakes);
});

test('não mascara uma timeline realmente incompleta como reparo legado', () => {
    assert.throws(
        () => fillTimelineTailPreservingCuts([videoTake('take-1', 1)], 3.5),
        /render_visual_timeline_short/,
    );
});

test('recusa reparo silencioso quando não existe corte visual reutilizável', () => {
    const invalidTake = videoTake('take-1', 0);
    assert.throws(
        () => fillTimelineTailPreservingCuts([invalidTake], 0.5),
        /render_visual_timeline_unfillable/,
    );
});
