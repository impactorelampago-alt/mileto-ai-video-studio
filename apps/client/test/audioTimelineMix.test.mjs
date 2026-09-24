import assert from 'node:assert/strict';
import test from 'node:test';
import { audioConfigFromTimeline } from '../src/lib/audioTimelineMix.ts';
import { reconcileAudioTimelineSources } from '../src/lib/audioTimelineSources.ts';

const clip = (id, startSec, inSec, outSec, sourceUrl = '/narrations/voice.mp3') => ({
    id, sourceUrl, name: id, startSec, inSec, outSec,
    fadeInSec: 0, fadeOutSec: 0, volume: 1,
});
const timeline = () => ({ durationSec: 14, tracks: [
    { id: 'narration', label: 'Narração', type: 'audio', enabled: false,
        volume: 1, muted: false, solo: false, clips: [clip('first', 0, 0, 10), clip('second', 10, 10, 14)] },
    { id: 'bgm', label: 'Música', type: 'audio', enabled: false,
        volume: 0.15, muted: false, solo: false,
        clips: [clip('music', 0, 0, 14, '/music/old.mp3')] },
] });
const config = {
    narration: { enabled: true, volume: 1, offsetSec: 0, trimStart: 0, trimEnd: 14, fadeInSec: 0, fadeOutSec: 0 },
    background: { enabled: true, volume: 0.15, offsetSec: 0, trimStart: 0, trimEnd: 14, fadeInSec: 0, fadeOutSec: 0 },
};

test('divisão contígua mantém o áudio inteiro na mixagem e ativa faixas visíveis', () => {
    const result = audioConfigFromTimeline(timeline());
    assert.equal(result.narration.enabled, true);
    assert.equal(result.narration.trimEnd, 14);
    assert.equal(result.background.enabled, true);
    assert.equal(result.background.volume, 0.15);
});

test('excluir a segunda parte aplica o recorte da primeira, sem restaurar a fala cortada', () => {
    const value = timeline();
    value.tracks[0].clips.pop();
    const result = audioConfigFromTimeline(value);
    assert.equal(result.narration.trimEnd, 10);
});

test('blocos separados não são reduzidos silenciosamente ao primeiro', () => {
    const value = timeline();
    value.tracks[0].clips[1].startSec = 11;
    assert.throws(() => audioConfigFromTimeline(value), /blocos separados/);
});

test('renovação da URL da música preserva divisão e seleção da narração em edição', () => {
    const value = timeline();
    const next = reconcileAudioTimelineSources(
        value, '/narrations/voice.mp3', '/music/new.mp3', config, false, () => 'new-id',
    );
    assert.equal(next.tracks[0].clips.length, 2);
    assert.equal(next.tracks[0].clips[0].outSec, 10);
    assert.equal(next.tracks[0].clips[1].inSec, 10);
    assert.equal(next.tracks[0].enabled, true);
    assert.equal(next.tracks[1].enabled, true);
    assert.equal(next.tracks[1].clips[0].sourceUrl, '/music/new.mp3');
});

test('migração inicial ainda descarta recorte legado sem contrato autoral', () => {
    const value = timeline();
    const next = reconcileAudioTimelineSources(
        value, '/narrations/voice.mp3', '/music/old.mp3', config, true, () => 'new-id',
    );
    assert.equal(next.tracks[0].clips.length, 1);
    assert.equal(next.tracks[0].clips[0].outSec, 14);
});
