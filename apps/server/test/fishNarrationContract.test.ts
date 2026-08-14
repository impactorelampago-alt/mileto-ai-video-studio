import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FISH_DIRECTION_CONTRACT_VERSION,
    NarrationContractError,
    OPS_NARRATION_DIALECT,
    prepareNarrationContract,
} from '../src/services/fishNarrationContract';

const prepare = (overrides: Record<string, unknown> = {}) => prepareNarrationContract({
    provider: 'fishAudio',
    narrationPlainText: 'Conheca nossa oferta hoje.',
    narrationSynthesisText: '[excited] Conheca nossa oferta hoje.',
    ttsModel: 's2.1-pro',
    directionMode: 'manual',
    directionVersion: FISH_DIRECTION_CONTRACT_VERSION,
    structured: true,
    ...overrides,
});

test('preserva tags S2.1 Pro e descricoes naturais ate o texto final', () => {
    const result = prepare({
        narrationPlainText: 'Cuide da sua visao com tranquilidade.',
        narrationSynthesisText: '[warm and reassuring] Cuide da sua visao com tranquilidade.',
    });

    assert.equal(result.ttsModel, 's2.1-pro');
    assert.equal(
        result.narrationSynthesisText,
        '[warm and reassuring] Cuide da sua visao com tranquilidade.',
    );
    assert.deepEqual(result.directions, ['warm and reassuring']);
});

test('automatic injeta direcoes naturais sem alterar o texto humano', () => {
    const plain = 'Voce sabia desta novidade? Aproveite a oferta. Fale conosco hoje.';
    const result = prepare({
        narrationPlainText: plain,
        narrationSynthesisText: plain,
        directionMode: 'automatic',
    });

    assert.equal(result.narrationPlainText, plain);
    assert.match(result.narrationSynthesisText, /^\[curious and inviting\]/);
    assert.match(result.narrationSynthesisText, /\[clear and informative\]/);
    assert.match(result.narrationSynthesisText, /\[confident\]/);
});

test('automatic usa budget editorial moderado em roteiro longo', () => {
    const plain = Array.from({ length: 8 }, (_, index) => `Frase ${index + 1}.`).join(' ');
    const result = prepare({
        narrationPlainText: plain,
        narrationSynthesisText: plain,
        directionMode: 'automatic',
    });
    assert.equal(result.directions.length, 5);
    assert.equal(result.narrationPlainText, plain);
});

test('projeto real de Piracicaba migra manual sem tags e recebe direcoes avancadas validas', () => {
    const plain = 'Se você mora em Piracicaba e está precisando de óculos multifocais, preste atenção nesta oferta que só a Ótica Reis tem para você!\n\nA partir de cento e noventa e nove reais, você leva seu óculos completo, com armação e lente, e ainda ganha o exame totalmente por nossa conta.\n\nE o melhor: temos mais de seiscentas armações para você escolher do jeitinho que gosta.\n\nMas corra, porque essa promoção vai só até sábado! Não deixe para depois e garanta já seu óculos novo com qualidade e preço que cabe no seu bolso.\n\nChama no WhatsApp da Ótica Reis agora mesmo e agende seu exame sem custo! Seu olhar merece o melhor.';
    const result = prepare({
        narrationPlainText: plain,
        narrationSynthesisText: plain,
        directionMode: 'manual',
        protectedTerms: ['Ótica Reis'],
    });

    assert.equal(result.directionMode, 'automatic');
    assert.equal(result.narrationPlainText, plain);
    assert.deepEqual(result.directions, [
        'curious and inviting',
        'clear and informative',
        'confident',
        'warm and reassuring',
        'confident and inviting',
    ]);
    assert.match(result.narrationSynthesisText, /^\[curious and inviting\]/);
    assert.match(result.narrationSynthesisText, /\[confident and inviting\] Seu olhar merece o melhor\.$/);
});

