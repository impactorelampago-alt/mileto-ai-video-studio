import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    captureTitleWorkflowAsyncFingerprint,
    isTitleWorkflowAsyncFingerprintCurrent,
} from '../src/lib/titleWorkflowAsyncGuard.ts';
import { titlePlanningNarrationKey } from '../src/lib/titlePlanningKey.ts';

const baseAdData = () => {
    const narrationPlainText = 'Multifocais a partir de R$ 199.';
    return {
        narrationPlainText,
        narrationText: narrationPlainText,
        narrationAudioUrl: 'http://localhost/audio/current.mp3',
        narrationAudioPath: null,
        sharedNarrationAssetId: undefined,
        plannedTitlesNarrationKey: titlePlanningNarrationKey(narrationPlainText),
        plannedTitles: [{
            id: 'price',
            text: 'R$ 199',
            sourceText: narrationPlainText,
            triggerId: 'price',
            triggerName: 'Preço',
            selected: true,
        }],
        captions: {
            enabled: true,
            language: 'pt-BR',
            presetId: 'karaoke-yellow',
            sourceKey: 'narration-v1-current',
            segments: [{
                id: 'caption-1',
                start: 0,
                end: 1.2,
                text: narrationPlainText,
                words: [{ text: 'Multifocais', start: 0, end: 0.4 }],
            }],
        },
    };
};

test('fingerprint assíncrono cobre narração, fonte, plano confirmado e tempos das legendas', () => {
    const initial = baseAdData();
    const captured = captureTitleWorkflowAsyncFingerprint(initial);

    assert.equal(isTitleWorkflowAsyncFingerprintCurrent(captured, structuredClone(initial)), true);
    assert.equal(isTitleWorkflowAsyncFingerprintCurrent(captured, {
        ...initial,
        narrationPlainText: 'Outra narração.',
    }), false);
    assert.equal(isTitleWorkflowAsyncFingerprintCurrent(captured, {
        ...initial,
        narrationAudioUrl: 'http://localhost/audio/new.mp3',
    }), false);
    assert.equal(isTitleWorkflowAsyncFingerprintCurrent(captured, {
        ...initial,
        plannedTitles: [{ ...initial.plannedTitles[0], text: 'Multifocal por R$ 199' }],
    }), false);
    assert.equal(isTitleWorkflowAsyncFingerprintCurrent(captured, {
        ...initial,
        captions: {
            ...initial.captions,
            segments: [{ ...initial.captions.segments[0], start: 0.35 }],
        },
    }), false);
});

test('resposta antiga não substitui o plano novo aplicado durante STT ou materialização', () => {
    const initial = baseAdData();
    const captured = captureTitleWorkflowAsyncFingerprint(initial);
    const latest = {
        ...initial,
        plannedTitles: [{
            ...initial.plannedTitles[0],
            id: 'new-price',
            text: 'Multifocal completo por R$ 199',
        }],
    };

    let project = latest;
    if (isTitleWorkflowAsyncFingerprintCurrent(captured, latest)) {
        project = { ...latest, plannedTitles: initial.plannedTitles };
    }

    assert.equal(project.plannedTitles[0].id, 'new-price');
    assert.equal(project.plannedTitles[0].text, 'Multifocal completo por R$ 199');
});

test('Step 3 revalida a versão mais recente antes de salvar STT e materialização', () => {
    const source = readFileSync(new URL('../src/pages/Step3.tsx', import.meta.url), 'utf8');
    const generation = source.slice(
        source.indexOf('const handleGenerateCaptions = async'),
        source.indexOf('const handleNext ='),
    );

    assert.match(generation, /const operationAdData = latestAdDataRef\.current/);
    assert.match(generation, /captureTitleWorkflowAsyncFingerprint\(operationAdData\)/);
    assert.match(generation, /signal:\s*controller\.signal/);
    assert.match(generation, /assertOperationIsCurrent\(\);[\s\S]*updateAdData\(captionsOnlyPatch\)/);
    assert.match(generation, /assertOperationIsCurrent\(\);[\s\S]*dynamicTitles:\s*result\.adData\.dynamicTitles/);
    assert.doesNotMatch(generation, /plannedTitles:\s*result\.adData\.plannedTitles/);
});

test('Step 4 descarta geração e recuperação antigas e libera a recuperação do plano novo', () => {
    const source = readFileSync(new URL('../src/pages/Step4.tsx', import.meta.url), 'utf8');
    const generation = source.slice(
        source.indexOf('const runTitleAssistantGeneration ='),
        source.indexOf('const handleGenerateTitles ='),
    );
    const recovery = source.slice(
        source.indexOf('// A confirmação feita no Chat'),
        source.indexOf('const handleRefineTitleAssistant ='),
    );

    assert.match(generation, /const operationAdData = latestAdDataRef\.current/);
    assert.match(generation, /isTitleWorkflowAsyncFingerprintCurrent\(operationFingerprint, latestAdDataRef\.current\)/);
    assert.match(generation, /if \(!operationIsCurrent\(\)\) throw/);
    assert.match(recovery, /const recoveryKey = currentWorkflowFingerprintKey/);
    assert.match(recovery, /if \(!operationIsCurrent\(\)\) return/);
    assert.match(recovery, /recoveredTitlePlanRef\.current = null/);
    assert.match(source, /titleAssistantProposalFingerprintRef/);
});
