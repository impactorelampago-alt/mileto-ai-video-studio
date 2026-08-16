import assert from 'node:assert/strict';
import test from 'node:test';
import {
    findApprovedTakesFolder,
    isApprovedTakesFolderName,
    markTakeTrimmed,
    nextTakeToTrim,
    readStagedTrims,
    readTrimmedTakeIds,
    writeStagedTrims,
} from '../src/lib/opsTakeCuration.ts';

const fakeStorage = () => {
    const map = new Map();
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => void map.set(key, String(value)),
        removeItem: (key) => void map.delete(key),
        key: (index) => [...map.keys()][index] ?? null,
        get length() {
            return map.size;
        },
    };
};

test('reconhece as variacoes naturais do nome TAKES APROVADOS', () => {
    for (const name of ['TAKES APROVADOS', 'Takes Aprovados', ' takes  aprovados ', 'TAKE APROVADO', 'Tákes Aprovados']) {
        assert.equal(isApprovedTakesFolderName(name), true, name);
    }
    for (const name of ['TAKES GRAVADOS', 'APROVADOS', 'TAKES', 'PASTA TAKES APROVADOS', '', null, 42]) {
        assert.equal(isApprovedTakesFolderName(name), false, String(name));
    }
});

test('encontra a pasta TAKES APROVADOS na lista de pastas da empresa', () => {
    const folders = [
        { id: 'f1', name: 'TAKES GRAVADOS' },
        { id: 'f2', name: 'Takes Aprovados' },
        { id: 'f3', name: 'VÍDEOS PRONTOS' },
    ];
    assert.equal(findApprovedTakesFolder(folders)?.id, 'f2');
    assert.equal(findApprovedTakesFolder([{ id: 'x', name: 'OUTRA' }]), null);
    assert.equal(findApprovedTakesFolder([]), null);
});

test('marcar um take como cortado persiste e sobrevive a releitura', () => {
    const storage = fakeStorage();
    assert.deepEqual([...readTrimmedTakeIds(storage)], []);

    const afterFirst = markTakeTrimmed('asset-1', storage);
    assert.equal(afterFirst.has('asset-1'), true);

    const afterSecond = markTakeTrimmed('asset-2', storage);
    assert.equal(afterSecond.has('asset-1'), true);
    assert.equal(afterSecond.has('asset-2'), true);

    const reloaded = readTrimmedTakeIds(storage);
    assert.equal(reloaded.has('asset-1'), true);
    assert.equal(reloaded.has('asset-2'), true);
});

test('registro corrompido no storage vira estado vazio sem quebrar', () => {
    const storage = fakeStorage();
    storage.setItem('mileto_ops_trimmed_takes_v1', '{corrompido');
    assert.deepEqual([...readTrimmedTakeIds(storage)], []);
    storage.setItem('mileto_ops_trimmed_takes_v1', JSON.stringify(['lista', 'errada']));
    assert.deepEqual([...readTrimmedTakeIds(storage)], []);
});

test('proximo take varre para frente, da a volta e pula os ja cortados', () => {
    const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

    assert.equal(nextTakeToTrim(queue, 'b', new Set())?.id, 'c');
    // "c" já cortado: pula para "d".
    assert.equal(nextTakeToTrim(queue, 'b', new Set(['c']))?.id, 'd');
    // Fim da fila: dá a volta para o começo.
    assert.equal(nextTakeToTrim(queue, 'd', new Set())?.id, 'a');
    // A volta também pula cortados.
    assert.equal(nextTakeToTrim(queue, 'd', new Set(['a', 'b']))?.id, 'c');
});

test('sem proximo disponivel retorna null', () => {
    const queue = [{ id: 'a' }, { id: 'b' }];
    assert.equal(nextTakeToTrim(queue, 'a', new Set(['b'])), null);
    assert.equal(nextTakeToTrim([{ id: 'a' }], 'a', new Set()), null);
    assert.equal(nextTakeToTrim([], 'a', new Set()), null);
});

test('take atual fora da fila comeca a busca do inicio', () => {
    const queue = [{ id: 'a' }, { id: 'b' }];
    assert.equal(nextTakeToTrim(queue, 'desconhecido', new Set())?.id, 'a');
    assert.equal(nextTakeToTrim(queue, 'desconhecido', new Set(['a']))?.id, 'b');
});

test('carrinho de cortes sobrevive ao ciclo gravar/reler (recarregamento do app)', () => {
    const storage = fakeStorage();
    const entry = {
        asset: { id: 'asset-1', name: 'IMG_1.MOV', companyId: 'empresa-1', folderId: 'pasta-takes' },
        take: { id: 'take-1', url: 'http://127.0.0.1/x.mp4', backendPath: 'C:/cache/x.mp4' },
        trims: [{ start: 1, end: 3.5, kind: 'primary' }, { start: 5, end: 7, kind: 'created' }],
        destinationFolderId: 'pasta-aprovados',
        destinationLabel: 'TAKES APROVADOS',
    };
    writeStagedTrims(new Map([['asset-1', entry]]), storage);

    const restored = readStagedTrims(storage);
    assert.equal(restored.size, 1);
    const back = restored.get('asset-1');
    assert.deepEqual(back.trims, entry.trims);
    assert.equal(back.destinationFolderId, 'pasta-aprovados');
    assert.equal(back.asset.companyId, 'empresa-1');
    assert.equal(back.take.backendPath, 'C:/cache/x.mp4');
});

test('carrinho vazio limpa o registro e dados corrompidos viram carrinho vazio', () => {
    const storage = fakeStorage();
    writeStagedTrims(new Map([['a', { trims: [{ start: 0, end: 1, kind: 'primary' }] }]]), storage);
    writeStagedTrims(new Map(), storage);
    assert.equal(storage.getItem('mileto_ops_staged_trims_v1'), null);

    storage.setItem('mileto_ops_staged_trims_v1', '{quebrado');
    assert.equal(readStagedTrims(storage).size, 0);
    storage.setItem('mileto_ops_staged_trims_v1', JSON.stringify(['lista', 'errada']));
    assert.equal(readStagedTrims(storage).size, 0);
});

test('entradas invalidas do carrinho sao descartadas individualmente', () => {
    const storage = fakeStorage();
    storage.setItem('mileto_ops_staged_trims_v1', JSON.stringify({
        'sem-trims': { destinationFolderId: 'x' },
        'trims-invalidos': { trims: [{ start: 'a', end: 'b' }, { start: 5, end: 2 }] },
        'valido': { trims: [{ start: 0, end: 2, kind: 'created' }, { start: 9, end: 'x' }], savedAt: Date.now() },
    }));

    const restored = readStagedTrims(storage);
    assert.deepEqual([...restored.keys()], ['valido']);
    // O trim inválido do meio é filtrado; o válido permanece com o kind certo.
    assert.deepEqual(restored.get('valido').trims, [{ start: 0, end: 2, kind: 'created' }]);
});

test('entradas muito antigas do carrinho expiram na leitura', () => {
    const storage = fakeStorage();
    storage.setItem('mileto_ops_staged_trims_v1', JSON.stringify({
        'velho': { trims: [{ start: 0, end: 2, kind: 'primary' }], savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 },
        'novo': { trims: [{ start: 0, end: 2, kind: 'primary' }], savedAt: Date.now() },
    }));
    assert.deepEqual([...readStagedTrims(storage).keys()], ['novo']);
});
