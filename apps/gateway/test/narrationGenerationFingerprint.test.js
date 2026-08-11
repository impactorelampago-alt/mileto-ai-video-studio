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
    narrationText: 'Texto atual',
    selectedVoiceId: 'voice-a',
    selectedVoiceProvider: 'fishAudio',
    voiceSettings: {
        speed: 1,
        volume: 2,
        stability: 0.4,
        similarityBoost: 0.75,
        fishModel: 's2-pro',
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
        { ...base, narrationText: 'Outro texto' },
        { ...base, selectedVoiceId: 'voice-b' },
        { ...base, selectedVoiceProvider: 'elevenLabs' },
        { ...base, voiceSettings: { ...base.voiceSettings, speed: 1.1 } },
        { ...base, voiceSettings: { ...base.voiceSettings, volume: 3 } },
        { ...base, voiceSettings: { ...base.voiceSettings, stability: 0.5 } },
        { ...base, voiceSettings: { ...base.voiceSettings, similarityBoost: 0.8 } },
        { ...base, voiceSettings: { ...base.voiceSettings, fishModel: 's1' } },
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
