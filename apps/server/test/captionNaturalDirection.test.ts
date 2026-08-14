import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileCaptionWords } from '../src/services/captionReconciliation';

test('direcao natural Fish nao aparece nas legendas', () => {
    const result = reconcileCaptionWords([
        { word: 'Cuide', start: 0, end: 0.3 },
        { word: 'da', start: 0.3, end: 0.5 },
        { word: 'visao', start: 0.5, end: 0.9 },
    ], '[warm and reassuring] Cuide da visao');

    assert.deepEqual(result.words.map((word) => word.text), ['CUIDE', 'DA', 'VISAO']);
    assert.equal(result.words.some((word) => /WARM|REASSURING/.test(word.text)), false);
});
