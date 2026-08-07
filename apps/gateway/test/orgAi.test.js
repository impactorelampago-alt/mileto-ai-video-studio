import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.TOKEN_SECRET ||= 'test-token-secret';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';

const {
    DEFAULT_TITLE_GENERATOR_CONFIG,
    normalizeTitleGeneratorConfig,
} = await import('../src/orgAi.js');

test('normaliza regras de titulo, cores e layouts por proporcao', () => {
    const input = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    input.maxTitles = 99;
    input.triggers[0].color = { mode: 'fixed', paletteSlot: 'primary', primary: '#ABCDEF', secondary: '#123456' };
    input.triggers[0].titleTypes[0].layouts['9:16'] = { posX: 150, posY: -20, scale: 9, textBoxWidthPct: 2 };
    input.triggers[0].titleTypes[0].layouts['16:9'].textBoxWidthPct = 999;
    input.triggers[0].maxWords = 99;

    const result = normalizeTitleGeneratorConfig(input);
    assert.equal(result.maxTitles, 12);
    assert.deepEqual(result.triggers[0].color, {
        mode: 'fixed', paletteSlot: 'primary', primary: '#abcdef', secondary: '#123456',
    });
    assert.deepEqual(result.triggers[0].titleTypes[0].layouts['9:16'], {
        posX: 100, posY: 0, scale: 4, scaleX: 1, scaleY: 1, textBoxWidthPct: 20,
    });
    assert.equal(result.triggers[0].titleTypes[0].layouts['16:9'].textBoxWidthPct, 300);
    assert.equal(result.triggers[0].maxWords, 12);
    assert.equal('maxWords' in result.triggers[0].titleTypes[0], false);
});

test('migra limite antigo do modelo para o gatilho e preserva ajuste atual', () => {
    const input = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    delete input.triggers[0].maxWords;
    delete input.triggers[0].titleTypes[0].maxWords;
    input.triggers[0].titleTypes[1].maxWords = 5;

    const result = normalizeTitleGeneratorConfig(input);
    assert.equal(result.triggers[0].maxWords, 5);

    input.triggers[0].maxWords = 4;
    assert.equal(normalizeTitleGeneratorConfig(input).triggers[0].maxWords, 4);
});

test('preserva largura ampliada e escalas independentes do editor visual', () => {
    const input = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    input.triggers[1].titleTypes[0].layouts['9:16'] = {
        posX: 48.25,
        posY: 63.75,
        scale: 0.82,
        scaleX: 1.74,
        scaleY: 0.68,
        textBoxWidthPct: 184,
    };

    const result = normalizeTitleGeneratorConfig(input);
    assert.deepEqual(result.triggers[1].titleTypes[0].layouts['9:16'], {
        posX: 48.25,
        posY: 63.75,
        scale: 0.82,
        scaleX: 1.74,
        scaleY: 0.68,
        textBoxWidthPct: 184,
    });
});

test('atualiza textos genericos dos gatilhos sem sobrescrever texto personalizado', () => {
    const input = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    input.triggers[0].sample = 'Escassez e urgencia';
    input.triggers[0].examples = [];
    input.triggers[1].sample = 'REGIÃO';
    input.triggers[2].sample = 'MINHA CHAMADA PERSONALIZADA';

    const result = normalizeTitleGeneratorConfig(input);
    assert.equal(result.triggers[0].sample, 'SOMENTE ATÉ SÁBADO');
    assert.deepEqual(result.triggers[0].examples, ['Somente até sábado', 'Últimas 8 unidades', '3 vagas']);
    assert.equal(result.triggers[1].sample, 'CASIMIRO DE ABREU');
    assert.equal(result.triggers[2].sample, 'MINHA CHAMADA PERSONALIZADA');
});

