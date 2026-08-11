import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import {
    applySystemVoicePresetOverride,
    migrateLegacySystemVoicePresetOverrides,
} from '../../client/src/lib/systemVoicePresetOverrides.ts';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const systemMusic = read('../../client/src/lib/systemMusic.ts');
const systemVoices = read('../../client/src/lib/systemVoices.ts');
const serverMusic = read('../../server/src/controllers/musicController.ts');
const builder = read('../../client/electron-builder.yml');

const RODEIO_VOICE_ID = 'fffaeef680cf41cdaff2c65d8cdd8650';
const RODEIO_MUSIC_ID = 'system-music:rodeio-1';

const preset = (musicTrackId, overrides = {}) => ({
    voiceSettings: {
        speed: 1,
        volume: 0,
        stability: 0.4,
        similarityBoost: 0.75,
        fishModel: 's2-pro',
        ...overrides.voiceSettings,
    },
    musicTrackId,
    audioConfig: {
        narration: {
            enabled: true,
            volume: 1,
            offsetSec: 0,
            trimStart: 0,
            fadeInSec: 0,
            fadeOutSec: 1,
            ...overrides.audioConfig?.narration,
        },
        background: {
            enabled: true,
            volume: 0.3,
            offsetSec: 0,
            trimStart: 0,
            fadeInSec: 2,
            fadeOutSec: 2,
            ...overrides.audioConfig?.background,
        },
    },
});

test('fixa os três recortes oficiais que acompanham todas as instalações', () => {
    const expected = [
        ['batida-1.mp3', 2_451_501, 'a9b0018c173cb294e4d4cbb6e04cfc54dedd95b4edb49bd3a115f9fc9343bef3', '76.584'],
        ['blogueira-1.mp3', 3_017_517, 'a2cec3109f1fc6b584b8428da4e0772e71853feace34db92dbfcb1edaeb00426', '94.272'],
        ['rodeio-1.mp3', 9_749_037, '6091086970a475362de6f2edf0b29f52b2422d77df4de022b6682da5e2c816a1', '304.632'],
    ];

    for (const [fileName, size, sha256, duration] of expected) {
        const url = new URL(`../../server/assets/system-music/${fileName}`, import.meta.url);
        assert.equal(statSync(url).size, size, `${fileName} mudou de tamanho`);
        assert.equal(createHash('sha256').update(readFileSync(url)).digest('hex'), sha256, `${fileName} mudou de conteúdo`);
        assert.match(systemMusic, new RegExp(`durationSec: ${duration.replace('.', '\\.')}`));
        assert.match(systemMusic, new RegExp(`/system-music/${fileName.replace('.', '\\.')}`));
        assert.match(serverMusic, new RegExp(`/system-music/${fileName.replace('.', '\\.')}`));
    }
    assert.match(builder, /assets\/system-music\/\*\*\/\*/);
});

test('Rodeio nasce com a própria música no catálogo global', () => {
    const rodeioAt = systemVoices.indexOf("name: 'Rodeio'");
    assert.ok(rodeioAt >= 0);
    assert.match(systemVoices.slice(rodeioAt, rodeioAt + 260), /createPreset\(1, 0, SYSTEM_MUSIC_IDS\.rodeio\)/);
    assert.match(systemVoices, /mileto_system_voice_presets_v2/);
});

test('migração remove o snapshot legado que escondia a música nova do Rodeio', () => {
    const beforeMusic = preset(null);
    const current = preset(RODEIO_MUSIC_ID);
    const migrated = migrateLegacySystemVoicePresetOverrides(
        { [RODEIO_VOICE_ID]: beforeMusic },
        {
            canonicalVoiceId: (id) => id,
            fallbackByVoiceId: { [RODEIO_VOICE_ID]: current },
            bundledUpgrades: {
                [RODEIO_VOICE_ID]: { from: beforeMusic, to: current },
            },
        },
    );

    assert.deepEqual(migrated, {});
    assert.equal(applySystemVoicePresetOverride(current, migrated[RODEIO_VOICE_ID]).musicTrackId, RODEIO_MUSIC_ID);
});

test('migração preserva uma personalização real, inclusive a opção sem música', () => {
    const beforeMusic = preset(null);
    const current = preset(RODEIO_MUSIC_ID);
    const customized = preset(null, { voiceSettings: { speed: 1.15 } });
    const migrated = migrateLegacySystemVoicePresetOverrides(
        { [RODEIO_VOICE_ID]: customized },
        {
            canonicalVoiceId: (id) => id,
            fallbackByVoiceId: { [RODEIO_VOICE_ID]: current },
            bundledUpgrades: {
                [RODEIO_VOICE_ID]: { from: beforeMusic, to: current },
            },
        },
    );

    assert.deepEqual(migrated[RODEIO_VOICE_ID], {
        voiceSettings: { speed: 1.15 },
        musicTrackId: null,
    });
    assert.deepEqual(applySystemVoicePresetOverride(current, migrated[RODEIO_VOICE_ID]), customized);
});