test('modo clean remove direcoes e modelos incompatíveis nao recebem tags', () => {
    const clean = prepare({ directionMode: 'clean' });
    assert.equal(clean.narrationSynthesisText, 'Conheca nossa oferta hoje.');
    assert.equal(clean.directionMode, 'clean');

    const s1 = prepare({ ttsModel: 's1', directionMode: 'automatic' });
    assert.equal(s1.narrationSynthesisText, 'Conheca nossa oferta hoje.');
    assert.equal(s1.directionMode, 'clean');
});

test('modelo ausente usa s2.1-pro e projeto antigo explicito preserva seu modelo', () => {
    assert.equal(prepare({ ttsModel: undefined }).ttsModel, 's2.1-pro');
    assert.equal(prepare({ ttsModel: 's2-pro' }).ttsModel, 's2-pro');
});

test('ElevenLabs usa seu modelo proprio e recebe texto limpo', () => {
    const result = prepareNarrationContract({
        provider: 'elevenLabs',
        narrationPlainText: 'Uma narracao limpa.',
        narrationSynthesisText: '[warm and reassuring] Uma narracao limpa.',
        directionMode: 'automatic',
        structured: true,
    });

    assert.equal(result.ttsModel, 'eleven_multilingual_v2');
    assert.equal(result.directionMode, 'clean');
    assert.equal(result.narrationSynthesisText, 'Uma narracao limpa.');
});

test('modelo invalido ou modelos conflitantes falham sem fallback', () => {
    assert.throws(
        () => prepare({ ttsModel: 'modelo-inexistente' }),
        (error: unknown) => error instanceof NarrationContractError && error.code === 'TTS_MODEL_UNAVAILABLE',
    );
    assert.throws(
        () => prepare({ ttsModel: 's2.1-pro', voiceSettingsModel: 's2-pro' }),
        (error: unknown) => error instanceof NarrationContractError && error.code === 'TTS_MODEL_CONFLICT',
    );
});

test('rejeita tags dentro de preco, endereco e nome protegido', () => {
    const cases = [
        {
            narrationPlainText: 'Apenas R$ 199 hoje.',
            narrationSynthesisText: 'Apenas R$ [emphasis] 199 hoje.',
        },
        {
            narrationPlainText: 'Visite a Rua Jose Bonifacio, 10.',
            narrationSynthesisText: 'Visite a Rua Jose [confident] Bonifacio, 10.',
        },
        {
            narrationPlainText: 'Visite a Otica Reis hoje.',
            narrationSynthesisText: 'Visite a Otica [excited] Reis hoje.',
            protectedTerms: ['Otica Reis'],
        },
    ];

    for (const value of cases) {
        assert.throws(
            () => prepare(value),
            (error: unknown) => error instanceof NarrationContractError
                && error.code === 'TTS_DIRECTION_INSIDE_PROTECTED_TEXT',
        );
    }
});

test('rejeita colchetes desbalanceados, apenas tags e divergencia de textos', () => {
    assert.throws(
        () => prepare({ narrationSynthesisText: '[excited Conheca nossa oferta hoje.' }),
        (error: unknown) => error instanceof NarrationContractError && error.code === 'TTS_DIRECTIONS_UNBALANCED',
    );
    assert.throws(
        () => prepare({ narrationPlainText: '', narrationSynthesisText: '[excited]' }),
        (error: unknown) => error instanceof NarrationContractError && error.code === 'TTS_NARRATION_EMPTY',
    );
    assert.throws(
        () => prepare({ narrationSynthesisText: '[excited] Um texto diferente.' }),
        (error: unknown) => error instanceof NarrationContractError && error.code === 'TTS_TEXT_MISMATCH',
    );
});

