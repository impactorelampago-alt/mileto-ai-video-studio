import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyTitleEditorialDecisions,
    buildTitleEditorialReviewBatch,
    preserveTitlesAcrossEditorialReflow,
    resolveTitleEditorialStrategy,
    runTitleEditorialReview,
    TITLE_EDITORIAL_REVIEW_MODEL,
} from '../src/services/titleEditorialReview';
import {
    DEFAULT_TITLE_GENERATOR_CONFIG,
    normalizeTitleGeneratorConfig,
} from '../src/services/titleGeneratorConfig';

const legacyTitles = () => [{
    id: 'urgency-title',
    text: 'ESSA PROMOÇÃO É VÁLIDA',
    sourceText: 'ESSA PROMOÇÃO É VÁLIDA',
    triggerId: 'scarcity',
    startSec: 15.18,
    durationSec: 2,
    styleId: 'premium-urgency-pulse',
    maxWords: 4,
    textBoxWidthPct: 76,
    scale: 0.95,
    fontFamily: 'Anton',
}, {
    id: 'cta-title',
    text: 'CHAME NO WHATSAPP',
    sourceText: 'CHAME NO WHATSAPP',
    triggerId: 'cta',
    startSec: 18.3,
    durationSec: 2,
    styleId: 'cta-whatsapp',
    maxWords: 3,
    textBoxWidthPct: 52,
    scale: 0.72,
    fontFamily: 'Inter',
}];

const words = [
    { text: 'ESSA', start: 15.18 },
    { text: 'PROMOÇÃO', start: 15.48 },
    { text: 'É', start: 15.9 },
    { text: 'VÁLIDA', start: 16.1 },
    { text: 'SÓ', start: 16.6 },
    { text: 'ATÉ', start: 16.8 },
    { text: 'SÁBADO', start: 17.1 },
    { text: 'CHAME', start: 18.3 },
    { text: 'NO', start: 18.6 },
    { text: 'WHATSAPP', start: 18.8 },
];

const segments = [{
    start: 15.18,
    end: 17.4,
    text: 'Essa promoção é válida só até sábado',
    words: words.slice(0, 7),
}, {
    start: 18.3,
    end: 19.2,
    text: 'Chame no WhatsApp',
    words: words.slice(7),
}];

test('usa revisor nano barato e estrategia remota reversivel', () => {
    assert.equal(TITLE_EDITORIAL_REVIEW_MODEL, 'gpt-4.1-nano');
    assert.equal(resolveTitleEditorialStrategy(undefined), 'reviewed-v1');
    assert.equal(resolveTitleEditorialStrategy('reviewed-v1'), 'reviewed-v1');
    assert.equal(resolveTitleEditorialStrategy('legacy-v4'), 'legacy-v4');
    assert.equal(resolveTitleEditorialStrategy('legacy'), 'legacy-v4');
});

test('normalizador local recusa escalada do revisor para modelo caro', () => {
    const unsafeConfig: unknown = {
        ...structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG),
        reviewer: { model: 'gpt-5', maxOutputTokens: 900, timeoutMs: 9000 },
    };
    const normalized = normalizeTitleGeneratorConfig(unsafeConfig);
    assert.equal(normalized.reviewer.model, 'gpt-4.1-nano');
    assert.equal(normalized.reviewer.maxOutputTokens, 900);
    assert.equal(normalized.reviewer.timeoutMs, 9000);
});

test('lote mostra fonte completa, titulo realmente desenhado, omissoes e layout real', () => {
    const titles = legacyTitles();
    const batch = buildTitleEditorialReviewBatch(
        titles,
        new Map([['urgency-title', 'ESSA PROMOÇÃO É VÁLIDA SÓ ATÉ SÁBADO']]),
        segments,
        '9:16',
    );

    assert.equal(batch.length, 2);
    assert.equal(batch[0].sourceText, 'ESSA PROMOÇÃO É VÁLIDA SÓ ATÉ SÁBADO');
    assert.equal(batch[0].generatedText, 'ESSA PROMOÇÃO É VÁLIDA SÓ ATÉ SÁBADO');
    assert.equal(batch[0].renderedText, 'ESSA PROMOÇÃO É VÁLIDA');
    assert.deepEqual(batch[0].omittedWords, ['SÓ', 'ATÉ', 'SÁBADO']);
    assert.deepEqual(batch[0].layout, {
        format: '9:16',
        styleId: 'premium-urgency-pulse',
        maxWords: 4,
        textBoxWidthPct: 76,
        scale: 0.95,
        fontFamily: 'Anton',
    });
});

test('faz uma unica chamada em lote e corrige somente o titulo reprovado com trecho literal', async () => {
    const legacy = legacyTitles();
    let calls = 0;
    const result = await runTitleEditorialReview({
        strategy: 'reviewed-v1',
        legacyFinalTitles: legacy,
        generatedTextById: new Map(),
        captionSegments: segments,
        spokenWords: words,
        format: '9:16',
        requestBatch: async (items) => {
            calls += 1;
            assert.equal(items.length, 2);
            return {
                reviews: [
                    { id: 'urgency-title', verdict: 'replace', replacementText: 'SÓ ATÉ SÁBADO' },
                    { id: 'cta-title', verdict: 'approve' },
                ],
            };
        },
    });

    assert.equal(calls, 1);
    assert.equal(result.correctedCount, 1);
    assert.equal(result.fallbackToLegacy, false);
    assert.equal(result.titles[0].text, 'SÓ ATÉ SÁBADO');
    assert.equal(result.titles[0].sourceText, 'SÓ ATÉ SÁBADO');
    assert.equal(result.titles[0].startSec, 16.6);
    assert.strictEqual(result.titles[1], legacy[1]);
});

