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
const planningClientSource = readFileSync(
    new URL('../src/lib/titlePlanning.ts', import.meta.url),
    'utf8',
);
const step4Source = readFileSync(
    new URL('../src/pages/Step4.tsx', import.meta.url),
    'utf8',
);
const titleDialogSource = readFileSync(
    new URL('../src/components/TitleAssistantDialog.tsx', import.meta.url),
    'utf8',
);

test('os novos textos visíveis permanecem em UTF-8 sem mojibake', () => {
    const visibleSources = `${proposalSource}\n${planningClientSource}`;
    assert.doesNotMatch(
        visibleSources,
        /narraÃ|tÃ­t|evidÃ|sugestÃ|preÃ|informaÃ|NÃ£o|Â·|â€œ|â€|â€¦/,
    );
});

test('o cliente usa a rota dedicada e limita o contexto reenviado na revisão', () => {
    assert.match(planningClientSource, /\/api\/video\/plan-titles/);
    assert.match(planningClientSource, /titles\.slice\(0, 40\)/);
    assert.match(planningClientSource, /id:[\s\S]*slice\(0, 120\)/);
    assert.match(planningClientSource, /text:[\s\S]*slice\(0, 90\)/);
    assert.match(planningClientSource, /sourceText:[\s\S]*slice\(0, 240\)/);
    assert.match(planningClientSource, /triggerId:[\s\S]*slice\(0, 80\)/);
    assert.match(planningClientSource, /triggerName:[\s\S]*slice\(0, 80\)/);
    assert.match(planningClientSource, /selected:\s*title\.selected === true/);
});

test('a narração é aplicada antes de solicitar títulos e a ação simples não os cria', () => {
    const applyOnly = chatSource.slice(
        chatSource.indexOf('const handleUseAsScript ='),
        chatSource.indexOf('const handleApplyAndCreateTitles ='),
    );
    const applyAndPlan = chatSource.slice(
        chatSource.indexOf('const handleApplyAndCreateTitles ='),
        chatSource.indexOf('const updateTitlePlan ='),
    );

    assert.doesNotMatch(applyOnly, /planNarrationTitles/);
    assert.ok(
        applyAndPlan.indexOf('updateAdData(patch)') < applyAndPlan.indexOf('await planNarrationTitles'),
        'a narração deve ser aplicada antes de iniciar o planejamento',
    );
    assert.match(applyAndPlan, /const script = nextAdData\.narrationPlainText/);
    assert.match(applyAndPlan, /planNarrationTitles\(\{ script, signal:/);
});

test('a proposta mostra todos os gatilhos inclusive os não encontrados', () => {
    assert.match(proposalSource, /proposal\.triggers\.map\(\(trigger\)\s*=>/);
    assert.match(proposalSource, /trigger\.status === 'found'/);
    assert.match(proposalSource, /Nenhuma evidência encontrada nesta narração/);
    assert.match(proposalSource, /trigger\.name/);
});

test('cada sugestão aceita uma mudança dedicada e envia somente o conjunto preenchido', () => {
    assert.match(proposalSource, /placeholder="Como você quer que fique\?"/);
    assert.match(proposalSource, /maxLength=\{90\}/);
    assert.match(proposalSource, /collectTitleProposalRevisionEdits/);
    assert.match(proposalSource, /onRequestChanges\(requestedChanges\)/);
    assert.match(proposalSource, /Fazer essas mudanças/);
    assert.match(proposalSource, /disabled=\{!requestedChanges\.length \|\| busy\}/);
    assert.doesNotMatch(proposalSource, /\bonEdit\b/);
});

test('o cartão de narração expõe exatamente as duas ações aprovadas e nenhuma cópia', () => {
    const cardSource = chatSource.slice(
        chatSource.indexOf('const NarrationCard ='),
        chatSource.indexOf('interface StructuredAgentResponseProps'),
    );
    const actions = [...cardSource.matchAll(/data-narration-action="([^"]+)"/g)]
        .map((match) => match[1]);

    assert.deepEqual(actions, ['apply', 'apply-and-create-titles']);
    assert.match(cardSource, /Aplicar narração/);
    assert.match(cardSource, /Aplicar e criar títulos/);
    assert.doesNotMatch(cardSource, /Copiar|copy/i);
});

test('títulos só entram no projeto após seleção explícita e ficam ligados à narração', () => {
    const applyPlan = chatSource.slice(
        chatSource.indexOf('const handleApplyTitlePlan ='),
        chatSource.indexOf('const [expandedFolders'),
    );

    assert.match(applyPlan, /filter\(\(suggestion\) => suggestion\.selected/);
    assert.match(applyPlan, /plannedTitles:\s*selected/);
    assert.match(applyPlan, /titlePlanningNarrationKey\(adData\.narrationPlainText\) !== state\.narrationKey/);
    assert.match(applyPlan, /plannedTitlesNarrationKey:\s*state\.narrationKey/);
});

test('Step 4 mantém a proposta fora do projeto e só confirma em uma atualização atômica', () => {
    const generation = step4Source.slice(
        step4Source.indexOf('const runTitleAssistantGeneration ='),
        step4Source.indexOf('const handleApplyTitleAssistant ='),
    );
    const apply = step4Source.slice(
        step4Source.indexOf('const handleApplyTitleAssistant ='),
        step4Source.indexOf('const handleUndoLastTitleApplication ='),
    );

    assert.doesNotMatch(generation, /updateAdData\(/);
    assert.match(generation, /setTitleAssistantProposal\(proposal\)/);
    assert.match(generation, /setTitleAssistantDraft\(/);
    assert.match(step4Source, /isTitleAssistantOpen && titleAssistantProposal[\s\S]*\? titleAssistantDraft/);
    assert.match(apply, /captureTitleAssistantSnapshot\(adData\)/);
    assert.match(apply, /updateAdData\(titleAssistantCommitPatch\(titleAssistantProposal, titleAssistantDraft\)\)/);
});

test('diálogo do Step 4 deixa cancelar, refinar e aplicar sem salvar automaticamente', () => {
    assert.match(titleDialogSource, /role="dialog"/);
    assert.match(titleDialogSource, /Nada entra no projeto até sua confirmação/);
    assert.match(titleDialogSource, /Ajustar com IA/);
    assert.match(titleDialogSource, /Aplicar títulos/);
    assert.match(titleDialogSource, />\s*Cancelar\s*</);
});
