import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = (relative) => path.resolve(__dirname, '../../client/src', relative);

const compileClientModule = (relative) => {
    const sourcePath = clientPath(relative);
    return {
        sourcePath,
        source: fs.readFileSync(sourcePath, 'utf8'),
        compiled: ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
                esModuleInterop: true,
            },
            fileName: sourcePath,
        }).outputText,
    };
};

const evaluateCommonJs = ({ compiled }, dependencyMocks, sandboxPatch = {}) => {
    const runtimeModule = { exports: {} };
    const runtimeRequire = (specifier) => {
        if (Object.hasOwn(dependencyMocks, specifier)) return dependencyMocks[specifier];
        return require(specifier);
    };
    const sandbox = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        Date,
        Promise,
        AbortController,
        AbortSignal,
        setTimeout,
        clearTimeout,
        ...sandboxPatch,
    };
    const factory = vm.runInNewContext(
        `(function(exports,module,require){${compiled}\n})`,
        sandbox,
    );
    factory(runtimeModule.exports, runtimeModule, runtimeRequire);
    return runtimeModule.exports;
};

const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

const baseAdData = () => ({
    narrationText: 'Oferta valida. Visite a loja.',
    format: '9:16',
    captions: {
        sourceKey: 'narration-source',
        segments: [{
            start: 0,
            end: 3,
            text: 'Oferta valida. Visite a loja.',
            words: [],
        }],
    },
    dynamicTitles: [],
    brandPalette: null,
    brandPaletteUpdatedAt: null,
});

test('consultas concorrentes da mesma empresa compartilham cache e requisicao Ops em voo', async () => {
    const calls = { connection: 0, contexts: 0, company: 0, companies: 0 };
    const context = {
        contextId: 'context-1',
        mode: 'self',
        label: 'Minha empresa',
        subtitle: 'Contexto principal',
    };
    const palette = {
        primary: '#112233',
        secondary: '#ffffff',
        tertiary: '#00e676',
        all: ['#112233', '#ffffff', '#00e676'],
    };
    const gatewayApi = {
        opsConnection: async () => {
            calls.connection += 1;
            await Promise.resolve();
            return { connection: { status: 'active' }, userLink: { status: 'confirmed' } };
        },
        opsViewContexts: async () => {
            calls.contexts += 1;
            await Promise.resolve();
            return { data: { defaultContextId: context.contextId, contexts: [context] } };
        },
        opsCompany: async () => {
            calls.company += 1;
            await Promise.resolve();
            return { data: { id: 'company-1', name: 'Loja', kind: 'company', palette, paletteUpdatedAt: '2026-08-10T00:00:00.000Z' } };
        },
        opsCompanies: async () => {
            calls.companies += 1;
            await Promise.resolve();
            return { data: [{ id: 'company-1', name: 'Loja', kind: 'company', palette, paletteUpdatedAt: '2026-08-10T00:00:00.000Z' }] };
        },
    };
    const module = evaluateCommonJs(
        compileClientModule('lib/opsProjectBrand.ts'),
        {
            './brandPalette': { normalizeBrandPalette: (value) => value || null },
            './gateway': { gatewayApi },
        },
    );
    const selection = {
        id: 'company-1',
        name: 'Loja',
        viewContextIdentity: module.opsViewContextIdentity(context),
    };

    const [first, second] = await Promise.all([
        module.resolveOpsProjectBrand(selection),
        module.resolveOpsProjectBrand(selection),
    ]);
    const cached = await module.resolveOpsProjectBrand(selection);

    assert.equal(first.company.id, 'company-1');
    assert.deepEqual(second.palette, palette);
    assert.equal(cached.context.contextId, 'context-1');
    assert.deepEqual(calls, { connection: 1, contexts: 1, company: 1, companies: 0 });

    module.invalidateOpsBrandDirectoryCache();
    await module.resolveOpsProjectBrand(selection);
    assert.deepEqual(calls, { connection: 2, contexts: 2, company: 2, companies: 0 });
});

test('resolucao da marca respeita deadline compartilhado antes de consultar a IA', async () => {
    const gatewayApi = {
        opsConnection: async () => new Promise(() => {}),
        opsViewContexts: async () => {
            throw new Error('nao deve chegar aos contextos');
        },
        opsCompany: async () => {
            throw new Error('nao deve consultar empresa');
        },
    };
    const module = evaluateCommonJs(
        compileClientModule('lib/opsProjectBrand.ts'),
        {
            './brandPalette': { normalizeBrandPalette: (value) => value || null },
            './gateway': { gatewayApi },
        },
    );

    await assert.rejects(
        module.resolveOpsProjectBrand({
            id: 'company-timeout',
            name: 'Loja lenta',
            viewContextIdentity: 'self:minha empresa:principal',
        }, { deadlineMs: 5 }),
        /excedeu o prazo seguro/i,
    );
});

