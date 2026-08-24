import assert from 'node:assert/strict';
import test from 'node:test';
import {
    OPS_SHARED_ARCHIVE_COMPANY_ID,
    opsTakeSourceCompanyId,
} from '../src/lib/opsVideoJobAssetSource.ts';

test('take compartilhado e lido do Acervo Impacto sem trocar a empresa de destino', () => {
    const job = {
        companyId: 'empresa-do-projeto',
        settings: {
            takeSelection: {
                sourceScope: 'shared',
                sourceFolderId: 'pasta-pinterest',
            },
        },
    };

    assert.equal(opsTakeSourceCompanyId(job), OPS_SHARED_ARCHIVE_COMPANY_ID);
    assert.equal(job.companyId, 'empresa-do-projeto');
});

test('take da empresa e jobs legados continuam usando a empresa do projeto', () => {
    for (const settings of [
        {},
        { takeSelection: { sourceScope: 'company' } },
        { takeSelection: { sourceScope: 'default' } },
        { takeSelection: { sourceScope: 'desconhecido' } },
        { takeSelection: null },
    ]) {
        assert.equal(opsTakeSourceCompanyId({ companyId: 'empresa-1', settings }), 'empresa-1');
    }
});
