import assert from 'node:assert/strict';
import test from 'node:test';
import { segmentCaptionWords } from '../src/services/captionSegmentation';

const words = (values: string[]) => values.map((text, index) => ({
    text,
    start: index * 0.3,
    end: index * 0.3 + 0.24,
}));

test('agrupa legenda por sentido e preserva preço com qualificador', () => {
    const segments = segmentCaptionWords(words([
        'NA', 'ÓTICA', 'REIS', 'A', 'SUA', 'ARMAÇÃO', 'SAI',
        'A', 'PARTIR', 'DE', 'R$ 39,90', 'NA', 'COMPRA', 'DOS', 'ÓCULOS',
    ]));

    assert.deepEqual(segments.map((segment) => segment.text), [
        'NA ÓTICA REIS',
        'A SUA ARMAÇÃO SAI',
        'A PARTIR DE R$ 39,90',
        'NA COMPRA DOS ÓCULOS',
    ]);
});

test('respeita pausa natural antes do limite visual', () => {
    const input = words(['ATENÇÃO', 'PIRACICABA', 'SÓ', 'ATÉ', 'SÁBADO']);
    input[2].start = 1.5;
    input[2].end = 1.74;
    input[3].start = 1.8;
    input[3].end = 2.04;
    input[4].start = 2.1;
    input[4].end = 2.34;
    assert.deepEqual(segmentCaptionWords(input).map((segment) => segment.text), [
        'ATENÇÃO PIRACICABA',
        'SÓ ATÉ SÁBADO',
    ]);
});
