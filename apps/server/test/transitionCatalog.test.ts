import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTransitionCatalog } from '../src/controllers/transitionController';

const uploadedFilmBurn = {
    id: 'user-film-burn',
    originalName: 'FÍLM BURN 08.MP4',
    publicUrl: '/transitions/user-film-burn.mp4',
    filePath: 'C:\\media\\user-film-burn.mp4',
};

const customTransition = {
    id: 'user-light-leak',
    originalName: 'Light Leak.mp4',
    publicUrl: '/transitions/light-leak.mp4',
    filePath: 'C:\\media\\light-leak.mp4',
};

test('catálogo anuncia o Film Burn incluído somente quando o asset está disponível', () => {
    const result = buildTransitionCatalog([uploadedFilmBurn, customTransition], true);

    assert.equal(result[0].id, 'builtin-film-burn-08');
    assert.equal(result[0].isBuiltIn, true);
    assert.deepEqual(result.slice(1).map((transition) => transition.id), ['user-light-leak']);
    assert.equal(result[1].isBuiltIn, false);
});

test('catálogo não cria seleção falsa e preserva upload homônimo se o asset estiver ausente', () => {
    const result = buildTransitionCatalog([uploadedFilmBurn, customTransition], false);

    assert.deepEqual(result.map((transition) => transition.id), [
        'user-film-burn',
        'user-light-leak',
    ]);
    assert.equal(result.some((transition) => transition.isBuiltIn === true), false);
    assert.equal(result.every((transition) => transition.isBuiltIn === false), true);
});
