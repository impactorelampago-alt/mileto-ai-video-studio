import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.TOKEN_SECRET ||= 'test-token-secret';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';

const {
    MODEL_CATALOG,
    assertAiModelAllowed,
    conservativeChatUsdPerMillion,
    isAiModelAllowed,
    isOpenAiReasoningModel,
    openAiReasoningEffort,
} = await import('../src/aiModels.js');
const { buildOpenAiChatBody } = await import('../src/providers.js');
const {
    DEFAULT_TITLE_GENERATOR_CONFIG,
    assertTitleGeneratorAiSelection,
    normalizeTitleGeneratorConfig,
    normalizeStoredOrgTitleGeneratorConfig,
} = await import('../src/orgAi.js');

test('catálogo oferece GPT-5.6 Luna com contrato oficial usado pelo gateway', () => {
    const luna = MODEL_CATALOG.openai.find((model) => model.id === 'gpt-5.6-luna');
    assert.ok(luna);
    assert.equal(luna.recommended, true);
    assert.equal(luna.reasoning, true);
    assert.deepEqual(luna.reasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
    assert.deepEqual(luna.endpoints, ['chat_completions', 'responses']);
    assert.deepEqual(luna.pricingUsdPerMillion, { input: 0.2, cachedInput: 0.02, output: 1.2 });
    assert.equal(conservativeChatUsdPerMillion('openai', luna.id), 1.2);
});

test('novas seleções aceitam apenas pares provedor/modelo presentes no catálogo', () => {
    assert.deepEqual(assertAiModelAllowed('openai', 'gpt-5.6-luna'), {
        provider: 'openai',
        model: 'gpt-5.6-luna',
    });
    assert.equal(isAiModelAllowed('gemini', 'gpt-5.6-luna'), false);
    assert.throws(() => assertAiModelAllowed('openai', 'modelo-digitado'), /Selecione um modelo da lista/i);
});

test('payload Chat Completions do Luna usa reasoning_effort e limite compatíveis', () => {
    const body = buildOpenAiChatBody({
        model: 'gpt-5.6-luna',
        messages: [{ role: 'user', content: 'Analise a narração.' }],
        reasoning: 'rapido',
        json: true,
        maxOutputTokens: 1400,
    });
    assert.equal(body.model, 'gpt-5.6-luna');
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.max_completion_tokens, 1400);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal('temperature' in body, false);
    assert.equal('max_tokens' in body, false);
});

test('runtime preserva IDs antigos de raciocínio, mas eles não entram em novas gravações', () => {
    assert.equal(isOpenAiReasoningModel('gpt-5-custom-historico'), true);
    assert.equal(openAiReasoningEffort('gpt-5-custom-historico', 'profundo'), 'high');
    assert.equal(isAiModelAllowed('openai', 'gpt-5-custom-historico'), false);
});

test('gerador global aceita Luna, rejeita ID livre e herda IA global nos layouts da organização', () => {
    const global = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    global.ai = {
        provider: 'openai',
        model: 'gpt-5.6-luna',
        reasoning: 'rapido',
        maxOutputTokens: 1400,
    };
    assert.deepEqual(assertTitleGeneratorAiSelection(global), {
        provider: 'openai',
        model: 'gpt-5.6-luna',
    });
    assert.equal(normalizeTitleGeneratorConfig(global).ai.model, 'gpt-5.6-luna');

    const invalid = structuredClone(global);
    invalid.ai.model = 'gpt-escrito-a-mao';
    assert.throws(() => assertTitleGeneratorAiSelection(invalid), /Selecione um modelo da lista/i);
    // Leitura de valor histórico inválido não quebra o app: volta ao padrão seguro.
    assert.equal(normalizeTitleGeneratorConfig(invalid).ai.model, DEFAULT_TITLE_GENERATOR_CONFIG.ai.model);

    const organizationVisuals = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    organizationVisuals.ai = {
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        reasoning: 'profundo',
        maxOutputTokens: 9000,
    };
    organizationVisuals.triggers[0].titleTypes[0].layouts['9:16'].posX = 41;
    const stored = normalizeStoredOrgTitleGeneratorConfig(organizationVisuals, global);
    assert.equal(stored.ai.model, 'gpt-5.6-luna');
    assert.equal(stored.triggers[0].titleTypes[0].layouts['9:16'].posX, 41);
});

test('medidor e endpoints de gravação aplicam o catálogo no lado servidor', () => {
    const meter = fs.readFileSync(new URL('../src/meter.js', import.meta.url), 'utf8');
    const admin = fs.readFileSync(new URL('../src/admin.js', import.meta.url), 'utf8');
    const settings = fs.readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8');
    assert.match(meter, /'gpt-5\.6-luna':\s*1\.2/);
    assert.match(admin, /MODEL_CATALOG\[provider\]\.some/);
    assert.match(settings, /assertAgentModelsAllowed\(normalizeAgentConfig/);
    assert.match(settings, /const normalized = assertAiModelAllowed\(provider, model\)/);
});
