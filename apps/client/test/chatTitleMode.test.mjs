import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyChatTitleModeIntent } from '../src/lib/chatTitleMode.ts';

test('proposta ativa trata instruções curtas como refinamento de títulos', () => {
    assert.equal(classifyChatTitleModeIntent('Mantém R$ 199 e Piracicaba, tira o quinto'), 'refine_titles');
    assert.equal(classifyChatTitleModeIntent('Faltou um CTA e quero o preço mais direto'), 'refine_titles');
    assert.equal(classifyChatTitleModeIntent('Ajuste os títulos da narração'), 'refine_titles');
    assert.equal(classifyChatTitleModeIntent('Use um trecho da narração no título'), 'refine_titles');
    assert.equal(classifyChatTitleModeIntent('Não mude a narração, só os títulos'), 'refine_titles');
    assert.equal(classifyChatTitleModeIntent('Não quero outra narração, ajuste apenas os títulos'), 'refine_titles');
});

test('pedido explícito de narração sai do planejamento e volta ao Narrador', () => {
    assert.equal(classifyChatTitleModeIntent('Quero fazer outra narração'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Ajusta a narração que já temos'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Refaça o roteiro com um tom mais calmo'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Voltar ao Narrador e fazer outra narração'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Não quero mais títulos, ajuste a narração atual'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Quero trocar a voz para Locutor Rádio'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Faz estilo locutor de rádio'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Coloque uma pausa antes do preço'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Deixe a voz mais quente'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Remova essa pausa'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Sem tags'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Não quero mais títulos, troque a voz'), 'narrator');
    assert.equal(classifyChatTitleModeIntent('Tire a palavra pausa do título'), 'refine_titles');
});

test('comando de saída encerra o contexto sem virar uma mensagem para a IA', () => {
    assert.equal(classifyChatTitleModeIntent('Sair do ajuste de títulos'), 'exit_title_mode');
    assert.equal(classifyChatTitleModeIntent('Voltar ao Narrador'), 'exit_title_mode');
    assert.equal(classifyChatTitleModeIntent('Encerre os títulos'), 'exit_title_mode');
    assert.equal(classifyChatTitleModeIntent('Cancele o ajuste de títulos'), 'exit_title_mode');
    assert.equal(classifyChatTitleModeIntent('Saia dos títulos'), 'exit_title_mode');
    assert.equal(classifyChatTitleModeIntent('Volte ao Narrador'), 'exit_title_mode');
});