test('automatico limita a uma requisicao ai antes do fallback local', async () => {
    const requestModes = [];
    const workflow = evaluateCommonJs(
        compileClientModule('lib/videoAgentWorkflow.ts'),
        {
            './apiBase': { API_BASE_URL: 'http://local.test' },
            './captionCurrency': { repairCaptionCurrencySegments: (segments) => segments },
            './gateway': { gatewayApi: {} },
            './narrationState': {
                invalidatedNarrationDerivatives: () => ({}),
                narrationSourceKey: () => 'narration-source',
            },
            './opsProjectBrand': {
                bindTitlesToBrandPalette: (adData) => adData.dynamicTitles || [],
                resolveOpsProjectBrand: async () => ({
                    required: false,
                    company: null,
                    context: null,
                    palette: null,
                    paletteUpdatedAt: null,
                }),
            },
            './opsTakeSelection': { deterministicShuffle: (items) => items },
            './serverAuth': { localAuthHeaders: async () => ({}) },
        },
        {
            fetch: async (_url, init) => {
                const mode = JSON.parse(String(init.body)).mode;
                requestModes.push(mode);
                if (mode === 'ai') {
                    return response({
                        ok: false,
                        code: 'title_provider_unavailable',
                        message: 'temporariamente indisponivel',
                        retryable: true,
                        phase: 'ai',
                    }, 503);
                }
                return response({
                    ok: true,
                    source: 'local',
                    attempts: 0,
                    titles: [{
                        id: 'fallback-title',
                        text: 'VISITE A LOJA',
                        startSec: 1,
                        durationSec: 2,
                        isActive: true,
                        semanticRoles: ['cta'],
                    }],
                    metrics: { rawCandidateCount: 1, acceptedCount: 1 },
                });
            },
            window: { setTimeout: (callback) => { callback(); return 0; } },
        },
    );

    const result = await workflow.generateAutomaticTitlesResilient(baseAdData());

    assert.deepEqual(requestModes, ['ai', 'local']);
    assert.equal(result.source, 'local');
    assert.equal(result.adData.titleGenerationSummary.clientRequests, 2);
    assert.equal(result.adData.titleGenerationSummary.outcome, 'fallback');
});

test('fallback resolvido dentro da resposta ai nao dispara segunda requisicao local', async () => {
    const requestModes = [];
    const workflow = evaluateCommonJs(
        compileClientModule('lib/videoAgentWorkflow.ts'),
        {
            './apiBase': { API_BASE_URL: 'http://local.test' },
            './captionCurrency': { repairCaptionCurrencySegments: (segments) => segments },
            './gateway': { gatewayApi: {} },
            './narrationState': {
                invalidatedNarrationDerivatives: () => ({}),
                narrationSourceKey: () => 'narration-source',
            },
            './opsProjectBrand': {
                bindTitlesToBrandPalette: (adData) => adData.dynamicTitles || [],
                resolveOpsProjectBrand: async () => ({ required: false, company: null, context: null }),
            },
            './opsTakeSelection': { deterministicShuffle: (items) => items },
            './serverAuth': { localAuthHeaders: async () => ({}) },
        },
        {
            fetch: async (_url, init) => {
                requestModes.push(JSON.parse(String(init.body)).mode);
                return response({
                    ok: true,
                    source: 'local',
                    attempts: 1,
                    warning: 'fallback local',
                    timingsMs: {
                        total: 12.6,
                        generation: 4,
                        token: 'Bearer secret-token',
                        error: { message: 'private upstream body' },
                    },
                    titles: [{
                        id: 'server-fallback-title',
                        text: 'OFERTA VALIDA',
                        startSec: 0,
                        durationSec: 2,
                        isActive: true,
                    }],
                });
            },
            window: { setTimeout: (callback) => { callback(); return 0; } },
        },
    );

    const result = await workflow.generateAutomaticTitlesResilient(baseAdData());

    assert.deepEqual(requestModes, ['ai']);
    assert.equal(result.source, 'local');
    assert.equal(result.adData.titleGenerationSummary.clientRequests, 1);
    assert.deepEqual(
        { ...result.adData.titleGenerationSummary.timings.server },
        { total: 13, generation: 4 },
    );
    assert.doesNotMatch(
        JSON.stringify(result.adData.titleGenerationSummary.timings.server),
        /secret|bearer|private|upstream|token|error/i,
    );
});

