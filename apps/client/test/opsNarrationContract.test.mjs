import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    OpsNarrationContractError,
    OpsNarrationDirectionsError,
    assertOpsNarrationMatchesPlainText,
    compareOpsNarration,
    normalizeOpsSpokenText,
    stripOpsNarrationDirections,
} from '../src/lib/opsNarrationContract.ts';
import { buildNarrationTtsRequest } from '../src/lib/narrationContract.ts';

const ttsInput = (overrides = {}) => ({
    narrationPlainText: 'Oferta exclusiva.',
    narrationSynthesisText: '[confident] Oferta exclusiva.',
    narrationText: 'Oferta exclusiva.',
    ttsModel: 's2.1-pro',
    voiceId: 'voice-1',
    selectedVoiceId: 'voice-1',
    selectedVoiceProvider: 'fishAudio',
    voiceSettings: { speed: 1, volume: 0, stability: 0.4, similarityBoost: 0.75, fishModel: 's2.1-pro' },
    directionMode: 'manual',
    directionVersion: 'fish-s2.1-natural-v1',
    ...overrides,
});

test('comparacao do Ops remove qualquer instrucao entre colchetes, sem allowlist', async () => {
    const narration = [
        '[excited] Oferta especial.',
        '[warm] Somente hoje.',
        '[curious and inviting] Quer saber mais?',
        '[pause] Visite a loja.',
        '[as if sharing a secret, with rising energy!] Aproveite agora.',
    ].join('\n');
    const plainText = 'Oferta especial. Somente hoje. Quer saber mais? Visite a loja. Aproveite agora.';

    assert.equal(stripOpsNarrationDirections('[QUALQUER DIRECAO: 2x] Fala.'), '  Fala.');
    assert.equal((await compareOpsNarration(narration, plainText)).matches, true);
});

test('normaliza Unicode, quebras de linha e todos os espacos antes de comparar', async () => {
    const narration = '［soft］\r\nO\u0301tica\u00a0Reis\t em\u200b Piracicaba.';
    const plainText = '\u00d3tica Reis em Piracicaba.';

    assert.equal(normalizeOpsSpokenText(narration), 'ótica reis em piracicaba.');
    assert.equal((await assertOpsNarrationMatchesPlainText(narration, plainText)).matches, true);
});

test('consumidor valida narration contra voiceSynthesis.plainText antes de preparar o projeto', () => {
    const coordinator = readFileSync(new URL('../src/components/OpsVideoJobCoordinator.tsx', import.meta.url), 'utf8');
    const validation = coordinator.slice(
        coordinator.indexOf('const validateBeforeClaim'),
        coordinator.indexOf('export const OpsVideoJobCoordinator'),
    );
    assert.match(validation, /voiceSynthesisPlainText && jobNarrationText/);
    assert.match(validation, /await assertOpsNarrationMatchesPlainText\(jobNarrationText, voiceSynthesisPlainText\)/);
    assert.match(validation, /const usesOpsNarrationDialect = Boolean\(voiceSynthesisPlainText && jobNarrationText\)/);
    assert.match(validation, /usesOpsNarrationDialect \? \{ narrationDialect: OPS_NARRATION_DIALECT \} : \{\}/);
    assert.ok(
        validation.indexOf('await assertOpsNarrationMatchesPlainText') < validation.indexOf('createDefaultAdData'),
        'a divergencia deve ser rejeitada antes de preparar o projeto local',
    );
});

test('divergencia retorna primeiro trecho e hashes, sem incluir o roteiro completo', async () => {
    const common = 'Texto comercial longo que nao deve aparecer inteiro no erro. '.repeat(8);
    const narration = `[warm] ${common}visite hoje.`;
    const plainText = `${common}visite amanha.`;

    await assert.rejects(
        () => assertOpsNarrationMatchesPlainText(narration, plainText),
        (error) => {
            assert.ok(error instanceof OpsNarrationContractError);
            assert.equal(error.code, 'ops_narration_text_mismatch');
            assert.equal(error.phase, 'narration_contract');
            assert.equal(error.retryable, false);
            assert.equal(error.diagnostic.matches, false);
            assert.match(error.diagnostic.narrationHash, /^(?:sha256:[a-f0-9]{64}|fnv1a32:[a-f0-9]{8})$/);
            assert.match(error.diagnostic.plainTextHash, /^(?:sha256:[a-f0-9]{64}|fnv1a32:[a-f0-9]{8})$/);
            assert.match(error.message, /Primeiro trecho diferente/);
            assert.match(error.message, /Hashes normalizados/);
            assert.doesNotMatch(error.message, new RegExp(common.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
            return true;
        },
    );
});

test('conteudo falado realmente diferente continua sendo rejeitado', async () => {
    await assert.rejects(
        () => assertOpsNarrationMatchesPlainText('[excited] Oferta por cento e noventa e nove reais.', 'Oferta por duzentos reais.'),
        (error) => error instanceof OpsNarrationContractError
            && error.diagnostic.firstDifference?.narrationExcerpt.includes('cento e noventa')
            && error.diagnostic.firstDifference?.plainTextExcerpt.includes('duzentos'),
    );
});

test('colchetes desbalanceados falham de forma estruturada, sem virar fala', async () => {
    await assert.rejects(
        () => compareOpsNarration('[excited Oferta especial.', 'Oferta especial.'),
        (error) => error instanceof OpsNarrationDirectionsError
            && error.code === 'ops_narration_directions_invalid'
            && error.phase === 'narration_contract'
            && error.retryable === false
            && /Hash normalizado/.test(error.message),
    );
});

test('request TTS propaga dialeto amplo somente para o payload do Ops', () => {
    const opsRequest = buildNarrationTtsRequest(ttsInput({
        narrationPlainText: 'Oferta exclusiva.',
        narrationSynthesisText: '[as if sharing a secret, with rising energy!] Oferta [2026] exclusiva.',
        narrationDialect: 'mileto-ops-bracket-v1',
    }));
    assert.equal(opsRequest.narrationDialect, 'mileto-ops-bracket-v1');
    assert.equal(
        opsRequest.narrationSynthesisText,
        '[as if sharing a secret, with rising energy!] Oferta [2026] exclusiva.',
    );

    const localRequest = buildNarrationTtsRequest(ttsInput({
        narrationPlainText: 'Oferta [2026] exclusiva.',
        narrationSynthesisText: '[confident] Oferta [2026] exclusiva.',
    }));
    assert.equal(localRequest.narrationDialect, undefined);
    assert.equal(localRequest.narrationPlainText, 'Oferta [2026] exclusiva.');
    assert.equal(localRequest.narrationSynthesisText, '[confident] Oferta [2026] exclusiva.');
});
