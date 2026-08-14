import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editorSource = readFileSync(
    new URL('../src/lib/titleGeneratorEditor.ts', import.meta.url),
    'utf8',
);
const settingsSource = readFileSync(
    new URL('../src/pages/AiTitleGeneratorTest.tsx', import.meta.url),
    'utf8',
);

test('editor limita cada gatilho a tres titulos inclusive nos personalizados', () => {
    assert.match(editorSource, /version:\s*Math\.max\(5/);
    assert.match(editorSource, /Math\.min\(3,[\s\S]*trigger\.maxOccurrences/);
    assert.match(editorSource, /newCustomTriggerEditor[\s\S]*maxOccurrences:\s*3/);
    assert.match(settingsSource, /const MAX_TITLES_PER_TRIGGER = 3/);
    assert.match(settingsSource, /max=\{MAX_TITLES_PER_TRIGGER\}/);
});
test('editor impede salvar ou excluir abaixo de quatro gatilhos utilizaveis', () => {
    assert.match(settingsSource, /const MIN_USABLE_TITLE_TRIGGERS = 4/);
    assert.match(settingsSource, /snapshot\.filter\(isUsableTrigger\)\.length/);
    assert.match(settingsSource, /remaining\.filter\(isUsableTrigger\)\.length < MIN_USABLE_TITLE_TRIGGERS/);
    assert.match(settingsSource, /Todo gatilho ativo precisa manter pelo menos um modelo/);
});
