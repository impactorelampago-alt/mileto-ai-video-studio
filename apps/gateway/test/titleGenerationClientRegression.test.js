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
const readClient = (relative) => fs.readFileSync(clientPath(relative), 'utf8');

const workflowSourcePath = clientPath('lib/videoAgentWorkflow.ts');
const workflowSource = fs.readFileSync(workflowSourcePath, 'utf8');
const workflowCompiled = ts.transpileModule(workflowSource, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
    },
    fileName: workflowSourcePath,
}).outputText;

const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

const loadWorkflow = (fetchImpl) => {
    const runtimeModule = { exports: {} };
    const dependencyMocks = {
        './apiBase': { API_BASE_URL: 'http://local.test' },
        './audioAutoFit': { backgroundTrimEndForNarration: () => undefined },
        './captionStyleMigration': { normalizeHydratedCaptionStyle: (style) => style },
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
            }),
        },
        './opsTakeSelection': { deterministicShuffle: (items) => items },
        './serverAuth': { localAuthHeaders: async () => ({}) },
    };
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
        fetch: fetchImpl,
        window: { setTimeout: (callback) => { callback(); return 0; } },
    };
    const factory = vm.runInNewContext(
        `(function(exports,module,require){${workflowCompiled}\n})`,
        sandbox,
    );
    factory(runtimeModule.exports, runtimeModule, runtimeRequire);
    return runtimeModule.exports;
};

const baseAdData = () => ({
    narrationText: 'Oferta válida. Visite a loja.',
    format: '9:16',
    captions: {
        sourceKey: 'narration-source',
        segments: [{
            start: 0,
            end: 3,
            text: 'Oferta válida. Visite a loja.',
            words: [],
        }],
    },
    dynamicTitles: [],
    brandPalette: null,
    brandPaletteUpdatedAt: null,
});

test('fallback local resolvido pelo servidor preserva tentativas e diagnóstico seguro da IA', async () => {
    const requests = [];
    const workflow = loadWorkflow(async (_url, init) => {
        const mode = JSON.parse(String(init.body)).mode;
        requests.push(mode);
        if (mode === 'ai') {
            return response({
                ok: true,
                titles: [{
                    id: 'local-title',
                    text: 'VISITE A LOJA',
                    startSec: 1,
                    durationSec: 2,
                    isActive: true,
                    semanticRoles: ['cta'],
                }],
                source: 'local',
                attempts: 1,
                diagnostic: {
                    code: 'title_provider_timeout',
                    status: 504,
                    phase: 'ai',
                    requestId: 'safe-request-id',
                },
                metrics: { rawCandidateCount: 1, acceptedCount: 1 },
            });
        }
        throw new Error('o cliente nao deve duplicar o fallback resolvido pelo servidor');
    });

    const result = await workflow.generateAutomaticTitlesResilient(baseAdData());
    const summary = result.adData.titleGenerationSummary;

    assert.deepEqual(requests, ['ai']);
    assert.equal(result.source, 'local');
    assert.equal(summary.outcome, 'fallback');
    assert.equal(summary.clientRequests, 1);
    assert.equal(summary.serverAttempts, 1);
    assert.equal(summary.attemptsBySource.ai, 1);
    assert.equal(summary.attemptsBySource.fallback, undefined);
    assert.equal(summary.diagnostic?.code, 'title_provider_timeout');
    assert.equal(summary.diagnostic?.requestId, 'safe-request-id');
    assert.equal(summary.metrics?.acceptedCount, 1);
    assert.equal(summary.metricsBySource.fallback.acceptedCount, 1);
    assert.equal(
        summary.warning.split('Títulos gerados pelo fallback local').length - 1,
        1,
    );
});

