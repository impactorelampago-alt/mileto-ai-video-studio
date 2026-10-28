import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

export function loadTs(relative, mocks = {}, globals = {}) {
    const filename = fileURLToPath(new URL(relative, import.meta.url));
    const localRequire = createRequire(filename);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    const factory = vm.runInNewContext(`(function(exports,module,require){${compiled}\n})`, { console, ...globals }, { filename });
    factory(module.exports, module, name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name));
    return module.exports;
}
