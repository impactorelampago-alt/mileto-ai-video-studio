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

const invokeProposal = async (sessionId: string, body: unknown) => {
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

    await chatController.persistTitleProposalMessage(req, res);
    return { statusCode, payload };
};

const proposalSnapshot = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    proposalId: 'proposal-1',
    revision: 2,
    narrationKey: 'title-plan-v1-deadbeef',
    source: 'ai',
    summary: 'Titulos ajustados.',
    suggestions: [{
        id: 'suggestion-1',
        text: 'Oculos completos',
        sourceText: 'Oculos completos com armacao e lentes.',
        triggerId: 'offer',
        triggerName: 'Oferta',
        selected: true,
    }],
    triggers: [{
        id: 'offer',
        name: 'Oferta',
        maxOccurrences: 2,
        status: 'found',
        suggestionCount: 1,
    }],
    warnings: [{ code: 'notice', message: 'Revisado.' }],
    ...overrides,
});

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

test('persiste e recarrega uma proposta como resposta editorial do Narrador', async () => {
    const session = chatService.createSession('Proposta persistida');
    const root = chatService.addNarratorMessage(session.id, 'Narracao pronta.');
    const refinement = await invoke(session.id, { content: 'Deixe o titulo mais curto.' });

    const result = await invokeProposal(session.id, {
        titleThreadId: root.id,
        replyToMessageId: refinement.payload.message.id,
        proposal: proposalSnapshot(),
        role: 'user',
        interactionMode: 'title_refinement',
    });

    assert.equal(result.statusCode, 201);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.message.role, 'assistant');
    assert.equal(result.payload.message.agentId, 'prompt_sales');
    assert.equal(result.payload.message.agentLabel, 'Narrador');
    assert.equal(result.payload.message.interactionMode, 'title_proposal');
    assert.equal(result.payload.message.titleThreadId, root.id);
    assert.equal(result.payload.message.replyToMessageId, refinement.payload.message.id);
    assert.deepEqual(result.payload.message.titleProposal, proposalSnapshot());

    // getMessages relê o arquivo; o snapshot precisa sobreviver fora da resposta HTTP.
    assert.deepEqual(chatService.getMessages(session.id).at(-1), result.payload.message);
});

test('proposta usa whitelist, limita colecoes e nunca persiste dados internos', async () => {
    const session = chatService.createSession('Proposta sanitizada');
    const root = chatService.addNarratorMessage(session.id, 'Narracao pronta.');

    const suggestions = Array.from({ length: 45 }, (_, index) => ({
        id: `suggestion-${index}`,
        text: `Titulo ${index} ${'x'.repeat(100)}`,
        sourceText: `Trecho ${index} ${'y'.repeat(260)}`,
        triggerId: `trigger-${index}`,
        triggerName: `Gatilho ${index} ${'z'.repeat(130)}`,
        selected: index === 0,
        prompt: 'nao persistir',
    }));
    const triggers = Array.from({ length: 45 }, (_, index) => ({
        id: `trigger-${index}`,
        name: `Gatilho ${index}`,
        maxOccurrences: 99,
        status: index === 0 ? 'found' : 'not_found',
        suggestionCount: 99,
        model: 'nao persistir',
    }));
    const warnings = Array.from({ length: 15 }, (_, index) => ({
        code: `warning-${index}`,
        message: 'm'.repeat(300),
        raw: 'nao persistir',
    }));

    const result = await invokeProposal(session.id, {
        titleThreadId: root.id,
        replyToMessageId: root.id,
        proposal: proposalSnapshot({
            summary: 's'.repeat(300),
            suggestions,
            triggers,
            warnings,
            script: 'segredo',
            prompt: 'segredo',
            model: 'segredo',
            configSource: 'segredo',
            raw: { response: 'segredo' },
        }),
    });

    assert.equal(result.statusCode, 201);
    const stored = result.payload.message.titleProposal;
    assert.equal(stored.summary.length, 240);
    assert.equal(stored.suggestions.length, 40);
    assert.equal(stored.suggestions[0].text.length, 90);
    assert.equal(stored.suggestions[0].sourceText.length, 240);
    assert.equal(stored.suggestions[0].triggerName.length, 120);
    assert.equal(stored.triggers.length, 40);
    assert.equal(stored.triggers[0].maxOccurrences, 3);
    assert.equal(stored.triggers[0].suggestionCount, 40);
    assert.equal(stored.warnings.length, 10);
    assert.equal(stored.warnings[0].message.length, 240);
    assert.equal('script' in stored, false);
    assert.equal('prompt' in stored, false);
    assert.equal('model' in stored, false);
    assert.equal('configSource' in stored, false);
    assert.equal('raw' in stored, false);
    assert.deepEqual(Object.keys(stored.suggestions[0]).sort(), [
        'id', 'selected', 'sourceText', 'text', 'triggerId', 'triggerName',
    ]);
});

test('rejeita sessao ausente, relacoes externas e snapshot invalido', async () => {
    const session = chatService.createSession('Relacoes');
    const root = chatService.addNarratorMessage(session.id, 'Narracao pronta.');
    const another = chatService.createSession('Outra conversa');
    const foreign = chatService.addMessage(another.id, 'user', 'Mensagem externa.');

    assert.equal((await invokeProposal('sessao-inexistente', {
        titleThreadId: root.id,
        replyToMessageId: root.id,
        proposal: proposalSnapshot(),
    })).statusCode, 404);
    assert.equal((await invokeProposal(session.id, {
        titleThreadId: root.id,
        replyToMessageId: foreign.id,
        proposal: proposalSnapshot(),
    })).statusCode, 400);
    assert.equal((await invokeProposal(session.id, {
        titleThreadId: 'mensagem-inexistente',
        replyToMessageId: root.id,
        proposal: proposalSnapshot(),
    })).statusCode, 400);
    assert.equal((await invokeProposal(session.id, {
        titleThreadId: root.id,
        replyToMessageId: root.id,
        proposal: proposalSnapshot({ narrationKey: 'chave-invalida' }),
    })).statusCode, 400);
});

test('historico do Narrador exclui refinamento e proposta editorial por default', async () => {
    const session = chatService.createSession('Historico editorial');
    const user = chatService.addMessage(session.id, 'user', 'Crie uma narracao curta.');
    const root = chatService.addNarratorMessage(session.id, 'Aqui esta a narracao.');
    const refinement = await invoke(session.id, { content: 'Deixe os titulos mais curtos.' });
    const proposal = await invokeProposal(session.id, {
        titleThreadId: root.id,
        replyToMessageId: refinement.payload.message.id,
        proposal: proposalSnapshot(),
    });

    assert.equal(proposal.statusCode, 201);
    assert.equal(chatService.getMessages(session.id).length, 4);
    assert.deepEqual(chatService.getNarratorGatewayHistory(session.id), [
        { role: user.role, content: user.content },
        { role: root.role, content: root.content },
    ]);
});
