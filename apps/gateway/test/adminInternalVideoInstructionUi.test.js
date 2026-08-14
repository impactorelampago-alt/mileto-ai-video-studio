import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminHtml = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
const narratorScript = adminHtml.slice(
    adminHtml.indexOf('function agentDraft(card)'),
    adminHtml.indexOf('let TITLE_AI_CATALOG')
);

test('JavaScript do Super Admin continua sintaticamente valido', () => {
    const script = adminHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'script principal deve existir');
    assert.doesNotThrow(() => new vm.Script(script));
});

test('Narrador mostra uma caixa interna separada logo abaixo do prompt principal', () => {
    const mainPrompt = narratorScript.indexOf('class="agent-prompt"');
    const internalBox = narratorScript.indexOf('class="agent-internal-instruction"');

    assert.ok(mainPrompt >= 0, 'textarea principal deve existir');
    assert.ok(internalBox > mainPrompt, 'caixa interna deve vir depois do prompt principal');
    assert.match(narratorScript, /Instru&ccedil;&atilde;o interna do AI Video/);
    assert.match(narratorScript, /Somente Super Admin/);
    assert.match(narratorScript, /N&atilde;o aparece no Chat, no aplicativo nem para as ag&ecirc;ncias/);
    assert.match(narratorScript, /aria-label="Instru&ccedil;&atilde;o interna do AI Video"/);
});

test('campo interno carrega, contabiliza e publica internalVideoInstruction', () => {
    assert.match(narratorScript, /esc\(c\.internalVideoInstruction \|\| ''\)/);
    assert.match(narratorScript, /internalVideoInstruction:\s*card\.querySelector\('\.agent-internal-video-instruction'\)\?\.value \?\? ''/);
    assert.match(narratorScript, /internalInstruction\.value\.length/);
    assert.match(narratorScript, /instrução oculta/);
    assert.match(narratorScript, /'\.agent-internal-video-instruction'\)\.addEventListener\('input'/);
});

test('prompt principal vazio continua independente da instrucao interna', () => {
    assert.match(narratorScript, /systemPrompt:\s*card\.querySelector\('\.agent-prompt'\)\.value/);
    assert.match(narratorScript, /0 caracteres · sem prompt \(estado válido\)/);
    assert.doesNotMatch(narratorScript, /systemPrompt:\s*card\.querySelector\('\.agent-internal-video-instruction'\)/);
});
