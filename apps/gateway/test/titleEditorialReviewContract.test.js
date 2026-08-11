import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.TOKEN_SECRET ||= 'test-token-secret';
process.env.ADMIN_PASSWORD ||= 'test-admin-password';

const {
    DEFAULT_TITLE_GENERATOR_CONFIG,
    normalizeTitleGeneratorConfig,
    normalizeStoredOrgTitleGeneratorConfig,
} = await import('../src/orgAi.js');

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('configuracao efetiva liga revisao barata e permite rollback remoto para o legado', () => {
    assert.equal(DEFAULT_TITLE_GENERATOR_CONFIG.pipeline, 'reviewed-v1');
    assert.deepEqual(DEFAULT_TITLE_GENERATOR_CONFIG.reviewer, {
        model: 'gpt-4.1-nano',
        maxOutputTokens: 512,
        timeoutMs: 8000,
    });

    const legacy = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    legacy.pipeline = 'legacy-v4';
    legacy.reviewer = { model: 'gpt-5', maxOutputTokens: 1, timeoutMs: 99_999 };
    const normalized = normalizeTitleGeneratorConfig(legacy);
    assert.equal(normalized.pipeline, 'legacy-v4');
    assert.deepEqual(normalized.reviewer, {
        model: 'gpt-4.1-nano',
        maxOutputTokens: 512,
        timeoutMs: 15000,
    });
});

test('kill switch global legado domina override org reviewed sem apagar seus layouts', () => {
    const globalLegacy = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    globalLegacy.pipeline = 'legacy-v4';
    globalLegacy.reviewer = { model: 'gpt-4.1-nano', maxOutputTokens: 600, timeoutMs: 7000 };
    const orgReviewed = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    orgReviewed.pipeline = 'reviewed-v1';
    orgReviewed.triggers[0].titleTypes[0].layouts['9:16'].posX = 37.5;

    const normalized = normalizeTitleGeneratorConfig(orgReviewed, globalLegacy);
    assert.equal(normalized.pipeline, 'legacy-v4');
    assert.equal(normalized.triggers[0].titleTypes[0].layouts['9:16'].posX, 37.5);

    // O editor recebe `normalized` (efetiva/legacy) e salva um layout durante o rollback.
    const storedWhileKilled = normalizeStoredOrgTitleGeneratorConfig(normalized, globalLegacy);
    assert.equal(storedWhileKilled.pipeline, 'reviewed-v1');
    assert.equal(storedWhileKilled.triggers[0].titleTypes[0].layouts['9:16'].posX, 37.5);
    const effectiveWhileKilled = normalizeTitleGeneratorConfig(storedWhileKilled, globalLegacy);
    assert.equal(effectiveWhileKilled.pipeline, 'legacy-v4');

    const globalReviewed = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    const enabled = normalizeTitleGeneratorConfig(orgReviewed, globalReviewed);
    assert.equal(enabled.pipeline, 'reviewed-v1');
    assert.equal(enabled.triggers[0].titleTypes[0].layouts['9:16'].posX, 37.5);
    const restoredAfterKillSwitch = normalizeTitleGeneratorConfig(storedWhileKilled, globalReviewed);
    assert.equal(restoredAfterKillSwitch.pipeline, 'reviewed-v1');
    assert.equal(restoredAfterKillSwitch.triggers[0].titleTypes[0].layouts['9:16'].posX, 37.5);
});

test('editor visual preserva pipeline/reviewer e controller faz uma unica revisao batch fail-open', () => {
    const editor = read('../../client/src/lib/titleGeneratorEditor.ts');
    const controller = read('../../server/src/controllers/aiController.ts');
    const review = read('../../server/src/services/titleEditorialReview.ts');

    assert.match(editor, /\.\.\.base,[\s\S]*version:\s*Math\.max\(4/);
    assert.doesNotMatch(editor, /version:\s*3/);
    assert.match(controller, /const legacyFinalTitles = runLegacyFinalTitleStrategy\(\)/);
    assert.match(controller, /runTitleEditorialReview\(\{/);
    assert.match(controller, /requestBatch:\s*async \(items\)/);
    assert.match(controller, /content:\s*JSON\.stringify\(\{ format: videoFormat, titles: items \}\)/);
    assert.match(controller, /model:\s*titleConfig\.reviewer\.model/);
    assert.doesNotMatch(controller, /reasoning:\s*['"]rapido['"][\s\S]*titleConfig\.reviewer/);
    assert.match(review, /catch \{[\s\S]*titles:\s*legacyFinalTitles[\s\S]*fallbackToLegacy:\s*true/);
    assert.match(controller, /preserveTitlesAcrossEditorialReflow/);
    assert.match(controller, /if \(editorialResult\.correctedCount && !atomicReflow\.accepted\)/);
    assert.match(controller, /const finalTitles = atomicReflow\.titles/);
    assert.match(controller, /strategy:\s*'legacy-v4'[\s\S]*fallbackToLegacy:\s*true/);
});
