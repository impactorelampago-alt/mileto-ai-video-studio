import assert from 'node:assert/strict';
import test from 'node:test';

import {
    collectTitleProposalRevisionEdits,
    prepareTitleProposalRevision,
} from '../src/lib/titleProposalRevision.ts';

const suggestions = [
    {
        id: 'title-region',
        text: 'Piracicaba',
        sourceText: 'Oferta em Piracicaba',
        triggerId: 'region',
        triggerName: 'Região',
        selected: true,
    },
    {
        id: 'title-price',
        text: 'A partir de R$ 199',
        sourceText: 'Multifocais a partir de R$ 199',
        triggerId: 'price',
        triggerName: 'Preço',
        selected: false,
    },
];

test('agrega somente mudanças preenchidas e preserva o vínculo com título e gatilho', () => {
    assert.deepEqual(collectTitleProposalRevisionEdits(suggestions, {
        'title-region': '  Óculos em Piracicaba  ',
        'title-price': '   ',
        desconhecido: 'ignorar',
    }), [{
        id: 'title-region',
        currentText: 'Piracicaba',
        desiredText: 'Óculos em Piracicaba',
        triggerId: 'region',
        triggerName: 'Região',
        selected: true,
    }]);
});

test('não fabrica mudanças quando todos os campos estão vazios', () => {
    assert.deepEqual(collectTitleProposalRevisionEdits(suggestions, {}), []);
});

test('considera somente campos próprios do mapa de mudanças', () => {
    assert.deepEqual(collectTitleProposalRevisionEdits([
        { ...suggestions[0], id: 'constructor' },
    ], {}), []);
});

test('não habilita revisão quando o texto desejado equivale ao título atual', () => {
    assert.deepEqual(collectTitleProposalRevisionEdits(suggestions, {
        'title-region': '  Piracicaba\n',
        'title-price': 'A partir de R$ 199',
    }), []);
});

test('separa mensagem humana dos IDs privados e manda somente itens editados', () => {
    const prepared = prepareTitleProposalRevision([{
        id: 'title-region-private-id',
        currentText: 'Piracicaba',
        desiredText: 'Óculos em Piracicaba',
        triggerId: 'region',
        triggerName: 'Região',
        selected: true,
    }]);

    assert.ok(prepared);
    assert.match(prepared.displayInstruction, /Região:.*Piracicaba.*Óculos em Piracicaba/);
    assert.match(prepared.displayInstruction, /O restante deve permanecer exatamente como está/);
    assert.doesNotMatch(prepared.displayInstruction, /title-region-private-id/);
    assert.deepEqual(prepared.requestedEdits, [{
        id: 'title-region-private-id',
        desiredText: 'Óculos em Piracicaba',
    }]);
});
