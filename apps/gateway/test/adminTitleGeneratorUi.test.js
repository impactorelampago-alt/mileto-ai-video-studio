import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { MODEL_CATALOG } from '../src/aiModels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminHtml = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
const titleView = adminHtml.slice(
    adminHtml.indexOf('<section id="viewIaTitleGenerator"'),
    adminHtml.indexOf('<section id="viewIaApi"')
);
const narratorView = adminHtml.slice(
    adminHtml.indexOf('<section id="viewIaAgents"'),
    adminHtml.indexOf('<section id="viewIaTitleGenerator"')
);
const narratorScript = adminHtml.slice(
    adminHtml.indexOf('async function loadAgents()'),
    adminHtml.indexOf('let TITLE_AI_CATALOG')
);
const titleScript = adminHtml.slice(
    adminHtml.indexOf('let TITLE_AI_CATALOG'),
    adminHtml.indexOf('async function openAgentHistory')
);

test('JavaScript embutido do Super Admin permanece sintaticamente valido', () => {
    const script = adminHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'script principal deve existir');
    assert.doesNotThrow(() => new vm.Script(script));
});

test('Gerador de Titulos usa seletores fechados e nao permite digitar modelo', () => {
    assert.match(titleView, /<select id="titleAiProvider"[^>]*data-premium-kind="provider"/);
    assert.match(titleView, /<select id="titleAiModel"[^>]*data-premium-kind="model"/);
    assert.match(titleView, /<select id="titleAiReasoning"[^>]*data-premium-kind="reasoning"/);
    assert.doesNotMatch(titleView, /<input id="titleAiModel"/);
    assert.doesNotMatch(titleView, /<datalist/);
    assert.doesNotMatch(titleScript, /titleAiModelsOpenai|titleAiModelsGemini|setAttribute\(['"]list['"]/);
    assert.match(titleScript, /modelSelect\.innerHTML = selectableModels/);
});

test('seletor premium expoe contrato acessivel e navegacao por teclado', () => {
    assert.match(adminHtml, /trigger\.setAttribute\('role', 'combobox'\)/);
    assert.match(adminHtml, /menu\.setAttribute\('role', 'listbox'\)/);
    assert.match(adminHtml, /option\.setAttribute\('role', 'option'\)/);
    assert.match(adminHtml, /aria-labelledby/);
    assert.match(adminHtml, /event\.key === 'ArrowDown'/);
    assert.match(adminHtml, /event\.key === 'Escape'/);
    assert.match(titleScript, /\['titleAiProvider', 'titleAiModel', 'titleAiReasoning'\]\.forEach/);
    assert.match(titleScript, /refreshPremiumSelect\(modelSelect\)/);
});

test('catalogo entregue ao seletor inclui GPT-5.6 Luna como recomendado', () => {
    const luna = MODEL_CATALOG.openai.find((model) => model.id === 'gpt-5.6-luna');
    assert.ok(luna);
    assert.equal(luna.name, 'GPT-5.6 Luna');
    assert.equal(luna.recommended, true);
    assert.match(titleScript, /find\(\(model\) => model\.recommended\)/);
    assert.match(titleView, /id="titleAiRecommended"/);
});

test('demais seletores de modelo do admin tambem ficam restritos ao catalogo', () => {
    assert.doesNotMatch(adminHtml, /agentModelsOpenai|agentModelsGemini|__custom__|in-custom/);
    assert.match(adminHtml, /<select class="agent-model">/);
    assert.doesNotMatch(adminHtml, /<input class="agent-model"/);
    assert.match(adminHtml, /catalogModelOptions\(catalog, prov, sel\)/);
    assert.match(adminHtml, /syncTitleAiReasoningAvailability/);
});

test('area de Chat do Super Admin exibe somente o Narrador', () => {
    assert.match(adminHtml, /data-view="ia-agents">Narrador</);
    assert.match(narratorView, /IA &middot; Narrador/);
    assert.match(narratorView, /&uacute;nica IA vis&iacute;vel no Chat/);
    assert.doesNotMatch(narratorView, /quatro prompts|Mileto Diretor|Diretor de Imagens|Diretor de V&iacute;deos/);
    assert.match(narratorScript, /data\.agents\.filter\(\(agent\) => agent\.id === 'prompt_sales'\)/);
    assert.doesNotMatch(narratorScript, /data\.agents\.map\(/);
});
