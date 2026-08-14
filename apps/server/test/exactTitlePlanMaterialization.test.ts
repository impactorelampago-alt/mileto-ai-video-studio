import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_TITLE_GENERATOR_CONFIG } from '../src/services/titleGeneratorConfig';
import { materializeExactTitlePlan } from '../src/services/exactTitlePlanMaterialization';

const spokenWords = [
    { text: 'Multifocais', start: 0.2 },
    { text: 'a', start: 0.8 },
    { text: 'partir', start: 1 },
    { text: 'de', start: 1.2 },
    { text: 'R$', start: 1.4 },
    { text: '199', start: 1.5 },
    { text: 'em', start: 2 },
    { text: 'Piracicaba', start: 2.2 },
    { text: 'clique', start: 5 },
    { text: 'aqui', start: 5.2 },
];

const materialize = (baseTitles: unknown, timelineDurationSec = 8, words = spokenWords) => materializeExactTitlePlan({
    baseTitles,
    spokenWords: words,
    titleConfig: structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG),
    format: '9:16',
    brandPalette: {
        primary: '#112233',
        secondary: '#445566',
        tertiary: '#778899',
        all: ['#112233', '#445566', '#778899'],
    },
    timelineDurationSec,
});

test('materializa somente selecionados com cardinalidade, ordem e textos exatos', () => {
    const result = materialize([
        {
            id: 'price-plan',
            text: 'R$ 199 — DO JEITO CERTO',
            sourceText: 'a partir de R$ 199',
            triggerId: 'price',
            selected: true,
        },
        {
            id: 'ignored-cta',
            text: 'CLIQUE AQUI',
            sourceText: 'clique aqui',
            triggerId: 'cta',
            selected: false,
        },
        {
            id: 'region-plan',
            text: 'ÓCULOS EM PIRACICABA',
            sourceText: 'Piracicaba',
            triggerId: 'region',
            selected: true,
        },
    ]);

    assert.equal(result.requestedCount, 2);
    assert.equal(result.materializedCount, 2);
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.approximatedCount, 0);
    assert.deepEqual(result.titles.map(({ id, text, sourceText, triggerId }) => ({
        id,
        text,
        sourceText,
        triggerId,
    })), [
        {
            id: 'price-plan',
            text: 'R$ 199 — DO JEITO CERTO',
            sourceText: 'a partir de R$ 199',
            triggerId: 'price',
        },
        {
            id: 'region-plan',
            text: 'ÓCULOS EM PIRACICABA',
            sourceText: 'Piracicaba',
            triggerId: 'region',
        },
    ]);
});

test('atribui timing e estilo deterministicamente a partir de legenda e configuracao', () => {
    const plan = [{
        id: 'price-plan',
        text: 'R$ 199',
        sourceText: 'a partir de R$ 199',
        triggerId: 'price',
        selected: true,
    }];
    const first = materialize(plan);
    const second = materialize(plan);

    assert.equal(first.titles[0].startSec, 0.8);
    assert.equal(first.titles[0].durationSec, 2.5);
    assert.equal(first.titles[0].styleId, DEFAULT_TITLE_GENERATOR_CONFIG.triggers
        .find((trigger) => trigger.id === 'price')?.titleTypes[0].styleId);
    assert.deepEqual(first.titles, second.titles);
});

test('ancoragem tolerante encontra a fala mesmo com ruido de transcricao', () => {
    // Legenda com grafia do STT: plural cortado (COMPLETO), preco reformatado
    // "R$ 199,00" quebrado em 199/00 e cidade com troca fonetica.
    const noisyWords = [
        { text: 'OCULOS', start: 0.5 },
        { text: 'COMPLETO', start: 0.9 },
        { text: 'POR', start: 1.3 },
        { text: 'R$', start: 1.5 },
        { text: '199', start: 1.7 },
        { text: '00', start: 1.8 },
        { text: 'NA', start: 2.2 },
        { text: 'OTICA', start: 2.4 },
    ];
    const result = materialize([{
        id: 'product-plan',
        text: 'ÓCULOS COMPLETOS',
        sourceText: 'óculos completos por R$ 199 na ótica',
        triggerId: 'product',
        selected: true,
    }], 8, noisyWords);

    assert.equal(result.materializedCount, 1);
    assert.equal(result.approximatedCount, 0);
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.titles[0].text, 'ÓCULOS COMPLETOS');
    assert.equal(result.titles[0].startSec, 0.5);
});

