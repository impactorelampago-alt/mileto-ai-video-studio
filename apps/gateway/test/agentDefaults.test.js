import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    AGENT_DEFINITIONS,
    AGENT_REASONING_LEVELS,
    AGENT_TIERS,
    DEFAULT_AGENT_CONFIGS,
    LEGACY_NARRATOR_PROMPT_HASHES,
    NARRATION_SALES_SYSTEM_PROMPT_V8,
    NARRATION_SALES_SYSTEM_PROMPT_V9,
    agentRequiresStrictJsonOutput,
    upgradeBundledAgentSystemPrompt,
} from '../src/agentDefaults.js';

test('preserva os IDs históricos dos quatro agentes', () => {
    assert.deepEqual(
        AGENT_DEFINITIONS.map((agent) => agent.id),
        ['director', 'prompt_sales', 'image_director', 'video_director']
    );
    assert.equal(new Set(AGENT_DEFINITIONS.map((agent) => agent.kind)).size, 4);
});

test('todo agente mantém configuração privada completa e idioma dinâmico', () => {
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
        if (agent.id === 'prompt_sales') {
            assert.equal(config.systemPrompt, NARRATION_SALES_SYSTEM_PROMPT_V9);
        } else {
            assert.ok(config.systemPrompt.trim().length > 40);
            assert.match(config.systemPrompt, /\{idioma\}/);
        }
        assert.equal(/api[_ -]?key|secret|token de acesso/i.test(config.systemPrompt), false);
    }
});

test('agentes de produção continuam inativos e reversíveis', () => {
    assert.equal(DEFAULT_AGENT_CONFIGS.image_director.enabled, false);
    assert.equal(DEFAULT_AGENT_CONFIGS.video_director.enabled, false);
    for (const tier of AGENT_TIERS) {
        assert.equal(DEFAULT_AGENT_CONFIGS.video_director.tiers[tier.id].generationProvider, 'seedance');
        assert.equal(DEFAULT_AGENT_CONFIGS.video_director.tiers[tier.id].generationModel, '');
    }
});

test('mantém os três níveis de raciocínio e produto', () => {
    assert.deepEqual(AGENT_REASONING_LEVELS.map((level) => level.id), ['rapido', 'equilibrado', 'profundo']);
    assert.deepEqual(AGENT_TIERS.map((tier) => tier.id), ['lite', 'mileto', 'ultra']);
    assert.deepEqual(AGENT_TIERS.map((tier) => tier.label), ['Mileto Lite', 'Mileto', 'Mileto Ultra']);
});

test('Narrador usa a orientação pública XML sem misturar o contrato privado', () => {
    const prompt = DEFAULT_AGENT_CONFIGS.prompt_sales.systemPrompt;
    assert.equal(prompt, NARRATION_SALES_SYSTEM_PROMPT_V9);
    assert.equal(prompt.length, 2375);
    assert.equal(
        createHash('sha256').update(prompt, 'utf8').digest('hex'),
        '5ecbadf4d053572801d055372f6680e00e45ff6c4c8753fae7cb92386cd8ab97'
    );
    assert.match(prompt, /^<CONFIGURACAO_DO_NARRADOR>[\s\S]*<\/CONFIGURACAO_DO_NARRADOR>$/);
    assert.match(prompt, /<IDENTIDADE>[\s\S]*<MISSAO>[\s\S]*<COMPORTAMENTO>/);
    assert.match(prompt, /<CRIACAO_DE_NARRACAO>[\s\S]*<ENTREGA_FINAL>/);
    assert.doesNotMatch(prompt, /Fish Audio|===ROTEIRO===|JSON/i);
    assert.equal(AGENT_DEFINITIONS.find((agent) => agent.id === 'prompt_sales')?.label, 'Narrador');
});

test('mantém somente fingerprints das versões antigas e preserva prompts personalizados', () => {
    assert.equal(LEGACY_NARRATOR_PROMPT_HASHES.length, 11);
    assert.equal(new Set(LEGACY_NARRATOR_PROMPT_HASHES).size, 11);
    for (const hash of LEGACY_NARRATOR_PROMPT_HASHES) assert.match(hash, /^[a-f0-9]{64}$/);
    assert.ok(LEGACY_NARRATOR_PROMPT_HASHES.includes('b95ca3f84ef5fa8553c39eab09fcd1b026a817521c71b64974a6981308671197'));

    assert.equal(
        upgradeBundledAgentSystemPrompt('prompt_sales', NARRATION_SALES_SYSTEM_PROMPT_V8),
        NARRATION_SALES_SYSTEM_PROMPT_V8
    );
    assert.equal(upgradeBundledAgentSystemPrompt('prompt_sales', '   \r\n '), '   \r\n ');
    const customPrompt = 'Você é um narrador personalizado pela agência.';
    assert.equal(upgradeBundledAgentSystemPrompt('prompt_sales', customPrompt), customPrompt);
    assert.equal(upgradeBundledAgentSystemPrompt('image_director', customPrompt), customPrompt);
});

test('somente os diretores de mídia exigem JSON', () => {
    assert.equal(agentRequiresStrictJsonOutput('director'), false);
    assert.equal(agentRequiresStrictJsonOutput('prompt_sales'), false);
    assert.equal(agentRequiresStrictJsonOutput('image_director'), true);
    assert.equal(agentRequiresStrictJsonOutput('video_director'), true);
});
