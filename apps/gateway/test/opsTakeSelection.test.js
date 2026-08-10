import test from 'node:test';
import assert from 'node:assert/strict';
import {
    narrationTakeCount,
    selectOpsTakesForNarration,
} from '../../client/src/lib/opsTakeSelection.ts';

const assets = (count) => Array.from({ length: count }, (_value, index) => ({
    id: `take-${index + 1}`,
    companyId: 'company-1',
    folderId: 'takes-folder',
    name: `take-${index + 1}.mp4`,
    kind: 'video',
    createdAt: new Date(Date.UTC(2026, 7, 10, 12, 0, count - index)).toISOString(),
}));

const job = (overrides = {}) => ({
    id: 'job-1',
    projectId: 'project-1',
    shuffleTakes: false,
    settings: {
        batch: { id: 'batch-1', index: 0, size: 1 },
        takeSelection: {
            mode: 'automatic',
            targetSeconds: 2.5,
            minSeconds: 2,
            maxSeconds: 3,
            order: 'newest',
        },
    },
    ...overrides,
});

test('calcula a quantidade usando a duracao real da narracao e alvo de 2,5 segundos', () => {
    assert.equal(narrationTakeCount(10), 4);
    assert.equal(narrationTakeCount(16), 6);
    assert.equal(narrationTakeCount(30), 12);
});

test('video unico usa os takes mais recentes na ordem recebida do Ops', () => {
    const pool = assets(12);
    const result = selectOpsTakesForNarration(pool, 10, job());

    assert.deepEqual(result.takes.map((take) => take.id), ['take-1', 'take-2', 'take-3', 'take-4']);
    assert.equal(result.reusedCount, 0);
});

test('variacoes do mesmo lote sao deterministicas e nao repetem takes quando o acervo permite', () => {
    const pool = assets(12);
    const firstJob = job({
        id: 'job-1',
        projectId: 'project-1',
        shuffleTakes: true,
        settings: { ...job().settings, batch: { id: 'batch-shared', index: 0, size: 2 } },
    });
    const secondJob = job({
        id: 'job-2',
        projectId: 'project-2',
        shuffleTakes: true,
        settings: { ...job().settings, batch: { id: 'batch-shared', index: 1, size: 2 } },
    });
    const first = selectOpsTakesForNarration(pool, 10, firstJob);
    const repeatedFirst = selectOpsTakesForNarration(pool, 10, firstJob);
    const second = selectOpsTakesForNarration(pool, 10, secondJob);

    assert.deepEqual(first.takes.map((take) => take.id), repeatedFirst.takes.map((take) => take.id));
    assert.equal(first.takes.length, 4);
    assert.equal(second.takes.length, 4);
    assert.equal(first.takes.some((take) => second.takes.some((candidate) => candidate.id === take.id)), false);
});

test('acervo curto repete a ordem calculada sem baixar o mesmo asset outra vez', () => {
    const result = selectOpsTakesForNarration(assets(2), 16, job());

    assert.equal(result.takes.length, 6);
    assert.equal(result.uniqueAssetCount, 2);
    assert.equal(result.reusedCount, 4);
});

test('selecao explicita respeita todos os takes informados', () => {
    const explicit = job({
        settings: {
            ...job().settings,
            takeSelection: { ...job().settings.takeSelection, mode: 'explicit' },
        },
    });
    const result = selectOpsTakesForNarration(assets(3), 30, explicit);

    assert.deepEqual(result.takes.map((take) => take.id), ['take-1', 'take-2', 'take-3']);
    assert.equal(result.targetCount, 3);
});
