import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { Request, Response } from 'express';

const tempDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-chat-title-refinement-'));
const previousUserDataPath = process.env.USER_DATA_PATH;
process.env.USER_DATA_PATH = tempDataPath;

const chatService = require('../src/services/chatService') as typeof import('../src/services/chatService');
const chatController = require('../src/controllers/chatController') as typeof import('../src/controllers/chatController');

after(() => {
    if (previousUserDataPath === undefined) delete process.env.USER_DATA_PATH;
    else process.env.USER_DATA_PATH = previousUserDataPath;
    fs.rmSync(tempDataPath, { recursive: true, force: true });
});

const invoke = async (sessionId: string, body: unknown) => {
    let statusCode = 200;
    let payload: any;
    const req = { params: { sessionId }, body } as unknown as Request;
    const res = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(value: unknown) {
            payload = value;
            return this;
        },
    } as unknown as Response;

    await chatController.persistTitleRefinementMessage(req, res);
    return { statusCode, payload };
};

test('persiste somente um turno de usuario marcado como refinamento de titulos', async () => {
    const session = chatService.createSession('Titulos');

    const result = await invoke(session.id, {
        content: '  Deixe o preco mais direto.  ',
        role: 'assistant',
        interactionMode: 'narrator',
    });

    assert.equal(result.statusCode, 201);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.message.role, 'user');
    assert.equal(result.payload.message.content, 'Deixe o preco mais direto.');
    assert.equal(result.payload.message.interactionMode, 'title_refinement');
    assert.deepEqual(chatService.getMessages(session.id), [result.payload.message]);
});

test('valida tipo, vazio, limite e existencia da conversa antes de persistir', async () => {
    const session = chatService.createSession('Validacao');

    assert.equal((await invoke(session.id, { content: 123 })).statusCode, 400);
    assert.equal((await invoke(session.id, { content: '   ' })).statusCode, 400);
    assert.equal((await invoke(session.id, { content: 'x'.repeat(1_001) })).statusCode, 400);
    assert.equal((await invoke('sessao-inexistente', { content: 'Ajuste o CTA.' })).statusCode, 404);
    assert.deepEqual(chatService.getMessages(session.id), []);
});

test('historico do Narrador exclui refinamentos sem apagar o historico visivel', async () => {
    const session = chatService.createSession('Historico isolado');
    chatService.addMessage(session.id, 'user', 'Crie uma narracao curta.');
    chatService.addNarratorMessage(session.id, 'Aqui esta a narracao.');
    const refinement = await invoke(session.id, {
        content: 'Mantenha Piracicaba e tire o titulo de qualidade.',
    });
    chatService.addNarratorMessage(session.id, '❌ Erro temporario');

    assert.equal(chatService.getMessages(session.id).length, 4);
    assert.equal(refinement.payload.message.interactionMode, 'title_refinement');
    assert.deepEqual(chatService.getNarratorGatewayHistory(session.id), [
        { role: 'user', content: 'Crie uma narracao curta.' },
        { role: 'assistant', content: 'Aqui esta a narracao.' },
    ]);
});
