import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const brandResolver = readFileSync(
    new URL('../src/lib/opsProjectBrand.ts', import.meta.url),
    'utf8',
).replace(/\r\n/g, '\n');
const exportJobs = readFileSync(
    new URL('../src/context/ExportJobsContext.tsx', import.meta.url),
    'utf8',
).replace(/\r\n/g, '\n');

test('prazo da marca comporta as consultas sequenciais do gateway', () => {
    assert.match(brandResolver, /OPS_BRAND_RESOLUTION_DEADLINE_MS = 45_000/);
    assert.doesNotMatch(brandResolver, /OPS_BRAND_RESOLUTION_DEADLINE_MS = 10_000/);
});

test('timeout e indisponibilidade da marca têm códigos estáveis e retomáveis', () => {
    assert.match(brandResolver, /OPS_BRAND_RESOLUTION_TIMEOUT_CODE = 'ops_brand_resolution_timeout'/);
    assert.match(brandResolver, /OPS_BRAND_RESOLUTION_UNAVAILABLE_CODE = 'ops_brand_resolution_unavailable'/);
    assert.match(brandResolver, /class OpsBrandResolutionError extends Error[\s\S]*?readonly retryable = true/);
    assert.match(brandResolver, /error instanceof GatewayError && retryableGatewayFailure\(error\)/);
});

test('exportação repete a confirmação sem descartar o MP4 na primeira oscilação', () => {
    assert.match(brandResolver, /export const resolveOpsProjectBrandWithRetry/);
    assert.match(brandResolver, /requestedAttempts = Number\(options\.maxAttempts \?\? 2\)/);
    assert.match(brandResolver, /Math\.max\(1, Math\.min\(3, Math\.round\(requestedAttempts\)\)\)/);
    assert.match(brandResolver, /invalidateOpsBrandDirectoryCache\(\)[\s\S]*?waitBeforeBrandRetry/);
    assert.match(
        exportJobs,
        /resolveOpsProjectBrandWithRetry\([\s\S]*?activeExport\.adData\.opsCompany,[\s\S]*?\{ maxAttempts: 2 \}/,
    );
});
