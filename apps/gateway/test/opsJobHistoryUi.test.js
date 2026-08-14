import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = read('../../client/src/App.tsx');
const layout = read('../../client/src/layouts/MainLayout.tsx');
const page = read('../../client/src/pages/OpsHistory.tsx');
const history = read('../../client/src/lib/opsJobHistory.ts');

const between = (source, start, end) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `início ausente: ${start}`);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `fim ausente: ${end}`);
    return source.slice(from, to);
};

test('sinal mostra cinco trabalhos recentes e leva ao histórico completo', () => {
    const signal = between(layout, '{isExecutorPanelOpen && (', '{isDownloadPanelOpen && (');
    assert.match(layout, /\.slice\(0, 5\)/);
    assert.match(signal, /recentOpsHistory\.map/);
    assert.match(signal, /Últimos trabalhos/);
    assert.match(signal, /navigate\('\/ops-history'\)/);
    assert.match(signal, /Ver histórico completo/);
});

test('sino continua sem estado do Ops', () => {
    const bell = between(layout, '{isDownloadPanelOpen && (', '{\/\* Horizontal Stepper \*\/}');
    assert.match(bell, /notificationJobs/);
    assert.doesNotMatch(bell, /recentOpsHistory|opsHistoryRecords|Mileto Ops|executorActivity/);
});

test('rota e aba lateral do histórico estão disponíveis', () => {
    assert.match(app, /const OpsHistory = lazy/);
    assert.match(app, /path="ops-history" element=\{<OpsHistory/);
    assert.match(layout, /location\.pathname === '\/ops-history'/);
    assert.match(layout, /Histórico do Ops/);
});

test('página oferece filtros, detalhes, timeline e diagnóstico copiável', () => {
    for (const marker of ['Todos', 'Em andamento', 'Concluídos', 'Falhas', 'Linha do tempo', 'Código técnico', 'Request ID', 'Copiar']) {
        assert.match(page, new RegExp(marker));
    }
    assert.match(page, /visibleCount/);
    assert.match(page, /setVisibleCount\(\(count\) => count \+ 25\)/);
    assert.match(page, /explainOpsJobFailure/);
});

test('journal é persistente, limitado e sanitiza diagnósticos', () => {
    assert.match(history, /OPS_JOB_HISTORY_STORAGE_KEY/);
    assert.match(history, /OPS_JOB_HISTORY_MAX_RECORDS = 200/);
    assert.match(history, /OPS_JOB_HISTORY_MAX_EVENTS = 32/);
    assert.match(history, /credencial=\[removido\]/);
    assert.match(history, /access\(\?:-\|_\)\?token/);
    assert.match(history, /parsed\.origin.*parsed\.pathname/);
    assert.match(history, /scopeKey/);
});
