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
const readClient = (relative) => fs.readFileSync(clientPath(relative), 'utf8');

const loadClientModule = (relative, dependencyMocks = {}) => {
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
    const runtimeRequire = (specifier) => {
        if (Object.hasOwn(dependencyMocks, specifier)) return dependencyMocks[specifier];
        return require(specifier);
    };
    const factory = vm.runInNewContext(
        `(function(exports,module,require){${compiled}\n})`,
        { console },
    );
    factory(runtimeModule.exports, runtimeModule, runtimeRequire);
    return runtimeModule.exports;
};

const premiumModels = loadClientModule('lib/premiumTitleModels.ts');
const catalog = loadClientModule('lib/titleModelCatalog.ts', {
    './premiumTitleModels': premiumModels,
});

const title = (updates = {}) => ({
    id: 'title-1',
    text: 'OFERTA ESPECIAL',
    startSec: 0,
    durationSec: 3,
    isActive: true,
    posY: 30,
    styleId: 'premium-creator-caption',
    primaryColor: '#123456',
    secondaryColor: '#abcdef',
    fontFamily: 'Poppins',
    animationId: 'pop',
    ...updates,
});

const modelById = (id) => {
    const model = catalog.TITLE_MODEL_CATALOG.find((candidate) => candidate.id === id);
    assert.ok(model, `preset ${id} deve existir no catálogo`);
    return model;
};

test('trocar o estilo aplica a paleta e a fonte padrão do novo preset', () => {
    const current = title();
    const model = modelById('premium-sale-spotlight');
    const patch = catalog.titleStyleSelectionPatch(current, model);
    assert.ok(patch);
    const updated = { ...current, ...patch };

    assert.equal(updated.styleId, model.id);
    assert.equal(updated.primaryColor, model.primaryColor);
    assert.equal(updated.secondaryColor, model.secondaryColor);
    assert.equal(updated.fontFamily, model.fontFamily);
    assert.notEqual(updated.primaryColor, current.primaryColor);
});

test('clicar novamente no mesmo estilo preserva customização e vínculo de marca', () => {
    const colorBinding = {
        mode: 'brand',
        paletteSlot: 'primary',
        secondaryPaletteSlot: 'secondary',
        fallbackPrimary: '#14e6ff',
        fallbackSecondary: '#ffffff',
    };
    const model = modelById('premium-creator-caption');
    const current = title({ colorBinding });
    const patch = catalog.titleStyleSelectionPatch(current, model);
    const updated = { ...current, ...patch };

    assert.equal(Object.keys(patch).length, 0);
    assert.equal(updated.primaryColor, '#123456');
    assert.equal(updated.secondaryColor, '#abcdef');
    assert.equal(updated.fontFamily, 'Poppins');
    assert.equal(updated.animationId, 'pop');
    assert.equal(updated.colorBinding, colorBinding);
    assert.equal(Object.hasOwn(patch, 'primaryColor'), false);
    assert.equal(Object.hasOwn(patch, 'secondaryColor'), false);
    assert.equal(Object.hasOwn(patch, 'colorBinding'), false);
});

test('trocar para a paleta de outro estilo remove explicitamente o colorBinding anterior', () => {
    const current = title({
        colorBinding: {
            mode: 'brand',
            paletteSlot: 'rotate',
            rotationIndex: 1,
            fallbackPrimary: '#14e6ff',
            fallbackSecondary: '#ffffff',
        },
    });
    const model = modelById('premium-aurora-signal');
    const patch = catalog.titleStyleSelectionPatch(current, model);
    assert.ok(patch);
    const updated = { ...current, ...patch };

    assert.equal(Object.hasOwn(patch, 'colorBinding'), true);
    assert.equal(updated.colorBinding, undefined);
    assert.equal(updated.primaryColor, model.primaryColor);
    assert.equal(updated.secondaryColor, model.secondaryColor);
});

