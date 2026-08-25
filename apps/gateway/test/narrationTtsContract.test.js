import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    OPS_NARRATION_DIALECT,
    prepareTtsRequest,
    sanitizeDirectionVersion,
} from '../src/narrationTtsContract.js';
import { resolveFishTtsModel, resolveTtsModelFromPayload } from '../src/ttsModels.js';

const structuredPayload = (overrides = {}) => ({
    provider: 'fishAudio',
    voiceId: 'voice-1',
    narrationPlainText: 'Cuide hoje da sua visão.',
    narrationSynthesisText: '[warm and reassuring] Cuide hoje da sua visão.',
    ttsModel: 's2.1-pro',
    directionMode: 'automatic',
    directionVersion: 'fish-s2.1-natural-v1',
    ...overrides,
});

test('payload estruturado preserva texto limpo e texto de síntese separadamente', () => {
    const payload = structuredPayload();
    const result = prepareTtsRequest(payload);
    assert.equal(result.narrationPlainText, payload.narrationPlainText);
    assert.equal(result.spokenText, payload.narrationSynthesisText);
    assert.equal(result.directionMode, 'automatic');
    assert.equal(result.directionVersion, 'fish-s2.1-natural-v1');
    assert.equal(result.model, 's2.1-pro');
});

test('descrição natural não documentada em allowlist permanece aceita', () => {
    const natural = '[curious and warmly inviting] Será que chegou sua hora?';
    assert.equal(
        prepareTtsRequest(structuredPayload({
            narrationPlainText: 'Será que chegou sua hora?',
            narrationSynthesisText: natural,
        })).spokenText,
        natural
    );
});

test('direção precisa ser descrição natural curta em inglês', () => {
    assert.throws(
        () => prepareTtsRequest(structuredPayload({ narrationSynthesisText: '[ênfase suave] Cuide hoje da sua visão.' })),
        (error) => error.code === 'narration_direction_invalid'
    );
    assert.throws(
        () => prepareTtsRequest(structuredPayload({ narrationSynthesisText: `[${'warm '.repeat(20)}] Cuide hoje da sua visão.` })),
        (error) => error.code === 'narration_direction_invalid'
    );
});

test('pedido sem tags usa modo clean sem injetar direções', () => {
    const clean = 'Cuide hoje da sua visão.';
    const result = prepareTtsRequest(structuredPayload({
        narrationSynthesisText: clean,
        directionMode: 'clean',
    }));
    assert.equal(result.spokenText, clean);
    assert.doesNotMatch(result.spokenText, /\[[^\]]+\]/);
});

test('ElevenLabs e Fish S1 rejeitam modo dirigido ou tags antes da cobrança', () => {
    const elevenClean = structuredPayload({
        provider: 'elevenLabs',
        ttsModel: 'eleven_multilingual_v2',
        narrationSynthesisText: 'Cuide hoje da sua visão.',
        directionMode: 'clean',
    });
    assert.equal(prepareTtsRequest(elevenClean).model, 'eleven_multilingual_v2');

    for (const payload of [
        { ...elevenClean, directionMode: 'manual' },
        { ...elevenClean, narrationSynthesisText: '[warm] Cuide hoje da sua visão.' },
        structuredPayload({
            ttsModel: 's1',
            voiceSettings: { fishModel: 's1' },
            narrationSynthesisText: 'Cuide hoje da sua visão.',
            directionMode: 'manual',
        }),
        structuredPayload({
            ttsModel: 's1',
            voiceSettings: { fishModel: 's1' },
            narrationSynthesisText: '[warm] Cuide hoje da sua visão.',
            directionMode: 'clean',
        }),
    ]) {
        assert.throws(
            () => prepareTtsRequest(payload),
            (error) => error.code === 'narration_direction_mode_incompatible'
                || error.code === 'narration_directions_unsupported'
        );
    }
});

test('payload legado limpa direções para ElevenLabs e S1, preservando S2', () => {
    const legacyText = '[warm and reassuring] Texto comercial.';
    assert.equal(prepareTtsRequest({
        provider: 'elevenLabs',
        text: legacyText,
        voiceSettings: { model: 'eleven_multilingual_v2' },
    }).spokenText, 'Texto comercial.');
    assert.equal(prepareTtsRequest({
        provider: 'fishAudio',
        text: legacyText,
        voiceSettings: { fishModel: 's1' },
    }).spokenText, 'Texto comercial.');
    assert.equal(prepareTtsRequest({
        provider: 'fishAudio',
        text: legacyText,
        voiceSettings: { fishModel: 's2-pro' },
    }).spokenText, legacyText);
});

