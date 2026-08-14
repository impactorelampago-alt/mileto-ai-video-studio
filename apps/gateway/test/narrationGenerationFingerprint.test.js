import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = fs.readFileSync(
    new URL('../../client/src/lib/narrationState.ts', import.meta.url),
    'utf8',
);
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    },
}).outputText;
const runtimeModule = { exports: {} };
const factory = vm.runInNewContext(
    `(function(exports,module,require){${compiled}\n})`,
    { console },
);
factory(runtimeModule.exports, runtimeModule, require);

const { narrationGenerationInputFingerprint } = runtimeModule.exports;
const base = {
    narrationPlainText: 'Texto atual',
    narrationSynthesisText: '[confident] Texto atual',
    ttsModel: 's2.1-pro',
    directionMode: 'manual',
    directionVersion: 'fish-s2.1-natural-v1',
    voiceId: 'voice-a',
    selectedVoiceId: 'voice-a',
    selectedVoiceProvider: 'fishAudio',
    voiceSettings: {
        speed: 1,
        volume: 2,
        stability: 0.4,
        similarityBoost: 0.75,
        fishModel: 's2.1-pro',
    },
};

test('fingerprint permanece igual quando somente a música muda', () => {
    assert.equal(
        narrationGenerationInputFingerprint({ ...base, musicAudioUrl: '/music-a.mp3' }),
        narrationGenerationInputFingerprint({ ...base, musicAudioUrl: '/music-b.mp3' }),
    );
});

test('fingerprint muda com texto, voz, provedor ou qualquer ajuste enviado à TTS', () => {
    const fingerprint = narrationGenerationInputFingerprint(base);
    const variants = [
        { ...base, narrationPlainText: 'Outro texto' },
        { ...base, narrationSynthesisText: '[confident] Outro texto' },
        { ...base, voiceId: 'voice-b', selectedVoiceId: 'voice-b' },
        { ...base, selectedVoiceProvider: 'elevenLabs' },
        { ...base, ttsModel: 's1' },
        { ...base, directionMode: 'clean' },
        { ...base, directionVersion: 'fish-s2.1-natural-v2' },
        { ...base, voiceSettings: { ...base.voiceSettings, speed: 1.1 } },
        { ...base, voiceSettings: { ...base.voiceSettings, volume: 3 } },
        { ...base, voiceSettings: { ...base.voiceSettings, stability: 0.5 } },
        { ...base, voiceSettings: { ...base.voiceSettings, similarityBoost: 0.8 } },
        { ...base, ttsModel: undefined, voiceSettings: { ...base.voiceSettings, fishModel: 's1' } },
    ];

    for (const variant of variants) {
        assert.notEqual(narrationGenerationInputFingerprint(variant), fingerprint);
    }
});

test('provedor ausente equivale ao fallback Fish Audio usado pela requisição', () => {
    assert.equal(
        narrationGenerationInputFingerprint({ ...base, selectedVoiceProvider: undefined }),
        narrationGenerationInputFingerprint(base),
    );
});
