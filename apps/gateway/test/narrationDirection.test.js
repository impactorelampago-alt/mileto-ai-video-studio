import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureNarrationSalesVoiceDirection,
    formatNarrationParagraphs,
    userRequestedCleanNarration,
} from '../src/narrationDirection.js';
import { normalizeSpokenNumbersPtBr } from '../src/spokenNumbers.js';
import { normalizeSpokenPronunciationPtBr } from '../src/spokenPronunciation.js';

test('preserva a direção criativa quando o modelo já entregou tags Fish Audio', () => {
    const original = '===ROTEIRO===\n[breathy] Olha essa novidade. [emphasis] Hoje.\n===FIM===';
    assert.equal(ensureNarrationSalesVoiceDirection(original), original);
});

test('não injeta direção criativa quando um roteiro final chega sem tags', () => {
    const original = '===TITULO===\nOferta local\n===ROTEIRO===\nOlha essa novidade. Aproveite a oferta. Chame agora.\n===FIM===';
    const result = ensureNarrationSalesVoiceDirection(original);
    assert.equal(result, original);
    assert.doesNotMatch(result, /\[(?:excited|emphasis|pause)\]/);
});

test('preserva aliases e direções naturais sem reescrever ou injetar fallback', () => {
    const result = ensureNarrationSalesVoiceDirection(
        '===ROTEIRO===\n[warm and reassuring] Perto de você. [break] Agora. [long-break] Respira.\n===FIM==='
    );
    assert.match(result, /\[warm and reassuring\]/);
    assert.match(result, /\[break\]/);
    assert.match(result, /\[long-break\]/);
    assert.doesNotMatch(result, /\[excited\]/);
});

test('remove direção natural terminal sem mover seu sentido para a frase anterior', () => {
    const result = ensureNarrationSalesVoiceDirection(
        '===ROTEIRO===\nChama no WhatsApp e agende seu exame grátis! [emphasis] Ótica Reis, a sua escolha certa em Piracicaba! [soft]\n===FIM==='
    );

    assert.match(result, /\[emphasis\] Ótica Reis/);
    assert.doesNotMatch(result, /\[soft\]/);
    assert.doesNotMatch(result, /\[[a-z][a-z '-]{0,63}\]\s*===\s*FIM/i);
    assert.match(result, /Piracicaba!\s*===FIM===/);
});

test('remove toda a sequência de direções órfãs no fim e preserva colchete editorial', () => {
    const orphaned = ensureNarrationSalesVoiceDirection(
        '===ROTEIRO===\n[emphasis] Oferta válida hoje. [soft] [long pause]\n===FIM==='
    );
    const editorial = ensureNarrationSalesVoiceDirection(
        '===ROTEIRO===\n[emphasis] Oferta válida hoje [Oferta]\n===FIM==='
    );
    const punctuation = ensureNarrationSalesVoiceDirection(
        '===ROTEIRO===\n[emphasis] Oferta válida hoje [soft].\n===FIM==='
    );

    assert.equal(orphaned, '===ROTEIRO===\n[emphasis] Oferta válida hoje.\n===FIM===');
    assert.match(editorial, /hoje \[Oferta\]\s*===FIM===/);
    assert.equal(punctuation, '===ROTEIRO===\n[emphasis] Oferta válida hoje.\n===FIM===');
});

test('preserva direção no fim de um parágrafo quando ainda existe texto para controlar', () => {
    const result = ensureNarrationSalesVoiceDirection(
        '===ROTEIRO===\n[emphasis] Primeira frase. [soft]\n\nSegunda frase.\n===FIM==='
    );

    assert.match(result, /\[soft\]\n\nSegunda frase/);
});

test('respeita pedido explícito por texto limpo ou Fish Audio S1', () => {
    const messages = [{ role: 'user', content: 'Quero texto limpo, sem tags para usar no S1.' }];
    assert.equal(userRequestedCleanNarration(messages), true);
    const original = '===ROTEIRO===\nTexto sem marcações.\n===FIM===';
    assert.equal(ensureNarrationSalesVoiceDirection(original, { allowClean: true }), original);
});

test('modo clean remove qualquer direção natural, inclusive aliases', () => {
    const result = ensureNarrationSalesVoiceDirection(
        '===ROTEIRO===\n[warm and reassuring] Texto. [break] Agora.\n===FIM===',
        { allowClean: true }
    );
    assert.equal(result, '===ROTEIRO===\nTexto. Agora.\n===FIM===');
});

test('não interfere em respostas de briefing sem roteiro final', () => {
    const briefing = 'Antes de gerar, qual é a cidade da campanha?';
    assert.equal(ensureNarrationSalesVoiceDirection(briefing), briefing);
});

test('mantém valores humanos no texto visível; normalização pertence somente ao TTS', () => {
    const result = ensureNarrationSalesVoiceDirection(
        '===TITULO===\nMultifocal por R$199\n===ROTEIRO===\n[excited] Multifocal por R$199 em até 20 segundos.\n===FIM==='
    );
    assert.match(result, /TITULO===\nMultifocal por R\$199/);
    assert.match(result, /R\$199/);
    assert.match(result, /20 segundos/);
});

test('normaliza moeda, percentual, horário e data para fala em português', () => {
    const result = normalizeSpokenNumbersPtBr('R$ 39,90, desconto de 50%, às 9:30 em 30/07/2026.');
    assert.match(result, /trinta e nove reais e noventa centavos/);
    assert.match(result, /cinquenta por cento/);
    assert.match(result, /nove horas e trinta minutos/);
    assert.match(result, /trinta de julho de dois mil e vinte e seis/);
    assert.doesNotMatch(result, /\d/);
});

test('texto limpo do chat preserva o valor humano sem antecipar a síntese', () => {
    const original = '===ROTEIRO===\nOferta por R$1.\n===FIM===';
    assert.equal(
        ensureNarrationSalesVoiceDirection(original, { allowClean: true }),
        '===ROTEIRO===\nOferta por R$1.\n===FIM==='
    );
});

test('organiza pausas da narração em parágrafos sem alterar o texto falado', () => {
    assert.equal(
        formatNarrationParagraphs('[excited] Gancho. [pause] Oferta e benefício. [long pause] CTA.'),
        '[excited] Gancho. [pause]\n\nOferta e benefício. [long pause]\n\nCTA.'
    );
});

test('corrige somente a pronúncia enviada ao Fish Audio', () => {
    assert.equal(
        normalizeSpokenPronunciationPtBr('Atendimento em Araçariguama e Sorocaba.'),
        'Atendimento em Araçari-guama e Sorocaba.'
    );
});

test('modo clean preserva colchetes editoriais que não são direções', () => {
    const result = ensureNarrationSalesVoiceDirection(
        '===ROTEIRO===\n[warm] Oferta [2026] da campanha [Oferta].\n===FIM===',
        { allowClean: true }
    );
    assert.equal(result, '===ROTEIRO===\nOferta [2026] da campanha [Oferta].\n===FIM===');
});
