import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyTitlePlanningOperations,
    constrainTitlePlanningOperationsToRequestedEdits,
    type TitlePlanningSuggestionState,
    type TitlePlanningTriggerState,
} from '../src/services/titlePlanningSafety';

const script = [
    'Na Ótica Reis, em Piracicaba, você encontra multifocais a partir de 199 reais.',
    'Óculos completo, com armação e lente, e o exame é por nossa conta na compra dos óculos.',
    'A promoção é válida somente até sábado.',
    'Clique no botão e chame no WhatsApp agora mesmo.',
].join(' ');

const triggers: TitlePlanningTriggerState[] = [
    { id: 'price', name: 'Preço', maxOccurrences: 3 },
    { id: 'product', name: 'Produto / oferta central', maxOccurrences: 3 },
    { id: 'benefit', name: 'Benefício / bônus', maxOccurrences: 3 },
    { id: 'scarcity', name: 'Escassez e urgência', maxOccurrences: 3 },
    { id: 'cta', name: 'CTA', maxOccurrences: 3 },
];

const resolveTrigger = (triggerId: string) => triggers.find((trigger) => trigger.id === triggerId) || null;

const baseTitles = (): TitlePlanningSuggestionState[] => [
    {
        id: 'price-1',
        text: '199 reais',
        sourceText: 'a partir de 199 reais',
        triggerId: 'price',
        triggerName: 'Preço',
        selected: true,
    },
    {
        id: 'benefit-1',
        text: 'Óculos completo, com armação',
        sourceText: 'Óculos completo, com armação e lente',
        triggerId: 'benefit',
        triggerName: 'Benefício / bônus',
        selected: true,
    },
    {
        id: 'cta-1',
        text: 'Clique no botão',
        sourceText: 'Clique no botão e chame no WhatsApp agora mesmo',
        triggerId: 'cta',
        triggerName: 'CTA',
        selected: true,
    },
];

test('aplica o caso real como edit_text e preserva profundamente todos os itens omitidos', () => {
    const previousTitles = baseTitles();
    const untouchedPrice = structuredClone(previousTitles[0]);
    const untouchedCta = structuredClone(previousTitles[2]);
    const result = applyTitlePlanningOperations({
        script,
        previousTitles,
        operations: [{
            op: 'edit_text',
            id: 'benefit-1',
            text: 'Óculos completo',
        }],
        resolveTrigger,
        createId: () => 'new-id',
    });

    assert.equal(result.appliedOperationCount, 1);
    assert.equal(result.rejectedOperationCount, 0);
    assert.deepEqual(result.suggestions.find((item) => item.id === 'price-1'), untouchedPrice);
    assert.deepEqual(result.suggestions.find((item) => item.id === 'cta-1'), untouchedCta);
    assert.deepEqual(result.suggestions.find((item) => item.id === 'benefit-1'), {
        ...previousTitles[1],
        text: 'Óculos completo',
    });
});

test('edit_text que cria título igual funde a seleção e não deixa duplicata', () => {
    const unrelated = baseTitles()[0];
    const previousTitles: TitlePlanningSuggestionState[] = [
        unrelated,
        {
            id: 'product-short',
            text: 'Óculos completo',
            sourceText: 'Óculos completo, com armação e lente',
            triggerId: 'product',
            triggerName: 'Produto / oferta central',
            selected: false,
        },
        baseTitles()[1],
    ];
    const result = applyTitlePlanningOperations({
        script,
        previousTitles,
        operations: [{ op: 'edit_text', id: 'benefit-1', text: 'Óculos completo' }],
        resolveTrigger,
        createId: () => 'new-id',
    });

    assert.deepEqual(result.suggestions.find((item) => item.id === 'price-1'), unrelated);
    assert.equal(result.suggestions.filter((item) => item.text === 'Óculos completo').length, 1);
    assert.equal(result.suggestions.some((item) => item.id === 'benefit-1'), false);
    assert.equal(result.suggestions.find((item) => item.id === 'product-short')?.selected, true);
});

test('id desconhecido não altera nenhum item', () => {
    const previousTitles = baseTitles();
    const result = applyTitlePlanningOperations({
        script,
        previousTitles,
        operations: [{ op: 'edit_text', id: 'nao-existe', text: 'Óculos completo' }],
        resolveTrigger,
        createId: () => 'new-id',
    });

    assert.deepEqual(result.suggestions, previousTitles);
    assert.deepEqual(result.rejections, [{ index: 0, code: 'unknown_id', id: 'nao-existe' }]);
});

