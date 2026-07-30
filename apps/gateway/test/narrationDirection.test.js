import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureNarrationSalesVoiceDirection,
    userRequestedCleanNarration,
} from '../src/narrationDirection.js';
import { normalizeSpokenNumbersPtBr } from '../src/spokenNumbers.js';

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

test('converte valores e números apenas no bloco falável do roteiro', () => {
    const result = ensureNarrationSalesVoiceDirection(
        '===TITULO===\nMultifocal por R$199\n===ROTEIRO===\n[excited] Multifocal por R$199 em até 20 segundos.\n===FIM==='
    );
    assert.match(result, /TITULO===\nMultifocal por R\$199/);
    assert.match(result, /cento e noventa e nove reais/);
    assert.match(result, /vinte segundos/);
    assert.doesNotMatch(result.match(/===ROTEIRO===[\s\S]*===FIM===/)[0], /\d/);
});

test('normaliza moeda, percentual, horário e data para fala em português', () => {
    const result = normalizeSpokenNumbersPtBr('R$ 39,90, desconto de 50%, às 9:30 em 30/07/2026.');
    assert.match(result, /trinta e nove reais e noventa centavos/);
    assert.match(result, /cinquenta por cento/);
    assert.match(result, /nove horas e trinta minutos/);
    assert.match(result, /trinta de julho de dois mil e vinte e seis/);
    assert.doesNotMatch(result, /\d/);
});

test('texto limpo continua sem tags, mas nunca envia dígitos ao Fish Audio', () => {
    const original = '===ROTEIRO===\nOferta por R$1.\n===FIM===';
    assert.equal(
        ensureNarrationSalesVoiceDirection(original, { allowClean: true }),
        '===ROTEIRO===\nOferta por um real.\n===FIM==='
    );
});
