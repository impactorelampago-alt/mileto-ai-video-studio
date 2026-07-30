import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AGENT_DEFINITIONS,
    AGENT_REASONING_LEVELS,
    AGENT_TIERS,
    DEFAULT_AGENT_CONFIGS,
    LEGACY_PROMPT_SALES_SYSTEM_PROMPT_V1,
    NARRATION_SALES_SYSTEM_PROMPT_V3,
    NARRATION_SALES_SYSTEM_PROMPT_V4,
    NARRATION_SALES_SYSTEM_PROMPT_V5,
    NARRATION_SALES_SYSTEM_PROMPT_V6,
    NARRATION_SALES_SYSTEM_PROMPT_V7,
    PROMPT_SALES_SYSTEM_PROMPT_V2,
    agentRequiresStrictJsonOutput,
    upgradeBundledAgentSystemPrompt,
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

test('Narração e Vendas v7 preserva liberdade, exige direção Fish Audio e organiza parágrafos', () => {
    const prompt = DEFAULT_AGENT_CONFIGS.prompt_sales.systemPrompt;
    assert.equal(prompt, NARRATION_SALES_SYSTEM_PROMPT_V7);
    assert.match(prompt, /versao="7"/);
    assert.match(prompt, /pontos de controle, não um roteiro rígido/);
    assert.match(prompt, /Faça de zero a cinco perguntas por rodada/);
    assert.match(prompt, /blogueiro\/UGC, varejo elétrico, rodeio\/evento, anúncio de rádio/);
    assert.match(prompt, /Uma narração comercial final sem nenhuma tag é uma resposta incompleta/);
    assert.match(prompt, /Textos menores podem usar menos, mas nunca zero por padrão/);
    assert.match(prompt, /\[angry\].*\[sad\].*\[embarrassed\].*\[excited\]/s);
    assert.match(prompt, /\[emphasis\].*\[whispering\].*\[soft\].*\[breathy\]/s);
    assert.match(prompt, /\[laughing\].*\[chuckling\].*\[moaning\].*\[clear throat\]/s);
    assert.match(prompt, /\[pause\].*\[long pause\]/s);
    assert.match(prompt, /===ROTEIRO===/);
    assert.match(prompt, /Nunca coloque explicação dentro de ===ROTEIRO===/);
    assert.match(prompt, /Não use tabelas, JSON ou relatórios extensos/);
    assert.match(prompt, /urgência temporal: data, horário ou encerramento real/);
    assert.match(prompt, /escassez de quantidade: estoque, lote ou unidades realmente limitadas/);
    assert.match(prompt, /um gatilho principal e um ou dois de apoio/);
    assert.match(prompt, /Avalie silenciosamente ao menos três aberturas diferentes/);
    assert.match(prompt, /Toda prova, escassez, urgência, autoridade, garantia e comparação tem base no briefing/);
    assert.match(prompt, /dois a quatro parágrafos curtos/);
});

test('migra somente prompts distribuídos pelo produto e preserva personalizações do Super Admin', () => {
    assert.equal(
        upgradeBundledAgentSystemPrompt('prompt_sales', LEGACY_PROMPT_SALES_SYSTEM_PROMPT_V1),
        NARRATION_SALES_SYSTEM_PROMPT_V7
    );
    assert.equal(
        upgradeBundledAgentSystemPrompt('prompt_sales', PROMPT_SALES_SYSTEM_PROMPT_V2),
        NARRATION_SALES_SYSTEM_PROMPT_V7
    );
    assert.equal(
        upgradeBundledAgentSystemPrompt('prompt_sales', NARRATION_SALES_SYSTEM_PROMPT_V3),
        NARRATION_SALES_SYSTEM_PROMPT_V7
    );
    assert.equal(
        upgradeBundledAgentSystemPrompt('prompt_sales', NARRATION_SALES_SYSTEM_PROMPT_V4),
        NARRATION_SALES_SYSTEM_PROMPT_V7
    );
    assert.equal(
        upgradeBundledAgentSystemPrompt('prompt_sales', NARRATION_SALES_SYSTEM_PROMPT_V5),
        NARRATION_SALES_SYSTEM_PROMPT_V7
    );
    assert.equal(
        upgradeBundledAgentSystemPrompt('prompt_sales', NARRATION_SALES_SYSTEM_PROMPT_V6),
        NARRATION_SALES_SYSTEM_PROMPT_V7
    );
    const customPrompt = `${LEGACY_PROMPT_SALES_SYSTEM_PROMPT_V1}\n<!-- personalizado -->`;
    assert.equal(upgradeBundledAgentSystemPrompt('prompt_sales', customPrompt), customPrompt);
    assert.equal(
        upgradeBundledAgentSystemPrompt('image_director', LEGACY_PROMPT_SALES_SYSTEM_PROMPT_V1),
        LEGACY_PROMPT_SALES_SYSTEM_PROMPT_V1
    );
});

test('somente os diretores de mídia forçam JSON durante toda a conversa', () => {
    assert.equal(agentRequiresStrictJsonOutput('director'), false);
    assert.equal(agentRequiresStrictJsonOutput('prompt_sales'), false);
    assert.equal(agentRequiresStrictJsonOutput('image_director'), true);
    assert.equal(agentRequiresStrictJsonOutput('video_director'), true);
});
