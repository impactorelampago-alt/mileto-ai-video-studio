import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createPersistedOpsVideoJob,
    loadPersistedOpsVideoJob,
    resolveOpsVideoClaimIdentity,
    resolveOpsVideoExecutionDisposition,
    savePersistedOpsVideoJob,
    updatePersistedOpsVideoJob,
} from '../src/lib/opsVideoWorkerState.ts';

const input = (overrides = {}) => ({
    isRevisionExecution: true,
    requiresFreshRender: true,
    hasCompatibleProject: false,
    hasPreviousExecutionEvidence: false,
    hasCompletePayload: true,
    ...overrides,
});

const jobInput = (overrides = {}) => ({
    id: 'job-1',
    workOrderId: 'wo-1',
    companyId: 'company-1',
    status: 'queued',
    stage: 'queued',
    projectId: 'project-1',
    projectTitle: 'Projeto',
    objective: 'Teste',
    narration: 'Texto.',
    format: '9:16',
    takeAssetIds: ['take-1'],
    frameAssetId: null,
    quickEdit: false,
    shuffleTakes: false,
    captions: false,
    automaticTitles: false,
    settings: {},
    progress: {},
    execution: { revision: 2, intent: 'revision', requiresFreshRender: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
});

test('claim identico preserva o checkpoint da mesma revisao', () => {
    const queued = jobInput();
    const decision = resolveOpsVideoClaimIdentity(queued, { ...queued, status: 'claimed' });
    assert.equal(decision.action, 'continue');
    assert.equal(decision.claimedRevision, 2);
});

test('claim com revisao ou payload mais novo exige rebase sem herdar artefatos', () => {
    const queued = jobInput();
    const claimed = jobInput({
        projectId: 'project-2',
        takeAssetIds: ['take-2'],
        execution: { revision: 3, intent: 'revision', requiresFreshRender: true },
    });
    const decision = resolveOpsVideoClaimIdentity(queued, claimed);
    assert.equal(decision.action, 'rebase');
    assert.equal(decision.queuedRevision, 2);
    assert.equal(decision.claimedRevision, 3);
    assert.match(decision.message, /checkpoint anterior foi descartado/i);
});

test('claim de outro job ou revisao regressiva nunca e executado', () => {
    const queued = jobInput();
    const otherJob = resolveOpsVideoClaimIdentity(queued, jobInput({ id: 'job-2' }));
    assert.equal(otherJob.action, 'reject');
    assert.equal(otherJob.code, 'ops_claim_job_mismatch');
    assert.equal(otherJob.retryable, false);

    const regressed = resolveOpsVideoClaimIdentity(queued, jobInput({
        execution: { revision: 1, intent: 'initial', requiresFreshRender: false },
    }));
    assert.equal(regressed.action, 'reject');
    assert.equal(regressed.code, 'ops_claim_revision_regressed');
    assert.equal(regressed.retryable, true);
});

test('projeto original compatível libera a revisão sem reconstruí-lo', () => {
    const decision = resolveOpsVideoExecutionDisposition(input({ hasCompatibleProject: true }));
    assert.equal(decision.disposition, 'revision_possible');
    assert.equal(decision.canExecute, true);
    assert.equal(decision.retryable, false);
});

test('evidência anterior com payload integral cria uma renderização nova segura', () => {
    const decision = resolveOpsVideoExecutionDisposition(input({ hasPreviousExecutionEvidence: true }));
    assert.equal(decision.disposition, 'new_execution');
    assert.equal(decision.canExecute, true);
    assert.match(decision.message, /payload integral/i);
});

test('evidência anterior sem projeto nem payload integral bloqueia substituto incompleto', () => {
    const decision = resolveOpsVideoExecutionDisposition(input({
        hasPreviousExecutionEvidence: true,
        hasCompletePayload: false,
    }));
    assert.equal(decision.disposition, 'project_original_missing');
    assert.equal(decision.code, 'project_original_missing');
    assert.equal(decision.canExecute, false);
    assert.match(decision.message, /Nenhum projeto substituto foi criado/i);
});

test('fresh render sem execução anterior usa payload integral como execução nova segura', () => {
    const decision = resolveOpsVideoExecutionDisposition(input());
    assert.equal(decision.disposition, 'new_execution');
    assert.equal(decision.canExecute, true);
    assert.match(decision.message, /projectId solicitado pelo Ops/i);
});

test('payload parcial exige novo enfileiramento e não entra em retry local', () => {
    const decision = resolveOpsVideoExecutionDisposition(input({ hasCompletePayload: false }));
    assert.equal(decision.disposition, 'new_execution_required');
    assert.equal(decision.code, 'new_execution_required');
    assert.equal(decision.canExecute, false);
    assert.equal(decision.retryable, false);
});

test('falha ao consultar projeto é temporária e preserva o trabalho', () => {
    const decision = resolveOpsVideoExecutionDisposition(input({ projectLookupUnavailable: true }));
    assert.equal(decision.disposition, 'temporarily_unavailable');
    assert.equal(decision.code, 'temporarily_unavailable');
    assert.equal(decision.canExecute, false);
    assert.equal(decision.retryable, true);
});

test('checkpoint preserva disposition e diagnóstico estruturado sanitizado', () => {
    const values = new Map();
    const storage = {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
    const job = jobInput({
        projectCompanyResolution: {
            id: 'company-1',
            source: 'legacy_job_company_id',
            authoritative: false,
            fallbackUsed: true,
            fallbackReason: 'settings.projectCompany_absent',
        },
    });
    savePersistedOpsVideoJob(createPersistedOpsVideoJob(job, 'ctx-1'), storage);
    updatePersistedOpsVideoJob({
        executionDisposition: 'new_execution_required',
        diagnostic: {
            code: 'new execution required!',
            message: 'Payload incompleto.',
            stage: 'narration',
            retryable: false,
            phase: 'project_preflight',
            requestId: 'req 123',
        },
    }, storage);

    const loaded = loadPersistedOpsVideoJob(storage);
    assert.equal(loaded.executionDisposition, 'new_execution_required');
    assert.equal(loaded.companySource, 'legacy_job_company_id');
    assert.equal(loaded.companyFallbackUsed, true);
    assert.equal(loaded.companyFallbackReason, 'settings.projectCompany_absent');
    assert.deepEqual(loaded.diagnostic, {
        code: 'new_execution_required_',
        message: 'Payload incompleto.',
        stage: 'narration',
        retryable: false,
        phase: 'project_preflight',
        requestId: 'req_123',
    });
});
