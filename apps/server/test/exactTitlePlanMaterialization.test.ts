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

const materialize = (baseTitles: unknown, timelineDurationSec = 8) => materializeExactTitlePlan({
    baseTitles,
    spokenWords,
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

test('item impossivel retorna diagnostico proprio e nunca finge que foi materializado', () => {
    const result = materialize([{
        id: 'missing-source',
        text: 'OFERTA QUE NAO FOI FALADA',
        sourceText: 'trecho inexistente nas legendas',
        triggerId: 'benefit',
        selected: true,
    }]);

    assert.equal(result.requestedCount, 1);
    assert.equal(result.materializedCount, 0);
    assert.deepEqual(result.titles, []);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].itemId, 'missing-source');
    assert.equal(result.diagnostics[0].code, 'title_plan_source_not_in_captions');
    assert.equal(result.diagnostics[0].retryable, false);
    assert.equal(
        result.diagnostics[0].message,
        'A fala de origem do título "OFERTA QUE NAO FOI FALADA" não foi encontrada nas legendas sincronizadas.',
    );
    assert.doesNotMatch(result.diagnostics[0].message, /Ã/);
});

test('fala sem tempo visual suficiente recebe diagnostico de timeline', () => {
    const result = materialize([{
        id: 'late-cta',
        text: 'CLIQUE AQUI',
        sourceText: 'clique aqui',
        triggerId: 'cta',
        selected: true,
    }], 5.6);

    assert.equal(result.materializedCount, 0);
    assert.equal(result.diagnostics[0].code, 'title_plan_timeline_unavailable');
});

test('titulos proximos sao recortados ou diagnosticados sem sobreposicao silenciosa', () => {
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
    assert.equal(result.materializedCount, 1);
    assert.deepEqual(result.titles.map((title) => title.id), ['second-price']);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].itemId, 'first-price');
    assert.equal(result.diagnostics[0].code, 'title_plan_timeline_overlap');
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
