import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsSource = readFileSync(
    new URL('../src/pages/AiChatSettings.tsx', import.meta.url),
    'utf8',
);
const adminSource = readFileSync(
    new URL('../../gateway/public/index.html', import.meta.url),
    'utf8',
);

test('configuracao da agencia preserva prompt vazio e o texto exato digitado', () => {
    assert.match(settingsSource, /const promptToSave = draft/);
    assert.match(settingsSource, /saveAiAgentPrompt\(selected\.id, promptToSave\)/);
    assert.doesNotMatch(settingsSource, /!draft\.trim\(\)/);
    assert.doesNotMatch(settingsSource, /saveAiAgentPrompt\(selected\.id, draft\.trim\(\)\)/);
    assert.match(settingsSource, /Nenhum texto será inserido automaticamente/);
    assert.doesNotMatch(settingsSource, /placeholder=["'][^"']+["'][^>]*Prompt do Narrador/);
});

test('Super Admin representa prompt vazio sem preencher fallback visual', () => {
    assert.match(adminSource, /<textarea class="agent-prompt" aria-label="Prompt do Narrador">\$\{esc\(c\.systemPrompt\)\}<\/textarea>/);
    assert.match(adminSource, /0 caracteres · sem prompt \(estado válido\)/);
    assert.match(adminSource, /systemPrompt: card\.querySelector\('\.agent-prompt'\)\.value/);
    assert.doesNotMatch(adminSource, /systemPrompt:\s*card\.querySelector\('\.agent-prompt'\)\.value\s*\|\|/);
});
