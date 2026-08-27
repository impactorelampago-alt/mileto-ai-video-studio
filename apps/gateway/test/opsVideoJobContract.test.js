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
const jobCompanyContract = read('../../client/src/lib/opsVideoJobCompany.ts');
const retryClient = read('../../client/src/lib/opsVideoJobRetry.ts');
const exportJobs = read('../../client/src/context/ExportJobsContext.tsx');
const opsController = read('../../server/src/controllers/opsController.ts');
const takeSelection = read('../../client/src/lib/opsTakeSelection.ts');
const projectController = read('../../server/src/controllers/projectController.ts');
const electron = read('../../client/electron-main/main.cjs');
const viteConfig = read('../../client/vite.config.ts');
const clientPackage = JSON.parse(read('../../client/package.json'));

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

test('heartbeat usa a versão do package.json, campo oficial mode e job atual', () => {
    const heartbeat = handler('export const heartbeatVideoWorker', 'export const claimVideoJob');
    assert.match(viteConfig, /readFileSync\(new URL\('\.\/package\.json', import\.meta\.url\)/);
    assert.match(viteConfig, /__MILETO_APP_VERSION__:\s*JSON\.stringify\(appVersion\)/);
    assert.match(workerState, /OPS_VIDEO_WORKER_APP_VERSION = typeof __MILETO_APP_VERSION__/);
    assert.match(String(clientPackage.version), /^\d+\.\d+\.\d+/);
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

test('job é persistido e assumido antes do preflight para devolver falhas estruturadas ao Ops', () => {
    const executeAt = coordinator.indexOf('const execute = useCallback');
    const saveAt = coordinator.indexOf('savePersistedOpsVideoJob', executeAt);
    const claimAt = coordinator.indexOf('claimOpsVideoJob', saveAt);
    const validationAt = coordinator.indexOf('await validateBeforeClaim', claimAt);
    const paidGenerationAt = coordinator.indexOf('generateNarrationAndMix', validationAt);
    assert.ok(executeAt >= 0 && saveAt > executeAt && claimAt > saveAt && validationAt > claimAt);
    assert.ok(paidGenerationAt > validationAt, 'nenhuma geração paga pode anteceder o preflight');
    assert.match(coordinator, /status: 'failed',[\s\S]*errorPhase: parsed\.phase[\s\S]*errorRequestId: parsed\.requestId[\s\S]*errorRetryable: parsed\.retryable/);
    assert.match(coordinator, /resolveOpsVideoClaimIdentity\(queued\.job, job\)/);
    assert.match(coordinator, /claimIdentity\.action === 'rebase'[\s\S]*clearPersistedOpsVideoJob\(\)[\s\S]*createPersistedOpsVideoJob\([\s\S]*job,/);
    assert.match(coordinator, /historyContextRef\.current = \{[\s\S]*revision: claimIdentity\.claimedRevision/);
    assert.match(coordinator, /claimIdentity\.action === 'reject'[\s\S]*claim_identity/);
});

test('falha antes do claim encerra o historico local sem criar revisao ativa fantasma', () => {
    const start = coordinator.indexOf('let activeClaim: OpsVideoJobClaim;');
    const end = coordinator.indexOf('const job = activeClaim.job;', start);
    const preClaimFailure = coordinator.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(preClaimFailure, /catch \(error\)[\s\S]*errorParts\(error\)/);
    assert.match(preClaimFailure, /preClaimPhase = parsed\.phase \|\| 'pre_claim_failed'/);
    assert.match(preClaimFailure, /status: 'failed'/);
    assert.match(preClaimFailure, /errorCode: parsed\.code/);
    assert.match(preClaimFailure, /errorStage: preClaimStage/);
    assert.match(preClaimFailure, /errorRequestId: parsed\.requestId/);
    assert.match(preClaimFailure, /errorRetryable: parsed\.retryable/);
    assert.match(preClaimFailure, /recordOpsJobHistoryActivity\(terminalActivity/);
    assert.match(preClaimFailure, /clearPersistedOpsVideoJob\(\)[\s\S]*currentJobRef\.current = null/);
    assert.match(preClaimFailure, /type: 'monitor-failed'[\s\S]*requestId: parsed\.requestId[\s\S]*retryable: parsed\.retryable/);
    assert.doesNotMatch(preClaimFailure, /updateOpsVideoJob|claimToken/);
    assert.match(preClaimFailure, /return;/);
});

test('varios jobs continuam em fila e somente um executor roda por vez', () => {
    assert.match(coordinator, /if \(runningRef\.current \|\| exportingRef\.current\) return/);
    assert.match(coordinator, /runningRef\.current = true/);
    assert.match(coordinator, /await execute\(activeQueued\)/);
    assert.match(coordinator, /runningRef\.current = false/);
});

test('primeiro progresso remoto após claim é narration 5 com mensagem de preparação', () => {
    const claimAt = coordinator.indexOf('claimOpsVideoJob');
    const claimedFlow = coordinator.slice(claimAt);
    assert.match(
        claimedFlow,
        /await patch\(\s*'narration',\s*OPS_VIDEO_PROGRESS\.narration\.start,\s*`Preparando a narração\./,
    );
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
    assert.match(coordinator, /if \(wantCaptions\) adData = await generateAutomaticCaptions/);
    assert.match(coordinator, /if \(wantTitles\)/);
    assert.match(workerState, /settings: job\.settings/);
});

test('Video Moldura: sinal settings.videoModel liga o modo forte (1:1, sem titulo/legenda, moldura obrigatoria)', () => {
    // Sinal explicito e retrocompativel dentro de settings (aberto).
    assert.match(coordinator, /const isMoldura = job\.settings\?\.videoModel === 'moldura'/);
    // Coage 1:1 e marca o adData como moldura.
    assert.match(coordinator, /const effectiveFormat = isMoldura \? \('1:1' as const\)/);
    assert.match(coordinator, /videoModel: isMoldura \? 'moldura' : 'takes'/);
    // Moldura obrigatoria + ao menos um take.
    assert.match(coordinator, /ops_frame_required/);
    assert.match(coordinator, /ops_take_required/);
    // Pula legenda e titulo de proposito, independente das flags do job.
    assert.match(coordinator, /const wantCaptions = !isMoldura && job\.captions/);
    assert.match(coordinator, /const wantTitles = !isMoldura && job\.automaticTitles/);
});

test('executor converte o contrato atual de narracao do Ops sem perder tags e aceita o legado', () => {
    const validation = coordinator.slice(
        coordinator.indexOf('const validateBeforeClaim'),
        coordinator.indexOf('export const OpsVideoJobCoordinator'),
    );
    assert.match(validation, /job\.settings\?\.voiceSynthesis/);
    assert.match(validation, /voiceSynthesis\?\.plainText/);
    assert.match(validation, /job\.settings\?\.narrationPlainText/);
    assert.match(validation, /job\.settings\?\.narrationSynthesisText/);
    assert.match(validation, /const narrationSynthesisText = voiceSynthesisPlainText && jobNarrationText[\s\S]*\? jobNarrationText/);
    assert.match(validation, /stripNarrationDirections\(narrationSynthesisText\)/);
    assert.match(validation, /narrationText: narrationPlainText/);
    assert.match(validation, /narrationSynthesisText: narrationSynthesisText \|\| narrationPlainText/);
});

test('falha da API local preserva metadados seguros e respeita retryable', () => {
    const parsing = coordinator.slice(
        coordinator.indexOf('const safeErrorIdentifier'),
        coordinator.indexOf('const isPersistedResolutionFailure'),
    );
    assert.match(parsing, /error instanceof LocalApiError/);
    assert.match(parsing, /code: safeErrorIdentifier\(error\.code, 'local_api_failed'\)/);
    assert.match(parsing, /phase: error\.phase \? safeErrorIdentifier/);
    assert.match(parsing, /requestId: error\.requestId \? safeErrorIdentifier/);
    assert.match(parsing, /retryable: error\.retryable === true/);
    assert.match(parsing, /\[url omitida\]/);
    assert.match(parsing, /error instanceof LocalApiError\) return error\.retryable === true/);
    assert.doesNotMatch(parsing, /JSON\.stringify\(error\)|error\.stack/);
    assert.match(coordinator, /const executorErrorMetadata[\s\S]*errorPhase: error\.phase[\s\S]*errorRequestId: error\.requestId[\s\S]*errorRetryable: error\.retryable/);
    assert.match(coordinator, /errorPhase\?: string;[\s\S]*errorRequestId\?: string;[\s\S]*errorRetryable\?: boolean;/);
    assert.match(coordinator, /status: 'failed',[\s\S]*errorPhase: parsed\.phase,[\s\S]*errorRequestId: parsed\.requestId,[\s\S]*errorRetryable: parsed\.retryable/);
    assert.match(gatewayClient, /errorStage\?: OpsVideoJobStage \| null;[\s\S]*errorPhase\?: string \| null;[\s\S]*errorRequestId\?: string \| null;[\s\S]*errorRetryable\?: boolean \| null;/);
    const updateBody = coordinator.slice(
        coordinator.indexOf('const update: OpsVideoJobUpdate'),
        coordinator.indexOf('const sendUpdate'),
    );
    assert.match(updateBody, /errorStage: extra\.errorCode \? stage : undefined/);
    assert.match(updateBody, /errorPhase: extra\.errorPhase/);
    assert.match(updateBody, /errorRequestId: extra\.errorRequestId/);
    assert.match(updateBody, /errorRetryable: extra\.errorRetryable/);
    assert.match(gatewayClient, /this\.phase = phase/);
    assert.match(gatewayClient, /this\.requestId = requestId/);
    assert.match(gatewayClient, /this\.retryable = retryable/);
    assert.match(gatewayClient, /errorData\?\.requestId \|\| null,[\s\S]*errorData\?\.phase \|\| null/);
    assert.match(coordinator, /parsed\.retryable[\s\S]*\? 'temporarily_unavailable' as const/);
});

test('fallback legado de empresa fica auditavel no checkpoint, historico e PATCH remoto', () => {
    assert.match(workerState, /companySource: OpsVideoWorkerCompanySource/);
    assert.match(workerState, /companyFallbackUsed: boolean/);
    assert.match(workerState, /companyFallbackReason\?: string \| null/);
    assert.match(workerState, /companySource: companyResolution\?\.source \|\| 'unresolved'/);
    assert.match(coordinator, /companySource: persisted\.companySource/);
    assert.match(coordinator, /companyFallbackUsed: persisted\.companyFallbackUsed/);
    assert.match(coordinator, /companyFallbackReason: persisted\.companyFallbackReason/);
    assert.match(coordinator, /recordOpsJobHistoryActivity\(\{[\s\S]*fallbackAuditMessage/);
    assert.match(coordinator, /companySource=\$\{readiness\.projectCompanyResolution\.source\}/);
    assert.match(gatewayClient, /companySource\?: OpsVideoJobCompanyResolution\['source'\] \| 'unresolved'/);
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

test('checkpoint de revisão distingue projeto original, execução nova e payload incompleto', () => {
    assert.match(coordinator, /persisted\.resume\.projectPrepared/);
    assert.match(coordinator, /completedExportFor\(job\)/);
    assert.match(coordinator, /previousAssetId/);
    assert.match(coordinator, /Video ja concluido e confirmado no Mileto Ops/);
    assert.match(coordinator, /job\.execution\?\.requiresFreshRender === true/);
    assert.match(coordinator, /const previousAssetId = requiresFreshRender[\s\S]*revisionResume\?\.assetId/);
    assert.match(workerState, /outputAssetId: requiresFreshRender \? null/);
    assert.match(workerState, /executionRevision: current\.executionRevision/);
    assert.match(coordinator, /resolveOpsVideoExecutionDisposition/);
    assert.match(coordinator, /hasPreviousExecutionEvidence: Boolean\([\s\S]*previousOutputAssetId[\s\S]*job\.renderResult/);
    assert.match(coordinator, /hasCompletePayload: readiness\.hasCompleteExecutionPayload/);
    assert.match(coordinator, /executionDecision\.disposition/);
    assert.match(coordinator, /executionDispositionError/);
    assert.doesNotMatch(coordinator, /fresh_render_project_unavailable/);
    for (const disposition of [
        'revision_possible',
        'new_execution',
        'project_original_missing',
        'new_execution_required',
        'temporarily_unavailable',
    ]) {
        assert.match(workerState, new RegExp(`'${disposition}'`));
    }
});

test('contexto do histórico muda para o job atual antes do preflight', () => {
    const execute = coordinator.slice(
        coordinator.indexOf('const execute = useCallback'),
        coordinator.indexOf('const readiness = await validateBeforeClaim'),
    );
    assert.match(execute, /historyContextRef\.current = \{/);
    assert.match(execute, /jobId: queued\.job\.id/);
});

test('quantidade de takes vem da narracao real, usa TAKES recentes e varia por lote de forma estavel', () => {
    assert.match(coordinator, /selectOpsTakesForNarration/);
    assert.match(coordinator, /Number\(adData\.narrationDuration \|\| 0\)/);
    assert.match(takeSelection, /DEFAULT_TARGET_SECONDS = 2\.5/);
    assert.match(takeSelection, /minimumForMaximumCut/);
    assert.match(takeSelection, /index % batchSize === batchIndex/);
    assert.match(takeSelection, /deterministicShuffle/);
});

test('retomada repara a cauda visual legada antes de persistir e exportar', () => {
    const resumeAt = coordinator.indexOf('if (canResumeProject && savedProject)');
    const repairAt = coordinator.indexOf('fillTimelineTailPreservingCuts(', resumeAt);
    const persistAt = coordinator.indexOf('await persistAutomatedProject(', repairAt);
    const exportAt = coordinator.indexOf('const exportJobId = startExport(', repairAt);

    assert.ok(resumeAt >= 0);
    assert.ok(repairAt > resumeAt);
    assert.ok(persistAt > repairAt);
    assert.ok(exportAt > persistAt);
    assert.match(coordinator.slice(resumeAt, repairAt), /if \(canResumeProject && job\.quickEdit\)/);
    assert.match(coordinator.slice(repairAt, persistAt), /legacy_visual_timeline_tail_repaired/);
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
    // A chave persistida só é reusada ao retomar um render já despachado; um
    // render novo (ou re-render) recebe uma chave fresca. Ver fix da colisão
    // de Idempotency-Key.
    assert.match(coordinator, /persisted\.resume\.renderStarted === true && validPersistedKey/);
    assert.match(coordinator, /:\s*crypto\.randomUUID\(\)/);
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
    assert.match(coordinator, /Diagnostico tecnico:/);
    assert.match(coordinator, /pode_tentar_novamente=/);
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
    assert.match(mainLayout, /describeOpsExecutorMonitorError/);
    assert.match(mainLayout, /Conexão com o Mileto Ops/);
    assert.match(mainLayout, /Diagnóstico: \{executorMonitorError\.code\}/);
    assert.match(mainLayout, /executorHeartbeatState === 'offline'/);
    assert.match(mainLayout, /executorHeartbeatState === 'unsupported'/);
    assert.match(mainLayout, /motion-reduce:animate-none/);
    assert.match(mainLayout, /const totalActiveCount = activeCount;/);
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
    assert.match(gatewayClient, /normalizeOpsVideoJobProjectCompany\(response\.data\.job\)/);
    assert.match(retryClient, /persistentRetryIdempotencyKey/);
    assert.match(retryClient, /integrity_temporal_1_4_27/);
    assert.match(retryClient, /minimumAppVersion: TEMPORAL_INTEGRITY_MINIMUM_APP_VERSION/);
});

test('empresa autoritativa do projeto vence a empresa legada em todas as entradas do job', () => {
    assert.match(jobCompanyContract, /own\(settings, 'projectCompany'\)/);
    assert.match(jobCompanyContract, /source\.source !== 'mileto_ops_company'/);
    assert.match(jobCompanyContract, /source: 'legacy_job_company_id'/);
    assert.match(jobCompanyContract, /fallbackReason: 'settings\.projectCompany_absent'/);
    assert.match(jobCompanyContract, /companyId: projectCompanyResolution\.id/);
    assert.match(coordinator, /name: projectCompanyResolution\.name/);
    assert.match(coordinator, /event: 'legacy_company_fallback'/);
    assert.match(gatewayClient, /nextOpsVideoJob[\s\S]*normalizeOpsVideoJobProjectCompany\(response\.data\)/);
    assert.match(gatewayClient, /claimOpsVideoJob[\s\S]*normalizeOpsVideoJobProjectCompany\(response\.data\.job\)/);
});
