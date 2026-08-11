import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const wizard = read('../../client/src/context/WizardContext.tsx');
const transitionsModal = read('../../client/src/components/TransitionsModal.tsx');
const step4 = read('../../client/src/pages/Step4.tsx');

const section = (source, start, end) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `início da seção ausente: ${start}`);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `fim da seção ausente: ${end}`);
    return source.slice(from, to);
};

test('Alice compartilha uma transição incluída e Bob recebe a mesma identidade sem caminho local', () => {
    const prepare = section(wizard, 'const prepareSharedPayload', 'const hydrateSharedPayload');
    const syncTransition = section(prepare, 'const syncTransition', 'const syncAudio');

    assert.match(syncTransition, /const portableTransition:[\s\S]*?\.\.\.transition,[\s\S]*?filePath:\s*''/);
    assert.match(syncTransition, /if \(isIncludedTransition\(transition\)\) return portableTransition/);
    assert.match(prepare, /nextAd\.transitionPath\s*=\s*undefined/);
    assert.match(prepare, /nextAd\.globalTransition\s*=\s*await syncTransition\(nextAd\.globalTransition\)/);
    assert.match(wizard, /nextAd\.globalTransition\s*=\s*\{ \.\.\.nextAd\.globalTransition, filePath: '' \}/);
});

test('referência compartilhada preserva sharedAssetId e renova publicUrl ao hidratar', () => {
    const prepare = section(wizard, 'const prepareSharedPayload', 'const hydrateSharedPayload');
    const hydrate = section(wizard, 'const hydrateSharedPayload', 'const saveProject');

    assert.match(
        prepare,
        /const sharedAssetId = String\(transition\.sharedAssetId[\s\S]*?scope:\s*'shared',[\s\S]*?sharedAssetId,/,
    );
    assert.match(hydrate, /globalTransition\?\.sharedAssetId\) ids\.add\(nextAd\.globalTransition\.sharedAssetId\)/);
    assert.match(hydrate, /const asset = assets\.get\(sharedAssetId\)/);
    assert.match(hydrate, /if \(asset\) transition\.publicUrl = asset\.publicUrl/);
    assert.match(hydrate, /transition\.filePath\s*=\s*''/);
});

test('transição customizada local é importada para Vídeos/Transições como referência compartilhada', () => {
    const prepare = section(wizard, 'const prepareSharedPayload', 'const hydrateSharedPayload');

    assert.match(prepare, /await importLocalAsset\(\{[\s\S]*?parent:\s*'Vídeos\/Transições'/);
    assert.match(prepare, /preventDuplicate:\s*true/);
    assert.match(prepare, /id:\s*`shared:\$\{entry\.id\}`/);
    assert.match(prepare, /sharedAssetId:\s*entry\.id/);
    assert.match(prepare, /publicUrl:\s*entry\.publicUrl/);
    assert.match(prepare, /portableTransitionAsset[\s\S]*?await syncTransition\(serializableTake\.transition\.asset\)/);
});

test('remover ou trocar a transição global elimina transitionPath legado e Step4 não o prioriza', () => {
    const clearMatches = transitionsModal.match(
        /updateAdData\(\{ globalTransition: null, transitionPath: undefined \}\)/g,
    ) || [];
    assert.ok(clearMatches.length >= 2, 'remoção e exclusão precisam limpar o caminho legado');
    assert.match(
        transitionsModal,
        /globalTransition:\s*transitionToApply,[\s\S]*?transitionPath:\s*transitionToApply\.filePath \|\| undefined/,
    );
    assert.match(
        step4,
        /transitionPath=\{adData\.globalTransition\?\.filePath \|\| undefined\}/,
    );
    assert.doesNotMatch(step4, /transitionPath=\{adData\.transitionPath \|\| adData\.globalTransition\?\.filePath\}/);
});
