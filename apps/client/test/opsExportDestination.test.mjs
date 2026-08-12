import assert from 'node:assert/strict';
import test from 'node:test';
import {
    findDefaultOpsExportFolder,
    findProjectOpsExportCompany,
    normalizeOpsFolderName,
    OPS_EXPORT_DEFAULT_FOLDER_NAME,
} from '../src/lib/opsExportDestination.ts';

test('usa o nome canônico da pasta de anúncios do Mileto Ops', () => {
    assert.equal(OPS_EXPORT_DEFAULT_FOLDER_NAME, 'VÍDEOS PRONTOS (ANÚNCIO)');
});

test('encontra a pasta padrão sem depender de caixa, acentos ou espaços extras', () => {
    const folders = [
        { id: 'takes', name: 'TAKES', parentId: null },
        { id: 'ready', name: '  vídeos   prontos (anúncio)  ', parentId: null },
        { id: 'legacy', name: 'VÍDEOS PRONTOS', parentId: null },
    ];

    assert.equal(findDefaultOpsExportFolder(folders)?.id, 'ready');
    assert.equal(normalizeOpsFolderName('Vídeos Prontos (Anúncio)'), 'VIDEOS PRONTOS ANUNCIO');
});

test('aceita a grafia canônica sem acentos ou parênteses', () => {
    assert.equal(findDefaultOpsExportFolder([
        { id: 'ready', name: 'Videos Prontos Anuncio', parentId: null },
    ])?.id, 'ready');
});

test('não escolhe a primeira pasta nem uma pasta legada quando a padrão não existe', () => {
    const folders = [
        { id: 'wrong', name: 'Exame Pinterest', parentId: null },
        { id: 'legacy', name: 'VÍDEOS PRONTOS', parentId: null },
    ];

    assert.equal(findDefaultOpsExportFolder(folders), null);
});

test('não aceita nomes apenas parecidos com a pasta canônica', () => {
    const folders = [
        { id: 'singular', name: 'VIDEO PRONTO ANÚNCIO', parentId: null },
        { id: 'other', name: 'VÍDEOS PRONTOS PARA ANÚNCIOS', parentId: null },
    ];

    assert.equal(findDefaultOpsExportFolder(folders), null);
});

test('ignora homônimo aninhado e escolhe somente a pasta raiz', () => {
    const folders = [
        { id: 'nested', name: 'VÍDEOS PRONTOS (ANÚNCIO)', parentId: 'other' },
        { id: 'root', name: 'VÍDEOS PRONTOS (ANÚNCIO)', parentId: null },
    ];

    assert.equal(findDefaultOpsExportFolder(folders)?.id, 'root');
});

test('falha fechado quando há duas pastas raiz canônicas', () => {
    const folders = [
        { id: 'first', name: 'VÍDEOS PRONTOS (ANÚNCIO)', parentId: null },
        { id: 'second', name: 'Videos Prontos Anuncio', parentId: null },
    ];

    assert.equal(findDefaultOpsExportFolder(folders), null);
});

test('usa exatamente a empresa da etapa 1, mesmo quando ela não é a primeira', () => {
    const companies = [
        { id: 'archive', name: 'Acervo Impacto', kind: 'archive' },
        { id: 'wrong', name: 'Outra empresa', kind: 'company' },
        { id: 'project', name: 'Empresa da etapa 1', kind: 'company' },
    ];

    assert.equal(findProjectOpsExportCompany(companies, 'project')?.id, 'project');
    assert.equal(findProjectOpsExportCompany(companies, 'missing'), null);
    assert.equal(findProjectOpsExportCompany(companies, 'archive'), null);
});
