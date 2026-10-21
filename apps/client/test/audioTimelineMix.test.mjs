import assert from 'node:assert/strict';
import test from 'node:test';
import { audioConfigFromTimeline, configuredAudioTrackDuration } from '../src/lib/audioTimelineMix.ts';
import { dragAudioClip } from '../src/lib/audioTimelineEditing.ts';
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

test('salva blocos separados com posição e intervalo próprios, sem perder a segunda parte', () => {
    const value = timeline();
    value.tracks[0].clips[1].startSec = 11;
    const result = audioConfigFromTimeline(value);
    assert.equal(result.narration.segments.length, 2);
    assert.deepEqual(result.narration.segments.map(({ offsetSec, trimStart, trimEnd }) => (
        [offsetSec, trimStart, trimEnd]
    )), [[0, 0, 10], [11, 10, 14]]);
    assert.equal(configuredAudioTrackDuration(result.narration), 15);
});

test('retirar um trecho do meio não restaura o intervalo removido ao salvar e reabrir', () => {
    const value = timeline();
    value.tracks[0].clips = [clip('first', 0, 0, 4), clip('last', 4, 10, 14)];
    const saved = JSON.parse(JSON.stringify(audioConfigFromTimeline(value)));
    assert.equal(configuredAudioTrackDuration(saved.narration), 8);
    const empty = { ...value, tracks: value.tracks.map((track) => ({ ...track, clips: [] })) };
    let id = 0;
    const reopened = reconcileAudioTimelineSources(empty, '/narrations/voice.mp3', '/music/old.mp3', saved, false, () => `id-${id++}`);
    assert.deepEqual(reopened.tracks[0].clips.map(({ startSec, inSec, outSec }) => [startSec, inSec, outSec]),
        [[0, 0, 4], [4, 10, 14]]);
});

test('sobreposição e volumes diferentes continuam representados na mixagem', () => {
    const value = timeline();
    value.tracks[0].volume = 0.8;
    value.tracks[0].clips = [clip('first', 0, 0, 10), { ...clip('last', 3, 10, 14), volume: 0.4 }];
    const saved = audioConfigFromTimeline(value).narration;
    assert.equal(saved.volume, 0.8);
    assert.equal(saved.segments[1].volume, 0.4);
    assert.equal(configuredAudioTrackDuration(saved), 10);
});

test('excluir todos os blocos permanece salvo quando o editor reabre', () => {
    const value = timeline();
    value.tracks.forEach((track) => { track.clips = []; });
    const saved = audioConfigFromTimeline(value);
    const reopened = reconcileAudioTimelineSources(value, '/narrations/voice.mp3', '/music/old.mp3', saved, false, () => 'new');
    assert.equal(reopened.tracks[0].clips.length, 0);
    assert.equal(reopened.tracks[1].clips.length, 0);
});

test('bordas não ultrapassam a fonte nem criam recorte negativo', () => {
    const original = clip('first', 1, 2, 8);
    const left = dragAudioClip(original, 'trim-start', -20, 14);
    assert.equal(left.startSec, 0);
    assert.equal(left.inSec, 1);
    assert.equal(left.startSec + left.outSec - left.inSec, 7);
    const inverted = dragAudioClip(original, 'trim-start', 20, 14);
    assert.ok(inverted.outSec - inverted.inSec >= 0.099);
    assert.equal(dragAudioClip(original, 'trim-end', 20, 14).outSec, 14);
    assert.equal(dragAudioClip(original, 'trim-end', -20, 14).outSec, 2.1);
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
