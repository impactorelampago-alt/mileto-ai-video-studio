import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const integration = read('../src/opsIntegration.js');
const server = read('../src/server.js');
const coordinator = read('../../client/src/components/OpsVideoJobCoordinator.tsx');
const executorActivity = read('../../client/src/lib/opsExecutorActivity.ts');
const mainLayout = read('../../client/src/layouts/MainLayout.tsx');
const workerState = read('../../client/src/lib/opsVideoWorkerState.ts');
const gatewayClient = read('../../client/src/lib/gateway.ts');
const retryClient = read('../../client/src/lib/opsVideoJobRetry.ts');
const exportJobs = read('../../client/src/context/ExportJobsContext.tsx');
const opsController = read('../../server/src/controllers/opsController.ts');
const takeSelection = read('../../client/src/lib/opsTakeSelection.ts');
const projectController = read('../../server/src/controllers/projectController.ts');
const electron = read('../../client/electron-main/main.cjs');

test('CORS permite o token efemero usado nas atualizacoes de progresso do job', () => {
    assert.match(server, /Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Ops-View-Context, X-Mileto-Job-Token, Idempotency-Key'/);
});

const handler = (start, end) => {
    const from = integration.indexOf(start);
    const to = integration.indexOf(end, from + start.length);
    assert.notEqual(from, -1, `handler ausente: ${start}`);
    return integration.slice(from, to === -1 ? integration.length : to);
};

test('expõe polling, leitura, heartbeat, claim, revisão e atualização somente pelo gateway autenticado', () => {
    assert.match(server, /app\.get\('\/v1\/integrations\/mileto-ops\/video-jobs\/next', authed/);
    assert.match(server, /app\.get\('\/v1\/integrations\/mileto-ops\/video-jobs\/:jobId', authed/);
    assert.match(server, /app\.post\('\/v1\/integrations\/mileto-ops\/video-workers\/heartbeat', authed/);
    assert.match(server, /app\.post\('\/v1\/integrations\/mileto-ops\/video-jobs\/:jobId\/claim', authed/);
    assert.match(server, /app\.post\('\/v1\/integrations\/mileto-ops\/video-jobs\/:jobId\/retry', authed/);
    assert.match(server, /app\.patch\('\/v1\/integrations\/mileto-ops\/video-jobs\/:jobId', authed/);
});

test('fila, leitura, presença, claim, revisão e PATCH preservam delegação, assets.write e X-Ops-View-Context', () => {
    const handlers = [
        handler('export const nextVideoJob', 'export const getVideoJob'),
        handler('export const getVideoJob', 'export const heartbeatVideoWorker'),
        handler('export const heartbeatVideoWorker', 'export const claimVideoJob'),
        handler('export const claimVideoJob', 'export const retryVideoJob'),
        handler('export const retryVideoJob', 'export const updateVideoJob'),
        handler('export const updateVideoJob', 'export const uploadExport'),
    ];
    for (const source of handlers) {
        assert.match(source, /withDelegatedAccess\(req/);
        assert.match(source, /assertAssetsWriteScope\(connection\)/);
        assert.match(source, /OPS_VIEW_CONTEXT_HEADER/);
    }
});

test('heartbeat usa versão 1.4.36, campo oficial mode e job atual', () => {
    const heartbeat = handler('export const heartbeatVideoWorker', 'export const claimVideoJob');
    assert.match(workerState, /OPS_VIDEO_WORKER_APP_VERSION = '1\.4\.36'/);
    assert.match(coordinator, /mode: modeRef\.current/);
    assert.match(coordinator, /activeJobId && persisted\?\.jobId === activeJobId/);
    assert.match(coordinator, /resolvePersistedJob\(persisted\)/);
    assert.match(coordinator, /else if \(!activeJobId\)/);
    assert.match(heartbeat, /mode: body\.mode === 'background'/);
    assert.doesNotMatch(heartbeat, /executionMode/);
    assert.match(coordinator, /currentJobId: currentJobRef\.current/);
    assert.match(coordinator, /HEARTBEAT_INTERVAL_MS\s*=\s*20_000/);
});

test('executor continua em background, minimizado ou escondido na bandeja', () => {
    assert.match(electron, /backgroundThrottling:\s*false/);
    assert.match(electron, /mainWindow\.on\('minimize', publishExecutorMode\)/);
    assert.match(electron, /mainWindow\.on\('hide', publishExecutorMode\)/);
    assert.match(electron, /mainWindow\.hide\(\)/);
    assert.match(electron, /new Tray\(iconPath\)/);
});

test('fechamento completo pausa localmente, tenta offline e não marca o job como failed', () => {
    const shutdown = coordinator.slice(coordinator.indexOf("const shutdown = () =>"), coordinator.indexOf("ipc?.on('executor:shutdown'"));
    assert.match(shutdown, /status: 'paused'/);
    assert.match(shutdown, /heartbeat\('offline'\)/);
    assert.doesNotMatch(shutdown, /status: 'failed'/);
    assert.match(electron, /requestGracefulQuit/);
});

test('Electron garante instância única e reabre a janela existente', () => {
    assert.match(electron, /app\.requestSingleInstanceLock\(\)/);
    assert.match(electron, /app\.on\('second-instance', showMainWindow\)/);
    assert.match(electron, /mainWindowRef\.show\(\)/);
    assert.match(electron, /mainWindowRef\.focus\(\)/);
});

test('404 do heartbeat é tratado como presença não suportada sem interromper o worker', () => {
    const heartbeat = handler('export const heartbeatVideoWorker', 'export const claimVideoJob');
    assert.match(heartbeat, /error instanceof OpsHttpError && error\.status === 404/);
    assert.match(heartbeat, /supported: false/);
    assert.match(coordinator, /result\.supported \? 'online' : 'unsupported'/);
});

test('job só é assumido depois da validação e da persistência local segura', () => {
    const validationAt = coordinator.indexOf('await validateBeforeClaim');
    const saveAt = coordinator.indexOf('savePersistedOpsVideoJob', validationAt);
    const claimAt = coordinator.indexOf('claimOpsVideoJob', validationAt);
    assert.ok(validationAt >= 0 && saveAt > validationAt && claimAt > saveAt);
});

test('varios jobs continuam em fila e somente um executor roda por vez', () => {
    assert.match(coordinator, /if \(runningRef\.current \|\| exportingRef\.current\) return/);
    assert.match(coordinator, /runningRef\.current = true/);
    assert.match(coordinator, /await execute\(activeQueued\)/);
    assert.match(coordinator, /runningRef\.current = false/);
});

test('primeiro progresso remoto após claim é narration 5 com mensagem de preparação', () => {
    const claimAt = coordinator.indexOf('claimOpsVideoJob');
    const firstPatchAt = coordinator.indexOf("await patch('narration'", claimAt);
    const snippet = coordinator.slice(firstPatchAt, firstPatchAt + 180);
    assert.match(snippet, /OPS_VIDEO_PROGRESS\.narration\.start/);
    assert.match(snippet, /Preparando a narração\./);
});

test('faixas oficiais de progresso permanecem exatas', () => {
    for (const [stage, start, end] of [
        ['narration', 5, 20], ['takes', 20, 35], ['quick_edit', 35, 60],
        ['captions', 60, 72], ['titles', 72, 82], ['export', 82, 99],
        ['completed', 100, 100],
    ]) {
        assert.match(workerState, new RegExp(`${stage}: \\{ start: ${start}, end: ${end} \\}`));
    }
});

test('estado durável contém identidade, destino, takes e retomada, mas nunca claimToken', () => {
    for (const field of ['jobId', 'projectId', 'companyId', 'destinationFolderId', 'takeAssetIds', 'stage', 'progress', 'resume']) {
        assert.match(workerState, new RegExp(`\\b${field}\\b`));
    }
    assert.match(workerState, /'claimToken' in/);
    assert.doesNotMatch(coordinator, /claimToken[^\n]*localStorage|localStorage[^\n]*claimToken/);
});

test('reinício consulta o job real e reutiliza o mesmo projectId', () => {
    assert.match(coordinator, /gatewayApi\.getOpsVideoJob\(state\.jobId, context\.contextId\)/);
    assert.match(coordinator, /loadAutomatedProject\(job\.projectId\)/);
    assert.match(workerState, /projectId: job\.projectId/);
});

test('contexto delegado expirado só é renovado após o novo contexto confirmar o mesmo job', () => {
    const resolve = coordinator.slice(
        coordinator.indexOf('const resolvePersistedJob'),
        coordinator.indexOf('const validateBeforeClaim'),
    );
    const getAt = resolve.indexOf('gatewayApi.getOpsVideoJob');
    const compatibleAt = resolve.indexOf('isPersistedJobCompatible');
    const rebindAt = resolve.indexOf('rebindPersistedOpsVideoJobContext');
    assert.ok(getAt >= 0 && compatibleAt > getAt && rebindAt > compatibleAt);
    assert.match(workerState, /export const rebindPersistedOpsVideoJobContext/);
    assert.match(workerState, /viewContextId: normalizedContextId/);
});

test('retomada rejeita mudança de empresa, pasta, takes ou payload do job', () => {
    assert.match(workerState, /state\.companyId === job\.companyId/);
    assert.match(workerState, /state\.destinationFolderId === \(job\.destinationFolderId \|\| null\)/);
    assert.match(workerState, /jobSignature === opsVideoJobSignature\(job\)/);
    assert.match(workerState, /takeAssetIds: job\.takeAssetIds/);
});

test('job com moldura valida PNG, materializa o overlay e preserva flags opcionais', () => {
    assert.match(gatewayClient, /frameAssetId\?: string \| null/);
    assert.match(coordinator, /job\.settings\?\.frameOverlayAssetId/);
    assert.match(coordinator, /frameAsset\.mimeType\?\.toLowerCase\(\) !== 'image\/png'/);
    assert.match(coordinator, /materializeOpsTake\([\s\S]*readiness\.frameAsset/);
    assert.match(coordinator, /frameOverlay = \{ \.\.\.materializedFrame, objectFit: 'contain' \}/);
    assert.match(coordinator, /if \(job\.captions\) adData = await generateAutomaticCaptions/);
    assert.match(coordinator, /if \(job\.automaticTitles\)/);
    assert.match(workerState, /settings: job\.settings/);
});

test('revisão mais nova do mesmo job descarta somente o checkpoint antigo e inicia outro claim', () => {
    const resolve = coordinator.slice(
        coordinator.indexOf('const resolvePersistedJob'),
        coordinator.indexOf('const validateBeforeClaim'),
    );
    assert.match(resolve, /latestRevision > state\.executionRevision/);
    assert.match(resolve, /clearPersistedOpsVideoJob\(\)/);
    assert.match(resolve, /return \{ job, context \}/);
});

test('checkpoint preparado evita recriar o projeto, mas revisão fresh bloqueia todo cache anterior', () => {
    assert.match(coordinator, /persisted\.resume\.projectPrepared/);
    assert.match(coordinator, /completedExportFor\(job\)/);
    assert.match(coordinator, /previousAssetId/);
    assert.match(coordinator, /Video ja concluido e confirmado no Mileto Ops/);
    assert.match(coordinator, /job\.execution\?\.requiresFreshRender === true/);
    assert.match(coordinator, /const previousAssetId = requiresFreshRender[\s\S]*revisionResume\?\.assetId/);
    assert.match(workerState, /outputAssetId: requiresFreshRender \? null/);
    assert.match(workerState, /executionRevision: current\.executionRevision/);
    assert.match(coordinator, /if \(isRevisionExecution && !canResumeProject\)/);
    assert.match(coordinator, /fresh_render_project_unavailable/);
});

test('quantidade de takes vem da narracao real, usa TAKES recentes e varia por lote de forma estavel', () => {
    assert.match(coordinator, /selectOpsTakesForNarration/);
    assert.match(coordinator, /Number\(adData\.narrationDuration \|\| 0\)/);
    assert.match(takeSelection, /DEFAULT_TARGET_SECONDS = 2\.5/);
    assert.match(takeSelection, /minimumForMaximumCut/);
    assert.match(takeSelection, /index % batchSize === batchIndex/);
    assert.match(takeSelection, /deterministicShuffle/);
});

test('projeto do agente continua listado e editavel depois da exportacao', () => {
    const saves = coordinator.match(/await persistAutomatedProject\(/g) || [];
    assert.equal(saves.length, 2);
    assert.match(coordinator, /exported: false/);
    assert.match(coordinator, /exported: true/);
    assert.match(projectController, /export const listProjects/);
    assert.match(projectController, /drafts\.push\(/);
    assert.doesNotMatch(projectController, /if \(parsed\.exported\) continue/);
});

test('job só conclui com assetId real confirmado pelo fluxo de exportação', () => {
    const exportAt = coordinator.indexOf('const completedExport = await waitForOpsExport(job.projectId, exportJobId)');
    const assetAt = coordinator.indexOf('const assetId = completedExport.assetId', exportAt);
    const completionAt = coordinator.indexOf("await patch('completed'", exportAt);
    assert.ok(exportAt >= 0);
    assert.ok(assetAt > exportAt);
    assert.ok(completionAt > assetAt);
    assert.match(coordinator.slice(completionAt, completionAt + 420), /outputAssetId: assetId/);
});

test('PATCH final envia a revisão e o renderResult integral somente depois do novo asset', () => {
    const completionAt = coordinator.lastIndexOf("await patch('completed'");
    const completion = coordinator.slice(completionAt, completionAt + 520);
    assert.match(completion, /status: 'completed'/);
    assert.match(completion, /revision: job\.execution\?\.revision/);
    assert.match(completion, /outputAssetId: assetId/);
    assert.match(completion, /renderResult: completedExport\.renderResult/);
    assert.match(coordinator, /render_integrity_report_missing/);
    assert.match(coordinator, /assetId === job\.execution\?\.previousOutputAssetId/);
    assert.doesNotMatch(
        coordinator.slice(
            coordinator.indexOf("await patch('export', OPS_VIDEO_PROGRESS.export.end"),
            completionAt,
        ),
        /outputAssetId/,
    );
});

test('novo render usa novo exportJobId e chave de upload persistida pela revisão', () => {
    assert.match(coordinator, /waitForOpsExport\(job\.projectId, exportJobId\)/);
    assert.match(coordinator, /detail\.exportJobId !== exportJobId/);
    assert.match(coordinator, /persisted\.resume\.uploadIdempotencyKey/);
    assert.match(coordinator, /uploadIdempotencyKey = crypto\.randomUUID\(\)/);
    assert.match(exportJobs, /idempotencyKey: activeExport\.uploadIdempotencyKey/);
    assert.match(opsController, /idempotencyKey \? \{ idempotencyKey \} : \{\}/);
});

test('409 de revision mismatch relê o mesmo job e renova o claim token', () => {
    const patchAt = coordinator.indexOf('const patch = async');
    const patchSource = coordinator.slice(patchAt, coordinator.indexOf('const showLocalProgress', patchAt));
    assert.match(patchSource, /video_job_revision_mismatch/);
    assert.match(patchSource, /gatewayApi\.getOpsVideoJob\(job\.id/);
    assert.match(patchSource, /activeClaim = await gatewayApi\.claimOpsVideoJob/);
    assert.match(patchSource, /activeClaim\.claimToken/);
    assert.match(patchSource, /video_job_revision_changed/);
});

test('asset recusado como antigo limpa o upload da revisão antes de renderizar novamente', () => {
    const rejectionAt = coordinator.indexOf("parsed.code === 'output_asset_not_fresh'");
    const rejection = coordinator.slice(rejectionAt, rejectionAt + 1_100);
    assert.ok(rejectionAt >= 0);
    assert.match(rejection, /outputAssetId: null/);
    assert.match(rejection, /uploadIdempotencyKey: null/);
    assert.match(rejection, /renderResult: null/);
    assert.match(rejection, /renderStarted: false/);
    assert.match(rejection, /stage: 'export'/);
    assert.match(rejection, /progress: OPS_VIDEO_PROGRESS\.export\.start/);
    assert.doesNotMatch(rejection, /status: 'completed'/);
});

test('HTTP 426 e minimumAppVersion exigem atualização do aplicativo', () => {
    assert.match(workerState, /opsWorkerSupportsMinimumVersion/);
    assert.match(coordinator, /video_worker_upgrade_required/);
    assert.match(coordinator, /video_job_revision_invalid/);
    assert.match(coordinator, /error\.status === 426/);
    assert.match(coordinator, /const blockedBeforeClaim = Boolean\(queued\)/);
    assert.match(coordinator, /status: 'paused'/);
});

test('falhas permanentes são estruturadas e falhas recuperáveis ficam pausadas', () => {
    assert.match(coordinator, /status: 'paused'/);
    assert.match(coordinator, /status: 'failed'/);
    assert.match(coordinator, /errorCode: parsed\.code/);
    assert.match(coordinator, /errorMessage: parsed\.message/);
});

test('cliente Electron de desenvolvimento e instalado compartilham o mesmo worker', () => {
    assert.match(electron, /if \(isDev\) \{[\s\S]*mainWindow\.loadURL\('http:\/\/localhost:5173'\)[\s\S]*\} else \{[\s\S]*mainWindow\.loadFile/);
    assert.equal((coordinator.match(/export const OpsVideoJobCoordinator/g) || []).length, 1);
});

test('interface separa presença, monitor e erro do job no indicador global', () => {
    assert.match(coordinator, /publishOpsExecutorActivity\(display\)/);
    for (const marker of ['mode', 'jobId', 'companyName', 'stage', 'percent', 'errorCode', 'monitorErrors', 'assetId']) {
        assert.match(executorActivity, new RegExp(`\\b${marker}\\b`));
    }
    for (const marker of ['Wifi', 'WifiOff', 'executorActivity.companyName', 'OPS_EXECUTOR_STAGE_LABELS[executorActivity.stage]', 'executorActivity.percent', 'executorJobErrorCode', 'executorMonitorError']) {
        assert.match(mainLayout, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('indicador diferencia heartbeat local da conexão persistente da empresa com o Ops', () => {
    assert.match(mainLayout, /Executor local offline\. Isso não indica que a empresa foi desconectada do Mileto Ops\./);
    assert.match(mainLayout, /Mesmo vermelho, ele não desconecta a empresa do Mileto Ops\./);
    assert.match(mainLayout, /executorHeartbeatState === 'offline'/);
    assert.match(mainLayout, /executorHeartbeatState === 'unsupported'/);
    assert.match(mainLayout, /motion-reduce:animate-none/);
    assert.match(coordinator, /if \(!contextId\) \{[\s\S]*heartbeat: 'unsupported'/);
});

test('cliente do gateway expõe leitura e presença com X-Ops-View-Context', () => {
    assert.match(gatewayClient, /async getOpsVideoJob/);
    assert.match(gatewayClient, /async heartbeatOpsVideoWorker/);
    assert.match(gatewayClient, /opsContextHeaders\(viewContextId\)/);
});

test('cliente do gateway expõe revisão com chave persistida pelo caller', () => {
    assert.match(gatewayClient, /async retryOpsVideoJob/);
    assert.match(gatewayClient, /async requestTemporalIntegrityRetry/);
    assert.match(gatewayClient, /requestTemporalIntegrityRetryWithPersistentKey/);
    assert.match(gatewayClient, /idempotencyKey: string/);
    assert.match(gatewayClient, /'Idempotency-Key': idempotencyKey/);
    assert.match(gatewayClient, /return response\.data\.job/);
    assert.match(retryClient, /persistentRetryIdempotencyKey/);
    assert.match(retryClient, /integrity_temporal_1_4_27/);
    assert.match(retryClient, /minimumAppVersion: TEMPORAL_INTEGRITY_MINIMUM_APP_VERSION/);
});
