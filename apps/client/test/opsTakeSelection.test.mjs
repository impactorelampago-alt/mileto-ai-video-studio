import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOpsTakesForNarration } from '../src/lib/opsTakeSelection.ts';

const asset = (id) => ({ id, name: `${id}.mp4`, kind: 'video' });
const pool = Array.from({ length: 12 }, (_, index) => asset(`take-${index + 1}`));
const ids = (result) => result.takes.map((take) => take.id);

const job = (overrides = {}) => ({
    id: 'job-1',
    projectId: 'project-1',
    shuffleTakes: false,
    settings: {},
    ...overrides,
});

test('sem shuffle nem order, a ordem enviada pelo Ops e respeitada', () => {
    const result = selectOpsTakesForNarration(pool, 25, job());
    assert.deepEqual(ids(result).slice(0, 4), ['take-1', 'take-2', 'take-3', 'take-4']);
});

test('takeSelection.order random embaralha a selecao num video unico', () => {
    const result = selectOpsTakesForNarration(pool, 25, job({
        settings: { takeSelection: { order: 'random' } },
    }));
    // Mesma quantidade de takes, ordem diferente da enviada.
    assert.equal(result.takes.length, selectOpsTakesForNarration(pool, 25, job()).takes.length);
    assert.notDeepEqual(ids(result), ids(selectOpsTakesForNarration(pool, 25, job())));
});

test('order random e deterministico por job: retry re-renderiza o mesmo video', () => {
    const first = selectOpsTakesForNarration(pool, 25, job({
        settings: { takeSelection: { order: 'random' } },
    }));
    const retry = selectOpsTakesForNarration(pool, 25, job({
        settings: { takeSelection: { order: 'random' } },
    }));
    assert.deepEqual(ids(first), ids(retry));
});

test('jobs diferentes com order random saem com selecoes diferentes', () => {
    const jobA = selectOpsTakesForNarration(pool, 25, job({
        id: 'job-a', settings: { takeSelection: { order: 'random' } },
    }));
    const jobB = selectOpsTakesForNarration(pool, 25, job({
        id: 'job-b', settings: { takeSelection: { order: 'random' } },
    }));
    assert.notDeepEqual(ids(jobA), ids(jobB));
});

test('order random tambem embaralha no modo explicit', () => {
    const result = selectOpsTakesForNarration(pool, 25, job({
        settings: { takeSelection: { mode: 'explicit', order: 'random' } },
    }));
    assert.equal(result.mode, 'explicit');
    assert.equal(result.takes.length, pool.length);
    assert.notDeepEqual(ids(result), pool.map((item) => item.id));
});

test('shuffleTakes existente continua funcionando sem o campo novo', () => {
    const result = selectOpsTakesForNarration(pool, 25, job({ shuffleTakes: true }));
    assert.notDeepEqual(ids(result), ids(selectOpsTakesForNarration(pool, 25, job())));
});
