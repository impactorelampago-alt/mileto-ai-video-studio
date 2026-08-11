import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const recoverySource = fs.readFileSync(
    new URL('../../client/src/lib/transitionExportRecovery.ts', import.meta.url),
    'utf8',
);
const exportSource = fs.readFileSync(
    new URL('../../client/src/context/ExportJobsContext.tsx', import.meta.url),
    'utf8',
);
const compiled = ts.transpileModule(recoverySource, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
    },
    fileName: 'transitionExportRecovery.ts',
}).outputText;

const runtimeRequire = (specifier) => {
    if (specifier === './apiBase') return { API_BASE_URL: 'http://localhost:3301' };
    if (specifier === './serverAuth') return { localAuthHeaders: async () => ({}) };
    throw new Error(`require inesperado: ${specifier}`);
};
const runtimeModule = { exports: {} };
const factory = vm.runInNewContext(
    `(function(exports,module,require){${compiled}\n})`,
    { console, fetch: globalThis.fetch, encodeURIComponent },
);
factory(runtimeModule.exports, runtimeModule, runtimeRequire);

const { resolveTransitionPathForExport } = runtimeModule.exports;

const response = (data, ok = true) => ({
    ok,
    json: async () => data,
});

const builtInTransition = (overrides = {}) => ({
    id: 'builtin-film-burn-08',
    originalName: 'Film Burn 08.mp4',
    publicUrl: '/system-transitions/film-burn-08.mp4',
    filePath: 'D:\\instalacao-antiga\\film-burn-08.mp4',
    durationSec: 1,
    isBuiltIn: true,
    identityCode: 'mileto:film-burn-08',
    ...overrides,
});

test('transição incluída usa sempre o filePath atual retornado pela instalação', async () => {
    const calls = [];
    const currentPath = 'C:\\Mileto\\resources\\transitions\\film-burn-08.mp4';
    const result = await resolveTransitionPathForExport(
        builtInTransition({ id: 'id-antigo', identityCode: 'mileto:film-burn-08' }),
        {
            apiBaseUrl: 'http://localhost:3301',
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                return response({
                    ok: true,
                    transitions: [builtInTransition({ filePath: currentPath })],
                });
            },
        },
    );

    assert.equal(result, currentPath);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://localhost:3301/api/transitions/list');
    assert.equal(calls[0].init, undefined);
    assert.notEqual(result, 'D:\\instalacao-antiga\\film-burn-08.mp4');
});

test('transição incluída também pode ser reencontrada pelo nome normalizado', async () => {
    const currentPath = 'C:\\Mileto\\current\\film-burn-08.mp4';
    const result = await resolveTransitionPathForExport(
        builtInTransition({ id: 'legado', identityCode: undefined, originalName: 'FÍLM BURN 08.MP4' }),
        {
            fetchImpl: async () => response({
                ok: true,
                transitions: [builtInTransition({ id: 'novo', identityCode: 'novo', filePath: currentPath })],
            }),
        },
    );
    assert.equal(result, currentPath);
});

test('projeto legado reconhece transição incluída mesmo sem isBuiltIn', async () => {
    const currentPath = 'C:\\Mileto\\current\\film-burn-08.mp4';
    const result = await resolveTransitionPathForExport(
        builtInTransition({ isBuiltIn: undefined }),
        {
            fetchImpl: async () => response({
                ok: true,
                transitions: [builtInTransition({ filePath: currentPath })],
            }),
        },
    );
    assert.equal(result, currentPath);
});

test('transição compartilhada é materializada com autenticação e usa somente o path devolvido', async () => {
    const calls = [];
    const currentPath = 'C:\\Mileto\\shared\\asset-1.mp4';
    const result = await resolveTransitionPathForExport(
        {
            ...builtInTransition({ isBuiltIn: false }),
            scope: 'shared',
            sharedAssetId: 'asset/1',
            filePath: 'C:\\cache-antigo\\asset-1.mp4',
        },
        {
            apiBaseUrl: 'http://localhost:3301',
            authHeaders: async () => ({ Authorization: 'Bearer teste' }),
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                return response({ ok: true, transition: { filePath: currentPath } });
            },
        },
    );

    assert.equal(result, currentPath);
    assert.equal(calls.length, 1);
    assert.equal(
        calls[0].url,
        'http://localhost:3301/api/shared/files/item/asset%2F1/materialize-transition',
    );
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer teste');
});

test('projeto sem transição ignora qualquer caminho legado sem chamar a rede', async () => {
    let fetchCount = 0;
    assert.equal(
        await resolveTransitionPathForExport(null, {
            fetchImpl: async () => {
                fetchCount += 1;
                throw new Error('não deveria chamar');
            },
        }),
        undefined,
    );
    assert.equal(fetchCount, 0);
    assert.doesNotMatch(exportSource, /transitionPath:\s*activeExport\.transitionPath/);
    assert.match(
        exportSource,
        /resolveTransitionPathForExport\(\s*activeExport\.adData\.globalTransition,?\s*\)/,
    );
    assert.match(exportSource, /transitionPath:\s*resolvedTransitionPath/);
});

test('falha de recuperação exibe orientação sem vazar caminhos ou resposta interna', async () => {
    const secretPath = 'C:\\Users\\outra-pessoa\\segredo\\transicao.mp4';
    await assert.rejects(
        resolveTransitionPathForExport(
            builtInTransition(),
            { fetchImpl: async () => response({ ok: false, message: secretPath }, false) },
        ),
        (error) => {
            assert.match(error.message, /^export_transition_unavailable:/);
            assert.doesNotMatch(error.message, /Users|segredo|transicao\.mp4/);
            return true;
        },
    );
});
