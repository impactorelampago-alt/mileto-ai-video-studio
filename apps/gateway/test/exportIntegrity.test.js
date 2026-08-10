import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sourcePath = path.resolve(__dirname, '../../client/src/lib/exportIntegrity.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
    },
    fileName: sourcePath,
}).outputText;
const runtimeModule = { exports: {} };
vm.runInNewContext(`(function(exports,module,require){${compiled}\n})`, {
    console,
})(runtimeModule.exports, runtimeModule, require);
const { titleOriginForExport, validateTitlesForExport } = runtimeModule.exports;
const exportJobsSource = fs.readFileSync(
    path.resolve(__dirname, '../../client/src/context/ExportJobsContext.tsx'),
    'utf8',
);
const videoControllerSource = fs.readFileSync(
    path.resolve(__dirname, '../../server/src/controllers/videoController.ts'),
    'utf8',
);

const title = (input) => ({ isActive: true, posY: 30, ...input });
const aiSummary = {
    requested: true,
    outcome: 'ai',
    titleCount: 2,
    semanticCoverage: {
        required: ['offer_or_benefit', 'cta'],
        covered: ['offer_or_benefit', 'cta'],
        missing: [],
    },
    generatedAt: '2026-08-10T00:00:00.000Z',
};

test('preserva oferta e CTA real dentro dos 24,163188 segundos', () => {
    const result = validateTitlesForExport([
        title({
            id: 'price', text: 'R$ 199,00', startSec: 10.86, durationSec: 2,
            semanticRoles: ['offer_or_benefit'],
        }),
        title({
            id: 'cta', text: 'VISITE A ÓTICA', startSec: 21.82, durationSec: 2,
            semanticRoles: ['cta'],
        }),
    ], 24.163188, aiSummary);

    assert.deepEqual(Array.from(result.titles, (item) => item.text), ['R$ 199,00', 'VISITE A ÓTICA']);
    assert.deepEqual(Array.from(result.coverage.missing), []);
    assert.equal(result.warnings.length, 0);
    assert.equal(titleOriginForExport(aiSummary, result.titles.length), 'ai');
});

test('preserva o CTA do segundo caso real dentro dos 20,662750 segundos', () => {
    const result = validateTitlesForExport([
        title({
            id: 'cta-search', text: 'ENCONTRE A LOJA', startSec: 16.3, durationSec: 2.5,
            semanticRoles: ['cta'],
        }),
    ], 20.66275, {
        ...aiSummary,
        titleCount: 1,
        semanticCoverage: { required: ['cta'], covered: ['cta'], missing: [] },
    });

    assert.equal(result.titles.length, 1);
    assert.equal(result.titles[0].startSec, 16.3);
    assert.equal(result.titles[0].durationSec, 2.5);
    assert.deepEqual(Array.from(result.coverage.missing), []);
});

test('remove título fora do MP4, título invisível e item desativado', () => {
    const result = validateTitlesForExport([
        title({ id: 'outside', text: 'FORA', startSec: 20.1, durationSec: 2, semanticRoles: ['cta'] }),
        title({ id: 'flash', text: 'FLASH', startSec: 19.6, durationSec: 2 }),
        title({ id: 'inactive', text: 'INATIVO', startSec: 2, durationSec: 2, isActive: false }),
    ], 20, {
        ...aiSummary,
        semanticCoverage: { required: ['cta'], covered: ['cta'], missing: [] },
    });

    assert.equal(result.titles.length, 0);
    assert.ok(result.warnings.some((warning) => warning.code === 'title_outside_final_timeline'));
    assert.ok(result.warnings.some((warning) => warning.code === 'title_visible_duration_too_short'));
    assert.ok(result.warnings.some((warning) => warning.code === 'title_semantic_coverage_missing'));
    assert.equal(titleOriginForExport(aiSummary, 0), 'none');
});

test('identifica fallback local no resultado persistido', () => {
    assert.equal(titleOriginForExport({ ...aiSummary, outcome: 'fallback' }, 3), 'fallback');
    assert.equal(titleOriginForExport(undefined, 1), 'manual');
});

test('nenhum destino recebe o MP4 antes da barreira ffprobe aprovada', () => {
    const integrityGate = exportJobsSource.indexOf("renderDiagnostics?.status !== 'passed'");
    const localDelivery = exportJobsSource.indexOf('/api/files/import-export');
    const sharedDelivery = exportJobsSource.indexOf('/api/shared/files/import-local');
    const opsDelivery = exportJobsSource.indexOf('/api/ops/exports/upload');
    assert.ok(integrityGate > 0);
    assert.ok(localDelivery > integrityGate);
    assert.ok(sharedDelivery > integrityGate);
    assert.ok(opsDelivery > integrityGate);

    const serverProbe = videoControllerSource.indexOf('await probeMediaDurations(exportedPath)');
    const serverGate = videoControllerSource.indexOf('assertRenderIntegrity(renderDiagnostics)');
    const successResponse = videoControllerSource.indexOf('renderDiagnostics,', serverGate);
    assert.ok(serverProbe > 0 && serverGate > serverProbe && successResponse > serverGate);
});

test('diagnóstico local não é anexado ao contrato de upload do Ops', () => {
    const opsDelivery = exportJobsSource.indexOf('/api/ops/exports/upload');
    const responseRead = exportJobsSource.indexOf('const responseText = await response.text()', opsDelivery);
    const uploadBlock = exportJobsSource.slice(opsDelivery, responseRead);
    assert.doesNotMatch(uploadBlock, /renderResult|renderDiagnostics|sourceJobId/);
});
