import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = fs.readFileSync(
    new URL('../../client/src/lib/audioAutoFit.ts', import.meta.url),
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

const { backgroundTrimEndForNarration } = runtimeModule.exports;

test('alinha uma música sem deslocamentos à duração útil da narração', () => {
    assert.equal(backgroundTrimEndForNarration({ narrationDurationSec: 30 }), 30);
});

test('soma trimStart da música em vez de produzir intervalo negativo', () => {
    assert.equal(backgroundTrimEndForNarration({
        backgroundTrimStart: 40,
        narrationDurationSec: 30,
    }), 70);
});

test('considera offsets globais diferentes para narração e música', () => {
    assert.equal(backgroundTrimEndForNarration({
        backgroundTrimStart: 10,
        backgroundOffsetSec: 2,
        narrationDurationSec: 20,
        narrationOffsetSec: 5,
    }), 33);
});

test('limita o corte à duração conhecida da fonte musical', () => {
    assert.equal(backgroundTrimEndForNarration({
        backgroundTrimStart: 10,
        narrationDurationSec: 30,
        backgroundSourceDurationSec: 25,
    }), 25);
});

test('não produz corte quando a música começa depois do fim da narração', () => {
    assert.equal(backgroundTrimEndForNarration({
        backgroundOffsetSec: 15,
        narrationDurationSec: 12,
    }), undefined);
});

test('não produz intervalo vazio quando o limite da fonte fica no trimStart', () => {
    assert.equal(backgroundTrimEndForNarration({
        backgroundTrimStart: 10,
        narrationDurationSec: 30,
        backgroundSourceDurationSec: 10,
    }), undefined);
});

test('rejeita duração de narração ausente, zero ou inválida', () => {
    assert.equal(backgroundTrimEndForNarration({ narrationDurationSec: undefined }), undefined);
    assert.equal(backgroundTrimEndForNarration({ narrationDurationSec: 0 }), undefined);
    assert.equal(backgroundTrimEndForNarration({ narrationDurationSec: Number.NaN }), undefined);
});
