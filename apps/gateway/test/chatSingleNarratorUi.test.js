import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chatSource = readFileSync(
    new URL('../../client/src/components/chat/ChatMileto.tsx', import.meta.url),
    'utf8'
);
const settingsSource = readFileSync(
    new URL('../../client/src/pages/AiChatSettings.tsx', import.meta.url),
    'utf8'
);

test('Chat mostra somente o Narrador e não mantém seletor de cargo ativo', () => {
    assert.match(chatSource, /const ACTIVE_CHAT_AGENT_ID: ChatAgentId = 'prompt_sales'/);
    assert.match(chatSource, /title="Narrador Mileto"/);
    assert.match(chatSource, /Converse livremente\. Como posso ajudar\?/);
    assert.doesNotMatch(chatSource, /Equipe de agentes|Escolher o especialista|chooseAgent|selectedAgentId|agentMenuOpen/);
    assert.doesNotMatch(chatSource, /Aprovar e gerar (?:imagem|vídeo)/);
});

test('configuração da agência edita diretamente apenas o Narrador', () => {
    assert.match(settingsSource, /agents\.find\(\(agent\) => agent\.id === 'prompt_sales'\)/);
    assert.match(settingsSource, /Prompt do Narrador/);
    assert.doesNotMatch(settingsSource, /agents\.map\(/);
    assert.doesNotMatch(settingsSource, /selectAgent|selectedId/);
});
