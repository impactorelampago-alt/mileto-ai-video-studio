import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.TOKEN_SECRET ||= 'test-token-secret';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';

const { normalizeAgentConfig, normalizeAgentTierId } = await import('../src/settings.js');

test('migra a configuração antiga para o nível Mileto sem perder o modelo', () => {
    const config = normalizeAgentConfig('director', {
        enabled: true,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        reasoning: 'profundo',
        maxOutputTokens: 7000,
        systemPrompt: 'Prompt legado em {idioma}.',
    });
    assert.equal(config.tiers.mileto.provider, 'gemini');
    assert.equal(config.tiers.mileto.model, 'gemini-2.5-pro');
    assert.equal(config.tiers.mileto.maxOutputTokens, 7000);
    assert.equal(config.tiers.lite.model, 'gpt-4.1-nano');
    assert.equal(config.tiers.ultra.model, 'gpt-5');
});

test('mantém os três níveis independentes no mesmo agente', () => {
    const config = normalizeAgentConfig('video_director', {
        enabled: true,
        tiers: {
            lite: { provider: 'openai', model: 'gpt-4.1-mini', reasoning: 'rapido', maxOutputTokens: 2048, generationProvider: 'seedance', generationModel: 'seedance-fast', generationCostUsd: 0.1 },
            mileto: { provider: 'openai', model: 'gpt-5-mini', reasoning: 'equilibrado', maxOutputTokens: 4096, generationProvider: 'seedance', generationModel: 'seedance-pro', generationCostUsd: 0.2 },
            ultra: { provider: 'gemini', model: 'gemini-2.5-pro', reasoning: 'profundo', maxOutputTokens: 8192, generationProvider: 'seedance', generationModel: 'seedance-ultra', generationCostUsd: 0.3 },
        },
        systemPrompt: 'Diretor de vídeo em {idioma}.',
    });
    assert.equal(config.tiers.lite.generationModel, 'seedance-fast');
    assert.equal(config.tiers.mileto.generationModel, 'seedance-pro');
    assert.equal(config.tiers.ultra.provider, 'gemini');
    assert.equal(config.tiers.ultra.generationModel, 'seedance-ultra');
    assert.equal(config.tiers.ultra.generationCostUsd, 0.3);
});

test('normaliza identificadores públicos e sessões legadas', () => {
    assert.equal(normalizeAgentTierId('mileto-lite'), 'lite');
    assert.equal(normalizeAgentTierId('mileto-ultra'), 'ultra');
    assert.equal(normalizeAgentTierId('mileto-plus'), 'mileto');
    assert.equal(normalizeAgentTierId('qualquer-sessao-antiga'), 'mileto');
});
