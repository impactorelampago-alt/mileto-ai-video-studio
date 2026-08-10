import assert from 'node:assert/strict';
import test from 'node:test';
import {
    compactTitleDisplayText,
    deterministicCaptionTitleCandidates,
    deterministicTitleCandidates,
    fitTitlesToTimeline,
    isSemanticallyCompleteTitle,
    limitTitleWords,
    preventTitleOverlaps,
    resolveLiteralCaptionText,
    resolveTitleColors,
    rotatingTitleTypeIndex,
    selectTitlesForSemanticCoverage,
    semanticCoverageForTitles,
    semanticRolesForTitle,
    titleTypeWordCapacity,
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

test('prioriza cidade em frase de moradia e nunca confunde a empresa com região', () => {
    const candidates = deterministicTitleCandidates('Se você mora em Rio das Ostras, na Ótica Olá, aproveite esta oferta.');
    assert.ok(candidates.some((candidate) => candidate.kind === 'region' && candidate.text === 'Rio das Ostras'));
    assert.ok(!candidates.some((candidate) => candidate.kind === 'region' && /Ótica Olá/iu.test(candidate.text)));
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
    assert.equal(aliases.get('oferta')?.id, undefined);

    const expandedAliases = triggerMapWithAliases([
        trigger('price', 'Preço'),
        trigger('product', 'Produto'),
    ]);
    assert.equal(expandedAliases.get('valor')?.id, 'price');
    assert.equal(expandedAliases.get('oferta')?.id, 'product');
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
    assert.equal(limitTitleWords('EXAME POR NOSSA CONTA', 3), 'EXAME POR NOSSA CONTA');
    assert.equal(limitTitleWords('A PARTIR DE R$ 39,90', 3), 'A PARTIR DE R$ 39,90');
    assert.equal(limitTitleWords('R$ 199,00', 3), 'R$ 199,00');
    assert.equal(limitTitleWords('CLIQUE AQUI', 3), 'CLIQUE AQUI');
    assert.equal(isSemanticallyCompleteTitle('A PARTIR DE'), false);
    assert.equal(isSemanticallyCompleteTitle('A PARTIR DE R$ 39,90'), true);
});

test('extrai preço das legendas reconciliadas quando a narração usa número por extenso', () => {
    assert.deepEqual(deterministicCaptionTitleCandidates([
        { text: 'A', start: 2 },
        { text: 'PARTIR', start: 2.2 },
        { text: 'DE', start: 2.5 },
        { text: 'R$ 39,90', start: 2.8 },
    ]), [{ text: 'A PARTIR DE R$ 39,90', kind: 'price', startSec: 2 }]);
});

test('separa evidencia literal de etiqueta visual curta por gatilho', () => {
    assert.deepEqual(compactTitleDisplayText('A PARTIR DE R$ 39,90', 'price', 3), {
        sourceText: 'A PARTIR DE R$ 39,90',
        text: 'R$ 39,90',
        qualifierText: 'A PARTIR DE',
    });
    assert.deepEqual(compactTitleDisplayText('ATENÇÃO, PIRACICABA', 'region', 3), {
        sourceText: 'ATENÇÃO, PIRACICABA',
        text: 'PIRACICABA',
    });
    assert.deepEqual(compactTitleDisplayText('O EXAME DE VISTA', 'benefit', 3), {
        sourceText: 'O EXAME DE VISTA',
        text: 'EXAME DE VISTA',
    });
    assert.deepEqual(compactTitleDisplayText('SUA ARMAÇÃO', 'product', 3), {
        sourceText: 'SUA ARMAÇÃO',
        text: 'ARMAÇÃO',
    });
    assert.deepEqual(compactTitleDisplayText('SOMENTE ATÉ SÁBADO', 'scarcity', 3), {
        sourceText: 'SOMENTE ATÉ SÁBADO',
        text: 'ATÉ SÁBADO',
    });
    assert.deepEqual(compactTitleDisplayText('CLIQUE NO BOTÃO', 'cta', 3), {
        sourceText: 'CLIQUE NO BOTÃO',
        text: 'CLIQUE NO BOTÃO',
    });
});

test('rejeita conectores sem fato e preço sem valor', () => {
    assert.equal(compactTitleDisplayText('A PARTIR DE', 'price', 3), null);
    assert.equal(compactTitleDisplayText('POR CONTA DE', 'benefit', 3), null);
    assert.equal(compactTitleDisplayText('NA ÓTICA OLÁ', 'region', 3), null);
    assert.deepEqual(compactTitleDisplayText('RIO DAS OSTRAS', 'region', 3), {
        sourceText: 'RIO DAS OSTRAS',
        text: 'RIO DAS OSTRAS',
    });
});

test('transforma frases comerciais em rótulos nominais literais', () => {
    assert.deepEqual(compactTitleDisplayText('A SUA ARMAÇÃO SAI A PARTIR DE', 'product', 5), {
        sourceText: 'A SUA ARMAÇÃO SAI A PARTIR DE',
        text: 'ARMAÇÃO',
    });
    assert.deepEqual(compactTitleDisplayText('O EXAME DE VISTA SAI POR CONTA', 'benefit', 4), {
        sourceText: 'O EXAME DE VISTA SAI POR CONTA',
        text: 'EXAME DE VISTA',
    });
    assert.deepEqual(compactTitleDisplayText('MONTE SEUS ÓCULOS DO SEU JEITO', 'product', 5), {
        sourceText: 'MONTE SEUS ÓCULOS DO SEU JEITO',
        text: 'ÓCULOS',
    });
    assert.deepEqual(compactTitleDisplayText('MONTE SEUS ÓCULOS DO SEU JEITO', 'differentiator', 5), {
        sourceText: 'MONTE SEUS ÓCULOS DO SEU JEITO',
        text: 'SEU JEITO',
    });
});

test('respeita a capacidade editorial do modelo visual', () => {
    assert.equal(titleTypeWordCapacity('premium-benefit-badge'), 3);
    assert.equal(titleTypeWordCapacity('premium-product-launch'), 4);
    assert.equal(titleTypeWordCapacity('modelo-desconhecido'), 4);
    assert.equal(titleTypeWordCapacity('premium-benefit-badge', 2), 2);
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

test('trata maxTitles como quantidade-base e só expande pelas funções semânticas comprovadas', () => {
    const candidates = [
        { id: 'hook-offer', startSec: 0.4, durationSec: 2, semanticRoles: semanticRolesForTitle('benefit', 0.4, 20) },
        { id: 'support', startSec: 4, durationSec: 2, semanticRoles: [] },
        { id: 'cta-final', startSec: 17, durationSec: 2, semanticRoles: semanticRolesForTitle('cta', 17, 20) },
    ];
    const expanded = selectTitlesForSemanticCoverage(candidates, 1);
    assert.deepEqual(expanded.titles.map((title) => title.id), ['hook-offer', 'cta-final']);
    assert.deepEqual(expanded.coverage, {
        required: ['hook', 'offer_or_benefit', 'cta'],
        covered: ['hook', 'offer_or_benefit', 'cta'],
        missing: [],
    });

    const baseFilled = selectTitlesForSemanticCoverage(candidates, 3);
    assert.deepEqual(baseFilled.titles.map((title) => title.id), ['hook-offer', 'support', 'cta-final']);
    assert.equal(baseFilled.titles.length, 3);
});

test('CTA final é preservado e limitado à timeline sem virar fração invisível', () => {
    const fitted = fitTitlesToTimeline([
        { id: 'valid-cta', startSec: 21.82, durationSec: 2, semanticRoles: ['cta'] as ('cta')[] },
        { id: 'outside', startSec: 24.3, durationSec: 2, semanticRoles: ['cta'] as ('cta')[] },
        { id: 'flash', startSec: 23.8, durationSec: 2, semanticRoles: [] },
    ], 24.163188);
    assert.deepEqual(fitted.map((title) => title.id), ['valid-cta']);
    assert.equal(fitted[0].durationSec, 2);
    assert.deepEqual(semanticCoverageForTitles(fitted, fitted), {
        required: ['cta'],
        covered: ['cta'],
        missing: [],
    });
});

test('CTA comprovado continua faltante se for descartado antes da seleção final', () => {
    const evidence = [
        { startSec: 0.4, durationSec: 1, semanticRoles: ['hook', 'offer_or_benefit'] as ('hook' | 'offer_or_benefit')[] },
        { startSec: 17, durationSec: 1, semanticRoles: ['cta'] as ('cta')[] },
    ];
    const selected = [evidence[0]];
    assert.deepEqual(semanticCoverageForTitles(evidence, selected), {
        required: ['hook', 'offer_or_benefit', 'cta'],
        covered: ['hook', 'offer_or_benefit'],
        missing: ['cta'],
    });
});
