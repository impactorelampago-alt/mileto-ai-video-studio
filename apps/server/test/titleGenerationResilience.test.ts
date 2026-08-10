import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AUTOMATIC_TITLES_UNAVAILABLE_WARNING,
    runResilientTitleGeneration,
    titleGenerationDiagnostic,
} from '../src/services/titleGenerationResilience';

const httpError = (status: number, code = 'provider_error') =>
    Object.assign(new Error('upstream body that must not be exposed'), { status, code });

test('repete erro HTTP 500 e usa o detector local sem interromper o vídeo', async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const result = await runResilientTitleGeneration({
        primary: async () => {
            primaryCalls += 1;
            throw httpError(500);
        },
        fallback: async () => {
            fallbackCalls += 1;
            return [{ text: 'R$ 199,00', kind: 'price' }];
        },
        maxAttempts: 3,
        wait: async () => undefined,
        requestId: 'request-500',
    });

    assert.equal(primaryCalls, 3);
    assert.equal(fallbackCalls, 1);
    assert.equal(result.source, 'local');
    assert.deepEqual(result.items, [{ text: 'R$ 199,00', kind: 'price' }]);
    assert.equal(result.diagnostic?.status, 500);
    assert.equal(result.diagnostic?.retryable, true);
});

test('resposta de IA sem títulos cai imediatamente no detector local', async () => {
    let fallbackCalls = 0;
    const result = await runResilientTitleGeneration({
        primary: async () => [],
        fallback: async () => {
            fallbackCalls += 1;
            return [{ text: 'Piracicaba', kind: 'region' }];
        },
        wait: async () => undefined,
    });

    assert.equal(result.attempts, 1);
    assert.equal(fallbackCalls, 1);
    assert.equal(result.source, 'local');
    assert.equal(result.items[0].text, 'Piracicaba');
});

test('ausência total de títulos conclui de forma degradada com advertência', async () => {
    const result = await runResilientTitleGeneration({
        primary: async () => [],
        fallback: async () => [],
        wait: async () => undefined,
    });

    assert.equal(result.source, 'none');
    assert.deepEqual(result.items, []);
    assert.equal(result.warning, AUTOMATIC_TITLES_UNAVAILABLE_WARNING);
});

test('diagnóstico estruturado não expõe corpo, token ou mensagem do provedor', () => {
    const error = Object.assign(
        new Error('Bearer secret-token resposta privada do provedor'),
        { status: 500, code: 'unsafe code Bearer secret-token' },
    );
    const diagnostic = titleGenerationDiagnostic(error, 'ai', 'request-safe');
    const serialized = JSON.stringify(diagnostic);

    assert.equal(diagnostic.code, 'title_provider_unavailable');
    assert.equal(diagnostic.status, 500);
    assert.equal(diagnostic.requestId, 'request-safe');
    assert.doesNotMatch(serialized, /secret-token|resposta privada|Bearer/i);
});
