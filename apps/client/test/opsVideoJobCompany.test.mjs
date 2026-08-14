import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeOpsVideoJobProjectCompany,
    resolveOpsVideoJobCompany,
} from '../src/lib/opsVideoJobCompany.ts';

test('settings.projectCompany vence a agencia ou empresa legada do job', () => {
    const job = {
        id: 'job-1',
        companyId: 'agencia-que-enviou',
        settings: {
            projectCompany: {
                id: 'empresa-do-projeto',
                name: 'Ótica Reis Piracicaba',
                source: 'mileto_ops_company',
            },
        },
    };

    const normalized = normalizeOpsVideoJobProjectCompany(job);

    assert.equal(normalized.companyId, 'empresa-do-projeto');
    assert.deepEqual(normalized.projectCompanyResolution, {
        id: 'empresa-do-projeto',
        name: 'Ótica Reis Piracicaba',
        source: 'mileto_ops_company',
        authoritative: true,
        fallbackUsed: false,
        legacyCompanyId: 'agencia-que-enviou',
    });
});

test('job antigo usa companyId somente quando projectCompany nao existe e registra o fallback', () => {
    const resolution = resolveOpsVideoJobCompany({
        companyId: 'empresa-legada',
        settings: { voiceId: 'voice-1' },
    });

    assert.deepEqual(resolution, {
        id: 'empresa-legada',
        source: 'legacy_job_company_id',
        authoritative: false,
        fallbackUsed: true,
        fallbackReason: 'settings.projectCompany_absent',
        legacyCompanyId: 'empresa-legada',
    });
});

test('projectCompany presente e invalido nunca cai silenciosamente para a empresa legada', () => {
    for (const projectCompany of [
        null,
        { id: '', name: 'Empresa', source: 'mileto_ops_company' },
        { id: 'empresa', name: '', source: 'mileto_ops_company' },
        { id: 'empresa', name: 'Empresa', source: 'agency' },
    ]) {
        assert.throws(
            () => resolveOpsVideoJobCompany({
                companyId: 'agencia-legada',
                settings: { projectCompany },
            }),
            /ops_project_company_invalid.*fallback legado foi bloqueado/i,
        );
    }
});

test('ausencia de ambos os contratos falha de forma estruturada', () => {
    assert.throws(
        () => resolveOpsVideoJobCompany({ companyId: '', settings: {} }),
        /ops_project_company_missing/i,
    );
});

test('normalizacao preserva job invalido para o executor devolver a falha ao Ops', () => {
    const job = normalizeOpsVideoJobProjectCompany({
        id: 'job-invalido',
        companyId: 'agencia-legada',
        settings: { projectCompany: { id: '', name: 'Empresa', source: 'mileto_ops_company' } },
    });

    assert.equal(job.id, 'job-invalido');
    assert.equal(job.companyId, 'agencia-legada');
    assert.equal(job.projectCompanyResolution, undefined);
    assert.equal(job.projectCompanyContractError.code, 'ops_project_company_invalid');
});
