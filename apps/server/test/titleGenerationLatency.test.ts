import assert from 'node:assert/strict';
import test from 'node:test';
import {
    runResilientTitleGeneration,
    titleGenerationDiagnostic,
} from '../src/services/titleGenerationResilience';

const transientError = () => Object.assign(
    new Error('Bearer secret-token upstream private body'),
    { status: 503, code: 'provider_unavailable' },
);

test('limita a duas tentativas primarias mesmo quando o chamador pede mais', async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const waits: number[] = [];

    const result = await runResilientTitleGeneration({
        primary: async () => {
            primaryCalls += 1;
            throw transientError();
        },
        fallback: async () => {
            fallbackCalls += 1;
            return [{ text: 'VISITE A LOJA', kind: 'cta' }];
        },
        maxAttempts: 99,
        wait: async (milliseconds) => { waits.push(milliseconds); },
        requestId: 'latency-test-request',
    });

    assert.equal(primaryCalls, 2);
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(waits, [200]);
    assert.equal(result.attempts, 2);
    assert.equal(result.source, 'local');
});

test('uma tentativa configurada nunca e ampliada pela camada de resiliencia', async () => {
    let primaryCalls = 0;
    const result = await runResilientTitleGeneration({
        primary: async () => {
            primaryCalls += 1;
            throw transientError();
        },
        fallback: async () => [{ text: 'R$ 199,00', kind: 'price' }],
        maxAttempts: 1,
        wait: async () => assert.fail('nao deve aguardar retry quando o limite e um'),
    });

    assert.equal(primaryCalls, 1);
    assert.equal(result.attempts, 1);
    assert.equal(result.source, 'local');
});

test('diagnostico e seguro para telemetria e nao inclui mensagem, token ou corpo upstream', () => {
    const diagnostic = titleGenerationDiagnostic(
        transientError(),
        'ai',
        'safe-latency-request',
    );
    const serialized = JSON.stringify(diagnostic);

    assert.deepEqual(Object.keys(diagnostic).sort(), [
        'code',
        'message',
        'phase',
        'requestId',
        'retryable',
        'status',
    ]);
    assert.doesNotMatch(serialized, /secret-token|private body|Bearer/i);
    assert.equal(diagnostic.requestId, 'safe-latency-request');
    assert.equal(diagnostic.retryable, true);
});
