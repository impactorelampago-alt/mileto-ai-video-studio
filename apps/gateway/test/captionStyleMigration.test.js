import test from 'node:test';
import assert from 'node:assert/strict';
import {
    HACKER_MATRIX_PRESET_REVISION,
    normalizeHydratedCaptionStyle,
} from '../../client/src/lib/captionStyleMigration.ts';

const legacyHackerMatrix = {
    id: 'hacker-matrix',
    name: 'Hacker Matrix',
    previewClass: '',
    fontFamily: 'Montserrat',
    fontSize: 20,
    strokeWidth: 4,
    activeColor: '#00c0c0',
    baseColor: '#FFFFFF',
    strokeColor: '#000000',
    verticalPosition: 23,
};

test('migra somente o antigo padrao Hacker Matrix e preserva a cor da marca', () => {
    const normalized = normalizeHydratedCaptionStyle(legacyHackerMatrix);

    assert.notStrictEqual(normalized, legacyHackerMatrix);
    assert.equal(normalized.fontSize, 16);
    assert.equal(normalized.strokeWidth, 1);
    assert.equal(normalized.activeColor, '#00c0c0');
    assert.equal(normalized.presetRevision, HACKER_MATRIX_PRESET_REVISION);
});

test('migra a geometria intermediaria 20/1 e versiona o legado 16/1 sem altera-lo', () => {
    const intermediate = normalizeHydratedCaptionStyle({ ...legacyHackerMatrix, strokeWidth: 1 });
    assert.equal(intermediate.fontSize, 16);
    assert.equal(intermediate.strokeWidth, 1);
    assert.equal(intermediate.presetRevision, HACKER_MATRIX_PRESET_REVISION);

    const legacyCurrentGeometry = { ...legacyHackerMatrix, fontSize: 16, strokeWidth: 1 };
    const versioned = normalizeHydratedCaptionStyle(legacyCurrentGeometry);
    assert.equal(versioned.fontSize, 16);
    assert.equal(versioned.strokeWidth, 1);
    assert.equal(versioned.presetRevision, HACKER_MATRIX_PRESET_REVISION);
});

test('preserva estilos customizados e ajustes feitos sobre o preset atual', () => {
    const customizations = [
        { ...legacyHackerMatrix, fontSize: 22 },
        { ...legacyHackerMatrix, strokeWidth: 3 },
        { ...legacyHackerMatrix, fontFamily: 'Anton' },
        { ...legacyHackerMatrix, baseColor: '#eeeeee' },
        { ...legacyHackerMatrix, strokeColor: '#111111' },
        { ...legacyHackerMatrix, verticalPosition: 24 },
        { ...legacyHackerMatrix, presetRevision: HACKER_MATRIX_PRESET_REVISION },
    ];

    for (const customStyle of customizations) {
        assert.strictEqual(normalizeHydratedCaptionStyle(customStyle), customStyle);
    }
});
