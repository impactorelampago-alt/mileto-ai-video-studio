import assert from 'node:assert/strict';
import test from 'node:test';
import {
    cleanFinalNarration,
    prepareOpsExportMetadata,
    summarizeFinalNarration,
} from '../src/services/opsExportMetadata';

test('resume somente a narração final e preserva marca, preço, condição e CTA', () => {
    const narration = '[excited] Na Ótica Reis, o segundo óculos é grátis até sábado. '
        + 'A condição vale na compra do primeiro par completo. [pause] Clique no botão e fale com a equipe.';

    assert.equal(
        cleanFinalNarration(narration),
        'Na Ótica Reis, o segundo óculos é grátis até sábado. A condição vale na compra do primeiro par completo. Clique no botão e fale com a equipe.'
    );
    assert.equal(
        summarizeFinalNarration(narration),
        'Na Ótica Reis, o segundo óculos é grátis até sábado. A condição vale na compra do primeiro par completo. Clique no botão e fale com a equipe.'
    );
});

test('limita a descrição a três frases e prioriza oferta e chamada para ação', () => {
    const narration = 'A Ótica Reis apresenta sua nova campanha. '
        + 'A loja possui vários modelos. O atendimento é feito pela equipe. '
        + 'Os óculos completos saem a partir de R$ 199,00. Clique no botão e fale no WhatsApp.';

    assert.equal(
        summarizeFinalNarration(narration),
        'A Ótica Reis apresenta sua nova campanha. Os óculos completos saem a partir de R$ 199,00. Clique no botão e fale no WhatsApp.'
    );
});

test('monta payload editorial com título atual e permite revisão antes do upload', () => {
    const metadata = prepareOpsExportMetadata({
        projectId: 'project-123',
        projectTitle: '  Segundo   óculos grátis  ',
        narrationText: 'Óculos completo a partir de R$ 199,00. Clique no botão para falar no WhatsApp.',
        title: '  Segundo óculos grátis — versão aprovada  ',
        description: '  Oferta de óculos completo por R$ 199,00.   Chamada para falar no WhatsApp. ',
    });

    assert.deepEqual(metadata, {
        title: 'Segundo óculos grátis — versão aprovada',
        description: 'Oferta de óculos completo por R$ 199,00. Chamada para falar no WhatsApp.',
        narrationSummary: 'Óculos completo a partir de R$ 199,00. Clique no botão para falar no WhatsApp.',
        sourceProjectId: 'project-123',
        sourceProjectTitle: 'Segundo óculos grátis',
    });
});

test('sem narração cria descrição objetiva sem inventar oferta', () => {
    const metadata = prepareOpsExportMetadata({
        projectId: 'project-silent',
        projectTitle: 'Tour da loja',
        narrationText: '',
        mediaTakeCount: 4,
    });

    assert.equal(metadata.title, 'Tour da loja');
    assert.equal(metadata.description, 'Vídeo do projeto “Tour da loja”, composto por 4 takes visuais e sem narração.');
    assert.equal(metadata.narrationSummary, metadata.description);
});

test('rejeita título e descrição vazios na revisão', () => {
    assert.throws(() => prepareOpsExportMetadata({
        projectId: 'project-123',
        projectTitle: 'Projeto válido',
        narrationText: 'Uma narração válida.',
        title: '   ',
        description: '   ',
    }), /title é obrigatório/);
});
