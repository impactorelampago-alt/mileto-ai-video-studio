import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AGENT_DEFINITIONS,
    AGENT_REASONING_LEVELS,
    AGENT_TIERS,
    DEFAULT_AGENT_CONFIGS,
} from '../src/agentDefaults.js';

test('declara os quatro agentes com identidades e funções únicas', () => {
    assert.deepEqual(
        AGENT_DEFINITIONS.map((agent) => agent.id),
        ['director', 'prompt_sales', 'image_director', 'video_director']
    );
    assert.equal(new Set(AGENT_DEFINITIONS.map((agent) => agent.kind)).size, 4);
});

test('todo agente possui configuração privada completa e prompt em português', () => {
    for (const agent of AGENT_DEFINITIONS) {
        const config = DEFAULT_AGENT_CONFIGS[agent.id];
        assert.equal(typeof config.enabled, 'boolean');
        assert.deepEqual(Object.keys(config.tiers), ['lite', 'mileto', 'ultra']);
        for (const tier of AGENT_TIERS) {
            const brain = config.tiers[tier.id];
            assert.ok(['openai', 'gemini'].includes(brain.provider));
            assert.ok(brain.model);
            assert.ok(brain.maxOutputTokens >= 512);
        }
        assert.match(config.systemPrompt, /<AGENTE/);
        assert.match(config.systemPrompt, /\{idioma\}/);
        assert.equal(/api[_ -]?key|secret|token de acesso/i.test(config.systemPrompt), false);
    }
});

test('agentes de produção nascem seguros até o motor ser configurado', () => {
    assert.equal(DEFAULT_AGENT_CONFIGS.image_director.enabled, false);
    assert.equal(DEFAULT_AGENT_CONFIGS.video_director.enabled, false);
    for (const tier of AGENT_TIERS) {
        assert.equal(DEFAULT_AGENT_CONFIGS.video_director.tiers[tier.id].generationProvider, 'seedance');
        assert.equal(DEFAULT_AGENT_CONFIGS.video_director.tiers[tier.id].generationModel, '');
    }
});

test('níveis de raciocínio expõem rápido, equilibrado e profundo', () => {
    assert.deepEqual(AGENT_REASONING_LEVELS.map((level) => level.id), ['rapido', 'equilibrado', 'profundo']);
});

test('cada agente oferece Mileto Lite, Mileto e Mileto Ultra', () => {
    assert.deepEqual(AGENT_TIERS.map((tier) => tier.id), ['lite', 'mileto', 'ultra']);
    assert.deepEqual(AGENT_TIERS.map((tier) => tier.label), ['Mileto Lite', 'Mileto', 'Mileto Ultra']);
});
