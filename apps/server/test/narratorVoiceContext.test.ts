import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeNarratorVoiceContext } from '../src/services/narratorVoiceContext';

test('normaliza somente metadados com chaves opacas', () => {
    const context = normalizeNarratorVoiceContext({
        version: 1,
        voices: [
            {
                key: 'mv-custom-12345678',
                name: '  Voz\nAcolhedora  ',
                description: '  Calma\te natural para explicações. ',
                selected: true,
                providerVoiceId: 'segredo-que-nao-pode-passar',
                apiKey: 'tambem-nao',
            },
            { key: 'raw-fish-reference-id', name: 'Inválida', description: 'Não deve passar.' },
        ],
    });

    assert.deepEqual(context, {
        version: 1,
        voices: [{
            key: 'mv-custom-12345678',
            name: 'Voz Acolhedora',
            description: 'Calma e natural para explicações.',
            selected: true,
        }],
    });
    assert.doesNotMatch(JSON.stringify(context), /segredo|apiKey|providerVoiceId/);
});
test('limita o contexto encaminhado a 30 itens e 8 KB', () => {
    const context = normalizeNarratorVoiceContext({
        version: 1,
        voices: Array.from({ length: 80 }, (_, index) => ({
            key: `mv-custom-${String(index).padStart(8, '0')}`,
            name: `Voz ${index} ${'N'.repeat(70)}`,
            description: `Descrição ${index} ${'D'.repeat(230)}`,
            selected: index === 0,
        })),
    });
    assert.ok(context);
    assert.ok(context!.voices.length <= 30);
    assert.ok(Buffer.byteLength(JSON.stringify(context), 'utf8') <= 8 * 1024);
});
