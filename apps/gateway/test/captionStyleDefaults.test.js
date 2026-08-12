import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const wizardContext = read('../../client/src/context/WizardContext.tsx');
const captionStudio = read('../../client/src/components/CaptionStudio.tsx');
const videoAgentWorkflow = read('../../client/src/lib/videoAgentWorkflow.ts');

const objectBody = (source, declaration) => {
    const match = source.match(new RegExp(`${declaration}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
    assert.ok(match, `nao encontrou ${declaration}`);
    return match[1];
};

test('projetos e legendas novos nascem com tamanho 16px e contorno 1px', () => {
    const defaultStyle = objectBody(wizardContext, 'DEFAULT_CAPTION_STYLE');
    assert.match(defaultStyle, /fontSize:\s*16,/);
    assert.match(defaultStyle, /strokeWidth:\s*1,/);

    assert.match(wizardContext, /useState<CaptionStyle \| null>\(\{ \.\.\.DEFAULT_CAPTION_STYLE \}\)/);
    assert.match(wizardContext, /startNewDraft[\s\S]*?setCaptionStyle\(\{ \.\.\.DEFAULT_CAPTION_STYLE \}\)/);
    assert.match(wizardContext, /snapshot\.captionStyle === undefined\s*\? \{ \.\.\.DEFAULT_CAPTION_STYLE \}/);

    const hackerMatrixPreset = captionStudio.match(/id: 'hacker-matrix'[\s\S]*?\}\s*\},/);
    assert.ok(hackerMatrixPreset, 'nao encontrou o preset Hacker Matrix');
    assert.match(hackerMatrixPreset[0], /fontSize:\s*16,/);
    assert.match(hackerMatrixPreset[0], /strokeWidth:\s*1,/);

    const automatedStyle = objectBody(videoAgentWorkflow, 'DEFAULT_AUTOMATED_CAPTION_STYLE');
    assert.match(automatedStyle, /fontSize:\s*16,/);
    assert.match(automatedStyle, /strokeWidth:\s*1,/);
});
