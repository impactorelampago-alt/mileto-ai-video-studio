import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildOpsUploadIntentPayload,
    createOpsExportIdempotencyKey,
} from '../src/opsExportContract.js';

const baseInput = () => ({
    folderId: '00000000-0000-4000-8000-000000000003',
    fileName: 'render_final_v7.mp4',
    sizeBytes: 123456,
    checksum: 'a'.repeat(64),
    metadata: {
        title: '  Segundo   óculos grátis ',
        description: 'Oferta fiel à narração.  Clique no botão.',
        narrationSummary: 'O segundo óculos é grátis na condição narrada. Clique no botão.',
        sourceProjectId: 'project-123',
        sourceProjectTitle: 'Segundo óculos grátis',
    },
});

test('payload da intenção inclui o contrato editorial completo', () => {
    assert.deepEqual(buildOpsUploadIntentPayload(baseInput()), {
        folderId: '00000000-0000-4000-8000-000000000003',
        fileName: 'render_final_v7.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 123456,
        checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
        origin: 'mileto_ai_video',
        title: 'Segundo óculos grátis',
        description: 'Oferta fiel à narração. Clique no botão.',
        narrationSummary: 'O segundo óculos é grátis na condição narrada. Clique no botão.',
        sourceProjectId: 'project-123',
        sourceProjectTitle: 'Segundo óculos grátis',
    });
});

test('a mesma intenção produz sempre a mesma Idempotency-Key', () => {
    const first = buildOpsUploadIntentPayload(baseInput());
    const second = buildOpsUploadIntentPayload(baseInput());
    const firstKey = createOpsExportIdempotencyKey(first, 'company-1');
    assert.equal(firstKey, createOpsExportIdempotencyKey(second, 'company-1'));
    assert.match(firstKey, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('campos opcionais vazios não quebram o schema do Ops', () => {
    const input = baseInput();
    input.metadata.narrationSummary = '   ';
    assert.equal(buildOpsUploadIntentPayload(input).narrationSummary, null);
});

test('qualquer mudança binária, de pasta ou editorial produz outra Idempotency-Key', () => {
    const basePayload = buildOpsUploadIntentPayload(baseInput());
    const baseKey = createOpsExportIdempotencyKey(basePayload, 'company-1');
    const variants = [
        { folderId: null },
        { fileName: 'outro.mp4' },
        { sizeBytes: 123457 },
        { checksum: { algorithm: 'sha256', value: 'b'.repeat(64) } },
        { title: 'Outro título' },
        { description: 'Outra descrição' },
        { narrationSummary: 'Outro resumo' },
        { sourceProjectId: 'project-456' },
        { sourceProjectTitle: 'Outro projeto' },
    ];

    for (const variant of variants) {
        assert.notEqual(createOpsExportIdempotencyKey({ ...basePayload, ...variant }, 'company-1'), baseKey);
    }
    assert.notEqual(createOpsExportIdempotencyKey(basePayload, 'company-2'), baseKey);
});

test('valida campos obrigatórios e limites antes de falar com o Ops', () => {
    const input = baseInput();
    input.metadata.title = '';
    assert.throws(() => buildOpsUploadIntentPayload(input), /title é obrigatório/);
});
