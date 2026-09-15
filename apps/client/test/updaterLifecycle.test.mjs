import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(
    new URL('../electron-main/main.cjs', import.meta.url),
    'utf8',
);
const rendererSource = readFileSync(
    new URL('../src/layouts/MainLayout.tsx', import.meta.url),
    'utf8',
);

test('atualizador pertence ao processo principal e volta a verificar durante toda a sessão', () => {
    assert.match(mainSource, /scheduleAutomaticUpdateCheck\(5000\)/);
    assert.match(mainSource, /scheduleAutomaticUpdateCheck\(1000\)/);
    assert.match(mainSource, /AUTOMATIC_UPDATE_INTERVAL_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
    assert.match(mainSource, /AUTOMATIC_UPDATE_RETRY_MS\s*=\s*2\s*\*\s*60\s*\*\s*1000/);
    assert.match(mainSource, /update-downloaded[\s\S]*installDownloadedUpdate\(\)/);
});

test('renderer apenas exibe o status e não controla o ciclo automático', () => {
    assert.doesNotMatch(rendererSource, /automaticUpdateCheckStarted/);
    assert.doesNotMatch(rendererSource, /runUpdateCheck\(false\)/);
    assert.doesNotMatch(rendererSource, /updater\.install\(\)/);
});
