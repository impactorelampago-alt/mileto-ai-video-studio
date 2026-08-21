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
    NARRATION_SALES_SYSTEM_PROMPT_V9,
    NARRATOR_FINAL_DELIVERY_CONTRACT,
} from '../src/agentDefaults.js';
const { composeAgentSystemPrompt, normalizeAgentConfig } = await import('../src/settings.js');

test('mantém exatamente o bloco Fish Audio aprovado como default privado', () => {
    assert.equal(DEFAULT_AGENT_CONFIGS.prompt_sales.systemPrompt, NARRATION_SALES_SYSTEM_PROMPT_V9);
    assert.equal(
        DEFAULT_AGENT_CONFIGS.prompt_sales.internalVideoInstruction,
        DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION
    );
    assert.equal(DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION.length, 683);
    assert.equal(
        createHash('sha256').update(DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION, 'utf8').digest('hex'),
        'a1b6caa9ac5b3d4c8566e5d867a40d4189afd285ffe2e9cfd5379ee2e637993c'
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
        NARRATION_SALES_SYSTEM_PROMPT_V9,
        DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION
    );
    assert.ok(runtime.startsWith(NARRATION_SALES_SYSTEM_PROMPT_V9));
    assert.ok(runtime.indexOf(NARRATION_SALES_SYSTEM_PROMPT_V9) < runtime.indexOf(DEFAULT_NARRATOR_INTERNAL_VIDEO_INSTRUCTION));
    assert.ok(runtime.endsWith(NARRATOR_FINAL_DELIVERY_CONTRACT));
    assert.match(runtime, /Nunca em conversa, briefing/);
    assert.match(runtime, /o Fish fala isso em voz alta/);
    assert.match(runtime, /Pausa = pontuação/);
    assert.match(runtime, /===TITULO===[\s\S]*===ROTEIRO===[\s\S]*===FIM===/);
    assert.match(runtime, /aplique aqui as direções de voz/);
    assert.match(runtime, /Não use esses marcadores nem direções de voz em conversa normal/);
    assert.match(runtime, /Se pedirem "sem tags", entregue limpo/);
    assert.match(runtime, /não executa trabalho em segundo plano/i);
    assert.match(runtime, /conclua o trabalho na mesma resposta/i);
    assert.match(runtime, /só um instante/i);
    assert.match(runtime, /Informações opcionais ausentes não impedem uma primeira versão/i);
});

test('instrução privada não integra contratos de agência ou resposta pública do chat', () => {
    const accountSource = readFileSync(new URL('../src/account.js', import.meta.url), 'utf8');
    const serverSource = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
    assert.doesNotMatch(accountSource, /internalVideoInstruction/);
    assert.doesNotMatch(serverSource, /internalVideoInstruction/);
});