test('todos os presets selecionáveis possuem paletas hexadecimais e metadados válidos', () => {
    assert.ok(Array.isArray(catalog.SIMPLE_TITLE_MODELS));
    assert.ok(catalog.SIMPLE_TITLE_MODELS.length > 0);
    assert.ok(catalog.CTA_TITLE_MODELS.length > 0);
    assert.ok(catalog.LOCATION_TITLE_MODELS.length > 0);
    assert.ok(Array.isArray(catalog.TITLE_STYLE_PRESETS));

    const ids = new Set();
    for (const model of catalog.TITLE_STYLE_PRESETS) {
        assert.match(model.id, /^[a-z0-9-]+$/);
        assert.ok(String(model.name || '').trim(), `${model.id} deve possuir nome`);
        assert.match(model.primaryColor, /^#[0-9a-f]{6}$/i, `${model.id} deve possuir cor primária válida`);
        assert.match(model.secondaryColor, /^#[0-9a-f]{6}$/i, `${model.id} deve possuir cor secundária válida`);
        assert.ok(String(model.fontFamily || '').trim(), `${model.id} deve possuir fonte padrão`);
        assert.equal(ids.has(model.id), false, `id de preset duplicado: ${model.id}`);
        ids.add(model.id);
    }

    for (const model of catalog.SIMPLE_TITLE_MODELS) {
        assert.ok(ids.has(model.id), `preset simples ${model.id} deve integrar a lista de estilos selecionáveis`);
    }
});

test('presets exclusivos do editor não ampliam o catálogo configurável da IA', () => {
    const aiModelIds = new Set(catalog.TITLE_MODEL_CATALOG.map((model) => model.id));

    for (const model of catalog.SIMPLE_TITLE_MODELS) {
        assert.equal(aiModelIds.has(model.id), false, `${model.id} não deve entrar no catálogo da IA`);
    }
    assert.equal(aiModelIds.has(catalog.IMAGE_TITLE_MODEL.id), false);
});

test('renderer prioriza cor persistida e usa a paleta do estilo como fallback', () => {
    const renderer = readClient('components/DynamicTitleRenderer.tsx');

    assert.match(renderer, /const stylePreset = titleStylePresetById\(styleId\)/);
    assert.match(
        renderer,
        /const primary = title\.primaryColor \|\| stylePreset\?\.primaryColor \|\| '#00E676'/,
    );
    assert.match(
        renderer,
        /const secondary = title\.secondaryColor \|\| stylePreset\?\.secondaryColor \|\| '#FFFFFF'/,
    );
    assert.equal(catalog.titleStylePresetById('solid-ribbon').primaryColor, '#00E6A8');
});

test('as quatro galerias do Step 4 usam o fluxo único de aplicação de estilo', () => {
    const step4 = readClient('pages/Step4.tsx');
    const section = (startMarker, endMarker) => {
        const start = step4.indexOf(startMarker);
        const end = step4.indexOf(endMarker, start + startMarker.length);
        assert.ok(start >= 0, `seção ausente: ${startMarker}`);
        assert.ok(end > start, `fim de seção ausente: ${endMarker}`);
        return step4.slice(start, end);
    };
    const galleries = [
        section('Accordion: Simples', 'Accordion: Call to Action'),
        section('Accordion: Call to Action', 'Accordion: Premium'),
        section('Accordion: Premium', 'Accordion: Localização'),
        section('Accordion: Localização', 'Accordion: Upload Imagem Personalizada'),
    ];

    assert.match(step4, /const applySelectedTitleStyle\s*=/);
    assert.match(step4, /titleStyleSelectionPatch\(/);
    for (const gallery of galleries) {
        assert.match(gallery, /applySelectedTitleStyle\(model(?:,|\))/);
        assert.doesNotMatch(
            gallery,
            /updateTitle\(selectedTitle\.id,\s*\{\s*styleId:\s*model\.id/,
        );
    }
});

test('o editor de cores continua removendo o binding ao assumir uma escolha manual', () => {
    const step4 = readClient('pages/Step4.tsx');
    const titleEditing = readClient('lib/titleEditing.ts');

    assert.match(step4, /applyManualTitleUpdate\(t, updates\)/);
    assert.match(titleEditing, /primaryColor/);
    assert.match(titleEditing, /secondaryColor/);
    assert.match(titleEditing, /colorEdited[\s\S]*colorBinding:\s*undefined/);
    assert.ok(
        (step4.match(/type="color"/g) || []).length >= 2,
        'o usuário deve continuar com controles para editar as duas cores',
    );
});
