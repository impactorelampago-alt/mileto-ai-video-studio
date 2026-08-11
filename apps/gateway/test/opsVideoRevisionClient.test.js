import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const clientSource = (relative) => fs.readFileSync(
    new URL(`../../client/src/lib/${relative}`, import.meta.url),
    'utf8',
);

const loadClientModule = (relative, mocks = {}, globals = {}) => {
    const compiled = ts.transpileModule(clientSource(relative), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;
    const module = { exports: {} };
    const factory = vm.runInNewContext(
        `(function(exports,module,require){${compiled}\n})`,
        { console, Date, JSON, Math, ...globals },
    );
    factory(module.exports, module, (id) => {
        if (id in mocks) return mocks[id];
        throw new Error(`mock ausente: ${id}`);
    });
    return module.exports;
};

const memoryStorage = () => {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        values,
    };
};

const sampleJob = (overrides = {}) => ({
    id: 'c26a898b-fbf6-4d1f-94d2-11490475e5e9',
    workOrderId: 'work-order-1',
    companyId: 'company-1',
    status: 'queued',
    stage: 'queued',
    projectId: 'ops-8879d6fc-ca7e-4b81-98ad-719098b5c74e',
    projectTitle: 'Ótica Reis Raposo',
    objective: 'Vídeo de oferta',
    narration: 'Narração original',
    voicePresetId: 'voice-1',
    format: '9:16',
    takeAssetIds: ['take-1', 'take-2'],
    destinationFolderId: 'folder-1',
    quickEdit: true,
    shuffleTakes: false,
    captions: true,
    automaticTitles: true,
    settings: { motion: 'zoom-in-out' },
    progress: { percent: 0 },
    outputAssetId: '11111111-1111-4111-8111-111111111111',
    execution: {
        revision: 2,
        intent: 'revision',
        requiresFreshRender: true,
        minimumAppVersion: '1.4.27',
        retryRequestedAt: '2026-08-10T22:00:00.000Z',
        retryReason: 'integrity_temporal_1_4_27',
        previousOutputAssetId: '11111111-1111-4111-8111-111111111111',
    },
    createdAt: '2026-08-10T20:00:00.000Z',
    updatedAt: '2026-08-10T22:00:00.000Z',
    ...overrides,
});

test('a mesma solicitação de retry reutiliza a chave persistida e o body exato', async () => {
    const calls = [];
    let uuidCalls = 0;
    const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const sendRetry = async (...args) => {
        calls.push(args);
        return sampleJob();
    };
    const retry = loadClientModule(
        'opsVideoJobRetry.ts',
        { './gateway': {} },
        { crypto: { randomUUID: () => { uuidCalls += 1; return uuid; } } },
    );
    const storage = memoryStorage();
    const request = {
        jobId: sampleJob().id,
        projectId: sampleJob().projectId,
        expectedRevision: 1,
        viewContextId: 'delegated-context',
        storage,
    };

    await retry.requestTemporalIntegrityRetry(request, sendRetry);
    await retry.requestTemporalIntegrityRetry(request, sendRetry);

    assert.equal(uuidCalls, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][1], uuid);
    assert.equal(calls[1][1], uuid);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), {
        projectId: sampleJob().projectId,
        expectedRevision: 1,
        reason: 'integrity_temporal_1_4_27',
        minimumAppVersion: '1.4.27',
    });
    assert.equal(calls[0][3], 'delegated-context');
});

test('estado de revisão nunca nasce com o asset anterior e vincula retomada à revision', () => {
    const worker = loadClientModule('opsVideoWorkerState.ts');
    const job = sampleJob();
    const state = worker.createPersistedOpsVideoJob(job, 'delegated-context');

    assert.equal(state.executionRevision, 2);
    assert.equal(state.requiresFreshRender, true);
    assert.equal(state.resume.outputAssetId, null);
    assert.equal(state.resume.renderResult, null);
    assert.equal(worker.isPersistedJobCompatible(state, job), true);
    assert.equal(worker.isPersistedJobCompatible(state, sampleJob({
        execution: { ...job.execution, revision: 3 },
    })), false);
});

test('job inicial fresh revision 1 sem asset anterior continua válido', () => {
    const worker = loadClientModule('opsVideoWorkerState.ts');
    const job = sampleJob({
        outputAssetId: null,
        execution: {
            revision: 1,
            intent: 'initial',
            requiresFreshRender: true,
            minimumAppVersion: '1.4.27',
            previousOutputAssetId: null,
        },
    });
    const state = worker.createPersistedOpsVideoJob(job, 'delegated-context');
    assert.equal(state.executionRevision, 1);
    assert.equal(state.requiresFreshRender, true);
    assert.equal(state.resume.outputAssetId, null);
    assert.equal(worker.isPersistedJobCompatible(state, job), true);
});

test('minimumAppVersion exige atualização sem bloquear a própria 1.4.28', () => {
    const worker = loadClientModule('opsVideoWorkerState.ts');
    assert.equal(worker.opsWorkerSupportsMinimumVersion('1.4.27', '1.4.28'), true);
    assert.equal(worker.opsWorkerSupportsMinimumVersion('1.4.28', '1.4.28'), true);
    assert.equal(worker.opsWorkerSupportsMinimumVersion('1.4.29', '1.4.28'), false);
    assert.equal(worker.opsWorkerSupportsMinimumVersion('v2.0.0', '1.4.28'), false);
});
