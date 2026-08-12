import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const recoverySource = fs.readFileSync(
    new URL('../../client/src/lib/opsMediaRecovery.ts', import.meta.url),
    'utf8',
);
const exportSource = fs.readFileSync(
    new URL('../../client/src/context/ExportJobsContext.tsx', import.meta.url),
    'utf8',
);
const serverOpsSource = fs.readFileSync(
    new URL('../../server/src/controllers/opsController.ts', import.meta.url),
    'utf8',
);
const compiled = ts.transpileModule(recoverySource, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
    },
}).outputText;

class GatewayError extends Error {
    constructor(status, message, code = null) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const opsContext = {
    contextId: 'context-current',
    mode: 'self',
    label: 'Minha empresa',
    subtitle: 'Perfil atual',
    isDefault: true,
};
let fetchImpl = async () => {
    throw new Error('fetch inesperado');
};
let createReferenceImpl = async () => {
    throw new Error('createOpsReference inesperado');
};
let opsViewContextsImpl = async () => ({
    data: { contexts: [opsContext], defaultContextId: opsContext.contextId, expiresIn: 600 },
});
let opsCompanyImpl = async () => ({ ok: true });
const gatewayApi = {
    opsViewContexts: (...args) => opsViewContextsImpl(...args),
    opsCompany: (...args) => opsCompanyImpl(...args),
    createOpsReference: (...args) => createReferenceImpl(...args),
    opsAssetUrl: async () => {
        throw new Error('URL assinada não deve ser usada na preparação do export');
    },
};
const runtimeRequire = (specifier) => {
    if (specifier === './gateway') return { gatewayApi, GatewayError };
    if (specifier === './apiBase') return { API_BASE_URL: 'http://127.0.0.1:43123' };
    if (specifier === './serverAuth') return { localAuthHeaders: async () => ({ Authorization: 'Bearer test' }) };
    throw new Error(`require inesperado: ${specifier}`);
};
const runtimeModule = { exports: {} };
const factory = vm.runInNewContext(
    `(function(exports,module,require){${compiled}\n})`,
    {
        console,
        URL,
        fetch: (...args) => fetchImpl(...args),
        setTimeout: (callback) => {
            callback();
            return 1;
        },
    },
);
factory(runtimeModule.exports, runtimeModule, runtimeRequire);

const {
    mergeOpsTakeWithCacheSource,
    prepareOpsTakeForExport,
} = runtimeModule.exports;

const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

test.beforeEach(() => {
    fetchImpl = async () => {
        throw new Error('fetch inesperado');
    };
    createReferenceImpl = async () => {
        throw new Error('createOpsReference inesperado');
    };
    opsViewContextsImpl = async () => ({
        data: { contexts: [opsContext], defaultContextId: opsContext.contextId, expiresIn: 600 },
    });
    opsCompanyImpl = async () => ({ ok: true });
});

const baseTake = (suffix = 'one') => ({
    id: `take-${suffix}`,
    fileName: `take-${suffix}.mp4`,
    originalDurationSeconds: 8,
    url: '',
    type: 'video',
    trim: { start: 1.25, end: 6.75 },
    speedPresetId: 'fast_in_slow_out',
    objectFit: 'contain',
    motionEffect: { type: 'zoom-in', intensity: 0.2, focalX: 30, focalY: 40 },
    enhancement: { enabled: true, intensity: 'strong' },
    sharpness: { enabled: true, amount: 35 },
    transition: { id: 'film-burn' },
    muteOriginalAudio: true,
    externalMedia: {
        source: 'mileto_ops',
        referenceId: `11111111-1111-4111-8111-${suffix.padEnd(12, '1').slice(0, 12)}`,
        connectionId: 'connection-1',
        accountId: 'account-1',
        companyId: `22222222-2222-4222-8222-${suffix.padEnd(12, '2').slice(0, 12)}`,
        assetId: `33333333-3333-4333-8333-${suffix.padEnd(12, '3').slice(0, 12)}`,
        viewContext: { mode: 'self', label: 'Minha empresa', subtitle: 'Perfil atual' },
    },
});

const localSource = (suffix = 'one') => ({
    url: `/api/ops/cache/file/${suffix}/source.mp4`,
    proxyUrl: `/api/ops/cache/file/${suffix}/proxy.mp4`,
    path: `D:\\mileto-cache\\${suffix}\\source.mp4`,
    duration: 8,
    cacheId: suffix.padEnd(32, 'a').slice(0, 32),
});

test('merge da fonte local preserva todos os cortes e efeitos do snapshot', () => {
    const take = baseTake('merge');
    take.trim = { start: 1.25, end: 8 };
    const merged = mergeOpsTakeWithCacheSource(take, {
        ...localSource('merge'),
        type: 'video',
        fileName: 'nome-alterado-no-ops.mp4',
        duration: 8.04,
    }, take.externalMedia);

    assert.equal(merged.backendPath, 'D:\\mileto-cache\\merge\\source.mp4');
    assert.equal(merged.fileUrl, 'http://127.0.0.1:43123/api/ops/cache/file/merge/source.mp4');
    for (const field of [
        'id', 'fileName', 'type', 'trim', 'originalDurationSeconds',
        'speedPresetId', 'objectFit', 'motionEffect',
        'enhancement', 'sharpness', 'transition', 'muteOriginalAudio',
    ]) {
        assert.deepEqual(JSON.parse(JSON.stringify(merged[field])), JSON.parse(JSON.stringify(take[field])), field);
    }
});

test('merge rejeita troca de tipo, mas delega cobertura visual ao preflight canônico', () => {
    const take = baseTake('invalid-source');
    assert.throws(
        () => mergeOpsTakeWithCacheSource(
            take,
            { ...localSource('invalid-source'), type: 'image' },
            take.externalMedia,
        ),
        (error) => error?.code === 'ops_source_type_mismatch',
    );
    const shorterVisualStream = mergeOpsTakeWithCacheSource(
        take,
        { ...localSource('invalid-source'), type: 'video', duration: 6.2 },
        take.externalMedia,
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(shorterVisualStream.trim)),
        JSON.parse(JSON.stringify(take.trim)),
    );
    assert.equal(shorterVisualStream.originalDurationSeconds, take.originalDurationSeconds);
});

