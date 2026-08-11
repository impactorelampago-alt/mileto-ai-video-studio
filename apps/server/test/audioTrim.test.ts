import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAudioFilterChain, normalizeAudioTrackConfig } from '../src/controllers/audioController';

test('normaliza um intervalo de música e monta o filtro completo do ffmpeg', () => {
    const config = normalizeAudioTrackConfig({
        enabled: true,
        volume: 0.35,
        offsetSec: 1.25,
        trimStart: 4.5,
        trimEnd: 14.5,
        fadeInSec: 2,
        fadeOutSec: 3,
    }, 0.3);

    assert.equal(
        buildAudioFilterChain(config),
        'atrim=start=4.5:end=14.5,asetpts=PTS-STARTPTS,volume=0.35,'
        + 'afade=t=in:st=0:d=2,afade=t=out:st=7:d=3,adelay=1250:all=1',
    );
});

test('rejeita corte cujo fim não fica depois do início', () => {
    assert.throws(
        () => normalizeAudioTrackConfig({ trimStart: 8, trimEnd: 7 }, 0.3),
        /fim do corte/i,
    );
});

test('limita números recebidos antes de interpolá-los no filtro', () => {
    const config = normalizeAudioTrackConfig({
        volume: 99,
        offsetSec: -4,
        trimStart: Number.NaN,
        trimEnd: 5,
        fadeInSec: 99,
        fadeOutSec: -1,
    }, 0.3);

    assert.deepEqual(config, {
        enabled: true,
        volume: 2,
        offsetSec: 0,
        trimStart: 0,
        trimEnd: 5,
        fadeInSec: 60,
        fadeOutSec: 0,
    });
});
