import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    captionTrackIsEnabled,
    withCaptionTrackEnabled,
} from '../src/lib/captionVisibility.ts';

const captionTrack = (enabled = true) => ({
    enabled,
    language: 'pt-BR',
    presetId: 'karaoke-yellow',
    sourceKey: 'narration-current',
    review: { sourceApplied: true, correctedWords: 1, formattedValues: 2 },
    segments: [{
        id: 'caption-1',
        start: 0,
        end: 1,
        text: 'Oferta atual',
        words: [{ text: 'Oferta', start: 0, end: 0.4 }],
    }],
});

test('somente enabled=false oculta legendas, preservando projetos antigos sem o campo', () => {
    assert.equal(captionTrackIsEnabled(captionTrack(true)), true);
    assert.equal(captionTrackIsEnabled(captionTrack(false)), false);
    assert.equal(captionTrackIsEnabled({ ...captionTrack(), enabled: undefined }), true);
    assert.equal(captionTrackIsEnabled(undefined), false);
});

test('alternar visibilidade preserva blocos, tempos, origem e revisão sem mutar a faixa', () => {
    const original = captionTrack(true);
    const hidden = withCaptionTrackEnabled(original, false);

    assert.notEqual(hidden, original);
    assert.equal(original.enabled, true);
    assert.equal(hidden.enabled, false);
    assert.equal(hidden.segments, original.segments);
    assert.equal(hidden.sourceKey, original.sourceKey);
    assert.equal(hidden.review, original.review);
    assert.equal(withCaptionTrackEnabled(hidden, false), hidden);
});

test('Etapa 3 expõe ativar/desativar e os dois caminhos de render respeitam enabled=false', () => {
    const step3 = readFileSync(new URL('../src/pages/Step3.tsx', import.meta.url), 'utf8');
    const preview = readFileSync(new URL('../src/components/VideoSequencePreview.tsx', import.meta.url), 'utf8');
    const exportJobs = readFileSync(new URL('../src/context/ExportJobsContext.tsx', import.meta.url), 'utf8');

    assert.match(step3, /Desativar legendas/);
    assert.match(step3, /Ativar legendas/);
    assert.match(step3, /withCaptionTrackEnabled\(latestCaptions, nextEnabled\)/);
    assert.match(step3, /não serão exibidos nem exportados/);
    assert.match(preview, /captions\?\.enabled !== false/);
    assert.match(exportJobs, /captions\?\.enabled !== false/);
});
