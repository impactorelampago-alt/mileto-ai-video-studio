import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpsFolderScope } from '../src/opsAssetScope.js';

const folderId = '00000000-0000-4000-8000-000000000003';

test('ausência de folderId continua representando busca global', () => {
    assert.equal(normalizeOpsFolderScope(undefined), undefined);
    assert.equal(normalizeOpsFolderScope(''), undefined);
});

test('folderId=root representa exclusivamente a raiz real', () => {
    assert.equal(normalizeOpsFolderScope('root'), 'root');
});

test('UUID representa exclusivamente a pasta informada', () => {
    assert.equal(normalizeOpsFolderScope(folderId), folderId);
});

test('falha fechado para escopos ambíguos ou forjados', () => {
    assert.throws(() => normalizeOpsFolderScope('TAKES'), /inválido/);
    assert.throws(() => normalizeOpsFolderScope(['root', folderId]), /inválido/);
});