test('titulo confirmado sem evidencia falada literal e posicionado pela ordem, nunca descartado', () => {
    const result = materialize([{
        id: 'benefit-plan',
        text: 'EXAME POR NOSSA CONTA',
        sourceText: 'o exame é por nossa conta na compra dos óculos',
        triggerId: 'benefit',
        selected: true,
    }]);

    assert.equal(result.requestedCount, 1);
    assert.equal(result.materializedCount, 1);
    assert.equal(result.approximatedCount, 1);
    // Texto sai exatamente como confirmado, sem inventar recorte da legenda.
    assert.equal(result.titles[0].text, 'EXAME POR NOSSA CONTA');
    assert.equal(result.titles[0].sourceText, 'o exame é por nossa conta na compra dos óculos');
    assert.ok(result.titles[0].startSec >= 0);
    assert.ok(!result.diagnostics.some((item) => item.code === 'title_plan_source_not_in_captions'));
});

test('titulos confirmados proximos sao espacados e ambos aparecem sem descarte silencioso', () => {
    const result = materialize([
        {
            id: 'first-price',
            text: 'PREÇO',
            sourceText: 'R$',
            triggerId: 'price',
            selected: true,
        },
        {
            id: 'second-price',
            text: 'R$ 199',
            sourceText: '199',
            triggerId: 'price',
            selected: true,
        },
    ]);

    assert.equal(result.requestedCount, 2);
    assert.equal(result.materializedCount, 2);
    assert.deepEqual(result.titles.map((title) => title.id), ['first-price', 'second-price']);
    // Preservam a ordem e nunca se sobrepoem.
    assert.ok(result.titles[1].startSec >= result.titles[0].startSec + result.titles[0].durationSec);
    assert.ok(result.titles.every((title) => title.durationSec >= 0.75));
    assert.equal(result.diagnostics.length, 0);
});

test('itens estruturalmente invalidos ainda recebem diagnostico proprio', () => {
    const result = materialize([
        {
            id: 'no-source',
            text: 'SEM FONTE',
            sourceText: '   ',
            triggerId: 'price',
            selected: true,
        },
        {
            id: 'dup',
            text: 'PRIMEIRO',
            sourceText: 'a partir de R$ 199',
            triggerId: 'price',
            selected: true,
        },
        {
            id: 'dup',
            text: 'SEGUNDO REPETIDO',
            sourceText: 'Piracicaba',
            triggerId: 'region',
            selected: true,
        },
    ]);

    assert.equal(result.requestedCount, 3);
    const codes = result.diagnostics.map((item) => item.code).sort();
    assert.deepEqual(codes, ['title_plan_duplicate_id', 'title_plan_field_invalid']);
    assert.doesNotMatch(result.diagnostics[0].message, /Ã/);
});

test('timeline fisicamente insuficiente derruba o excedente com diagnostico, sem fingir sucesso', () => {
    const overload = Array.from({ length: 5 }, (_, index) => ({
        id: `overload-${index}`,
        text: `TITULO ${index}`,
        sourceText: 'Multifocais',
        triggerId: 'product',
        selected: true,
    }));
    const result = materialize(overload, 2);

    assert.equal(result.requestedCount, 5);
    assert.ok(result.materializedCount < 5);
    assert.ok(result.materializedCount >= 1);
    assert.ok(result.diagnostics.some((item) => item.code === 'title_plan_timeline_unavailable'));
    assert.ok(result.titles.every((title) => title.durationSec >= 0.75));
});

test('endpoint desvia o modo exact-plan antes de qualquer geracao por IA', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/controllers/aiController.ts'), 'utf8');
    const exactBranch = source.indexOf("if (materializationMode === 'exact-plan')");
    const aiGeneration = source.indexOf('const resilientGeneration = await runResilientTitleGeneration', exactBranch);

    assert.ok(exactBranch >= 0);
    assert.ok(aiGeneration > exactBranch);
    const branchSource = source.slice(exactBranch, aiGeneration);
    assert.match(branchSource, /materializeExactTitlePlan\(/);
    assert.match(branchSource, /return res\.json\(/);
    assert.match(branchSource, /source:\s*responseSource/);
    assert.match(branchSource, /diagnostics:\s*materialization\.diagnostics/);
});