test('projeto antigo preserva modelo salvo e campo ausente usa s2.1-pro', () => {
    assert.equal(resolveTtsModelFromPayload('fishAudio', { voiceSettings: { fishModel: 's1' } }), 's1');
    assert.equal(resolveTtsModelFromPayload('fishAudio', {}), 's2.1-pro');
});

test('modelo conhecido mas configurado como indisponível falha sem fallback', () => {
    assert.throws(
        () => resolveFishTtsModel('s2-pro', { availableModels: new Set(['s2.1-pro']) }),
        (error) => error.code === 'tts_model_unavailable' && /s2-pro/.test(error.message)
    );
    assert.throws(
        () => resolveFishTtsModel(undefined, { availableModels: new Set(['s1']) }),
        (error) => error.code === 'tts_model_unavailable' && /s2\.1-pro/.test(error.message)
    );
    assert.throws(
        () => prepareTtsRequest(structuredPayload({ ttsModel: 'modelo-inventado' })),
        (error) => error.code === 'tts_model_unavailable' && /modelo-inventado/.test(error.message)
    );
});

test('direções malformadas e texto só com tags falham', () => {
    assert.throws(
        () => prepareTtsRequest(structuredPayload({ narrationSynthesisText: '[excited Texto' })),
        (error) => error.code === 'narration_directions_invalid'
    );
    assert.throws(
        () => prepareTtsRequest(structuredPayload({ narrationSynthesisText: '[excited] [pause]' })),
        (error) => error.code === 'narration_tags_only'
            || error.code === 'narration_direction_without_target'
    );
    assert.throws(
        () => prepareTtsRequest({ provider: 'fishAudio', text: '[warm Texto' }),
        (error) => error.code === 'narration_directions_invalid'
    );
});

test('recupera direção terminal órfã antes da cobrança e preserva tags válidas', () => {
    const plain = 'Chama no WhatsApp! Ótica Reis, a sua escolha certa em Piracicaba!';
    const result = prepareTtsRequest(structuredPayload({
        narrationPlainText: plain,
        narrationSynthesisText: '[excited] Chama no WhatsApp! [emphasis] Ótica Reis, a sua escolha certa em Piracicaba! [soft]',
        protectedTerms: ['Ótica Reis'],
    }));

    assert.equal(result.model, 's2.1-pro');
    assert.equal(
        result.spokenText,
        '[excited] Chama no WhatsApp! [emphasis] Ótica Reis, a sua escolha certa em Piracicaba!'
    );
});

test('preserva pontuação ao remover direção órfã e recupera payload legado', () => {
    assert.equal(
        prepareTtsRequest(structuredPayload({
            narrationPlainText: 'Compre hoje.',
            narrationSynthesisText: '[excited] Compre hoje [soft].',
        })).spokenText,
        '[excited] Compre hoje.'
    );
    assert.equal(
        prepareTtsRequest({ provider: 'fishAudio', text: '[excited] Compre hoje. [soft]' }).spokenText,
        '[excited] Compre hoje.'
    );
});

