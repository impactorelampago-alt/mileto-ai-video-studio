import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const librarySource = readFileSync(
    new URL('../src/components/OpsLibrary.tsx', import.meta.url),
    'utf8',
).replace(/\r\n/g, '\n');

const serverSource = readFileSync(
    new URL('../../server/src/controllers/opsController.ts', import.meta.url),
    'utf8',
).replace(/\r\n/g, '\n');

test('lote de cortes reidrata o asset e nunca confia no caminho temporario persistido', () => {
    const pipeline = librarySource.slice(
        librarySource.indexOf('const sliceAndImportEntry'),
        librarySource.indexOf('// Processa um conjunto de takes como job'),
    );
    assert.match(pipeline, /materializeAsset\(entry\.asset/);
    assert.doesNotMatch(pipeline, /entry\.take\.(?:backendPath|url)/);
});

test('fonte do Acervo da Agencia respeita o contrato somente leitura e salva cortes localmente', () => {
    assert.match(librarySource, /company\?\.kind === 'archive' \? 'local' : 'ops'/);
    assert.match(librarySource, /if \(entry\.destinationScope === 'local'\) return sliceData\.slices\.length/);
    assert.match(librarySource, /Meu computador › Vídeos › Cortes/);
    assert.match(librarySource, /selectedCompany\.kind !== 'archive'/);
});

test('falha do lote preserva etapa e mensagem devolvida pelo servidor', () => {
    const pipeline = librarySource.slice(
        librarySource.indexOf('const sliceAndImportEntry'),
        librarySource.indexOf('// ─── Exclusão de arquivos'),
    );
    assert.match(pipeline, /Preparação da origem:/);
    assert.match(pipeline, /Recorte local:/);
    assert.match(pipeline, /Envio ao Mileto Ops:/);
    assert.match(pipeline, /failures\.push\(\{ entry, message \}\)/);
    assert.doesNotMatch(pipeline, /catch\s*\{\s*failures\.push/);
});

test('retry de upload usa chave idempotente estavel no cliente e no servidor', () => {
    assert.match(librarySource, /uploadIdempotencyKeys: trims\.map\(\(\) => crypto\.randomUUID\(\)\)/);
    assert.match(librarySource, /idempotencyKey: entry\.uploadIdempotencyKeys\?\.\[sliceIndex\]/);
    assert.match(serverSource, /const idempotencyKey = String\(req\.body\?\.idempotencyKey/);
    assert.match(serverSource, /\.\.\.\(idempotencyKey \? \{ idempotencyKey \} : \{\}\)/);
});

test('itens continuam no carrinho durante o processamento e saem apenas apos sucesso', () => {
    const job = librarySource.slice(
        librarySource.indexOf('const runCutJob'),
        librarySource.indexOf('// "Confirmar (N takes)"'),
    );
    assert.match(job, /for \(const entry of queuedEntries\) next\.set\(entry\.asset\.id, entry\)/);
    assert.match(job, /sentCuts \+= await sliceAndImportEntry[\s\S]*?next\.delete\(entry\.asset\.id\)/);
});
