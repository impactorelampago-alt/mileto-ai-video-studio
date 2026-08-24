import assert from 'node:assert/strict';
import test from 'node:test';
import {
    enrichVoiceCatalogPreviews,
    fishModelPreviewUrl,
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

test('extrai a primeira amostra de áudio HTTP do modelo Fish', () => {
    assert.equal(fishModelPreviewUrl({ samples: [
        { audio: 'javascript:alert(1)' },
        { audio: '/model-samples/voice.mp3' },
    ] }), 'https://api.fish.audio/model-samples/voice.mp3');
    assert.equal(fishModelPreviewUrl({ samples: [] }), null);
});

test('enriquece previews sem sintetizar e preserva falhas individualmente', async () => {
    const calls = [];
    const payload = {
        catalogVersion: 4,
        voices: [
            { voiceId: 'system-1', name: 'Sistema', provider: 'fish_audio', isCustom: false },
            { voiceId: 'custom-1', name: 'Custom', provider: 'fish_audio', isCustom: true },
            { voiceId: 'existing', name: 'Pronta', provider: 'fish_audio', isCustom: true, previewUrl: 'https://cdn.example/existing.mp3' },
        ],
    };
    const out = await enrichVoiceCatalogPreviews(payload, {
        fishApiKey: 'test-key',
        fetchImpl: async (url) => {
            calls.push(url);
            if (url.endsWith('/system-1')) {
                return { ok: true, json: async () => ({ samples: [{ audio: 'https://cdn.fish.audio/system.mp3' }] }) };
            }
            return { ok: false, json: async () => ({}) };
        },
    });

    assert.equal(out.voices[0].previewUrl, 'https://cdn.fish.audio/system.mp3');
    assert.equal(out.voices[1].previewUrl, undefined);
    assert.equal(out.voices[2].previewUrl, 'https://cdn.example/existing.mp3');
    assert.equal(calls.length, 2);
    assert.equal(payload.voices[0].previewUrl, undefined);
});
