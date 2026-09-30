import assert from 'node:assert/strict';
import test from 'node:test';
import {
    currentCaptionTrack,
    videoCaptionMixTakes,
    videoCaptionSourceKey,
} from '../src/lib/videoCaptions.ts';

const video = (id, start = 0, end = 5) => ({
    id, type: 'video', fileName: `${id}.mp4`,
    url: `https://r2.example/${id}.mp4?token=one`,
    sharedAssetId: `asset-${id}`,
    originalDurationSeconds: 10,
    trim: { start, end },
    audio: { mode: 'off', volume: 0 },
});

test('extração usa áudio original mesmo se o take estiver mudo, sem alterar o projeto', () => {
    const takes = [video('one'), {
        id: 'still', type: 'image', fileName: 'still.png', url: '/uploads/still.png',
        originalDurationSeconds: 2, trim: { start: 0, end: 2 },
    }, video('two', 1, 4)];
    const payload = videoCaptionMixTakes(takes);
    assert.equal(payload[0].audioMode, 'original');
    assert.equal(payload[0].timelineStartSec, 0);
    assert.equal(payload[1].timelineStartSec, 5);
    assert.equal(payload[1].audioMode, undefined);
    assert.equal(payload[2].timelineStartSec, 7);
    assert.deepEqual(payload[2].trim, { start: 1, end: 4 });
    assert.equal(takes[0].audio.mode, 'off');
});

test('legenda dos takes sobrevive à URL assinada renovada, mas invalida corte e ordem diferentes', () => {
    const takes = [video('one'), video('two')];
    const key = videoCaptionSourceKey(takes);
    const adData = { captions: { sourceKind: 'takes', sourceKey: key, enabled: false, segments: [{ id: 'a' }] } };
    assert.equal(currentCaptionTrack(adData, takes), adData.captions);
    assert.equal(videoCaptionSourceKey([{ ...takes[0], url: 'https://r2.example/one.mp4?token=two' }, takes[1]]), key);
    assert.equal(currentCaptionTrack(adData, [{ ...takes[0], trim: { start: 0, end: 4 } }, takes[1]]), undefined);
    assert.equal(currentCaptionTrack(adData, [...takes].reverse()), undefined);
});

test('sem vídeo ou com velocidade variável a extração falha antes de cobrar transcrição', () => {
    assert.throws(() => videoCaptionMixTakes([]), /ao menos um take de vídeo/);
    assert.throws(() => videoCaptionMixTakes([{ ...video('fast'), speedPresetId: 'speed-ramp' }]), /velocidade variável/);
});