test('export reabre o cache e nunca cai para URL assinada', async () => {
    const take = baseTake('cached');
    const calls = [];
    fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return response(200, { ok: true, source: localSource('cached') });
    };

    const prepared = await prepareOpsTakeForExport(take);
    assert.equal(prepared.backendPath, 'D:\\mileto-cache\\cached\\source.mp4');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/ops\/cache\/restore$/);
});

test('cache ausente é rematerializado localmente antes do FFmpeg', async () => {
    const take = baseTake('materialize');
    const calls = [];
    fetchImpl = async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/restore')) {
            return response(404, { ok: false, code: 'ops_local_cache_miss', message: 'cache ausente' });
        }
        return response(201, { ok: true, source: localSource('materialize') });
    };

    const prepared = await prepareOpsTakeForExport(take);
    assert.equal(prepared.backendPath, 'D:\\mileto-cache\\materialize\\source.mp4');
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/api\/ops\/cache\/materialize$/);
    assert.equal(calls[1].init.headers['X-Ops-View-Context'], opsContext.contextId);
});

test('resolução inicial e refresh de contexto repetem falhas transitórias', async () => {
    const initialTake = baseTake('context-initial');
    let initialContextCalls = 0;
    opsViewContextsImpl = async () => {
        initialContextCalls += 1;
        if (initialContextCalls === 1) {
            throw new GatewayError(503, 'contextos temporariamente indisponíveis');
        }
        return { data: { contexts: [opsContext], defaultContextId: opsContext.contextId, expiresIn: 600 } };
    };
    fetchImpl = async (url) => url.endsWith('/restore')
        ? response(404, { ok: false, code: 'ops_local_cache_miss' })
        : response(201, { ok: true, source: localSource('context-initial') });

    const initiallyPrepared = await prepareOpsTakeForExport(initialTake);
    assert.equal(initiallyPrepared.backendPath, 'D:\\mileto-cache\\context-initial\\source.mp4');
    assert.equal(initialContextCalls, 2);

    const refreshTake = baseTake('context-refresh');
    let refreshContextCalls = 0;
    let materializeCalls = 0;
    opsViewContextsImpl = async () => {
        refreshContextCalls += 1;
        if (refreshContextCalls === 2) {
            throw new GatewayError(503, 'refresh temporariamente indisponível');
        }
        const context = { ...opsContext, contextId: `context-refresh-${refreshContextCalls}` };
        return { data: { contexts: [context], defaultContextId: context.contextId, expiresIn: 600 } };
    };
    fetchImpl = async (url) => {
        if (url.endsWith('/restore')) {
            return response(404, { ok: false, code: 'ops_local_cache_miss' });
        }
        materializeCalls += 1;
        if (materializeCalls === 1) {
            return response(403, { ok: false, code: 'view_context_forbidden' });
        }
        return response(201, { ok: true, source: localSource('context-refresh') });
    };

    const refreshed = await prepareOpsTakeForExport(refreshTake);
    assert.equal(refreshed.backendPath, 'D:\\mileto-cache\\context-refresh\\source.mp4');
    assert.equal(refreshContextCalls, 3);
    assert.equal(materializeCalls, 2);
});

