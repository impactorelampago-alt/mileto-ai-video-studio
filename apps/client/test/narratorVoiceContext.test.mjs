import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildNarratorVoiceContext,
    isRecommendableVoiceDescription,
    migrateCustomVoices,
    NARRATOR_VOICE_CONTEXT_MAX_BYTES,
    NARRATOR_VOICE_CONTEXT_MAX_ITEMS,
} from '../src/lib/narratorVoiceContext.ts';

const systemVoice = {
    id: 'fish-reference-id-must-stay-local',
    catalogKey: 'mv-system-01',
    name: 'Locutor Rádio',
    desc: 'Locução de rádio, impacto',
    provider: 'fishAudio',
    preset: {},
};

test('migra voz legada sem quebrar ID/preset e a deixa pendente de descrição', () => {
    const preset = { voiceSettings: { speed: 1.2 } };
    const legacy = [{ id: 'real-provider-id', name: 'Minha voz', description: 'Voz Personalizada', preset }];
    const migrated = migrateCustomVoices(legacy, () => 'mv-custom-12345678');

    assert.equal(migrated.changed, true);
    assert.equal(migrated.voices[0].id, 'real-provider-id');
    assert.deepEqual(migrated.voices[0].preset, preset);
    assert.equal(migrated.voices[0].provider, 'fishAudio');
    assert.equal(migrated.voices[0].catalogKey, 'mv-custom-12345678');
    assert.equal(migrated.voices[0].recommendationStatus, 'description_required');
});
test('descrição genérica não habilita recomendação', () => {
    assert.equal(isRecommendableVoiceDescription('Voz Personalizada'), false);
    assert.equal(isRecommendableVoiceDescription('curta'), false);
    assert.equal(isRecommendableVoiceDescription('Voz jovem e enérgica para promoções.'), true);
});

test('contexto usa chave opaca, exclui pendentes e nunca inclui IDs ou presets reais', () => {
    const context = buildNarratorVoiceContext([systemVoice], [
        {
            id: 'custom-provider-secret-id',
            catalogKey: 'mv-custom-aaaaaaaa',
            name: 'Voz pronta',
            description: 'Voz calma e acolhedora para conteúdo explicativo.',
            recommendationStatus: 'ready',
            provider: 'fishAudio',
            preset: { voiceSettings: { fishModel: 's2.1-pro' } },
        },
        {
            id: 'legacy-still-works-in-tts',
            catalogKey: 'mv-custom-bbbbbbbb',
            name: 'Legada',
            description: '',
            recommendationStatus: 'description_required',
        },
    ], 'custom-provider-secret-id');

    assert.equal(context.voices.length, 2);
    assert.deepEqual(context.voices.map((voice) => voice.key), ['mv-system-01', 'mv-custom-aaaaaaaa']);
    assert.equal(context.voices[1].selected, true);
    const serialized = JSON.stringify(context);
    assert.doesNotMatch(serialized, /custom-provider-secret-id|fish-reference-id|s2\.1-pro|fishAudio/);
});

test('contexto respeita no máximo 30 vozes e 8 KB', () => {
    const customs = Array.from({ length: 80 }, (_, index) => ({
        id: `provider-${index}`,
        catalogKey: `mv-custom-${String(index).padStart(8, '0')}`,
        name: `Voz ${index} ${'N'.repeat(70)}`,
        description: `Descrição editorial ${index} ${'D'.repeat(220)}`,
        recommendationStatus: 'ready',
    }));
    const context = buildNarratorVoiceContext([], customs, null);
    assert.ok(context.voices.length <= NARRATOR_VOICE_CONTEXT_MAX_ITEMS);
    assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength <= NARRATOR_VOICE_CONTEXT_MAX_BYTES);
});
