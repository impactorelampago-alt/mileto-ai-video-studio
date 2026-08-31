import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const player = read('../../client/src/components/MiletoMediaPlayer.tsx');
const range = read('../../client/src/components/MediaRange.tsx');
const audioPlayer = read('../../client/src/components/AudioPlayer.tsx');
const fileExplorer = read('../../client/src/components/FileExplorer.tsx');
const opsLibrary = read('../../client/src/components/OpsLibrary.tsx');
const fileExplorerController = read('../../server/src/controllers/fileExplorerController.ts');
const apiRoutes = read('../../server/src/routes/api.ts');

test('player comum substitui controles nativos nas prévias de Arquivos', () => {
    assert.doesNotMatch(fileExplorer, /<video[\s\S]{0,160}\bcontrols\b/);
    assert.doesNotMatch(fileExplorer, /<audio[\s\S]{0,160}\bcontrols\b/);
    assert.match(fileExplorer, /<MiletoMediaPlayer[\s\S]*?downloadName=\{file\.name\}/);
    assert.equal((fileExplorer.match(/<AudioPlayer\b/g) || []).length, 2);
    assert.match(audioPlayer, /preload=\{compact \? 'none' : 'metadata'\}/);
    assert.match(audioPlayer, /setWaiting\(!compact\)/);
});

test('timeline mantém trilho discreto, progresso mais espesso e input acessível amplo', () => {
    assert.match(range, /compact \? 'h-5' : 'h-7'/);
    assert.match(range, /absolute inset-x-0 h-0\.5/);
    assert.match(range, /absolute left-0 h-1/);
    assert.match(range, /type="range"/);
    assert.match(range, /aria-label=\{label\}/);
    assert.match(player, /label="Posição do vídeo"/);
    assert.match(player, /label="Volume"/);
    assert.match(audioPlayer, /label="Posição do áudio"/);
    assert.match(audioPlayer, /label="Volume"/);
});

test('download fica junto ao fullscreen sem copiar vídeos grandes para Blob', () => {
    const downloadAt = player.indexOf('aria-label="Baixar vídeo"');
    const fullscreenAt = player.indexOf("aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}");
    assert.ok(downloadAt >= 0);
    assert.ok(fullscreenAt > downloadAt);
    assert.doesNotMatch(player, /response\.blob\(|createObjectURL|fetch\(parsed\.href/);
    assert.match(player, /anchor\.download = fileName/);
    assert.match(player, /anchor\.target = '_blank'/);
    assert.match(opsLibrary, /onDownload=\{\(\) => downloadAsset\(preview\.asset\)\}/);
    assert.match(fileExplorer, /gatewayApi\.sharedAssetDownload\(preview\.id\)/);
    assert.match(fileExplorer, /resolveDownloadSource=\{scope === 'shared'/);
});

test('player preserva teclado, volume, loading, erro e fullscreen', () => {
    for (const marker of [
        "event.key === 'ArrowLeft'",
        "event.key === 'ArrowRight'",
        "event.key.toLowerCase() === 'm'",
        "event.key.toLowerCase() === 'f'",
        'onWaiting={() => setWaiting(true)}',
        'onError={() =>',
        "document.addEventListener('fullscreenchange'",
    ]) {
        assert.ok(player.includes(marker), `faltou contrato: ${marker}`);
    }
});

test('Editor de Cortes prefere proxy compatível sem trocar o original de exportação', () => {
    const trimModal = read('../../client/src/components/TrimModal.tsx');
    assert.match(trimModal, /const localPreviewSource = take\.proxyUrl \|\| take\.url/);
    assert.match(trimModal, /previewCandidates\.find\(\(source\) => !failedPreviewSources\.has\(source\)\)/);
    assert.match(trimModal, /<video[\s\S]*?src=\{previewSource\}/);
    assert.doesNotMatch(trimModal, /<video[\s\S]{0,160}?src=\{take\.url\}/);
});

test('recorte abre pelo stream aquecido e materializa o original em segundo plano', () => {
    const openTrim = opsLibrary.slice(
        opsLibrary.indexOf('const beginAssetTrim'),
        opsLibrary.indexOf('const beginAssetFraming'),
    );
    assert.match(openTrim, /const materializing = materializeForTrim\(asset\)/);
    assert.match(openTrim, /await Promise\.race\(\[/);
    assert.match(openTrim, /resolvePreviewSource\(asset\)\.then/);
    assert.match(openTrim, /materializing\.then\(\(take\) => \(\{ kind: 'local'/);
    assert.match(openTrim, /setTrimTarget\(\{[\s\S]*previewUrl: remotePreview\.url,[\s\S]*materializing: true/);
    assert.match(openTrim, /void materializing[\s\S]*\.then\(\(localTake\)/);
    assert.equal(
        (opsLibrary.match(/onPointerEnter=\{\(\) => warmPreviewSource\(asset\)\}/g) || []).length,
        4,
        'card e botão de recorte devem aquecer o stream nos modos grade e lista',
    );
});

test('download local usa endpoint attachment em vez da URL publica cross-origin', () => {
    assert.match(fileExplorer, /\/api\/files\/download\?/);
    assert.match(fileExplorerController, /export const downloadItem/);
    assert.match(fileExplorerController, /existingEntryPath\(entry, requestedRelPath\)/);
    assert.match(fileExplorerController, /res\.download\(filePath,/);
    assert.match(apiRoutes, /router\.get\('\/files\/download', fileExplorerController\.downloadItem\)/);
});
