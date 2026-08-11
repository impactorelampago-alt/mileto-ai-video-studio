import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.TOKEN_SECRET ||= 'test-token-secret';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';

const { completeChatRequest } = await import('../src/providers.js');
const {
    DEFAULT_TITLE_GENERATOR_CONFIG,
    normalizeTitleGeneratorConfig,
} = await import('../src/orgAi.js');

test('erro não transitório não é repetido pelo gateway', async () => {
    let calls = 0;
    await assert.rejects(
        completeChatRequest(async () => {
            calls += 1;
            throw new Error('OpenAI 400: requisição inválida');
        }),
        /OpenAI 400/,
    );
    assert.equal(calls, 1);
});

test('resposta vazia preserva somente uma retry interna no gateway', async () => {
    let calls = 0;
    const result = await completeChatRequest(async () => {
        calls += 1;
        return calls === 1
            ? { text: '', usageTokens: 2 }
            : { text: 'ok', usageTokens: 3 };
    });
    assert.equal(calls, 2);
    assert.equal(result.usageTokens, 5);
});

test('chat comum preserva uma única retry interna', async () => {
    let calls = 0;
    const result = await completeChatRequest(async () => {
        calls += 1;
        if (calls === 1) throw new Error('OpenAI 503: indisponível');
        return { text: 'ok', usageTokens: 3 };
    });

    assert.equal(result.text, 'ok');
    assert.equal(calls, 2);
});

test('migra somente o preset legado exato para o default rápido v4', () => {
    const legacy = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    legacy.version = 3;
    legacy.ai = {
        provider: 'openai',
        model: 'gpt-5-mini',
        reasoning: 'equilibrado',
        maxOutputTokens: 4096,
    };

    const migrated = normalizeTitleGeneratorConfig(legacy);
    assert.equal(migrated.version, 4);
    assert.deepEqual(migrated.ai, {
        provider: 'openai',
        model: 'gpt-5-mini',
        reasoning: 'rapido',
        maxOutputTokens: 1400,
    });
});

test('preserva preset customizado e escolha explícita já salva como v4', () => {
    const custom = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    custom.version = 3;
    custom.ai = {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        reasoning: 'equilibrado',
        maxOutputTokens: 2048,
    };
    assert.deepEqual(normalizeTitleGeneratorConfig(custom).ai, custom.ai);

    const explicitLegacyValues = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    explicitLegacyValues.version = 4;
    explicitLegacyValues.ai = {
        provider: 'openai',
        model: 'gpt-5-mini',
        reasoning: 'equilibrado',
        maxOutputTokens: 4096,
    };
    assert.deepEqual(normalizeTitleGeneratorConfig(explicitLegacyValues).ai, explicitLegacyValues.ai);
});
