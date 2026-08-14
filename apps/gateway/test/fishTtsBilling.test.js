import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    resolveFishTtsModel,
    resolveTtsModel,
    ttsProviderCostUsd,
} from '../src/ttsModels.js';

test('Fish sem modelo usa o s2.1-pro pago e modelo inválido falha', () => {
    assert.equal(resolveFishTtsModel(undefined), 's2.1-pro');
    assert.throws(
        () => resolveFishTtsModel('modelo-inventado'),
        (error) => error.code === 'tts_model_unavailable'
    );
    assert.throws(
        () => resolveFishTtsModel(null),
        (error) => error.code === 'tts_model_invalid'
    );
    assert.equal(resolveTtsModel('fishAudio', {}), 's2.1-pro');
});

test('custo acompanha o modelo Fish realmente enviado', () => {
    assert.equal(ttsProviderCostUsd('fishAudio', 's2.1-pro', 1_000_000), 15);
    assert.equal(ttsProviderCostUsd('fishAudio', 's2-pro', 1_000_000), 15);
    assert.equal(ttsProviderCostUsd('fishAudio', 's1', 1_000_000), 15);
    assert.equal(ttsProviderCostUsd('fishAudio', 's2.1-pro-free', 1_000_000), 0);
});

test('modelo Fish desconhecido falha antes de poder ser precificado', () => {
    assert.throws(
        () => ttsProviderCostUsd('fishAudio', 'modelo-inventado', 1_000_000),
        (error) => error.code === 'tts_model_unavailable'
    );
});

test('deploy possui migracao executavel para registrar o modelo no ledger existente', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const runner = readFileSync(new URL('../src/migrateUsageLedgerModel.js', import.meta.url), 'utf8');
    const migration = readFileSync(new URL('../migrations/20260813_usage_ledger_model.sql', import.meta.url), 'utf8');

    assert.equal(packageJson.scripts['migrate:usage-ledger-model'], 'node src/migrateUsageLedgerModel.js');
    assert.match(runner, /20260813_usage_ledger_model\.sql/);
    assert.match(migration, /ALTER TABLE usage_ledger[\s\S]*ADD COLUMN IF NOT EXISTS model TEXT/i);
});

test('deploy expoe a lista de modelos Fish habilitados antes da cobranca', () => {
    const compose = readFileSync(new URL('../docker-compose.prod.yml', import.meta.url), 'utf8');
    const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    assert.match(compose, /FISH_TTS_AVAILABLE_MODELS:[^\n]*s2\.1-pro/);
    assert.match(envExample, /FISH_TTS_AVAILABLE_MODELS=s2\.1-pro,s2\.1-pro-free,s2-pro,s1/);
});