test('cancelamento durante IA interrompe o cliente sem disparar fallback local', async () => {
    const requestModes = [];
    let markRequestStarted;
    const requestStarted = new Promise((resolve) => { markRequestStarted = resolve; });
    const workflow = evaluateCommonJs(
        compileClientModule('lib/videoAgentWorkflow.ts'),
        {
            './apiBase': { API_BASE_URL: 'http://local.test' },
            './captionCurrency': { repairCaptionCurrencySegments: (segments) => segments },
            './gateway': { gatewayApi: {} },
            './narrationState': {
                invalidatedNarrationDerivatives: () => ({}),
                narrationSourceKey: () => 'narration-source',
            },
            './opsProjectBrand': {
                bindTitlesToBrandPalette: (adData) => adData.dynamicTitles || [],
                resolveOpsProjectBrand: async () => ({ required: false, company: null, context: null }),
            },
            './opsTakeSelection': { deterministicShuffle: (items) => items },
            './serverAuth': { localAuthHeaders: async () => ({}) },
        },
        {
            fetch: async (_url, init) => {
                requestModes.push(JSON.parse(String(init.body)).mode);
                markRequestStarted();
                return new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () => {
                        const error = new Error('cancelled');
                        error.name = 'AbortError';
                        reject(error);
                    }, { once: true });
                });
            },
            window: { setTimeout },
        },
    );
    const controller = new AbortController();
    const pending = workflow.generateAutomaticTitlesResilient(baseAdData(), { signal: controller.signal });
    await requestStarted;
    controller.abort();

    await assert.rejects(pending, (error) => error?.name === 'AbortError');
    assert.deepEqual(requestModes, ['ai']);
});

test('timings do servidor aceitam apenas numeros finitos e nunca persistem textos sensiveis', () => {
    const workflow = evaluateCommonJs(
        compileClientModule('lib/videoAgentWorkflow.ts'),
        {
            './apiBase': { API_BASE_URL: 'http://local.test' },
            './captionCurrency': { repairCaptionCurrencySegments: (segments) => segments },
            './gateway': { gatewayApi: {} },
            './narrationState': {
                invalidatedNarrationDerivatives: () => ({}),
                narrationSourceKey: () => 'narration-source',
            },
            './opsProjectBrand': {
                bindTitlesToBrandPalette: (adData) => adData.dynamicTitles || [],
                resolveOpsProjectBrand: async () => ({ required: false, company: null, context: null }),
            },
            './opsTakeSelection': { deterministicShuffle: (items) => items },
            './serverAuth': { localAuthHeaders: async () => ({}) },
        },
        { fetch: async () => response({ ok: true }) },
    );
    const timings = workflow.sanitizeTitleGenerationServerTimings({
        total: 12.6,
        generation: 4,
        negative: -1,
        infinite: Number.POSITIVE_INFINITY,
        script: 'Oferta secreta',
        token: 'Bearer secret-token',
        error: { message: 'private upstream body' },
        'invalid key': 7,
        arbitraryNumericKey: 8,
    });
    const serialized = JSON.stringify(timings);

    assert.deepEqual({ ...timings }, { total: 13, generation: 4 });
    assert.doesNotMatch(serialized, /oferta|secret|bearer|private|upstream|script|token|error/i);
});

test('job retomado reutiliza empresa validada com a paleta fresca do pre-claim', () => {
    const coordinator = fs.readFileSync(
        clientPath('components/OpsVideoJobCoordinator.tsx'),
        'utf8',
    );
    const resolvedBrandStart = coordinator.indexOf('resolvedBrand: {');
    const resolvedBrandEnd = coordinator.indexOf('},\n                            onProgress:', resolvedBrandStart);
    const resolvedBrandBlock = coordinator.slice(resolvedBrandStart, resolvedBrandEnd);

    assert.ok(resolvedBrandStart > 0 && resolvedBrandEnd > resolvedBrandStart);
    assert.match(resolvedBrandBlock, /palette:\s*readiness\.initialAdData\.brandPalette/);
    assert.match(resolvedBrandBlock, /paletteUpdatedAt:\s*readiness\.initialAdData\.brandPaletteUpdatedAt/);
    assert.doesNotMatch(resolvedBrandBlock, /palette:\s*adData\.brandPalette/);
});
