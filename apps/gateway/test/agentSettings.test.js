import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.TOKEN_SECRET ||= 'test-token-secret';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';

const {
    normalizeAgentConfig,
    normalizeAgentTierId,
    upgradeBundledAgentConfig,
} = await import('../src/settings.js');

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

test('somente o Narrador aceita prompt global vazio', () => {
    const narrator = normalizeAgentConfig('prompt_sales', { systemPrompt: '   ' });
    assert.equal(narrator.systemPrompt, '');

    assert.throws(
        () => normalizeAgentConfig('director', { systemPrompt: '   ' }),
        /prompt de sistema não pode ficar vazio/i
    );
});

test('prompt migration preserves custom, blank, version and rollback metadata', () => {
    const stock = {
        systemPrompt: '<AGENTE id="prompt-sales" versao="7">\n' +
            '<IDENTIDADE>Você é um prompt oficial legado.</IDENTIDADE>\n' +
            '</AGENTE>',
        version: 7,
        publishedAt: '2026-08-13T12:00:00.000Z',
        publishedBy: 42,
        rollbackOf: 3,
    };
    const migrated = upgradeBundledAgentConfig('prompt_sales', stock);

    // Um prompt desconhecido é personalização e não pode ser migrado por aproximação.
    assert.equal(migrated.systemPrompt, stock.systemPrompt);
    assert.equal(migrated.version, 7);
    assert.equal(migrated.publishedAt, stock.publishedAt);
    assert.equal(migrated.publishedBy, 42);
    assert.equal(migrated.rollbackOf, 3);

    const custom = { ...stock, systemPrompt: 'My agency narrator.' };
    assert.equal(upgradeBundledAgentConfig('prompt_sales', custom).systemPrompt, custom.systemPrompt);
    const intentionallyBlank = { ...stock, systemPrompt: '' };
    assert.equal(upgradeBundledAgentConfig('prompt_sales', intentionallyBlank).systemPrompt, '');
    assert.equal(upgradeBundledAgentConfig('image_director', stock).systemPrompt, stock.systemPrompt);
});
