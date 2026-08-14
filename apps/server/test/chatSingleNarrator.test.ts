import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const tempDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-chat-narrator-'));
const previousUserDataPath = process.env.USER_DATA_PATH;
process.env.USER_DATA_PATH = tempDataPath;

const chatService = require('../src/services/chatService') as typeof import('../src/services/chatService');

after(() => {
    if (previousUserDataPath === undefined) delete process.env.USER_DATA_PATH;
    else process.env.USER_DATA_PATH = previousUserDataPath;
    fs.rmSync(tempDataPath, { recursive: true, force: true });
});

test('nova sessao usa o Narrador mesmo quando o consumidor pede um cargo legado', () => {
    const session = chatService.createSession('Conversa', null, 'mileto-plus', 'director');

    assert.equal(session.agentId, 'prompt_sales');
});

test('mensagens historicas preservam o agente originalmente gravado', () => {
    const session = chatService.createSession('Historico');
    chatService.addMessage(session.id, 'assistant', 'Resposta antiga', {
        agentId: 'image_director',
        agentLabel: 'Diretor de Imagens',
    });
    chatService.addNarratorMessage(session.id, 'Resposta nova', {
        agentVersion: 8,
    });

    const messages = chatService.getMessages(session.id);
    assert.deepEqual(messages.map((message) => message.agentId), ['image_director', 'prompt_sales']);
    assert.deepEqual(messages.map((message) => message.agentLabel), ['Diretor de Imagens', 'Narrador']);
    assert.equal(messages[0].content, 'Resposta antiga');
    assert.equal(messages[1].agentVersion, 8);
});

test('uma resposta nova nao herda o label legado devolvido por outra camada', () => {
    const session = chatService.createSession('Nova conversa');
    const message = chatService.addNarratorMessage(session.id, 'Oi! Como posso ajudar?');

    assert.equal(message.agentId, chatService.ACTIVE_CHAT_AGENT_ID);
    assert.equal(message.agentLabel, chatService.ACTIVE_CHAT_AGENT_LABEL);
});