test('texto inseguro é rejeitado e preserva integralmente a proposta', () => {
    const previousTitles = baseTitles();
    const result = applyTitlePlanningOperations({
        script,
        previousTitles,
        operations: [{ op: 'edit_text', id: 'benefit-1', text: 'Exame por 199 reais' }],
        resolveTrigger,
        createId: () => 'new-id',
    });

    assert.deepEqual(result.suggestions, previousTitles);
    assert.deepEqual(result.rejections, [{ index: 0, code: 'unsafe_text', id: 'benefit-1' }]);
});

test('set_selected, remove e add alteram somente os campos declarados', () => {
    const previousTitles = baseTitles();
    const result = applyTitlePlanningOperations({
        script,
        previousTitles,
        operations: [
            { op: 'set_selected', id: 'price-1', selected: false },
            { op: 'remove', id: 'cta-1' },
            {
                op: 'add',
                sourceText: 'somente até sábado',
                text: 'até sábado',
                triggerId: 'scarcity',
                selected: true,
            },
        ],
        resolveTrigger,
        createId: () => 'scarcity-new',
    });

    assert.equal(result.appliedOperationCount, 3);
    assert.equal(result.suggestions.find((item) => item.id === 'price-1')?.selected, false);
    assert.deepEqual(result.suggestions.find((item) => item.id === 'benefit-1'), previousTitles[1]);
    assert.equal(result.suggestions.some((item) => item.id === 'cta-1'), false);
    assert.deepEqual(result.suggestions.find((item) => item.id === 'scarcity-new'), {
        id: 'scarcity-new',
        text: 'até sábado',
        sourceText: 'somente até sábado',
        triggerId: 'scarcity',
        triggerName: 'Escassez e urgência',
        selected: true,
    });
});

test('revisao estruturada bloqueia operacoes e IDs que nao foram pedidos', () => {
    const previousTitles = baseTitles();
    const constrained = constrainTitlePlanningOperationsToRequestedEdits({
        requestedEdits: [{ id: 'benefit-1', desiredText: 'Óculos completo' }],
        operations: [
            { op: 'edit_text', id: 'benefit-1', text: 'Óculos completo' },
            { op: 'edit_text', id: 'price-1', text: 'a partir de 199 reais' },
            { op: 'set_selected', id: 'benefit-1', selected: false },
            { op: 'remove', id: 'cta-1' },
            {
                op: 'add',
                sourceText: 'somente até sábado',
                text: 'até sábado',
                triggerId: 'scarcity',
            },
        ],
    });
    const result = applyTitlePlanningOperations({
        script,
        previousTitles,
        operations: constrained.operations,
        authorialRequestedEdits: [{ id: 'benefit-1', desiredText: 'Óculos completo' }],
        resolveTrigger,
        createId: () => 'malicious-new-id',
    });

    assert.equal(constrained.rejectedOperationCount, 4);
    assert.equal(result.appliedOperationCount, 1);
    assert.deepEqual(result.suggestions.find((item) => item.id === 'benefit-1'), {
        ...previousTitles[1],
        text: 'Óculos completo',
    });
    assert.deepEqual(result.suggestions.find((item) => item.id === 'price-1'), previousTitles[0]);
    assert.deepEqual(result.suggestions.find((item) => item.id === 'cta-1'), previousTitles[2]);
    assert.equal(result.suggestions.some((item) => item.id === 'malicious-new-id'), false);
});

test('texto autoral explícito é aplicado exatamente e texto diferente devolvido pela IA é rejeitado', () => {
    const previousTitles: TitlePlanningSuggestionState[] = [{
        id: 'region-1',
        text: 'Piracicaba',
        sourceText: 'Piracicaba',
        triggerId: 'region',
        triggerName: 'Região',
        selected: true,
    }];
    const requestedEdits = [{ id: 'region-1', desiredText: 'Óculos em Piracicaba' }];
    const refused = constrainTitlePlanningOperationsToRequestedEdits({
        requestedEdits,
        operations: [{ op: 'edit_text', id: 'region-1', text: 'Oferta em Piracicaba' }],
    });
    assert.deepEqual(refused.operations, []);
    assert.equal(refused.rejectedOperationCount, 1);

    const constrained = constrainTitlePlanningOperationsToRequestedEdits({
        requestedEdits,
        operations: [{ op: 'edit_text', id: 'region-1', text: 'Óculos em Piracicaba' }],
    });
    const result = applyTitlePlanningOperations({
        script,
        previousTitles,
        operations: constrained.operations,
        authorialRequestedEdits: requestedEdits,
        strictTargetIsolation: true,
        resolveTrigger,
        createId: () => 'unused',
    });

    assert.equal(result.appliedOperationCount, 1);
    assert.deepEqual(result.suggestions, [{
        ...previousTitles[0],
        text: 'Óculos em Piracicaba',
    }]);
});
