import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const coordinator = readFileSync(
    new URL('../src/components/OpsVideoJobCoordinator.tsx', import.meta.url),
    'utf8',
).replace(/\r\n/g, '\n');

test('idempotency_key_conflict é classificado como retryable (fix #2 — botão do Ops)', () => {
    // O conjunto de códigos retryable existe e inclui o conflito de chave.
    assert.match(coordinator, /const RETRYABLE_EXECUTOR_ERROR_CODES = new Set\(\['idempotency_key_conflict'\]\)/);
    // errorParts usa o conjunto no ramo de erro prefixado (Error puro do upload).
    assert.match(coordinator, /const code = safeErrorIdentifier\(match\[1\], 'ai_video_failed'\);[\s\S]*?retryable: RETRYABLE_EXECUTOR_ERROR_CODES\.has\(code\)/);
    // ...e também no ramo de GatewayError, caso o conflito chegue tipado.
    assert.match(coordinator, /retryable: RETRYABLE_EXECUTOR_ERROR_CODES\.has\(code\) \|\|/);
});

test('idempotency_key_conflict nunca entra na lista de interrupção recuperável (vai para falha + retry do Ops)', () => {
    const recoverable = coordinator.slice(
        coordinator.indexOf('const isRecoverableInterruption'),
        coordinator.indexOf('const isPersistedResolutionFailure'),
    );
    assert.doesNotMatch(recoverable, /idempotency_key_conflict/);
});

test('conflito descarta o checkpoint de upload para a próxima tentativa gerar chave nova (fix #1)', () => {
    const handler = coordinator.slice(
        coordinator.indexOf("if (parsed.code === 'idempotency_key_conflict')"),
        coordinator.indexOf('if (isRecoverableInterruption(error, parsed.code))'),
    );
    assert.ok(handler, 'o handler do conflito deve existir antes da checagem de interrupção');
    assert.match(handler, /renderStarted: false/);
    assert.match(handler, /uploadIdempotencyKey: null/);
    assert.match(handler, /exportJobId: null/);
    // Não retorna: precisa fluir para o caminho de falha que reporta retryable.
    assert.doesNotMatch(handler, /\breturn;/);
});

test('a chave persistida só é reusada ao retomar um render já despachado; re-render recebe chave nova (fix #1)', () => {
    // Reuso condicionado a renderStarted === true; caso contrário, UUID novo.
    assert.match(
        coordinator,
        /uploadIdempotencyKey = persisted\.resume\.renderStarted === true && validPersistedKey\s*\n\s*\?\s*persistedKey\s*\n\s*:\s*crypto\.randomUUID\(\)/,
    );
    // O bloco antigo (reuso incondicional em requiresFreshRender) não existe mais.
    assert.doesNotMatch(
        coordinator,
        /let uploadIdempotencyKey = requiresFreshRender\s*\n\s*\?\s*String\(persisted\.resume\.uploadIdempotencyKey/,
    );
});
