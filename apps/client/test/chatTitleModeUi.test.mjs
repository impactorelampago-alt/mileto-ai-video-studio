import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chatSource = readFileSync(
    new URL('../src/components/chat/ChatMileto.tsx', import.meta.url),
    'utf8',
);
const proposalSource = readFileSync(
    new URL('../src/components/chat/ChatTitleProposal.tsx', import.meta.url),
    'utf8',
);
const apiSource = readFileSync(
    new URL('../src/lib/chatApi.ts', import.meta.url),
    'utf8',
);

test('o campo principal desvia ajustes para títulos antes de iniciar o Narrador', () => {
    const sendSource = chatSource.slice(
        chatSource.indexOf('const handleSendWithFolder ='),
        chatSource.indexOf('// ─── Inline Folder Creation'),
    );

    assert.ok(
        sendSource.indexOf("intent === 'refine_titles'") < sendSource.indexOf('let sessionId = activeSessionId'),
        'o roteamento de títulos deve acontecer antes de criar/iniciar uma resposta do Narrador',
    );
    assert.match(sendSource, /submitTitlePlanRefinement\(\{[\s\S]*messageId: activeTitlePlanMessageId,[\s\S]*displayInstruction: userContent/);
    assert.match(sendSource, /intent === 'narrator'[\s\S]*exitTitleMode\(\)/);
});

test('o modo fica explícito no composer, pode ser encerrado e bloqueia envio duplicado', () => {
    assert.match(chatSource, /> Ajustando títulos\s*</);
    assert.match(chatSource, /Diga como quer ajustar os títulos/);
    assert.match(chatSource, /onClick=\{\(\) => exitTitleMode\(true\)\}/);
    assert.match(chatSource, /Cancelar ajuste/);
    assert.match(chatSource, /activeTitlePlan\?\.busy/);
    assert.match(chatSource, /interactionMode !== 'title_refinement'/);
    assert.match(chatSource, /lastEditableUserMessageId/);
    assert.match(chatSource, /setInputText\(''\);[\s\S]*Ajuste de títulos encerrado/);
});

test('a proposta usa o chat principal e não mantém uma segunda caixa de instrução', () => {
    assert.match(proposalSource, /Continue pelo campo principal do chat/);
    assert.match(proposalSource, /Continuar ajustando no chat/);
    assert.doesNotMatch(proposalSource, /onInstructionChange|placeholder="Ex\.: faltou/);
    assert.match(proposalSource, /Ajuste em andamento no campo principal do chat/);
    assert.doesNotMatch(proposalSource, /<TitlePlanningProgress/);
    assert.match(proposalSource, /disabled=\{busy \|\| readOnly\}/);
});

test('cada revisão de títulos vira uma nova resposta persistida abaixo do pedido', () => {
    const submitSource = chatSource.slice(
        chatSource.indexOf('const submitTitlePlanRefinement ='),
        chatSource.indexOf('const handleRequestTitleChanges ='),
    );
    assert.match(apiSource, /persistTitleProposalMessage/);
    assert.match(apiSource, /title-proposal-message/);
    assert.ok(
        submitSource.indexOf('persistTitleRefinementMessage')
            < submitSource.indexOf('handleRefineTitlePlan'),
        'o pedido editorial deve ser persistido antes de acionar a IA',
    );
    assert.ok(
        submitSource.indexOf('handleRefineTitlePlan')
            < submitSource.indexOf('appendTitleProposalMessage'),
        'a nova proposta deve ser persistida como resposta abaixo do pedido',
    );
    assert.match(submitSource, /return await appendTitleProposalMessage\(\{/);
    assert.match(submitSource, /\[input\.messageId\]: \{ \.\.\.previous, busy: false \}/);
    assert.match(chatSource, /const hasBusyTitlePlan = Object\.values\(titlePlans\)\.some/);
    assert.match(chatSource, /busy=\{hasBusyTitlePlan\}/);
    assert.match(apiSource, /persistTitleProposalMessage[\s\S]*signal\?: AbortSignal/);
    assert.match(apiSource, /persistTitleRefinementMessage[\s\S]*signal\?: AbortSignal/);
    assert.match(submitSource, /persistTitleRefinementMessage\([\s\S]*operationController\.signal/);
    assert.match(chatSource, /interactionMode === 'title_proposal'[\s\S]*<ChatTitleProposal/);
    assert.match(proposalSource, /Versão anterior preservada/);
    assert.doesNotMatch(chatSource, /\[messageId\]: \{[\s\S]{0,160}proposal,[\s\S]{0,80}phase: 'refining'/);
});

test('ações de narração e edição não concorrem com uma resposta ou proposta ativa', () => {
    assert.match(chatSource, /actionsDisabled=\{isLoading\}/);
    assert.match(chatSource, /if \(isLoading\)[\s\S]*Aguarde a resposta atual terminar antes de criar títulos/);
    assert.match(chatSource, /const handleEditLastMessage[\s\S]*exitTitleMode\(\)/);
    assert.match(chatSource, /onActivate=\{\(\) => \{[\s\S]*exitTitleMode\(\);[\s\S]*setActiveTitlePlanMessageId\(msg\.id\)/);
});

test('o cliente persiste o turno editorial na rota dedicada', () => {
    assert.match(apiSource, /persistTitleRefinementMessage/);
    assert.match(apiSource, /title-refinement-message/);
    assert.match(apiSource, /body: JSON\.stringify\(\{ content \}\)/);
});