test('correcao parafraseada ou maior que o modelo nunca e cortada silenciosamente', async () => {
    const legacy = legacyTitles();
    const result = await runTitleEditorialReview({
        strategy: 'reviewed-v1',
        legacyFinalTitles: legacy,
        generatedTextById: new Map(),
        captionSegments: segments,
        spokenWords: words,
        format: '9:16',
        requestBatch: async () => ({ reviews: [
            { id: 'urgency-title', verdict: 'replace', replacementText: 'PROMOÇÃO IMPERDÍVEL ATÉ O PRÓXIMO SÁBADO' },
            { id: 'cta-title', verdict: 'approve' },
        ] }),
    });

    assert.equal(result.correctedCount, 0);
    assert.equal(result.fallbackToLegacy, true);
    assert.equal(result.strategy, 'legacy-v4');
    assert.strictEqual(result.titles, legacy);
});

test('um unico replace invalido rejeita atomicamente as demais correcoes validas do lote', async () => {
    const legacy = legacyTitles();
    const result = await runTitleEditorialReview({
        strategy: 'reviewed-v1',
        legacyFinalTitles: legacy,
        generatedTextById: new Map(),
        captionSegments: segments,
        spokenWords: words,
        format: '9:16',
        requestBatch: async () => ({ reviews: [
            { id: 'urgency-title', verdict: 'replace', replacementText: 'SÓ ATÉ SÁBADO' },
            // Literal, mas excede maxWords=3 do CTA.
            { id: 'cta-title', verdict: 'replace', replacementText: 'ESSA PROMOÇÃO É VÁLIDA' },
        ] }),
    });

    assert.equal(result.correctedCount, 0);
    assert.equal(result.fallbackToLegacy, true);
    assert.equal(result.strategy, 'legacy-v4');
    assert.strictEqual(result.titles, legacy);
    assert.equal(result.titles[0].text, legacy[0].text);
});

test('replace literal de outro titulo ou distante do timing tambem invalida a transacao', async () => {
    const legacy = legacyTitles();
    const wrongSource = await runTitleEditorialReview({
        strategy: 'reviewed-v1',
        legacyFinalTitles: legacy,
        generatedTextById: new Map(),
        captionSegments: segments,
        spokenWords: words,
        format: '9:16',
        requestBatch: async () => ({ reviews: [
            { id: 'urgency-title', verdict: 'replace', replacementText: 'CHAME NO WHATSAPP' },
            { id: 'cta-title', verdict: 'approve' },
        ] }),
    });
    assert.equal(wrongSource.fallbackToLegacy, true);
    assert.strictEqual(wrongSource.titles, legacy);

    const farWords = [...words, { text: 'ÚLTIMAS', start: 30 }, { text: 'VAGAS', start: 30.3 }];
    const farTiming = applyTitleEditorialDecisions(
        legacy,
        [{ id: 'urgency-title', verdict: 'replace', replacementText: 'ÚLTIMAS VAGAS' }],
        farWords,
        new Map([['urgency-title', 'ÚLTIMAS VAGAS']]),
    );
    assert.equal(farTiming.valid, false);
    assert.strictEqual(farTiming.titles, legacy);
});

test('reflow que remove qualquer titulo rejeita toda a revisao e preserva o legado', () => {
    const legacy = legacyTitles();
    const dropped = preserveTitlesAcrossEditorialReflow(legacy, [legacy[0]]);
    assert.equal(dropped.accepted, false);
    assert.strictEqual(dropped.titles, legacy);

    const reordered = preserveTitlesAcrossEditorialReflow(legacy, [legacy[1], legacy[0]]);
    assert.equal(reordered.accepted, true);
    assert.strictEqual(reordered.titles[0], legacy[1]);
});

test('timeout ou resposta incompleta devolve exatamente o array legado', async () => {
    const legacy = legacyTitles();
    const failed = await runTitleEditorialReview({
        strategy: 'reviewed-v1',
        legacyFinalTitles: legacy,
        generatedTextById: new Map(),
        captionSegments: segments,
        spokenWords: words,
        format: '9:16',
        requestBatch: async () => { throw new Error('timeout'); },
    });
    assert.equal(failed.fallbackToLegacy, true);
    assert.equal(failed.strategy, 'legacy-v4');
    assert.strictEqual(failed.titles, legacy);

    const incomplete = await runTitleEditorialReview({
        strategy: 'reviewed-v1',
        legacyFinalTitles: legacy,
        generatedTextById: new Map(),
        captionSegments: segments,
        spokenWords: words,
        format: '9:16',
        requestBatch: async () => ({ reviews: [{ id: 'urgency-title', verdict: 'approve' }] }),
    });
    assert.equal(incomplete.fallbackToLegacy, true);
    assert.equal(incomplete.strategy, 'legacy-v4');
    assert.strictEqual(incomplete.titles, legacy);
});

test('legacy-v4 nao chama IA e preserva identidade e conteudo', async () => {
    const legacy = legacyTitles();
    const snapshot = structuredClone(legacy);
    const result = await runTitleEditorialReview({
        strategy: 'legacy-v4',
        legacyFinalTitles: legacy,
        generatedTextById: new Map(),
        captionSegments: segments,
        spokenWords: words,
        format: '9:16',
        requestBatch: async () => assert.fail('rollback nao pode chamar a revisora'),
    });

    assert.strictEqual(result.titles, legacy);
    assert.deepEqual(result.titles, snapshot);
    assert.equal(result.attempted, false);
});
