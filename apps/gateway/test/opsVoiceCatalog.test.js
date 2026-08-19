import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeVoiceCatalogPayload,
    normalizeVoiceCatalogVersion,
} from '../src/opsVoiceCatalog.js';

test('normaliza o payload mínimo do contrato', () => {
    const out = normalizeVoiceCatalogPayload({
        catalogVersion: 1,
        voices: [{ voiceId: 'fish-123', name: 'Voz da Victoria', isCustom: true }],
    });
    assert.deepEqual(out, {
        catalogVersion: 1,
        voices: [{ voiceId: 'fish-123', name: 'Voz da Victoria', isCustom: true }],
    });
});

test('catalogVersion inválido é rejeitado (422)', () => {
    for (const bad of [0, -1, 1.5, 'x', null, undefined, NaN]) {
        assert.throws(
            () => normalizeVoiceCatalogPayload({ catalogVersion: bad, voices: [] }),
            /ops_voice_catalog_invalid|catalogVersion/,
        );
    }
    assert.equal(normalizeVoiceCatalogVersion(7), 7);
    assert.throws(() => normalizeVoiceCatalogVersion(0), /catalogVersion/);
});

test('descarta vozes sem voiceId ou nome e deduplica por voiceId', () => {
    const out = normalizeVoiceCatalogPayload({
        catalogVersion: 3,
        voices: [
            { voiceId: 'a', name: 'A' },
            { voiceId: '', name: 'sem id' },
            { voiceId: 'b', name: '' },
            { voiceId: 'a', name: 'A duplicada' },
            { name: 'sem voiceId' },
        ],
    });
    assert.deepEqual(out.voices.map((v) => v.voiceId), ['a']);
    assert.equal(out.voices[0].isCustom, true);
});

test('aceita e limpa os campos opcionais do contrato', () => {
    const out = normalizeVoiceCatalogPayload({
        catalogVersion: 2,
        voices: [{
            voiceId: 'fish-1',
            name: '  Voz  Teste  ',
            isCustom: false,
            provider: 'fish_audio',
            description: 'grave e calma',
            language: 'pt-BR',
            labels: ['radio', '', 'quente'],
            modelIds: ['m1', 'm2'],
            capabilities: { clone: true },
            isDefault: true,
            previewUrl: 'https://x/y.mp3',
            metadata: { source: 'app' },
        }],
    });
    const v = out.voices[0];
    assert.equal(v.name, 'Voz Teste');
    assert.equal(v.isCustom, false);
    assert.equal(v.provider, 'fish_audio');
    assert.equal(v.description, 'grave e calma');
    assert.deepEqual(v.labels, ['radio', 'quente']);
    assert.deepEqual(v.modelIds, ['m1', 'm2']);
    assert.deepEqual(v.capabilities, { clone: true });
    assert.equal(v.isDefault, true);
    assert.equal(v.previewUrl, 'https://x/y.mp3');
    assert.deepEqual(v.metadata, { source: 'app' });
});

test('respeita o limite de 1000 vozes', () => {
    const voices = Array.from({ length: 1001 }, (_, i) => ({ voiceId: `v${i}`, name: `V${i}` }));
    assert.throws(
        () => normalizeVoiceCatalogPayload({ catalogVersion: 1, voices }),
        /1000/,
    );
});
