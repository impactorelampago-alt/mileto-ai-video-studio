import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const clientRoot = fileURLToPath(new URL('../../../client/src/', import.meta.url));

export const compileClientModule = relative => {
    const sourcePath = path.resolve(clientRoot, relative);
    const source = fs.readFileSync(sourcePath, 'utf8');
    return {
        sourcePath,
        compiled: ts.transpileModule(source, {
            fileName: sourcePath,
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        }).outputText,
    };
};

// Dependências relativas pertencem ao módulo cliente, não ao diretório do teste
// no gateway. Carregar as implementações reais evita mocks obsoletos para cada
// helper novo e preserva os contratos de duração/áudio usados pelo workflow.
export const evaluateClientModule = (entry, mocks = {}, globals = {}) => {
    const cache = new Map();
    const context = vm.createContext({
        console: { log() {}, info() {}, warn() {}, error() {} },
        Date, Promise, AbortController, AbortSignal, setTimeout, clearTimeout,
        URL, TextEncoder, TextDecoder, Buffer, Blob,
        ...globals,
    });
    const load = record => {
        if (cache.has(record.sourcePath)) return cache.get(record.sourcePath).exports;
        const module = { exports: {} };
        cache.set(record.sourcePath, module);
        const localRequire = createRequire(record.sourcePath);
        const runtimeRequire = specifier => {
            const withoutExtension = specifier.replace(/\.(?:ts|tsx|js|jsx)$/, '');
            if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
            if (Object.hasOwn(mocks, withoutExtension)) return mocks[withoutExtension];
            if (!specifier.startsWith('.')) return localRequire(specifier);
            const target = path.resolve(path.dirname(record.sourcePath), specifier);
            const resolved = [target, `${target}.ts`, `${target}.tsx`, `${target}.js`]
                .find(filename => fs.existsSync(filename) && fs.statSync(filename).isFile());
            if (!resolved) throw new Error(`Dependência cliente não encontrada: ${specifier} em ${record.sourcePath}`);
            return load(compileClientModule(path.relative(clientRoot, resolved)));
        };
        const factory = vm.runInContext(`(function(exports,module,require){${record.compiled}\n})`, context, { filename: record.sourcePath });
        factory(module.exports, module, runtimeRequire);
        return module.exports;
    };
    return load(entry);
};