test('recupera direção terminal órfã antes da síntese sem alterar tags válidas', () => {
    const plain = 'Chama no WhatsApp! Ótica Reis, a sua escolha certa em Piracicaba!';
    const result = prepare({
        narrationPlainText: plain,
        narrationSynthesisText: '[excited] Chama no WhatsApp! [emphasis] Ótica Reis, a sua escolha certa em Piracicaba! [soft]',
        protectedTerms: ['Ótica Reis'],
    });

    assert.equal(
        result.narrationSynthesisText,
        '[excited] Chama no WhatsApp! [emphasis] Ótica Reis, a sua escolha certa em Piracicaba!',
    );
    assert.deepEqual(result.directions, ['excited', 'emphasis']);
});

test('preserva pontuação ao remover direção órfã colocada antes dela', () => {
    const result = prepare({
        narrationPlainText: 'Conheca nossa oferta hoje.',
        narrationSynthesisText: '[excited] Conheca nossa oferta hoje [soft].',
    });
    assert.equal(result.narrationSynthesisText, '[excited] Conheca nossa oferta hoje.');
});

test('mantem paragrafos no texto limpo e normaliza fala somente no texto de sintese', () => {
    const result = prepare({
        narrationPlainText: 'Oferta de R$ 199,00.\n\nLigue agora.',
        narrationSynthesisText: '[confident] Oferta de R$ 199,00.\n\n[warm and reassuring] Ligue agora.',
    });

    assert.equal(result.narrationPlainText, 'Oferta de R$ 199,00.\n\nLigue agora.');
    assert.match(result.narrationSynthesisText, /cento e noventa e nove reais/i);
    assert.match(result.narrationSynthesisText, /\[warm and reassuring\]/);
});

test('preserva colchetes editoriais no Fish, clean, ElevenLabs e S1', () => {
    const plain = 'Oferta [2026] da campanha [Oferta].';
    const manual = prepare({
        narrationPlainText: plain,
        narrationSynthesisText: `[confident] ${plain}`,
    });
    assert.equal(manual.narrationPlainText, plain);
    assert.equal(manual.narrationSynthesisText, `[confident] ${plain}`);

    const clean = prepare({
        narrationPlainText: plain,
        narrationSynthesisText: `[warm] ${plain}`,
        directionMode: 'clean',
    });
    assert.equal(clean.narrationSynthesisText, plain);

    const eleven = prepareNarrationContract({
        provider: 'elevenLabs',
        narrationPlainText: plain,
        narrationSynthesisText: `[warm] ${plain}`,
        directionMode: 'automatic',
        structured: true,
    });
    assert.equal(eleven.narrationSynthesisText, plain);

    const s1 = prepare({
        narrationPlainText: plain,
        narrationSynthesisText: `[warm] ${plain}`,
        ttsModel: 's1',
        directionMode: 'automatic',
    });
    assert.equal(s1.narrationSynthesisText, plain);
});

test('refazer sintese e idempotente com moeda, data e percentual por extenso', () => {
    const plain = 'Oferta de R$ 199,00 com 20% ate 13/08/2026.';
    const first = prepare({
        narrationPlainText: plain,
        narrationSynthesisText: `[confident] ${plain}`,
    });
    const second = prepare({
        narrationPlainText: first.narrationPlainText,
        narrationSynthesisText: first.narrationSynthesisText,
        ttsModel: first.ttsModel,
        directionMode: first.directionMode,
        directionVersion: first.directionVersion,
    });

    assert.equal(second.narrationPlainText, plain);
    assert.equal(second.narrationSynthesisText, first.narrationSynthesisText);
});

test('dialeto explicito do Ops trata qualquer colchete balanceado como direcao', () => {
    const result = prepare({
        narrationPlainText: 'Oferta exclusiva.',
        narrationSynthesisText: '[as if sharing a secret, with rising energy!] Oferta [2026] exclusiva.',
        narrationDialect: OPS_NARRATION_DIALECT,
    });
    assert.equal(result.narrationDialect, OPS_NARRATION_DIALECT);
    assert.deepEqual(result.directions, ['as if sharing a secret, with rising energy!', '2026']);
    assert.equal(
        result.narrationSynthesisText,
        '[as if sharing a secret, with rising energy!] Oferta [2026] exclusiva.',
    );
});
