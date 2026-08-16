import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { titlePlanningNarrationKey } from '../src/lib/titlePlanningKey.ts';
import {
    assertExactTitlePlanMaterialization,
    materializeCurrentTitlePlan,
    titlePlanMaterializationDecision,
} from '../src/lib/titlePlanMaterialization.ts';

const suggestion = (overrides = {}) => ({
    id: 'price',
    text: 'A partir de R$ 199',
    sourceText: 'Multifocais a partir de R$ 199.',
    triggerId: 'price',
    triggerName: 'Preço',
    selected: true,
    ...overrides,
});

test('materializa somente sugestões selecionadas do plano ligado à narração atual', () => {
    const narrationPlainText = 'Multifocais a partir de R$ 199.';
    const decision = titlePlanMaterializationDecision({
        narrationPlainText,
        plannedTitlesNarrationKey: titlePlanningNarrationKey(narrationPlainText),
        plannedTitles: [suggestion(), suggestion({ id: 'cta', text: 'Clique aqui', selected: false })],
    });

    assert.equal(decision.shouldMaterialize, true);
    assert.deepEqual(decision.plannedTitles.map((title) => title.id), ['price']);
});

test('nunca materializa plano antigo ou vazio em uma narração diferente', () => {
    const narrationPlainText = 'Nova narração.';
    assert.deepEqual(titlePlanMaterializationDecision({
        narrationPlainText,
        plannedTitlesNarrationKey: titlePlanningNarrationKey('Narração anterior.'),
        plannedTitles: [suggestion()],
    }), { shouldMaterialize: false, plannedTitles: [] });

    assert.deepEqual(titlePlanMaterializationDecision({
        narrationPlainText,
        plannedTitlesNarrationKey: titlePlanningNarrationKey(narrationPlainText),
        plannedTitles: [],
    }), { shouldMaterialize: false, plannedTitles: [] });
});

test('helper reutilizável não chama a geração nem altera o projeto sem plano atual', async () => {
    const input = {
        narrationPlainText: 'Nova narração.',
        plannedTitlesNarrationKey: titlePlanningNarrationKey('Narração anterior.'),
        plannedTitles: [suggestion()],
    };
    const result = await materializeCurrentTitlePlan(input);

    assert.equal(result.attempted, false);
    assert.equal(result.plannedTitleCount, 0);
    assert.strictEqual(result.adData, input);
});

test('force materializa o plano do executor mesmo com a chave de narração divergente', async () => {
    // No executor, plano e narração chegam juntos no mesmo job (vínculo por
    // construção): a chave nunca deve bloquear a materialização.
    const input = {
        narrationText: 'Nova narração.',
        narrationPlainText: 'Nova narração.',
        plannedTitlesNarrationKey: titlePlanningNarrationKey('Narração anterior.'),
        plannedTitles: [suggestion()],
    };

    // Sem force: a chave diverge → não tenta (atalho seguro do editor).
    const skipped = await materializeCurrentTitlePlan(input);
    assert.equal(skipped.attempted, false);

    // Com force: tenta de fato (chega a exigir materialização exata e falha por
    // não haver legendas/servidor) — o essencial é que NÃO tomou o atalho.
    await assert.rejects(() => materializeCurrentTitlePlan(input, {}, { force: true }));
});

