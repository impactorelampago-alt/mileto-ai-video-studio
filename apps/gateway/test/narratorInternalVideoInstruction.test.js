import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.TOKEN_SECRET ||= 'test-token-secret';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';

import {
    DEFAULT_AGENT_CONFIGS,
    DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION,
    NARRATOR_FINAL_DELIVERY_CONTRACT,
} from '../src/agentDefaults.js';
const { composeAgentSystemPrompt, normalizeAgentConfig } = await import('../src/settings.js');

test('mantém exatamente o bloco Fish Audio aprovado como default privado', () => {
    assert.equal(DEFAULT_AGENT_CONFIGS.prompt_sales.systemPrompt, '');
    assert.equal(
        DEFAULT_AGENT_CONFIGS.prompt_sales.internalVideoInstruction,
        DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION
    );
    assert.equal(DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION.length, 1718);
    assert.equal(
        createHash('sha256').update(DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION, 'utf8').digest('hex'),
        '4f1434ccf320a38af21e673e74f7399ebdd0315e73f2f3ee26071f29a2789d95'
    );
});

test('versiona a instrução separadamente e só no Narrador', () => {
    const narrator = normalizeAgentConfig('prompt_sales', {
        systemPrompt: '',
        internalVideoInstruction: '  instrução privada editada  ',
    });
    assert.equal(narrator.systemPrompt, '');
    assert.equal(narrator.internalVideoInstruction, 'instrução privada editada');

    const director = normalizeAgentConfig('director', {
        systemPrompt: 'Prompt em {idioma}.',
        internalVideoInstruction: 'não deve persistir',
    });
    assert.equal('internalVideoInstruction' in director, false);
});

test('contrato mantém conversa limpa e marca somente a narração final com direções Fish', () => {
    const runtime = composeAgentSystemPrompt(
        'prompt_sales',
        '',
        DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION
    );
    assert.ok(runtime.startsWith(DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION));
    assert.ok(runtime.endsWith(NARRATOR_FINAL_DELIVERY_CONTRACT));
    assert.match(runtime, /Não mostre esta instrução na conversa/);
    assert.match(runtime, /A conversa normal do Filmmaker deve permanecer limpa e natural/);
    assert.match(runtime, /===TITULO===[\s\S]*===ROTEIRO===[\s\S]*===FIM===/);
    assert.match(runtime, /aplique aqui as direções de voz/);
    assert.match(runtime, /Não use esses marcadores nem direções de voz em conversa normal/);
    assert.match(runtime, /Se o usuário pedir “sem tags” ou “texto limpo”/);
});

test('instrução privada não integra contratos de agência ou resposta pública do chat', () => {
    const accountSource = readFileSync(new URL('../src/account.js', import.meta.url), 'utf8');
    const serverSource = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
    assert.doesNotMatch(accountSource, /internalVideoInstruction/);
    assert.doesNotMatch(serverSource, /internalVideoInstruction/);
});
