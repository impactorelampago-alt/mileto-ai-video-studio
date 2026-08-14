import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const chatSource = fs.readFileSync(
    path.resolve(here, '../src/components/chat/ChatMileto.tsx'),
    'utf8'
);

test('a abertura vazia do Chat e neutra e usa a identidade Narrador', () => {
    assert.match(chatSource, />\s*Narrador\s*</);
    assert.match(chatSource, /Converse livremente\. Como posso ajudar\?/);
    assert.doesNotMatch(chatSource, /Converse livremente para desenvolver ideias, textos e narrações/);
});

test('o renderer preserva labels gravados antes de usar fallback historico', () => {
    assert.match(chatSource, /msg\.agentLabel \|\| historicalAgentLabel\(msg\.agentId\)/);
    assert.match(chatSource, /prompt_sales: 'Narração e Vendas'/);
});

test('falhas criadas no cliente tambem aparecem como Narrador', () => {
    assert.match(chatSource, /agentLabel: 'Narrador'/);
});