test('executor materializa o plano confirmado e nunca cai em títulos automáticos', () => {
    const coord = readFileSync(new URL('../src/components/OpsVideoJobCoordinator.tsx', import.meta.url), 'utf8');
    assert.match(coord, /const planDriven = selectedPlannedTitles\.length > 0/);
    assert.match(coord, /materializeCurrentTitlePlan\(\s*adData,\s*titleGenerationOptions,\s*\{ force: true \}/);
    // O caminho com plano confirmado retenta e sai SEM títulos na falha —
    // jamais gera automáticos (que só existem no ramo "sem plano").
    assert.match(coord, /Sem plano confirmado: geração automática normal\.\s*\n\s*titleResult = await generateAutomaticTitlesResilient/);
    assert.match(coord, /PLANNED_TITLES_UNAVAILABLE_WARNING/);

    // A materialização exata usa o prazo amplo (não o curto do fallback local).
    const workflow = readFileSync(new URL('../src/lib/videoAgentWorkflow.ts', import.meta.url), 'utf8');
    assert.match(workflow, /\(isAi \|\| isExactPlan\)\s*\?\s*TITLE_AI_REQUEST_DEADLINE_MS/);
});

test('helper exige materialização exata e envia somente o plano selecionado', () => {
    const source = readFileSync(new URL('../src/lib/titlePlanMaterialization.ts', import.meta.url), 'utf8');
    assert.match(source, /baseTitles:\s*decision\.plannedTitles/);
    assert.match(source, /materializationMode:\s*'exact-plan'/);

    const workflow = readFileSync(new URL('../src/lib/videoAgentWorkflow.ts', import.meta.url), 'utf8');
    assert.match(workflow, /exactPlanMaterialization\s*=\s*options\.materializationMode\s*===\s*'exact-plan'/);
    assert.match(workflow, /materializationMode:\s*'exact-plan'/);
    assert.match(workflow, /primaryData\s*=\s*await request\(exactPlanMaterialization\s*\?\s*'exact-plan'\s*:\s*'ai'\)/);
    assert.match(workflow, /primaryData\s*===\s*null\s*&&\s*!exactPlanMaterialization/);
});

const exactOutcome = ({ expected, titles, diagnostics = [] }) => ({
    adData: {
        dynamicTitles: titles,
        titleGenerationSummary: {
            materialization: {
                mode: 'exact-plan',
                requestedCount: expected.length,
                materializedCount: titles.length,
                diagnostics,
            },
        },
    },
    source: 'ai',
});

test('atestado exato aceita somente subconjunto ordenado e idêntico com diagnóstico por omissão', () => {
    const expected = [
        suggestion(),
        suggestion({ id: 'cta', text: 'Clique aqui', sourceText: 'Clique aqui.', triggerId: 'cta' }),
    ];
    assert.doesNotThrow(() => assertExactTitlePlanMaterialization(expected, exactOutcome({
        expected,
        titles: [{
            id: 'price',
            text: expected[0].text,
            sourceText: expected[0].sourceText,
            triggerId: expected[0].triggerId,
        }],
        diagnostics: [{ itemId: 'cta', code: 'title_plan_timeline_overlap', message: 'Sem tempo.', retryable: false }],
    })));
});

test('servidor antigo, título reescrito, título extra ou omissão silenciosa falham fechado', () => {
    const expected = [suggestion()];
    assert.throws(() => assertExactTitlePlanMaterialization(expected, {
        adData: { dynamicTitles: [] },
        source: 'local',
    }), /não confirmou a materialização exata/);

    assert.throws(() => assertExactTitlePlanMaterialization(expected, exactOutcome({
        expected,
        titles: [{
            id: 'price',
            text: 'Texto reescrito',
            sourceText: expected[0].sourceText,
            triggerId: expected[0].triggerId,
        }],
    })), /título diferente/);

    assert.throws(() => assertExactTitlePlanMaterialization(expected, exactOutcome({
        expected,
        titles: [{
            id: 'extra',
            text: 'Título extra',
            sourceText: expected[0].sourceText,
            triggerId: expected[0].triggerId,
        }],
    })), /título diferente/);

    assert.throws(() => assertExactTitlePlanMaterialization(expected, exactOutcome({
        expected,
        titles: [],
    })), /omitido sem diagnóstico/);
});

test('Step 3 materializa o plano no fluxo das legendas e preserva o plano na falha', () => {
    const source = readFileSync(new URL('../src/pages/Step3.tsx', import.meta.url), 'utf8');
    assert.match(source, /titlePlanMaterializationDecision\(operationAdData\)/);
    assert.match(source, /materializeCurrentTitlePlan\(\{/);
    assert.match(source, /captions:\s*result\.adData\.captions/);
    assert.match(source, /dynamicTitles:\s*result\.adData\.dynamicTitles/);

    const failureBranch = source.slice(source.indexOf('catch (titleError: unknown)'), source.indexOf("console.error('STT Error:'"));
    assert.match(failureBranch, /updateAdData\(captionsOnlyPatch\)/);
    assert.doesNotMatch(failureBranch, /plannedTitles\s*:/);
    assert.match(failureBranch, /plano continua salvo/);
});

test('materialização parcial ou impossível informa a contagem e preserva o diagnóstico', () => {
    const step3 = readFileSync(new URL('../src/pages/Step3.tsx', import.meta.url), 'utf8');
    assert.match(step3, /titleCount < requestedTitleCount/);
    assert.match(step3, /de \$\{requestedTitleCount\} títulos confirmados foram posicionados/);
    assert.match(step3, /Motivo do primeiro pendente/);

    const step4 = readFileSync(new URL('../src/pages/Step4.tsx', import.meta.url), 'utf8');
    const recovery = step4.slice(
        step4.indexOf('// A confirmação feita no Chat'),
        step4.indexOf('const handleRefineTitleAssistant ='),
    );
    assert.match(recovery, /titleGenerationSummary:\s*result\.adData\.titleGenerationSummary/);
    assert.match(recovery, /if \(!titleCount\)/);
    assert.match(recovery, /titleCount < requestedTitleCount/);
    assert.match(recovery, /O diagnóstico e o plano completo continuam salvos/);
});
