import assert from 'node:assert/strict';
import test from 'node:test';
import {
    deterministicTitleCandidates,
    limitTitleWords,
    preventTitleOverlaps,
    resolveLiteralCaptionText,
    resolveTitleColors,
    rotatingTitleTypeIndex,
    triggerMapWithAliases,
} from '../src/services/titleGenerationRules';
import type { TitleTriggerRule } from '../src/services/titleGeneratorConfig';

const trigger = (id: string, name: string): TitleTriggerRule => ({
    id,
    name,
    enabled: true,
    maxWords: 3,
    maxOccurrences: 1,
    instructions: '',
    examples: [],
    sample: '',
    color: { mode: 'brand', paletteSlot: 'primary', primary: '#00e676', secondary: '#07110d' },
    titleTypes: [],
});

test('detecta região após atenção e preço com prefixo a partir de', () => {
    const candidates = deterministicTitleCandidates('Aten\u00e7\u00e3o, Piracicaba! \u00d3culos a partir de R$ 199.');
    assert.deepEqual(candidates, [
        { text: 'a partir de R$ 199', kind: 'price' },
        { text: 'Piracicaba', kind: 'region' },
    ]);
});

test('detecta CTA literal mesmo quando a chamada usa verbo no infinitivo', () => {
    const candidates = deterministicTitleCandidates('Conheça nossas condições e aproveitar essa oferta.');
    assert.deepEqual(candidates, [
        { text: 'aproveitar essa oferta', kind: 'cta' },
    ]);
});

test('prioriza CTA direta sobre uma menção genérica à oferta', () => {
    const candidates = deterministicTitleCandidates(
        'Você pode aproveitar essa oferta. Para continuar, clique no botão.'
    );
    assert.deepEqual(candidates, [
        { text: 'clique no botão', kind: 'cta' },
        { text: 'aproveitar essa oferta', kind: 'cta' },
    ]);
});

test('reconcilia preço formatado e região com os tempos reais das legendas', () => {
    const words = [
        { text: 'ATENÇÃO', start: 0 },
        { text: 'PIRACICABA', start: 0.4 },
        { text: 'A', start: 2 },
        { text: 'PARTIR', start: 2.2 },
        { text: 'DE', start: 2.5 },
        { text: 'R$ 199,00', start: 2.8 },
    ];
    assert.deepEqual(resolveLiteralCaptionText(words, 'Piracicaba', 0, 'region'), {
        text: 'PIRACICABA',
        startSec: 0.4,
    });
    assert.deepEqual(resolveLiteralCaptionText(words, 'a partir de R$ 199', 2, 'price'), {
        text: 'A PARTIR DE R$ 199,00',
        startSec: 2,
    });
});

test('aceita aliases da IA para os gatilhos configurados', () => {
    const aliases = triggerMapWithAliases([
        trigger('region', 'Região'),
        trigger('price', 'Preço'),
    ]);
    assert.equal(aliases.get('localizacao')?.id, 'region');
    assert.equal(aliases.get('oferta')?.id, 'price');
});

test('usa primária e secundária reais da empresa no modo marca', () => {
    const colors = resolveTitleColors(
        { mode: 'brand', paletteSlot: 'primary', primary: '#00e676', secondary: '#07110d' },
        { primary: '#00bcd4', secondary: '#ffb800', tertiary: '#ffffff', all: [] },
        0
    );
    assert.equal(colors.primaryColor, '#00bcd4');
    assert.equal(colors.secondaryColor, '#ffb800');
    assert.ok(colors.colorBinding);
    assert.equal(colors.colorBinding?.secondaryPaletteSlot, 'secondary');
});

test('encurta títulos gerados para manter um respiro antes do próximo', () => {
    const titles = preventTitleOverlaps([
        { id: 'region', startSec: 0.72, durationSec: 2 },
        { id: 'scarcity', startSec: 1.96, durationSec: 2.5 },
        { id: 'description', startSec: 3.16, durationSec: 2.5 },
        { id: 'price', startSec: 6.22, durationSec: 2.5 },
    ]);

    assert.deepEqual(titles, [
        { id: 'region', startSec: 0.72, durationSec: 1.12 },
        { id: 'scarcity', startSec: 1.96, durationSec: 1.08 },
        { id: 'description', startSec: 3.16, durationSec: 2.5 },
        { id: 'price', startSec: 6.22, durationSec: 2.5 },
    ]);

    for (let index = 0; index < titles.length - 1; index += 1) {
        const currentEnd = titles[index].startSec + titles[index].durationSec;
        assert.ok(currentEnd <= titles[index + 1].startSec - 0.12 + Number.EPSILON);
    }
});

test('descarta candidato simultâneo que não teria tempo útil de exibição', () => {
    const titles = preventTitleOverlaps([
        { id: 'first', startSec: 1, durationSec: 2 },
        { id: 'second', startSec: 1, durationSec: 2 },
        { id: 'third', startSec: 3, durationSec: 2 },
    ]);

    assert.deepEqual(titles.map((title) => title.id), ['second', 'third']);
    assert.equal(titles[0].durationSec, 1.88);
});

test('limita títulos por palavras sem quebrar preço brasileiro', () => {
    assert.equal(limitTitleWords('EXAME POR NOSSA CONTA', 3), 'EXAME POR NOSSA');
    assert.equal(limitTitleWords('R$ 199,00', 3), 'R$ 199,00');
    assert.equal(limitTitleWords('CLIQUE AQUI', 3), 'CLIQUE AQUI');
});

test('faz rodízio entre todas as opções marcadas em gerações sucessivas', () => {
    assert.deepEqual(
        [0, 1, 2, 3, 4].map((assignment) => rotatingTitleTypeIndex(3, 0, assignment)),
        [0, 1, 2, 0, 1]
    );
    assert.deepEqual(
        [0, 1, 2].map((assignment) => rotatingTitleTypeIndex(3, 1, assignment)),
        [1, 2, 0]
    );
});
