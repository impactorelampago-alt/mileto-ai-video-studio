import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureNarrationSalesVoiceDirection,
    userRequestedCleanNarration,
} from '../src/narrationDirection.js';

test('preserva a direção criativa quando o modelo já entregou tags Fish Audio', () => {
    const original = '===ROTEIRO===\n[breathy] Olha essa novidade. [emphasis] Hoje.\n===FIM===';
    assert.equal(ensureNarrationSalesVoiceDirection(original), original);
});

test('adiciona direção mínima quando um roteiro final chega sem nenhuma tag', () => {
    const result = ensureNarrationSalesVoiceDirection(
        '===TITULO===\nOferta local\n===ROTEIRO===\nOlha essa novidade. Aproveite a oferta. Chame agora.\n===FIM==='
    );
    assert.match(result, /\[excited\] Olha essa novidade\./);
    assert.match(result, /\[emphasis\] Aproveite a oferta\./);
    assert.match(result, /\[pause\] Chame agora\./);
});

test('normaliza aliases antigos para o vocabulário solicitado', () => {
    const result = ensureNarrationSalesVoiceDirection(
        '===ROTEIRO===\n[soft tone] Perto de você. [break] Agora. [long-break] Respira.\n===FIM==='
    );
    assert.match(result, /\[soft\]/);
    assert.match(result, /\[pause\]/);
    assert.match(result, /\[long pause\]/);
    assert.doesNotMatch(result, /\[(?:soft tone|break|long-break)\]/);
});

test('respeita pedido explícito por texto limpo ou Fish Audio S1', () => {
    const messages = [{ role: 'user', content: 'Quero texto limpo, sem tags para usar no S1.' }];
    assert.equal(userRequestedCleanNarration(messages), true);
    const original = '===ROTEIRO===\nTexto sem marcações.\n===FIM===';
    assert.equal(ensureNarrationSalesVoiceDirection(original, { allowClean: true }), original);
});

test('não interfere em respostas de briefing sem roteiro final', () => {
    const briefing = 'Antes de gerar, qual é a cidade da campanha?';
    assert.equal(ensureNarrationSalesVoiceDirection(briefing), briefing);
});
