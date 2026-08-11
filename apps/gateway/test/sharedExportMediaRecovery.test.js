import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const exportSource = fs.readFileSync(
    new URL('../../client/src/context/ExportJobsContext.tsx', import.meta.url),
    'utf8',
);
const sharedRecoverySource = fs.readFileSync(
    new URL('../../client/src/lib/sharedMediaRecovery.ts', import.meta.url),
    'utf8',
);
const domCaptureSource = fs.readFileSync(
    new URL('../../client/src/lib/export/DOMCaptureEngine.ts', import.meta.url),
    'utf8',
);
const compiled = ts.transpileModule(sharedRecoverySource, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
    },
    fileName: 'sharedMediaRecovery.ts',
}).outputText;

const gatewayApi = {
    sharedAsset: async () => {
        throw new Error('sharedAsset inesperado');
    },
};
const runtimeRequire = (specifier) => {
    if (specifier === './gateway') return { gatewayApi };
    throw new Error(`require inesperado: ${specifier}`);
};
const runtimeModule = { exports: {} };
const factory = vm.runInNewContext(
    `(function(exports,module,require){${compiled}\n})`,
    { console, URL, crypto: globalThis.crypto },
);
factory(runtimeModule.exports, runtimeModule, runtimeRequire);

const {
    refreshSharedMasterAudioForExport,
    refreshSharedTakeForExport,
} = runtimeModule.exports;

const sharedTake = () => ({
    id: 'take-shared',
    fileName: 'Campanha: Agosto?.mp4',
    originalDurationSeconds: 8,
    url: 'https://old.example/source.mp4?expired=1',
    fileUrl: 'https://old.example/source.mp4?expired=1',
    proxyUrl: 'https://old.example/proxy.mp4?expired=1',
    backendPath: 'C:\\cache\\shared-old.mp4',
    sharedAssetId: 'shared-asset-1',
    type: 'video',
    trim: { start: 1.25, end: 6.75 },
    speedPresetId: 'fast_in_slow_out',
    objectFit: 'contain',
    motionEffect: { type: 'zoom-in', intensity: 0.2, focalX: 30, focalY: 40 },
    enhancement: { enabled: true, intensity: 'strong' },
    sharpness: { enabled: true, amount: 35 },
    transition: { id: 'film-burn' },
    muteOriginalAudio: true,
});

test('renova a URL compartilhada preservando integralmente o snapshot da timeline', async () => {
    const take = sharedTake();
    const calls = [];
    const freshUrl = 'https://mileto-shared-media.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/fresh.mp4?signature=new';
    const prepared = await refreshSharedTakeForExport(take, async (id) => {
        calls.push(id);
        return { publicUrl: freshUrl };
    });

    assert.deepEqual(calls, ['shared-asset-1']);
    assert.equal(prepared.url, freshUrl);
    assert.equal(prepared.fileUrl, freshUrl);
    assert.equal(prepared.proxyUrl, freshUrl);
    assert.equal(prepared.backendPath, undefined);
    for (const field of [
        'id', 'fileName', 'originalDurationSeconds', 'sharedAssetId', 'type', 'trim',
        'speedPresetId', 'objectFit', 'motionEffect', 'enhancement', 'sharpness',
        'transition', 'muteOriginalAudio',
    ]) {
        assert.deepEqual(
            JSON.parse(JSON.stringify(prepared[field])),
            JSON.parse(JSON.stringify(take[field])),
            field,
        );
    }
});

test('falha sem publicUrl usa código estável e nome de take sanitizado', async () => {
    const take = sharedTake();
    await assert.rejects(
        refreshSharedTakeForExport(take, async () => ({ publicUrl: '   ' })),
        (error) => {
            assert.match(error.message, /^shared_export_take_unavailable: Campanha_ Agosto_\.mp4:/);
            assert.doesNotMatch(error.message, /Campanha: Agosto\?/);
            return true;
        },
    );
});

test('renova o master compartilhado e recusa uma CDN fora do R2 privado', async () => {
    const freshUrl = 'https://mileto-shared-media.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/mix.mp3?signature=fresh';
    assert.equal(
        await refreshSharedMasterAudioForExport('shared-master-1', async (id) => {
            assert.equal(id, 'shared-master-1');
            return { publicUrl: freshUrl };
        }),
        freshUrl,
    );
    await assert.rejects(
        refreshSharedMasterAudioForExport(
            'shared-master-1',
            async () => ({ publicUrl: 'https://cdn.example.com/mix.mp3' }),
        ),
        /shared_export_audio_unavailable/,
    );
});

test('contrato renova compartilhados depois do finish e envia somente a URL fresca', () => {
    const finishIndex = exportSource.indexOf('const finishResult = (await engine.finish');
    const audioRefreshIndex = exportSource.indexOf('await refreshSharedMasterAudioForExport', 0);
    const refreshIndex = exportSource.indexOf('await refreshSharedTakeForExport(take)', finishIndex);
    const postIndex = exportSource.indexOf('/api/video/export-hybrid', refreshIndex);
    assert.ok(audioRefreshIndex >= 0 && audioRefreshIndex < finishIndex);
    assert.ok(finishIndex >= 0 && refreshIndex > finishIndex && postIndex > refreshIndex);
    assert.match(
        exportSource,
        /sharedMasterAssetId[\s\S]{0,180}!activeExport\.adData\.masterAudioUrl[\s\S]{0,120}sharedNarrationAssetId/,
    );
    assert.match(exportSource, /engine\.finish\([\s\S]{0,120}exportMasterAudioUrl/);
    assert.match(exportSource, /if \(take\.sharedAssetId\)[\s\S]{0,180}refreshSharedTakeForExport\(take\)/);
    assert.match(
        exportSource,
        /file_path:\s*take\.sharedAssetId[\s\S]{0,80}\? take\.fileUrl[\s\S]{0,120}: take\.externalMedia\?\.source === 'mileto_ops'/,
    );
    assert.match(sharedRecoverySource, /backendPath:\s*undefined/);
    assert.match(
        domCaptureSource,
        /if \(masterAudioUrl\)[\s\S]{0,180}export_audio_source_unavailable/,
        'uma fonte de áudio esperada não pode cair silenciosamente para WAV vazio',
    );
});

test('export não usa narração pura quando existe música sem master preparado', () => {
    const guardIndex = exportSource.indexOf('hasConfiguredBackgroundAudio && !hasPreparedMasterAudio');
    const narrationFallbackIndex = exportSource.indexOf('activeExport.adData.sharedNarrationAssetId');
    const finishIndex = exportSource.indexOf('const finishResult = (await engine.finish');

    assert.ok(guardIndex >= 0, 'o export deve detectar música sem mixagem pronta');
    assert.ok(guardIndex < narrationFallbackIndex && narrationFallbackIndex < finishIndex);
    assert.match(
        exportSource,
        /hasConfiguredBackgroundAudio[\s\S]{0,220}musicAudioUrl[\s\S]{0,120}sharedMusicAssetId/,
    );
    assert.match(
        exportSource,
        /hasPreparedMasterAudio[\s\S]{0,220}masterAudioUrl[\s\S]{0,120}sharedMasterAssetId/,
    );
    assert.match(exportSource, /export_audio_mix_required/);
});