test('referência stale 409 e criação transitória entram na state machine de retry', async () => {
    const take = baseTake('stale');
    const materializeBodies = [];
    let materializeAttempts = 0;
    let createReferenceAttempts = 0;
    createReferenceImpl = async (assetId, contextId) => {
        createReferenceAttempts += 1;
        if (createReferenceAttempts === 1) {
            throw new GatewayError(429, 'criação temporariamente limitada');
        }
        return {
            id: '44444444-4444-4444-8444-444444444444',
            connectionId: 'connection-2',
            accountId: 'account-2',
            companyId: take.externalMedia.companyId,
            assetId,
            name: take.fileName,
            kind: 'video',
            folderId: null,
            version: '2',
            checksum: null,
            opsUpdatedAt: null,
            contextId,
        };
    };
    fetchImpl = async (url, init) => {
        if (url.endsWith('/restore')) {
            return response(404, { ok: false, code: 'ops_local_cache_miss', message: 'cache ausente' });
        }
        materializeAttempts += 1;
        materializeBodies.push(JSON.parse(init.body));
        if (materializeAttempts === 1) {
            return response(409, { ok: false, code: 'ops_reference_stale', message: 'referência expirada' });
        }
        return response(201, { ok: true, source: localSource('stale') });
    };

    const prepared = await prepareOpsTakeForExport(take);
    assert.equal(prepared.backendPath, 'D:\\mileto-cache\\stale\\source.mp4');
    assert.equal(materializeAttempts, 2);
    assert.equal(createReferenceAttempts, 2);
    assert.equal(materializeBodies[0].referenceId, take.externalMedia.referenceId);
    assert.equal(materializeBodies[1].referenceId, '44444444-4444-4444-8444-444444444444');
});

test('422 explícito de transporte rematerializa uma vez; 422 semântico falha direto', async () => {
    const transientTake = baseTake('checksum-retry');
    let transientMaterializations = 0;
    fetchImpl = async (url) => {
        if (url.endsWith('/restore')) {
            return response(404, { ok: false, code: 'ops_local_cache_miss' });
        }
        transientMaterializations += 1;
        if (transientMaterializations === 1) {
            return response(422, {
                ok: false,
                code: 'ops_download_checksum_mismatch',
                message: 'checksum da entrega divergente',
            });
        }
        return response(201, { ok: true, source: localSource('checksum-retry') });
    };

    const recovered = await prepareOpsTakeForExport(transientTake);
    assert.equal(recovered.backendPath, 'D:\\mileto-cache\\checksum-retry\\source.mp4');
    assert.equal(transientMaterializations, 2);

    const semanticTake = baseTake('semantic-422');
    let semanticMaterializations = 0;
    fetchImpl = async (url) => {
        if (url.endsWith('/restore')) {
            return response(404, { ok: false, code: 'ops_local_cache_miss' });
        }
        semanticMaterializations += 1;
        return response(422, {
            ok: false,
            code: 'ops_media_type_invalid',
            message: 'tipo de mídia inválido',
        });
    };

    await assert.rejects(
        prepareOpsTakeForExport(semanticTake),
        (error) => error?.status === 422 && error?.code === 'ops_media_type_invalid',
    );
    assert.equal(semanticMaterializations, 1);
});

test('servidor identifica 422 transitórios de integridade com códigos estáveis', () => {
    assert.match(serverOpsSource, /'ops_materialization_incomplete'/);
    assert.match(serverOpsSource, /'ops_download_size_mismatch'/);
    assert.match(serverOpsSource, /'ops_download_checksum_mismatch'/);
});

test('integração prepara o snapshot depois da captura e exige backendPath para take Ops', () => {
    const finishIndex = exportSource.indexOf('const finishResult = (await engine.finish');
    const prepareIndex = exportSource.indexOf('await prepareOpsTakeForExport(take)', finishIndex);
    const postIndex = exportSource.indexOf('/api/video/export-hybrid', prepareIndex);
    assert.ok(finishIndex >= 0 && prepareIndex > finishIndex && postIndex > prepareIndex);
    assert.match(exportSource, /takes:\s*preparedMediaTakes\.map/);
    assert.match(
        exportSource,
        /take\.externalMedia\?\.source === 'mileto_ops'[\s\S]{0,120}\? take\.backendPath[\s\S]{0,120}: take\.backendPath \|\| take\.fileUrl/,
    );
    assert.match(exportSource, /ops_export_take_unavailable:/);
});