test('regenerar legendas remove títulos e o resumo pertencente à geração anterior', async () => {
    const workflow = loadWorkflow(async () => response({
        ok: true,
        segments: [{
            start: 0,
            end: 2,
            text: 'Nova legenda.',
            words: [],
        }],
    }));
    const input = {
        ...baseAdData(),
        narrationAudioUrl: 'http://local.test/audio.wav',
        dynamicTitles: [{ id: 'old-title', text: 'ANTIGO', isActive: true }],
        dynamicTitlesSourceKey: 'narration-source',
        titleGenerationSummary: {
            requested: true,
            outcome: 'ai',
            titleCount: 1,
            semanticCoverage: { required: ['cta'], covered: ['cta'], missing: [] },
            generatedAt: '2026-08-10T00:00:00.000Z',
        },
    };

    const result = await workflow.generateAutomaticCaptions(input);

    assert.equal(Array.isArray(result.dynamicTitles), true);
    assert.equal(result.dynamicTitles.length, 0);
    assert.equal(result.dynamicTitlesSourceKey, undefined);
    assert.equal(result.titleGenerationSummary, undefined);
});

test('Step 3 invalida explicitamente o resumo ao substituir as legendas', () => {
    const step3 = readClient('pages/Step3.tsx');
    const saveStart = step3.indexOf('updateAdData({', step3.indexOf('// Save segments to state'));
    const saveEnd = step3.indexOf('});', saveStart);
    const saveBlock = step3.slice(saveStart, saveEnd);

    assert.ok(saveStart > 0 && saveEnd > saveStart);
    assert.match(saveBlock, /dynamicTitles:\s*\[\]/);
    assert.match(saveBlock, /dynamicTitlesSourceKey:\s*undefined/);
    assert.match(saveBlock, /titleGenerationSummary:\s*undefined/);
});

test('advertências finais chegam por message e pelo renderResult revisionado do Ops', () => {
    const coordinator = readClient('components/OpsVideoJobCoordinator.tsx');
    const waitStart = coordinator.indexOf('const waitForOpsExport');
    const waitEnd = coordinator.indexOf('const orderedContexts', waitStart);
    const waitBlock = coordinator.slice(waitStart, waitEnd);
    const patchStart = coordinator.indexOf('const update: OpsVideoJobUpdate');
    const patchEnd = coordinator.indexOf('const sendUpdate', patchStart);
    const patchBlock = coordinator.slice(patchStart, patchEnd);

    assert.ok(waitStart > 0 && waitEnd > waitStart);
    assert.match(waitBlock, /renderResult/);
    assert.match(coordinator, /renderResult[^\n]*warnings|warnings[^\n]*renderResult/s);
    assert.match(coordinator, /titleWarning[\s\S]*patch\('completed'/);
    assert.match(patchBlock, /message/);
    assert.match(patchBlock, /revision/);
    assert.match(patchBlock, /renderResult/);
    assert.doesNotMatch(patchBlock, /renderDiagnostics|titleGenerationSummary|semanticCoverage|metrics/);
});

test('Step 4 impede geração concorrente, oferece cancelamento e não registra AxiosError completo', () => {
    const step4 = readClient('pages/Step4.tsx');
    const generationStart = step4.indexOf('const handleGenerateTitles');
    const generationEnd = step4.indexOf('const handleTargetTime', generationStart);
    const generationBlock = step4.slice(generationStart, generationEnd);
    const buttonStart = step4.indexOf('onClick={isGenerating ? cancelTitleGeneration : handleGenerateTitles}');
    const buttonEnd = step4.indexOf('</button>', buttonStart);
    const buttonBlock = step4.slice(buttonStart, buttonEnd);
    const transformStart = step4.indexOf('const updateTitleTransform');
    const transformEnd = step4.indexOf('const deleteTitle', transformStart);
    const transformBlock = step4.slice(transformStart, transformEnd);

    assert.ok(generationStart > 0 && generationEnd > generationStart);
    assert.match(generationBlock, /if \(titleGenerationAbortRef\.current \|\| isGenerating\) return/);
    assert.doesNotMatch(generationBlock, /console\.error\(error\)/);
    assert.match(buttonBlock, /cancelTitleGeneration/);
    assert.match(transformBlock, /updateTitle\(id, updates\)/);
});
