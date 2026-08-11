import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    TITLE_GENERATION_PREFLIGHT_TIMEOUT_MS,
    TITLE_GENERATION_TOTAL_TIMEOUT_MS,
} from '../src/services/gatewayClient';

test('orçamento total da chamada inclui a retry interna do gateway', () => {
    assert.equal(TITLE_GENERATION_TOTAL_TIMEOUT_MS, 35_000);
});

test('preflight possui teto menor que a geração e não altera o timeout do chat comum', () => {
    assert.equal(TITLE_GENERATION_PREFLIGHT_TIMEOUT_MS, 10_000);
    assert.ok(TITLE_GENERATION_PREFLIGHT_TIMEOUT_MS < TITLE_GENERATION_TOTAL_TIMEOUT_MS);
});

test('deadline de preflight é compartilhado por paginação de empresa e fallback de configuração', () => {
    const controller = readFileSync(path.resolve(__dirname, '../src/controllers/aiController.ts'), 'utf8');
    const config = readFileSync(path.resolve(__dirname, '../src/services/titleGeneratorConfig.ts'), 'utf8');

    assert.match(controller, /deadlineAt\s*=\s*startedAt\s*\+\s*TITLE_GENERATION_PREFLIGHT_TIMEOUT_MS/);
    assert.match(controller, /remainingPaletteTimeoutMs\(\)[\s\S]*for \(let page[\s\S]*remainingPaletteTimeoutMs\(\)/);
    assert.match(controller, /new GatewayHttpError\(504, 'A validação da empresa excedeu o prazo\.'/);
    assert.match(config, /deadlineAt[\s\S]*\/v1\/ai\/title-generator'[\s\S]*remainingTimeoutMs\(\)/);
    assert.match(config, /\/account\/ai\/title-generator'[\s\S]*remainingTimeoutMs\(\)/);
});
