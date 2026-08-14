import assert from 'node:assert/strict';
import test from 'node:test';
import {
    OPS_JOB_HISTORY_MAX_RECORDS,
    explainOpsJobFailure,
    opsJobHistoryForScope,
    parseOpsJobHistory,
    reduceOpsJobHistory,
} from '../src/lib/opsJobHistory.ts';

const empty = () => ({ version: 1, records: [] });
const activity = (overrides = {}) => ({
    jobId: 'job-1',
    companyName: 'Ótica Reis',
    projectTitle: 'Multifocal 199',
    stage: 'queued',
    status: 'queued',
    percent: 0,
    message: 'Solicitação recebida.',
    mode: 'foreground',
    heartbeat: 'online',
    ...overrides,
});

test('registra a jornada do job, agrupa progresso e preserva a falha completa', () => {
    const context = { scopeKey: '1:9' };
    let snapshot = reduceOpsJobHistory(empty(), activity(), 100, context);
    snapshot = reduceOpsJobHistory(snapshot, activity({
        stage: 'narration', status: 'running', percent: 5, message: 'Preparando narração.',
    }), 200, context);
    snapshot = reduceOpsJobHistory(snapshot, activity({
        stage: 'narration', status: 'running', percent: 12, message: 'Preparando narração.',
    }), 300, context);
    snapshot = reduceOpsJobHistory(snapshot, activity({
        stage: 'export', status: 'failed', percent: 90,
        message: 'Projeto original indisponível.', errorCode: 'project_original_missing',
        errorStage: 'export', errorRetryable: false, executionDisposition: 'project_original_missing',
    }), 400, context);

    assert.equal(snapshot.records.length, 1);
    const record = snapshot.records[0];
    assert.equal(record.scopeKey, '1:9');
    assert.equal(record.status, 'failed');
    assert.equal(record.errorCode, 'project_original_missing');
    assert.equal(record.errorStage, 'export');
    assert.equal(record.executionDisposition, 'project_original_missing');
    assert.deepEqual(record.events.map((event) => event.kind), ['requested', 'started', 'progress', 'failed']);
    assert.equal(record.events[2].percent, 12);
});

test('isola o histórico por organização e usuário', () => {
    let snapshot = reduceOpsJobHistory(empty(), activity(), 100, { scopeKey: '1:9' });
    snapshot = reduceOpsJobHistory(snapshot, activity({ projectTitle: 'Outro usuário' }), 200, { scopeKey: '1:10' });

    assert.equal(snapshot.records.length, 2);
    assert.equal(opsJobHistoryForScope(snapshot, '1:9')[0].projectTitle, 'Multifocal 199');
    assert.equal(opsJobHistoryForScope(snapshot, '1:10')[0].projectTitle, 'Outro usuário');
});

test('preserva cada revisão do mesmo job como tentativa independente', () => {
    let snapshot = reduceOpsJobHistory(empty(), activity({
        status: 'failed', stage: 'narration', errorCode: 'ops_narration_text_mismatch',
    }), 100, { scopeKey: '1:9', revision: 1 });
    snapshot = reduceOpsJobHistory(snapshot, activity({
        status: 'queued', stage: 'queued', percent: 0, message: 'Nova tentativa recebida.',
    }), 200, { scopeKey: '1:9', revision: 2 });

    assert.equal(snapshot.records.length, 2);
    assert.deepEqual(snapshot.records.map((record) => record.revision), [2, 1]);
    assert.equal(snapshot.records[1].errorCode, 'ops_narration_text_mismatch');
});

test('heartbeat sem mudança não altera horário nem cria ruído na timeline', () => {
    const first = reduceOpsJobHistory(empty(), activity({
        stage: 'export', status: 'running', percent: 90, message: 'Renderizando.',
    }), 100, { scopeKey: '1:9' });
    const duplicate = reduceOpsJobHistory(first, activity({
        stage: 'export', status: 'running', percent: 90, message: 'Renderizando.',
    }), 200, { scopeKey: '1:9' });

    assert.equal(duplicate, first);
    assert.equal(duplicate.records[0].updatedAt, 100);
    assert.deepEqual(duplicate.records[0].events.map((event) => event.kind), ['requested', 'started']);
});

test('limita o volume persistido e remove credenciais e querystrings do diagnóstico', () => {
    let snapshot = empty();
    for (let index = 0; index < OPS_JOB_HISTORY_MAX_RECORDS + 8; index += 1) {
        snapshot = reduceOpsJobHistory(snapshot, activity({
            jobId: `job-${index}`,
            message: 'Authorization=Bearer-secret https://r2.example/video.mp4?X-Amz-Signature=segredo',
        }), 1_000 + index, { scopeKey: '1:9' });
    }

    assert.equal(snapshot.records.length, OPS_JOB_HISTORY_MAX_RECORDS);
    assert.doesNotMatch(snapshot.records[0].message, /Bearer-secret|X-Amz-Signature|segredo/);
    assert.match(snapshot.records[0].message, /https:\/\/r2\.example\/video\.mp4/);
});

test('remove credenciais tambem quando o erro traz JSON ou nomes alternativos', () => {
    const message = JSON.stringify({
        claimToken: 'claim-supersecret',
        access_token: 'access-supersecret',
        apiKey: 'api-supersecret',
        password: 'password-supersecret',
        detail: 'Falha segura',
    });
    const snapshot = reduceOpsJobHistory(empty(), activity({ message }), 100, { scopeKey: '1:9' });

    assert.doesNotMatch(snapshot.records[0].message, /claim-supersecret|access-supersecret|api-supersecret|password-supersecret/);
    assert.match(snapshot.records[0].message, /Falha segura/);
});

test('ignora storage corrompido e traduz o erro de renderização nova', () => {
    assert.deepEqual(parseOpsJobHistory('{invalido'), { version: 1, records: [] });
    const explanation = explainOpsJobFailure('fresh_render_project_unavailable', 'erro bruto');
    assert.match(explanation.title, /Projeto original/);
    assert.match(explanation.detail, /revisão/);
    assert.match(explanation.action, /Ops/);
});
