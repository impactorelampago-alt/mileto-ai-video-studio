import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const wizard = read('../../client/src/context/WizardContext.tsx');
const narrationState = read('../../client/src/lib/narrationState.ts');
const audioIsolation = read('../../client/src/lib/audioIsolation.ts');
const step3 = read('../../client/src/pages/Step3.tsx');
const sharedRecovery = read('../../client/src/lib/sharedMediaRecovery.ts');
const sharedController = read('../../server/src/controllers/sharedController.ts');
const audioController = read('../../server/src/controllers/audioController.ts');
const serverRoutes = read('../../server/src/routes/api.ts');

const section = (source, start, end) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `início da seção ausente: ${start}`);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `fim da seção ausente: ${end}`);
    return source.slice(from, to);
};

test('publicação compartilhada reatribui legendas e títulos à identidade portátil da mesma narração', () => {
    const prepare = section(wizard, 'const prepareSharedPayload', 'const hydrateSharedPayload');
    const previousAt = prepare.indexOf('const previousNarrationSourceKey = narrationSourceKey(nextAd)');
    const uploadAt = prepare.indexOf("await syncAudio(\n            'narrationAudioUrl'");
    const portableAt = prepare.indexOf('const portableNarrationSourceKey = narrationSourceKey(nextAd)');

    assert.ok(previousAt >= 0 && uploadAt > previousAt && portableAt > uploadAt);
    assert.match(prepare, /rebindNarrationDerivativeSourceKeys\([\s\S]*?previousNarrationSourceKey,[\s\S]*?portableNarrationSourceKey/);
});

test('hidratação recupera derivados ocultos pelo bug de transporte da v1.4.33', () => {
    const hydrate = section(wizard, 'const hydrateSharedPayload', 'const saveProject');
    const lookupAt = hydrate.indexOf('const narration = nextAd.sharedNarrationAssetId ? assets.get');
    const stableAt = hydrate.indexOf('const stableNarrationSourceKey = narrationSourceKey({');

    assert.ok(lookupAt >= 0 && stableAt > lookupAt);
    assert.match(hydrate, /nextAd\.isNarrationGenerated[\s\S]*?nextAd\.captions\?\.segments\?\.length/);
    assert.match(hydrate, /\^narration-v1-\[a-f0-9\]\+\$\/i\.test\(storedCaptionSourceKey\)/);
    assert.match(hydrate, /rebindNarrationDerivativeSourceKeys\([\s\S]*?storedCaptionSourceKey![\s\S]*?stableNarrationSourceKey/);
});

test('helper puro recupera o caso real sem alterar os 18 segmentos nem os 4 títulos', async () => {
    const audioIsolationJavascript = ts.transpileModule(audioIsolation, {
        compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const audioIsolationModuleUrl = `data:text/javascript;base64,${Buffer.from(audioIsolationJavascript).toString('base64')}`;
    const javascript = ts.transpileModule(narrationState, {
        compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText.replace(
        /from ['"]\.\/audioIsolation(?:\.ts)?['"]/,
        `from '${audioIsolationModuleUrl}'`,
    );
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`;
    const { narrationSourceKey, rebindNarrationDerivativeSourceKeys } = await import(moduleUrl);

    // Draft 8980071e: a URL local original gerou 5c22cdd5; o asset estável
    // 9b44af2d-9a30-4dc2-b92f-0557661580df gera 630c9db4 para o mesmo roteiro.
    const narrationText = '[emphasis]Você sabia que na Vivazz em Avaré  o exame de vista que custa cem reais está saindo por apenas dezenove e noventa? [pause]\n\n[excited]É isso mesmo! Com equipamentos modernos que avaliam com precisão as ametropias — as dificuldades para enxergar de perto e de longe — você cuida da sua visão sem pesar no bolso.\n\n[emphasis]Mas atenção: essa promoção é válida só até sábado! [pause]\n\nNão perca tempo, chame agora no WhatsApp da Vivazz e garanta seu exame com esse preço especial. [emphasis]';
    const localSourceKey = narrationSourceKey({
        narrationText,
        narrationAudioUrl: 'http://localhost:3301/narrations/narration-cb9440b016876bc708f702121d9da65a.mp3',
        narrationAudioPath: null,
    });
    const sharedSourceKey = narrationSourceKey({
        narrationText,
        narrationAudioUrl: 'https://capability-renovavel.r2.cloudflarestorage.com/objeto',
        narrationAudioPath: null,
        sharedNarrationAssetId: '9b44af2d-9a30-4dc2-b92f-0557661580df',
    });
    const oldKey = 'narration-v1-5c22cdd5';
    const stableKey = 'narration-v1-630c9db4';
    assert.equal(localSourceKey, oldKey);
    assert.equal(sharedSourceKey, stableKey);
    const segments = Array.from({ length: 18 }, (_, index) => ({ id: `segment-${index}` }));
    const titles = Array.from({ length: 4 }, (_, index) => ({ id: `title-${index}` }));
    const affectedDraft = {
        captions: { sourceKey: oldKey, segments },
        dynamicTitlesSourceKey: oldKey,
        dynamicTitles: titles,
    };
    const rebound = {
        ...affectedDraft,
        ...rebindNarrationDerivativeSourceKeys(affectedDraft, oldKey, stableKey),
    };

    assert.equal(rebound.captions.sourceKey, stableKey);
    assert.equal(rebound.dynamicTitlesSourceKey, stableKey);
    assert.strictEqual(rebound.captions.segments, segments);
    assert.strictEqual(rebound.dynamicTitles, titles);
    assert.deepEqual(
        rebindNarrationDerivativeSourceKeys(affectedDraft, 'narration-v1-outra-fonte', stableKey),
        {},
        'uma fonte realmente diferente não pode ser reatribuída',
    );
});

test('uma narração realmente nova não herda caminho nem identidade compartilhada anteriores', () => {
    const invalidation = section(narrationState, 'invalidatedNarrationDerivatives', '});');
    assert.match(invalidation, /narrationAudioPath:\s*null/);
    assert.match(invalidation, /sharedNarrationAssetId:\s*undefined/);
    assert.match(invalidation, /captions:\s*undefined/);
    assert.match(invalidation, /dynamicTitles:\s*\[\]/);
});

test('Step 3 materializa o asset compartilhado antes de chamar STT', () => {
    const stepGenerate = section(step3, 'const handleGenerateCaptions', 'const handleNext');
    assert.match(stepGenerate, /resolveEffectiveNarrationAudio\(operationAdData\)/);
    assert.match(stepGenerate, /operationNarration\.variant === 'original'[\s\S]*?operationNarration\.sharedAssetId[\s\S]*?sharedMasterAssetId/);
    const materializeAt = stepGenerate.indexOf('await materializeSharedAudioForCaptions(sharedAudioAssetId)');
    const sttAt = stepGenerate.indexOf('/api/stt/generate-captions');
    assert.ok(materializeAt >= 0 && sttAt > materializeAt);
    assert.match(sharedRecovery, /materialize-audio/);
    assert.match(sharedRecovery, /headers:\s*await localAuthHeaders\(\)/);
});

test('servidor autentica, valida e baixa o áudio em cache local atômico e limitado', () => {
    const materialize = section(sharedController, 'export const materializeAudio', 'export const materializeTransition');
    assert.match(serverRoutes, /router\.post\('\/shared\/files\/item\/:assetId\/materialize-audio', sharedController\.materializeAudio\)/);
    assert.match(materialize, /gatewayRequest\([\s\S]*?\/shared\/files\/item\/\$\{encodeURIComponent\(assetId\)\}/);
    assert.match(materialize, /item\.type !== 'audio'/);
    assert.match(sharedController, /MAX_CAPTION_AUDIO_BYTES = 25 \* 1024 \* 1024/);
    assert.match(sharedController, /\.r2\.cloudflarestorage\.com/);
    assert.match(sharedController, /downloadRemoteAudioFile\([\s\S]*?MAX_CAPTION_AUDIO_BYTES,[\s\S]*?isAllowedSharedAudioUrl/);
    assert.match(sharedController, /ensureValidAudioCacheFile\([\s\S]*?isUsableAudioCacheFile/);
    assert.match(audioController, /crypto\.randomUUID\(\)[\s\S]*?rename\(temporaryPath, targetPath\)/);
    assert.match(materialize, /publicUrl: `\/narrations\/shared\/\$\{filename\}`/);
    const responseAt = materialize.lastIndexOf('res.json({');
    assert.ok(responseAt >= 0);
    assert.doesNotMatch(materialize.slice(responseAt), /item\.publicUrl/);
});
