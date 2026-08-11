import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const coordinator = read('../../client/src/components/OpsVideoJobCoordinator.tsx');
const executorActivity = read('../../client/src/lib/opsExecutorActivity.ts');
const mainLayout = read('../../client/src/layouts/MainLayout.tsx');

const compiledActivity = ts.transpileModule(executorActivity, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
    },
}).outputText;
const activityModule = { exports: {} };
const activityFactory = vm.runInNewContext(
    `(function(exports,module,require){${compiledActivity}\n})`,
    { console },
);
activityFactory(activityModule.exports, activityModule, require);
const {
    createOpsExecutorHeartbeatQueue,
    transitionOpsExecutorMonitor,
    opsExecutorVisibleJobError,
} = activityModule.exports;

const sourceBetween = (source, start, end) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `inicio ausente: ${start}`);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `fim ausente: ${end}`);
    return source.slice(from, to);
};

const pollSource = sourceBetween(
    coordinator,
    'const poll = useCallback(async () =>',
    'useEffect(() => {\n        void poll();',
);

test('falha do monitor depois de completed preserva o estado terminal do job', () => {
    const completed = {
        jobId: 'job-1',
        projectTitle: 'Video concluido',
        companyName: 'Empresa',
        stage: 'completed',
        status: 'completed',
        percent: 100,
        message: 'Entregue.',
        assetId: 'asset-new',
        mode: 'background',
        heartbeat: 'online',
    };
    const next = transitionOpsExecutorMonitor(completed, {
        type: 'monitor-failed',
        source: 'poll',
        code: 'ops_request_failed',
        message: 'Falha temporaria.',
    });

    assert.equal(next.status, 'completed');
    assert.equal(next.stage, 'completed');
    assert.equal(next.percent, 100);
    assert.equal(next.assetId, 'asset-new');
    assert.equal(next.errorCode, undefined);
    assert.equal(next.heartbeat, 'online');
    assert.equal(next.monitorErrors?.poll?.code, 'ops_request_failed');
    assert.equal(next.monitorErrors?.heartbeat, undefined);
    assert.match(pollSource, /source: 'poll'/);
    assert.match(coordinator, /await patch\('completed'[\s\S]*clearPersistedOpsVideoJob\(\)/);
});

test('polling saudavel sem job retorna a idle, limpa o job e preserva a saude do heartbeat', () => {
    const noQueuedAt = pollSource.indexOf('if (!queued)');
    assert.notEqual(noQueuedAt, -1);
    const noQueuedSource = pollSource.slice(noQueuedAt, pollSource.indexOf('heartbeatContextRef.current', noQueuedAt));

    assert.match(noQueuedSource, /if\s*\(!queued\)\s*\{/);
    assert.match(noQueuedSource, /transitionOpsExecutorMonitor\(current, \{ type: 'queue-empty' \}\)/);
    assert.match(noQueuedSource, /currentJobRef\.current\s*=\s*null/);

    const idle = transitionOpsExecutorMonitor({
        jobId: 'job-antigo',
        projectTitle: 'Video antigo',
        companyName: 'Empresa',
        stage: 'completed',
        status: 'completed',
        percent: 100,
        message: 'Entregue.',
        assetId: 'asset-antigo',
        errorCode: 'erro-antigo',
        monitorErrors: {
            poll: { source: 'poll', code: 'ops_request_failed', message: 'Falhou o polling.' },
            heartbeat: { source: 'heartbeat', code: 'heartbeat_failed', message: 'Falhou o heartbeat.' },
        },
        mode: 'background',
        heartbeat: 'offline',
    }, { type: 'queue-empty' });
    assert.equal(idle.status, 'idle');
    assert.equal(idle.percent, 0);
    assert.equal(idle.mode, 'background');
    assert.equal(idle.heartbeat, 'offline');
    assert.equal(idle.monitorErrors?.poll, undefined);
    assert.equal(idle.monitorErrors?.heartbeat?.code, 'heartbeat_failed');
    for (const staleField of ['jobId', 'projectTitle', 'companyName', 'assetId', 'errorCode']) {
        assert.equal(idle[staleField], undefined, `idle deve limpar ${staleField}`);
    }

    const idleActivity = sourceBetween(
        executorActivity,
        'export const IDLE_OPS_EXECUTOR_ACTIVITY',
        'let currentActivity',
    );
    for (const staleField of ['jobId', 'projectTitle', 'companyName', 'assetId', 'errorCode']) {
        assert.doesNotMatch(
            idleActivity,
            new RegExp(`${staleField}:`, 'm'),
            `o estado idle base nao deve carregar ${staleField}`,
        );
    }
});

test('recuperacao de uma origem nao apaga falha da outra origem', () => {
    const base = {
        stage: 'completed',
        status: 'completed',
        percent: 100,
        message: 'Entregue.',
        mode: 'background',
        heartbeat: 'online',
    };
    const pollFailed = transitionOpsExecutorMonitor(base, {
        type: 'monitor-failed',
        source: 'poll',
        code: 'ops_request_failed',
        message: 'Polling indisponivel.',
    });
    const heartbeatRecovered = transitionOpsExecutorMonitor(pollFailed, {
        type: 'monitor-recovered',
        source: 'heartbeat',
        heartbeat: 'online',
    });
    assert.equal(heartbeatRecovered.heartbeat, 'online');
    assert.equal(heartbeatRecovered.monitorErrors?.poll?.code, 'ops_request_failed');

    const heartbeatFailed = transitionOpsExecutorMonitor(heartbeatRecovered, {
        type: 'monitor-failed',
        source: 'heartbeat',
        code: 'heartbeat_failed',
        message: 'Heartbeat indisponivel.',
    });
    const pollRecovered = transitionOpsExecutorMonitor(heartbeatFailed, {
        type: 'monitor-recovered',
        source: 'poll',
    });
    assert.equal(pollRecovered.heartbeat, 'offline');
    assert.equal(pollRecovered.monitorErrors?.poll, undefined);
    assert.equal(pollRecovered.monitorErrors?.heartbeat?.code, 'heartbeat_failed');
    assert.equal(pollRecovered.status, 'completed');
});

test('heartbeat e serializado e o shutdown envia offline por ultimo', async () => {
    let releaseFirst;
    const firstRequest = new Promise((resolve) => { releaseFirst = resolve; });
    const calls = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const queue = createOpsExecutorHeartbeatQueue(async (stateOverride) => {
        calls.push(stateOverride || 'automatic');
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        try {
            if (stateOverride === 'busy') await firstRequest;
        } finally {
            concurrent -= 1;
        }
    });

    const busy = queue.request('busy');
    const offline = queue.request('offline');
    await Promise.resolve();
    assert.deepEqual(calls, ['busy']);
    releaseFirst();
    await Promise.all([busy, offline]);
    assert.deepEqual(calls, ['busy', 'offline']);
    assert.equal(maxConcurrent, 1);

    await queue.request('idle');
    assert.deepEqual(calls, ['busy', 'offline'], 'nenhum heartbeat novo entra depois do shutdown');
    assert.match(coordinator, /createOpsExecutorHeartbeatQueue\(performHeartbeat\)/);
    assert.match(coordinator, /heartbeat\('offline'\)\.finally\([\s\S]*executor:shutdown-complete/);
});

test('polling nao confunde contexto temporariamente indisponivel com fila vazia', () => {
    const lookupSource = sourceBetween(
        coordinator,
        'const findQueuedJob = async',
        'const resolvePersistedJob = async',
    );
    assert.match(lookupSource, /\[401, 403, 404\]\.includes\(error\.status\)/);
    assert.match(lookupSource, /transientLookupError = error/);
    assert.match(lookupSource, /if \(transientLookupError\) throw transientLookupError/);
    assert.match(lookupSource, /successfulLookups === 0 && lastAccessError/);

    const retrievalSource = sourceBetween(
        pollSource,
        'try {\n                queued = persisted',
        'if (!queued)',
    );
    assert.match(retrievalSource, /isPersistedResolutionFailure\(parsed\.code\)/);
    assert.match(retrievalSource, /type: 'monitor-failed',[\s\S]*source: 'poll'/);
    const transientBranch = retrievalSource.slice(retrievalSource.lastIndexOf('} else {'));
    assert.doesNotMatch(transientBranch, /updatePersistedOpsVideoJob/);
});

test('resposta antiga do heartbeat nao sobrescreve a mais nova', () => {
    const componentState = sourceBetween(
        coordinator,
        'export const OpsVideoJobCoordinator',
        'const performHeartbeat = useCallback',
    );
    const heartbeatSource = sourceBetween(
        coordinator,
        'const performHeartbeat = useCallback',
        'const heartbeatQueueRef',
    );

    assert.match(
        componentState,
        /heartbeat(?:Sequence|RequestId|Generation)Ref\s*=\s*useRef/,
        'cada heartbeat precisa de uma geracao monotona',
    );
    assert.match(heartbeatSource, /const isLatest = \(\) => generation === heartbeatGenerationRef\.current/);
    assert.ok((heartbeatSource.match(/if \(!isLatest\(\)\) return/g) || []).length >= 3);
});

test('checkpoint terminal nao anuncia job busy e validacao antecede a identidade ativa', () => {
    assert.match(
        coordinator,
        /initialPersistedJob\.status !== 'completed' && initialPersistedJob\.status !== 'failed'[\s\S]*initialPersistedJob\.jobId/,
    );
    const executeSource = sourceBetween(
        coordinator,
        'const execute = useCallback',
        'const poll = useCallback',
    );
    assert.ok(
        executeSource.indexOf('await validateBeforeClaim') < executeSource.indexOf('currentJobRef.current = queued.job.id'),
        'o job so fica busy depois de validar versao, empresa e assets',
    );
    assert.doesNotMatch(pollSource, /currentJobRef\.current = queued\.job\.id/);
    assert.match(pollSource, /const blockedBeforeClaim = Boolean\(queued\)[\s\S]*updateRequired/);
    assert.match(pollSource, /else if \(blockedBeforeClaim && queued\)[\s\S]*const blockedJob = queued\.job[\s\S]*jobId: blockedJob\.id/);
});

test('codigo de erro so e renderizado para failed ou paused', () => {
    const base = {
        stage: 'completed',
        percent: 100,
        message: 'Teste',
        mode: 'foreground',
        heartbeat: 'online',
        errorCode: 'job_failed',
    };
    assert.equal(opsExecutorVisibleJobError({ ...base, status: 'completed' }), undefined);
    assert.equal(opsExecutorVisibleJobError({ ...base, status: 'idle' }), undefined);
    assert.equal(opsExecutorVisibleJobError({ ...base, status: 'running' }), undefined);
    assert.equal(opsExecutorVisibleJobError({ ...base, status: 'paused' }), 'job_failed');
    assert.equal(opsExecutorVisibleJobError({ ...base, status: 'failed' }), 'job_failed');
    assert.match(mainLayout, /const executorJobErrorCode = opsExecutorVisibleJobError\(executorActivity\)/);
    assert.match(mainLayout, /\{executorJobErrorCode && \(/);
    assert.match(mainLayout, /role="status"/);
    assert.match(mainLayout, /aria-live="polite"/);
    assert.match(mainLayout, /role="alert"/);
});
