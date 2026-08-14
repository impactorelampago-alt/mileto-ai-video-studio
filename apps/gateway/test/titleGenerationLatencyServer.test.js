import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.TOKEN_SECRET ||= 'test-token-secret';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';

const { completeChatRequest } = await import('../src/providers.js');
const {
    DEFAULT_TITLE_GENERATOR_CONFIG,
    normalizeTitleGeneratorConfig,
} = await import('../src/orgAi.js');

test('gateway limita erro transitorio a duas tentativas do provedor', async () => {
    let calls = 0;
    await assert.rejects(
        completeChatRequest(async () => {
            calls += 1;
            throw new Error('OpenAI 503: unavailable');
        }),
        /OpenAI 503/,
    );
    assert.equal(calls, 2);
});

test('gateway preserva no maximo a recuperacao dupla do chat comum', async () => {
    let calls = 0;
    const result = await completeChatRequest(async () => {
        calls += 1;
        if (calls === 1) throw new Error('OpenAI 503: unavailable');
        return { text: 'ok', usageTokens: 7 };
    });

    assert.equal(calls, 2);
    assert.equal(result.text, 'ok');
});

test('resposta vazia tambem para depois da segunda tentativa', async () => {
    let calls = 0;
    await assert.rejects(
        completeChatRequest(async () => {
            calls += 1;
            return { text: '', usageTokens: 0 };
        }),
        (error) => error?.code === 'CHAT_EMPTY_RESPONSE',
    );
    assert.equal(calls, 2);
});

test('migra somente o preset legado exato para a configuracao rapida v4', () => {
    const legacy = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    legacy.version = 3;
    legacy.ai = {
        provider: 'openai',
        model: 'gpt-5-mini',
        reasoning: 'equilibrado',
        maxOutputTokens: 4096,
    };
    const migrated = normalizeTitleGeneratorConfig(legacy);

    assert.equal(migrated.version, 5);
    assert.deepEqual(migrated.ai, {
        provider: 'openai',
        model: 'gpt-5-mini',
        reasoning: 'rapido',
        maxOutputTokens: 1400,
    });

    const custom = structuredClone(legacy);
    custom.ai.maxOutputTokens = 1800;
    const preserved = normalizeTitleGeneratorConfig(custom);
    assert.equal(preserved.version, 5);
    assert.deepEqual(preserved.ai, custom.ai);
});

test('controller faz uma geracao e uma revisao batch, sem chamadas por titulo, e publica somente timings numericos', () => {
    const controller = fs.readFileSync(
        new URL('../../server/src/controllers/aiController.ts', import.meta.url),
        'utf8',
    );
    const gatewayClient = fs.readFileSync(
        new URL('../../server/src/services/gatewayClient.ts', import.meta.url),
        'utf8',
    );
    const titleGeneratorConfig = fs.readFileSync(
        new URL('../../server/src/services/titleGeneratorConfig.ts', import.meta.url),
        'utf8',
    );
    const gatewayServer = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

    assert.match(controller, /maxAttempts:\s*1/);
    // Uma chamada para planejar no diálogo, uma para gerar e uma revisão batch.
    assert.equal(controller.match(/gatewayChat\(token/g)?.length, 3);
    assert.match(controller, /requestBatch:\s*async \(items\)/);
    assert.doesNotMatch(controller, /maxProviderAttempts/);
    assert.match(controller, /TITLE_GENERATION_PREFLIGHT_TIMEOUT_MS/);
    assert.match(controller, /TITLE_GENERATION_TOTAL_TIMEOUT_MS/);
    assert.match(controller, /const remainingPaletteTimeoutMs = \(\) =>/);
    assert.match(controller, /gatewayJson<[\s\S]*remainingPaletteTimeoutMs\(\)/);
    assert.match(controller, /Promise\.all\(\[\s*palettePromise,\s*configurationPromise/s);
    assert.doesNotMatch(gatewayServer, /maxProviderAttempts/);
    assert.match(gatewayClient, /TITLE_GENERATION_PREFLIGHT_TIMEOUT_MS\s*=\s*10000/);
    assert.match(gatewayClient, /TITLE_GENERATION_TOTAL_TIMEOUT_MS\s*=\s*35000/);
    assert.match(controller, /requestController\.signal,\s*TITLE_GENERATION_TOTAL_TIMEOUT_MS\)/);
    assert.match(titleGeneratorConfig, /const remainingTimeoutMs = \(\) =>/);
    assert.match(titleGeneratorConfig, /gatewayJson<[\s\S]*remainingTimeoutMs\(\)[\s\S]*gatewayJson<[\s\S]*remainingTimeoutMs\(\)/);

    const timingsStart = controller.indexOf('const timingsMs = {', controller.indexOf('export const generateTitles'));
    const timingsEnd = controller.indexOf('\n    };', timingsStart);
    const timingsBlock = controller.slice(timingsStart, timingsEnd);
    assert.ok(timingsStart > 0 && timingsEnd > timingsStart);
    assert.match(timingsBlock, /companyPalette/);
    assert.match(timingsBlock, /configuration/);
    assert.match(timingsBlock, /generation/);
    assert.match(timingsBlock, /formatting/);
    assert.match(timingsBlock, /total/);
    assert.doesNotMatch(timingsBlock, /script|captions|token|authorization|error|stack/i);
    assert.match(controller, /timingsMs:\s*\{\s*\.\.\.timingsMs\s*\}/);
});
