import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const coordinator = read('../../client/src/components/OpsVideoJobCoordinator.tsx');
const workflow = read('../../client/src/lib/videoAgentWorkflow.ts');
const controller = read('../../server/src/controllers/aiController.ts');
const resilience = read('../../server/src/services/titleGenerationResilience.ts');

test('endpoint registra diagnóstico seguro, repete transitórios e usa fallback determinístico', () => {
    assert.match(controller, /runResilientTitleGeneration/);
    assert.match(controller, /maxAttempts:\s*1/);
    assert.doesNotMatch(controller, /maxProviderAttempts/);
    assert.match(controller, /deterministicCaptionTitleCandidates/);
    assert.match(controller, /deterministicTitleCandidates/);
    assert.match(controller, /logTitleGenerationDiagnostic\('request_failed'/);
    assert.doesNotMatch(controller, /error\.response\?\.data/);
    assert.match(resilience, /Nunca serializamos[\s\S]*token[\s\S]*resposta upstream/);
});

test('cliente faz uma requisicao de IA e solicita explicitamente o modo local como fallback', () => {
    assert.doesNotMatch(workflow, /CLIENT_TITLE_GENERATION_ATTEMPTS/);
    assert.match(workflow, /primaryData\s*=\s*await request\('ai'\)/);
    assert.match(workflow, /fallbackData\s*=\s*await request\('local'\)/);
    assert.match(workflow, /dynamicTitles:\s*\[\]/);
});

test('falha de títulos gera advertência e não entra no bloco fatal do job', () => {
    const titleAt = coordinator.indexOf("await patch('titles'");
    const exportAt = coordinator.indexOf("await patch('export'", titleAt);
    const titleStage = coordinator.slice(titleAt, exportAt);
    assert.ok(titleAt >= 0 && exportAt > titleAt);
    assert.match(titleStage, /generateAutomaticTitlesResilient/);
    assert.match(titleStage, /AUTOMATIC_TITLES_UNAVAILABLE_WARNING/);
    assert.match(titleStage, /dynamicTitles:\s*\[\]/);
    assert.doesNotMatch(titleStage, /status:\s*'failed'/);
});

test('renderização e upload continuam sem títulos e preservam o destino original do job', () => {
    const exportAt = coordinator.indexOf("await patch('export'");
    const completeAt = coordinator.indexOf("await patch('completed'", exportAt);
    const exportStage = coordinator.slice(exportAt, completeAt + 500);
    assert.ok(exportAt >= 0 && completeAt > exportAt);
    assert.match(exportStage, /companyId:\s*job\.companyId/);
    assert.match(exportStage, /opsFolderId:\s*job\.destinationFolderId \|\| null/);
    assert.match(exportStage, /outputAssetId:\s*assetId/);
    assert.match(exportStage, /vídeo criado e entregue/);
});

test('conclusão degradada libera o executor para o próximo job sequencial', () => {
    assert.match(coordinator, /clearPersistedOpsVideoJob\(\);[\s\S]*currentJobRef\.current = null/);
    assert.match(coordinator, /finally\s*\{[\s\S]*runningRef\.current = false/);
    assert.match(coordinator, /if \(runningRef\.current \|\| exportingRef\.current\) return/);
    assert.match(coordinator, /await execute\(queued\)/);
});
