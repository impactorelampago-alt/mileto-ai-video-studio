import assert from 'node:assert/strict';
import test from 'node:test';
import {
    NARRATION_DIRECTION_VERSION,
    buildNarrationTtsRequest,
    narrationContractFromChatScript,
    narrationContractFromPlainText,
    normalizeNarrationContract,
    removeOrphanNarrationDirections,
    stripNarrationDirections,
} from '../src/lib/narrationContract.ts';

const project = (overrides = {}) => ({
    narrationPlainText: 'Visite a Ótica Reis em Piracicaba.',
    narrationSynthesisText: '[warm and reassuring] Visite a Ótica Reis em Piracicaba.',
    narrationText: 'Visite a Ótica Reis em Piracicaba.',
    ttsModel: 's2.1-pro',
    voiceId: 'voice-fish',
    directionMode: 'manual',
    directionVersion: NARRATION_DIRECTION_VERSION,
    selectedVoiceId: 'voice-fish',
    selectedVoiceProvider: 'fishAudio',
    voiceSettings: {
        speed: 1,
        volume: 0,
        stability: 0.4,
        similarityBoost: 0.75,
        fishModel: 's2.1-pro',
    },
    ...overrides,
});

test('preserva a descrição natural até o request S2.1 Pro', () => {
    const payload = buildNarrationTtsRequest(project(), ['Ótica Reis']);

    assert.equal(payload.ttsModel, 's2.1-pro');
    assert.equal(payload.narrationSynthesisText, '[warm and reassuring] Visite a Ótica Reis em Piracicaba.');
    assert.equal(payload.text, payload.narrationSynthesisText);
    assert.equal(payload.voiceSettings.fishModel, 's2.1-pro');
    assert.equal(payload.directionVersion, 'fish-s2.1-natural-v1');
});

test('mantém texto limpo separado do texto de síntese', () => {
    const normalized = normalizeNarrationContract(project());

    assert.equal(normalized.narrationPlainText, 'Visite a Ótica Reis em Piracicaba.');
    assert.equal(normalized.narrationSynthesisText, '[warm and reassuring] Visite a Ótica Reis em Piracicaba.');
    assert.equal(normalized.narrationText, normalized.narrationPlainText);
});

test('modo clean respeita pedido sem tags', () => {
    const payload = buildNarrationTtsRequest(project({ directionMode: 'clean' }));

    assert.equal(payload.directionMode, 'clean');
    assert.equal(payload.narrationSynthesisText, 'Visite a Ótica Reis em Piracicaba.');
    assert.doesNotMatch(payload.text, /\[[^\]]+\]/);
});

test('draft antigo preserva modelo explicitamente salvo', () => {
    const normalized = normalizeNarrationContract({
        narrationText: '[confident] Oferta válida hoje.',
        selectedVoiceId: 'legacy-voice',
        voiceSettings: { fishModel: 's2-pro' },
    });

    assert.equal(normalized.ttsModel, 's2-pro');
    assert.equal(normalized.narrationPlainText, 'Oferta válida hoje.');
    assert.equal(normalized.narrationSynthesisText, '[confident] Oferta válida hoje.');
});

test('draft sem modelo adota s2.1-pro sem fallback gratuito', () => {
    const normalized = normalizeNarrationContract({ narrationText: 'Oferta válida hoje.' });

    assert.equal(normalized.ttsModel, 's2.1-pro');
    assert.equal(normalized.directionMode, 'automatic');
});

test('migra S2.1 Pro manual sem tags para automatico', () => {
    const plain = 'Se você mora em Piracicaba, conheça esta oferta da Ótica Reis.';
    const normalized = normalizeNarrationContract(project({
        narrationPlainText: plain,
        narrationSynthesisText: plain,
        narrationText: plain,
        directionMode: 'manual',
    }));

    assert.equal(normalized.directionMode, 'automatic');
    const request = buildNarrationTtsRequest({ ...project(), ...normalized });
    assert.equal(request.directionMode, 'automatic');
    assert.match(request.narrationSynthesisText, /^\[curious and inviting\]/);
    assert.equal(stripNarrationDirections(request.narrationSynthesisText), plain);
});

test('editar o texto principal remove tags antigas e retorna para automatico', () => {
    const edited = narrationContractFromPlainText(project(), 'Novo texto limpo para Piracicaba.');

    assert.equal(edited.directionMode, 'automatic');
    assert.equal(edited.narrationPlainText, 'Novo texto limpo para Piracicaba.');
    assert.equal(edited.narrationSynthesisText, edited.narrationPlainText);
});

