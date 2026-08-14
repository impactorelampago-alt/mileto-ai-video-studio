import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
const adminSource = fs.readFileSync(path.resolve(__dirname, '../src/admin.js'), 'utf8');

test('chat normal resolve sempre o Narrador sem fallback para Diretor', () => {
    assert.match(serverSource, /resolveAgent\('prompt_sales', locale, model, req\.user\.orgId\)/);
    assert.doesNotMatch(serverSource, /agentId\s*\|\|\s*['"]director['"]/);
});

test('chat normal não injeta contrato legado nem fallback do Diretor', () => {
    assert.doesNotMatch(serverSource, /CHAT_SCRIPT_OUTPUT_CONTRACT/);
    assert.doesNotMatch(serverSource, /getSystemPrompt/);
    assert.match(serverSource, /const systemPrompt = hasCustomSystem[\s\S]*\? system[\s\S]*: selectedAgent\.systemPrompt/);
    assert.match(serverSource, /const effectiveSystemPrompt = \[systemPrompt, privateVoiceContext\][\s\S]*const fullMessages = effectiveSystemPrompt[\s\S]*content: effectiveSystemPrompt[\s\S]*: conversationMessages/);
    assert.doesNotMatch(serverSource, /selectedAgent\?\.systemPrompt\s*\|\|\s*\(await getSystemPrompt/);
});

test('chat normal ignora system vindo nas mensagens, devolve texto bruto e preserva pedido sem tags', () => {
    assert.match(
        serverSource,
        /messages\.filter\(\(message\) => message\?\.role === 'user' \|\| message\?\.role === 'assistant'\)/
    );
    assert.doesNotMatch(serverSource, /ensureNarrationSalesVoiceDirection/);
    assert.match(serverSource, /userRequestedCleanNarration\(conversationMessages\)/);
    assert.match(serverSource, /narrationDirectionMode \? \{ narrationDirectionMode \} : \{\}/);
    assert.match(serverSource, /text: result\.text/);
    assert.doesNotMatch(serverSource, /result\.text\s*=/);
});

test('teste de rascunho do admin também omite mensagem system vazia', () => {
    assert.match(adminSource, /const messages = \[\{ role: 'user', content: message\.slice\(0, 12000\) \}\]/);
    assert.match(adminSource, /if \(systemPrompt\) messages\.unshift\(\{ role: 'system', content: systemPrompt \}\)/);
});
