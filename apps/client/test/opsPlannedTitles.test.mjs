import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { plannedTitlesFromOpsJob } from '../src/lib/opsPlannedTitles.ts';

const validItem = (overrides = {}) => ({
    text: 'R$ 199',
    sourceText: 'óculos completos, armação mais lente, a partir de R$199',
    triggerId: 'price',
    triggerName: 'Preço',
    ...overrides,
});

test('converte titulos confirmados do Ops para o plano interno com id e selecao', () => {
    const result = plannedTitlesFromOpsJob({ plannedTitles: [validItem()] });
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
        id: 'ops-planned-title-1',
        text: 'R$ 199',
        sourceText: 'óculos completos, armação mais lente, a partir de R$199',
        triggerId: 'price',
        triggerName: 'Preço',
        selected: true,
    });
});

test('descarta itens malformados individualmente sem derrubar os validos', () => {
    const result = plannedTitlesFromOpsJob({
        plannedTitles: [
            null,
            'texto solto',
            validItem({ text: '' }),
            validItem({ sourceText: 'x'.repeat(241) }),
            validItem({ triggerId: undefined }),
            validItem({ text: 'Só até sábado', triggerId: 'scarcity', triggerName: undefined }),
        ],
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'Só até sábado');
    // triggerName ausente cai no triggerId.
    assert.equal(result[0].triggerName, 'scarcity');
});

test('aplica os limites do contrato: 8 itens no total e 3 por gatilho', () => {
    const overloaded = Array.from({ length: 12 }, (_, index) => validItem({
        text: `Título ${index + 1}`,
        triggerId: index < 6 ? 'price' : `trigger-${index}`,
    }));
    const result = plannedTitlesFromOpsJob({ plannedTitles: overloaded });
    assert.equal(result.length, 8);
    assert.equal(result.filter((item) => item.triggerId === 'price').length, 3);
});

test('entrada ausente, nao-objeto ou sem array retorna plano vazio', () => {
    assert.deepEqual(plannedTitlesFromOpsJob(undefined), []);
    assert.deepEqual(plannedTitlesFromOpsJob(null), []);
    assert.deepEqual(plannedTitlesFromOpsJob([]), []);
    assert.deepEqual(plannedTitlesFromOpsJob({}), []);
    assert.deepEqual(plannedTitlesFromOpsJob({ plannedTitles: 'nao-e-array' }), []);
});

test('normaliza espacos e quebras de linha nos campos aceitos', () => {
    const result = plannedTitlesFromOpsJob({
        plannedTitles: [validItem({ text: '  R$\n199  ', triggerName: ' Preço \t especial ' })],
    });
    assert.equal(result[0].text, 'R$ 199');
    assert.equal(result[0].triggerName, 'Preço especial');
});

test('coordenador liga o plano do job ao fluxo exact-plan existente', () => {
    const coordinator = readFileSync(
        new URL('../src/components/OpsVideoJobCoordinator.tsx', import.meta.url),
        'utf8',
    ).replace(/\r\n/g, '\n');
    // Ingestão: plano + chave calculada localmente sobre o texto limpo.
    assert.match(coordinator, /plannedTitlesFromOpsJob\(job\.settings\)/);
    assert.match(coordinator, /plannedTitlesNarrationKey:\s*titlePlanningNarrationKey\(narrationPlainText\)/);
    // Job com plano confirmado é AUTORIDADE (vínculo por construção): materializa
    // com force, sem depender da chave de narração; a automática só existe no
    // ramo sem plano.
    assert.match(coordinator, /const planDriven = selectedPlannedTitles\.length > 0/);
    assert.match(coordinator, /materializeCurrentTitlePlan\(\s*adData,\s*titleGenerationOptions,\s*\{ force: true \}/);
    assert.match(coordinator, /generateAutomaticTitlesResilient\(adData,\s*titleGenerationOptions\)/);
});