test('modelo indisponível falha antes do request e não faz fallback', () => {
    assert.throws(
        () => buildNarrationTtsRequest(project({ ttsModel: 'future-model' })),
        /tts_model_unavailable.*future-model.*Nenhum fallback/i,
    );
});

test('rejeita direção dentro de preço ou nome protegido', () => {
    assert.throws(
        () => buildNarrationTtsRequest(project({
            narrationPlainText: 'Ótica Reis oferece por R$ 199.',
            narrationSynthesisText: 'Ótica [warm] Reis oferece por R$ 199.',
            narrationText: 'Ótica Reis oferece por R$ 199.',
        }), ['Ótica Reis']),
        /dentro de um nome protegido/i,
    );
    assert.throws(
        () => buildNarrationTtsRequest(project({
            narrationPlainText: 'Oferta por R$ 199.',
            narrationSynthesisText: 'Oferta por R$ [emphasis] 199.',
            narrationText: 'Oferta por R$ 199.',
        })),
        /dentro de um preco ou numero/i,
    );
});

test('ElevenLabs recebe seu modelo, texto limpo e nenhum fishModel', () => {
    const payload = buildNarrationTtsRequest(project({
        selectedVoiceProvider: 'elevenLabs',
        voiceId: 'voice-eleven',
        selectedVoiceId: 'voice-eleven',
    }));

    assert.equal(payload.ttsModel, 'eleven_multilingual_v2');
    assert.equal(payload.directionMode, 'clean');
    assert.equal(payload.narrationSynthesisText, 'Visite a Ótica Reis em Piracicaba.');
    assert.equal(Object.hasOwn(payload.voiceSettings, 'fishModel'), false);
});

test('parser de direções aceita hífen e não remove colchetes não linguísticos', () => {
    assert.equal(stripNarrationDirections('[long-break] Volte [2026].'), 'Volte [2026].');
});

test('Chat manual separa tags sem alterar preço e números do texto limpo', () => {
    const contract = narrationContractFromChatScript(
        project(),
        '[confident] Óculos completos por R$ 199,00. [long pause] Ligue 3434-2026.',
        'manual',
    );

    assert.equal(contract.directionMode, 'manual');
    assert.equal(contract.narrationPlainText, 'Óculos completos por R$ 199,00. Ligue 3434-2026.');
    assert.equal(
        contract.narrationSynthesisText,
        '[confident] Óculos completos por R$ 199,00. [long pause] Ligue 3434-2026.',
    );
    assert.equal(contract.narrationText, contract.narrationPlainText);
});

test('metadata manual do Chat sem tags migra para automatico no S2.1 Pro', () => {
    const plain = 'Visite a Ótica Reis em Piracicaba.';
    const contract = narrationContractFromChatScript(project(), plain, 'manual');

    assert.equal(contract.directionMode, 'automatic');
    assert.equal(contract.narrationSynthesisText, plain);
});

test('metadata clean do Chat remove tags também da síntese', () => {
    const contract = narrationContractFromChatScript(
        project(),
        '[warm and reassuring] Óculos por R$ 199.',
        'clean',
    );

    assert.equal(contract.directionMode, 'clean');
    assert.equal(contract.narrationPlainText, 'Óculos por R$ 199.');
    assert.equal(contract.narrationSynthesisText, 'Óculos por R$ 199.');
});

test('preserva colchetes editoriais ao remover direções', () => {
    assert.equal(
        stripNarrationDirections('[long-break] Volte [2026] com [Oferta].'),
        'Volte [2026] com [Oferta].',
    );
});

test('recupera tag órfã terminal sem remover direções válidas do roteiro', () => {
    const synthesis = '[excited] Atenção, Piracicaba! [emphasis] Ótica Reis, a sua escolha certa! [soft]';
    const cleaned = removeOrphanNarrationDirections(synthesis);

    assert.equal(cleaned, '[excited] Atenção, Piracicaba! [emphasis] Ótica Reis, a sua escolha certa!');
    const normalized = normalizeNarrationContract(project({
        narrationPlainText: 'Atenção, Piracicaba! Ótica Reis, a sua escolha certa!',
        narrationSynthesisText: synthesis,
        narrationText: 'Atenção, Piracicaba! Ótica Reis, a sua escolha certa!',
    }));
    assert.equal(normalized.directionMode, 'manual');
    assert.equal(normalized.narrationSynthesisText, cleaned);
});

test('remove sequência órfã e preserva colchetes editoriais finais', () => {
    assert.equal(
        removeOrphanNarrationDirections('[warm] Oferta [2026]. [soft] [pause]'),
        '[warm] Oferta [2026].',
    );
    assert.equal(removeOrphanNarrationDirections('[warm] Oferta [soft].'), '[warm] Oferta.');
});