test('automatic recupera tag órfã antes do ponto sem perder direções válidas', () => {
    const synthesis = '[curious] Na Ótica Luz, em Rio das Ostras, você encontra óculos completo, armação mais lente, a partir de 149 reais [emphasis]. [confident] E tem mais: o exame é por nossa conta.';
    const plain = synthesis.replace(/\[[a-z][a-z '\-]{0,63}\]/g, ' ').replace(/[ \t]+/g, ' ').trim();
    const result = prepareTtsRequest(structuredPayload({
        narrationPlainText: plain,
        narrationSynthesisText: synthesis,
        directionMode: 'automatic',
        protectedTerms: ['Ótica Luz'],
    }));

    assert.equal(plain.includes('149 reais .'), true, 'reproduz a marca visível no print');
    assert.doesNotMatch(result.spokenText, /\[emphasis\]\s*\./);
    assert.match(result.spokenText, /^\[curious\]/);
    assert.match(result.spokenText, /\[confident\] E tem mais/);
});

test('manual continua rejeitando tag órfã no meio do roteiro', () => {
    assert.throws(
        () => prepareTtsRequest(structuredPayload({
            narrationPlainText: 'Oferta por 149 reais . Depois aproveite.',
            narrationSynthesisText: '[curious] Oferta por 149 reais [emphasis]. Depois aproveite.',
            directionMode: 'manual',
        })),
        (error) => error.code === 'narration_direction_without_target'
    );
});

test('borda migra manual ou automatic sem tags no S2.1 Pro e injeta direcoes avancadas', () => {
    const plain = 'Se você mora em Piracicaba e está precisando de óculos multifocais, preste atenção nesta oferta que só a Ótica Reis tem para você!\n\nA partir de cento e noventa e nove reais, você leva seu óculos completo, com armação e lente, e ainda ganha o exame totalmente por nossa conta.\n\nE o melhor: temos mais de seiscentas armações para você escolher do jeitinho que gosta.\n\nMas corra, porque essa promoção vai só até sábado! Não deixe para depois e garanta já seu óculos novo com qualidade e preço que cabe no seu bolso.\n\nChama no WhatsApp da Ótica Reis agora mesmo e agende seu exame sem custo! Seu olhar merece o melhor.';
    for (const directionMode of ['manual', 'automatic']) {
        const result = prepareTtsRequest(structuredPayload({
            narrationPlainText: plain,
            narrationSynthesisText: plain,
            directionMode,
            protectedTerms: ['Ótica Reis'],
        }));
        assert.equal(result.directionMode, 'automatic');
        assert.match(result.spokenText, /^\[curious and inviting\]/);
        assert.match(result.spokenText, /\[clear and informative\]/);
        assert.match(result.spokenText, /\[confident\]/);
        assert.match(result.spokenText, /\[warm and reassuring\]/);
        assert.match(result.spokenText, /\[confident and inviting\] Seu olhar merece o melhor\.$/);
    }
});

test('qualquer campo estruturado exige o contrato completo', () => {
    assert.throws(
        () => prepareTtsRequest({
            provider: 'fishAudio',
            text: '[warm] Texto.',
            narrationPlainText: 'Texto.',
            directionMode: 'clean',
            directionVersion: 'fish-s2.1-natural-v1',
        }),
        (error) => error.code === 'narration_synthesis_text_required'
    );
});

test('texto limpo e síntese precisam ser equivalentes ignorando tags e normalização pt-BR', () => {
    const result = prepareTtsRequest(structuredPayload({
        narrationPlainText: 'Oferta por R$ 199.',
        narrationSynthesisText: '[confident] Oferta por cento e noventa e nove reais.',
    }));
    assert.equal(result.spokenText, '[confident] Oferta por cento e noventa e nove reais.');
    assert.throws(
        () => prepareTtsRequest(structuredPayload({ narrationSynthesisText: '[confident] Outro texto.' })),
        (error) => error.code === 'narration_text_mismatch'
    );
    assert.throws(
        () => prepareTtsRequest(structuredPayload({
            narrationPlainText: 'Oferta por R$ 199.',
            narrationSynthesisText: '[confident] Oferta por cento e noventa e nove [emphasis] reais.',
            directionMode: 'manual',
        })),
        (error) => error.code === 'narration_direction_inside_protected_value'
    );
});

test('rejeita direções inseridas dentro de preços, telefones, nomes e endereços', () => {
    const invalid = [
        '[excited] Por R$ [emphasis] 199.',
        '[excited] Ligue 11 [pause] 99999-9999.',
        '[excited] Fale com Maria [warm] Silva.',
        '[excited] Visite a Rua [pause] XV de Novembro.',
    ];
    for (const narrationSynthesisText of invalid) {
        assert.throws(
            () => prepareTtsRequest(structuredPayload({ narrationSynthesisText })),
            (error) => error.code === 'narration_direction_inside_protected_value'
        );
    }
    assert.throws(
        () => prepareTtsRequest(structuredPayload({
            narrationPlainText: 'Visite a Ótica Reis hoje.',
            narrationSynthesisText: '[excited] Visite a Ótica [emphasis] Reis hoje.',
            protectedTerms: ['Ótica Reis'],
        })),
        (error) => error.code === 'narration_direction_inside_protected_value'
    );
    assert.throws(
        () => prepareTtsRequest(structuredPayload({
            narrationPlainText: 'Conheça a Mileto hoje.',
            narrationSynthesisText: '[excited] Conheça a Mi[emphasis]leto hoje.',
            protectedTerms: ['Mileto'],
        })),
        (error) => error.code === 'narration_direction_inside_protected_value'
    );
});

test('rejeita direções dentro de telefone, data e percentual normalizados por extenso', () => {
    const cases = [
        {
            narrationPlainText: 'Ligue 11 99999-9999.',
            narrationSynthesisText: '[confident] Ligue onze [pause] noventa e nove mil novecentos e noventa e nove nove mil novecentos e noventa e nove.',
        },
        {
            narrationPlainText: 'A oferta vale em 13/08/2026.',
            narrationSynthesisText: '[confident] A oferta vale em treze de agosto [pause] de dois mil e vinte e seis.',
        },
        {
            narrationPlainText: 'Ganhe 20% de desconto.',
            narrationSynthesisText: '[confident] Ganhe vinte [emphasis] por cento de desconto.',
        },
    ];
    for (const payload of cases) {
        assert.throws(
            () => prepareTtsRequest(structuredPayload({ ...payload, directionMode: 'manual' })),
            (error) => error.code === 'narration_direction_inside_protected_value'
        );
    }
});

test('directionVersion é sanitizada para header e log', () => {
    assert.equal(sanitizeDirectionVersion(' Fish S2.1 / V1\r\n segredo '), 'fish-s2.1-v1-segredo');
    assert.throws(
        () => prepareTtsRequest(structuredPayload({ directionVersion: 'fish-s2.1-natural-v2' })),
        (error) => error.code === 'narration_direction_version_invalid'
    );
});

test('servidor valida contrato e modelo antes de chave, preço e reserva', () => {
    const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
    const validation = source.indexOf('const prepared = prepareTtsRequest(payload)');
    const keyLookup = source.indexOf('await hasKey(provider)', validation);
    const pricing = source.indexOf('await priceOf(provider, requestedTtsModel', validation);
    const reservation = source.indexOf('await reserve({ orgId: req.user.orgId', validation);
    assert.ok(validation >= 0);
    assert.ok(keyLookup > validation);
    assert.ok(pricing > validation);
    assert.ok(reservation > validation);
});

test('preserva colchetes editoriais sem tratá-los como direção', () => {
    const plain = 'Oferta [2026] da campanha [Oferta].';
    const result = prepareTtsRequest(structuredPayload({
        narrationPlainText: plain,
        narrationSynthesisText: `[confident] ${plain}`,
        directionMode: 'manual',
    }));
    assert.equal(result.spokenText, `[confident] ${plain}`);

    const clean = prepareTtsRequest(structuredPayload({
        narrationPlainText: plain,
        narrationSynthesisText: plain,
        directionMode: 'clean',
    }));
    assert.equal(clean.spokenText, plain);
});

test('dialeto do Ops aceita instrucoes livres e trata todo colchete como nao falado', () => {
    const result = prepareTtsRequest(structuredPayload({
        narrationPlainText: 'Oferta exclusiva.',
        narrationSynthesisText: '[as if sharing a secret, with rising energy!] Oferta [2026] exclusiva.',
        narrationDialect: OPS_NARRATION_DIALECT,
    }));
    assert.equal(result.narrationDialect, OPS_NARRATION_DIALECT);
    assert.equal(
        result.spokenText,
        '[as if sharing a secret, with rising energy!] Oferta [2026] exclusiva.'
    );

    const local = prepareTtsRequest(structuredPayload({
        narrationPlainText: 'Oferta [2026] exclusiva.',
        narrationSynthesisText: '[confident] Oferta [2026] exclusiva.',
    }));
    assert.equal(local.narrationDialect, 'fish-natural-v1');
    assert.equal(local.narrationPlainText, 'Oferta [2026] exclusiva.');
    assert.equal(local.spokenText, '[confident] Oferta [2026] exclusiva.');
});
