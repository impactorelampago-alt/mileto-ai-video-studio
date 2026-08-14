import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_TITLE_GENERATOR_CONFIG,
    MAX_TITLES_PER_TRIGGER,
    MIN_USABLE_TITLE_TRIGGERS,
    normalizeTitleGeneratorConfig,
} from '../src/services/titleGeneratorConfig';

test('fallback local v5 usa tres titulos por gatilho e quatro gatilhos no minimo', () => {
    assert.equal(DEFAULT_TITLE_GENERATOR_CONFIG.version, 5);
    assert.ok(DEFAULT_TITLE_GENERATOR_CONFIG.triggers.every((trigger) =>
        trigger.maxOccurrences === MAX_TITLES_PER_TRIGGER
    ));

    const invalid = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    invalid.triggers = invalid.triggers.slice(0, MIN_USABLE_TITLE_TRIGGERS - 1);
    assert.throws(
        () => normalizeTitleGeneratorConfig(invalid),
        /pelo menos 4 gatilhos ativos/i,
    );
});
test('fallback local recupera configuracao v4 antiga e limita ocorrencias a tres', () => {
    const legacy = structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    legacy.version = 4;
    legacy.triggers = legacy.triggers.slice(0, 2);
    legacy.triggers[0].maxOccurrences = 1;
    legacy.triggers[1].enabled = false;

    const healed = normalizeTitleGeneratorConfig(legacy);
    assert.equal(healed.version, 5);
    assert.ok(healed.triggers.filter((trigger) => trigger.enabled && trigger.titleTypes.length).length >= 4);
    assert.ok(healed.triggers.every((trigger) => trigger.maxOccurrences <= MAX_TITLES_PER_TRIGGER));
});
