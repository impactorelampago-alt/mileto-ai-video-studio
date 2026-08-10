import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const clientPath = (relative) => path.resolve(__dirname, '../../client/src', relative);
const serverPath = (relative) => path.resolve(__dirname, '../../server/src', relative);
const readClient = (relative) => fs.readFileSync(clientPath(relative), 'utf8');
const readServer = (relative) => fs.readFileSync(serverPath(relative), 'utf8');

const loadClientModule = (relative) => {
    const sourcePath = clientPath(relative);
    const compiled = ts.transpileModule(readClient(relative), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: sourcePath,
    }).outputText;
    const runtimeModule = { exports: {} };
    const factory = vm.runInNewContext(
        `(function(exports,module,require){${compiled}\n})`,
        { console },
    );
    factory(runtimeModule.exports, runtimeModule, require);
    return runtimeModule.exports;
};

const titleEditing = loadClientModule('lib/titleEditing.ts');

const generatedTitle = (updates = {}) => ({
    id: 'generated-title',
    text: 'EXAME DE VISTA',
    sourceText: 'Faça agora seu exame de vista completo',
    triggerId: 'benefit',
    semanticRoles: ['offer_or_benefit'],
    startSec: 7,
    durationSec: 2.5,
    isActive: true,
    posY: 30,
    posX: 50,
    scale: 1,
    maxWords: 3,
    styleId: 'premium-kinetic-punch',
    primaryColor: '#C7FF3D',
    secondaryColor: '#FFFFFF',
    fontFamily: 'Archivo Black',
    animationId: 'none',
    hasSound: true,
    colorBinding: {
        mode: 'brand',
        paletteSlot: 'primary',
        secondaryPaletteSlot: 'secondary',
    },
    ...updates,
});

test('edição manual aceita texto acima do maxWords sem truncar', () => {
    const original = generatedTitle();
    const manualText = 'EXAME DE VISTA COMPLETO POR NOSSA CONTA';
    const updated = titleEditing.applyManualTitleUpdate(original, { text: manualText });

    assert.equal(updated.text, manualText);
    assert.equal(updated.maxWords, 3, 'maxWords continua apenas como metadado da geração');
    assert.equal(updated.sourceText, undefined);
    assert.equal(updated.triggerId, undefined);
    assert.equal(updated.semanticRoles, undefined);
    assert.equal(original.text, 'EXAME DE VISTA');
});

test('duplicação cria uma cópia independente logo depois do original', () => {
    const before = generatedTitle({ id: 'before', startSec: 1 });
    const source = generatedTitle({ imageUrl: 'blob:titulo-personalizado' });
    const after = generatedTitle({ id: 'after', startSec: 12 });
    const input = [before, source, after];
    const result = titleEditing.duplicateTitleAfter(input, source.id, 'manual-copy-1');

    assert.ok(result);
    assert.equal(result.titles.map((title) => title.id).join(','), 'before,generated-title,manual-copy-1,after');
    assert.equal(result.duplicate.text, source.text);
    assert.equal(result.duplicate.startSec, source.startSec);
    assert.equal(result.duplicate.durationSec, source.durationSec);
    assert.equal(result.duplicate.styleId, source.styleId);
    assert.equal(result.duplicate.imageUrl, source.imageUrl);
    assert.notEqual(result.duplicate, source);
    assert.notEqual(result.duplicate.semanticRoles, source.semanticRoles);
    assert.notEqual(result.duplicate.colorBinding, source.colorBinding);
    assert.deepEqual(input.map((title) => title.id), ['before', 'generated-title', 'after']);
});

test('duplicação de id inexistente não altera a lista', () => {
    const input = [generatedTitle()];
    assert.equal(titleEditing.duplicateTitleAfter(input, 'missing', 'copy'), null);
    assert.equal(input.length, 1);
});

test('painel e editor sobre o vídeo não aplicam limite da IA à digitação manual', () => {
    const step4 = readClient('pages/Step4.tsx');
    const overlay = readClient('components/EditableTitleOverlay.tsx');

    assert.doesNotMatch(step4, /limitTitleWords/);
    assert.doesNotMatch(overlay, /limitTitleWords|title\.maxWords/);
    assert.match(step4, /applyManualTitleUpdate\(t, updates\)/);
    assert.match(overlay, /setDraftText\(event\.target\.value\)/);
});

test('limite continua aplicado somente na geração automática', () => {
    const aiPreview = readClient('pages/AiTitleGeneratorTest.tsx');
    const aiController = readServer('controllers/aiController.ts');
    const generationRules = readServer('services/titleGenerationRules.ts');

    assert.match(aiPreview, /limitTitleWords\(selectedTrigger\.sample, selectedTrigger\.maxWords\)/);
    assert.match(aiController, /trigger\.maxWords/);
    assert.match(aiController, /maxWords:\s*visualMaxWords/);
    assert.match(generationRules, /limitTitleWords\(text, maxWords\)/);
});

test('Step 4 oferece ação acessível para duplicar e persiste a cópia localmente', () => {
    const step4 = readClient('pages/Step4.tsx');
    const duplicateStart = step4.indexOf('const duplicateTitle =');
    const duplicateEnd = step4.indexOf('const handleSelectTitle', duplicateStart);
    const duplicateBlock = step4.slice(duplicateStart, duplicateEnd);

    assert.ok(duplicateStart >= 0 && duplicateEnd > duplicateStart);
    assert.match(duplicateBlock, /duplicateTitleAfter\(titles, id,/);
    assert.match(duplicateBlock, /persistManualTitles\(result\.titles\)/);
    assert.match(duplicateBlock, /setSelectedTitleId\(result\.duplicate\.id\)/);
    assert.match(step4, /aria-label=\{`Duplicar título/);
    assert.match(step4, /<CopyPlus/);
});