test('permite gatilho e tipo customizados sem misturar configuracao global', () => {
    const input = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    input.triggers.push({
        ...structuredClone(input.triggers[0]),
        id: 'prova-social',
        name: 'Prova social',
        titleTypes: [{ ...structuredClone(input.triggers[0].titleTypes[0]), id: 'depoimento' }],
    });
    const result = normalizeTitleGeneratorConfig(input);
    assert.equal(result.triggers.at(-1).id, 'prova-social');
    assert.equal(result.triggers.at(-1).titleTypes[0].id, 'depoimento');
    assert.equal(DEFAULT_TITLE_GENERATOR_CONFIG.triggers.length, 5);
    assert.deepEqual(DEFAULT_TITLE_GENERATOR_CONFIG.triggers.map((trigger) => trigger.id), [
        'scarcity', 'region', 'cta', 'price', 'benefit',
    ]);
    assert.ok(!DEFAULT_TITLE_GENERATOR_CONFIG.triggers.some((trigger) => trigger.id === 'hook'));
    const defaultTypes = DEFAULT_TITLE_GENERATOR_CONFIG.triggers.flatMap((trigger) => trigger.titleTypes);
    assert.ok(defaultTypes.every((type) => type.color?.mode === 'fixed'));
    assert.deepEqual(
        defaultTypes.find((type) => type.styleId === 'premium-urgency-pulse').color,
        { mode: 'fixed', paletteSlot: 'primary', primary: '#FF3B30', secondary: '#FFFFFF' }
    );
    assert.deepEqual(
        defaultTypes.find((type) => type.styleId === 'cta-whatsapp').color,
        { mode: 'fixed', paletteSlot: 'primary', primary: '#A3E635', secondary: '#FFFFFF' }
    );
});

test('migra gatilhos v1, remove gancho e valida modelo e animacao reais', () => {
    const v1 = {
        version: 1,
        extractionPrompt: 'Trechos literais.',
        maxTitles: 5,
        triggers: [
            { ...structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG.triggers[0]), id: 'hook', name: 'Gancho' },
            { ...structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG.triggers[1]), id: 'local', name: 'Localização' },
            { ...structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG.triggers[3]), id: 'offer', name: 'Oferta' },
        ],
    };
    v1.triggers[1].titleTypes[0].styleId = 'modelo-inexistente';
    v1.triggers[1].titleTypes[0].animationId = 'rodopia';
    const result = normalizeTitleGeneratorConfig(v1);
    assert.equal(result.version, 2);
    assert.ok(!result.triggers.some((trigger) => trigger.id === 'hook'));
    assert.ok(result.triggers.some((trigger) => trigger.id === 'region'));
    assert.ok(result.triggers.some((trigger) => trigger.id === 'price'));
    assert.ok(result.triggers.some((trigger) => trigger.id === 'benefit'));
    assert.ok(result.triggers.some((trigger) => trigger.id === 'scarcity'));
    const regionType = result.triggers.find((trigger) => trigger.id === 'region').titleTypes[0];
    assert.equal(regionType.styleId, 'loc-pin-viagem');
    assert.equal(regionType.animationId, 'fade');
});

test('recusa configuracao sem gatilho ativo', () => {
    const input = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    input.triggers.forEach((trigger) => { trigger.enabled = false; });
    assert.throws(() => normalizeTitleGeneratorConfig(input), /pelo menos um gatilho/i);
});

test('rotas de edicao exigem owner e consumo efetivo permanece org-scoped', () => {
    const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8');
    assert.match(server, /app\.get\('\/account\/ai\/chat',[\s\S]*?requireOwner/);
    assert.match(server, /app\.put\('\/account\/ai\/chat\/:agentId',[\s\S]*?requireOwner/);
    assert.match(server, /app\.put\('\/account\/ai\/title-generator',[\s\S]*?requireOwner/);
    assert.match(server, /app\.get\('\/v1\/ai\/title-generator',[\s\S]*?account\.effectiveAiTitleGenerator/);
    assert.match(server, /resolveAgent\(String\(agentId \|\| 'director'\), locale, model, req\.user\.orgId\)/);
    assert.match(settings, /getOrgAgentPrompt\(orgId, id\)/);
});
