import assert from 'node:assert/strict';
import test from 'node:test';
import {
    findApprovedTakesFolder,
    isApprovedTakesFolderName,
    markTakeTrimmed,
    nextTakeToTrim,
    readTrimmedTakeIds,
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
