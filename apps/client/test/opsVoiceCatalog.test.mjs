import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildVoiceCatalogVoices,
    syncOpsVoiceCatalog,
    voiceCatalogContentHash,
} from '../src/lib/opsVoiceCatalog.ts';

const fakeStorage = () => {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => void map.set(k, String(v)),
        removeItem: (k) => void map.delete(k),
        key: (i) => [...map.keys()][i] ?? null,
        get length() { return map.size; },
        _map: map,
    };
};

test('mapeia vozes padrão e Fish custom: id -> voiceId, sem catalogKey', () => {
    const voices = buildVoiceCatalogVoices([
        { id: 'fish-abc', name: 'Voz da Victoria', provider: 'fishAudio', description: 'grave', catalogKey: 'mv-x' },
        { id: 'legacy-1', name: 'Legada sem provider' }, // provider ausente = Fish
        { id: 'el-1', name: 'ElevenLabs', provider: 'elevenLabs' }, // excluída
        { id: '', name: 'sem id' },
        { id: 'fish-abc', name: 'duplicada' },
    ]);
    assert.equal(voices.length, 6);
    assert.deepEqual(voices.slice(0, 4).map((voice) => ({
        voiceId: voice.voiceId,
        isCustom: voice.isCustom,
        isDefault: voice.isDefault,
        provider: voice.provider,
    })), [
        { voiceId: 'd7cdad0d54464bcfade4be58791c6f3d', isCustom: false, isDefault: true, provider: 'fish_audio' },
        { voiceId: '64ea557cd80c4fb99a96b209763f4ec9', isCustom: false, isDefault: true, provider: 'fish_audio' },
        { voiceId: 'fffaeef680cf41cdaff2c65d8cdd8650', isCustom: false, isDefault: true, provider: 'fish_audio' },
        { voiceId: '5c7c62ef7fc545908c8de8feab76a272', isCustom: false, isDefault: true, provider: 'fish_audio' },
    ]);
    assert.deepEqual(voices.slice(4), [
        { voiceId: 'fish-abc', name: 'Voz da Victoria', isCustom: true, provider: 'fish_audio', description: 'grave' },
        { voiceId: 'legacy-1', name: 'Legada sem provider', isCustom: true, provider: 'fish_audio' },
    ]);
    // catalogKey (mv-*) nunca vaza; enviamos o id de síntese.
    assert.ok(!JSON.stringify(voices).includes('mv-x'));
});

test('hash de conteúdo é estável e independente de ordem', () => {
    const a = [{ voiceId: 'a', name: 'A', isCustom: true }, { voiceId: 'b', name: 'B', isCustom: true }];
    const b = [{ voiceId: 'b', name: 'B', isCustom: true }, { voiceId: 'a', name: 'A', isCustom: true }];
    assert.equal(voiceCatalogContentHash(a), voiceCatalogContentHash(b));
    const c = [{ voiceId: 'a', name: 'A2', isCustom: true }];
    assert.notEqual(voiceCatalogContentHash(a), voiceCatalogContentHash(c));
});

const deps = (over = {}) => ({
    storage: fakeStorage(),
    readCustomVoices: () => [{ id: 'fish-1', name: 'Uma', provider: 'fishAudio' }],
    heartbeat: async () => ({ inSync: false, needsSnapshot: true, storedVersion: null }),
    put: async () => ({ ok: true, applied: true }),
    isSkippable: (e) => e && e.__skippable === true,
    ...over,
});

test('primeira sincronização empurra catalogVersion 1 e persiste o estado', async () => {
    const puts = [];
    const d = deps({ put: async (p) => { puts.push(p); return { ok: true, applied: true }; } });
    const outcome = await syncOpsVoiceCatalog(d);
    assert.equal(outcome, 'pushed');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].catalogVersion, 1);
    assert.deepEqual(puts[0].voices.slice(-1).map((v) => v.voiceId), ['fish-1']);
    assert.equal(puts[0].voices.length, 5);
    // estado persistido
    assert.match(d.storage.getItem('mileto_voice_catalog_sync_v1'), /"version":1/);
});

test('inSync não empurra', async () => {
    let putCalls = 0;
    const outcome = await syncOpsVoiceCatalog(deps({
        heartbeat: async () => ({ inSync: true, storedVersion: 1 }),
        put: async () => { putCalls += 1; return {}; },
    }));
    assert.equal(outcome, 'in-sync');
    assert.equal(putCalls, 0);
});

test('conteúdo inalterado entre aberturas mantém a mesma versão (idempotente)', async () => {
    const storage = fakeStorage();
    const versions = [];
    const base = {
        storage,
        readCustomVoices: () => [{ id: 'fish-1', name: 'Uma', provider: 'fishAudio' }],
        put: async (p) => { versions.push(p.catalogVersion); return { ok: true, applied: true }; },
        isSkippable: () => false,
    };
    // 1ª abertura: Ops vazio -> push v1
    await syncOpsVoiceCatalog({ ...base, heartbeat: async () => ({ inSync: false, storedVersion: null }) });
    // 2ª abertura: Ops já tem v1 -> inSync, sem push
    const second = await syncOpsVoiceCatalog({ ...base, heartbeat: async () => ({ inSync: true, storedVersion: 1 }) });
    assert.deepEqual(versions, [1]);
    assert.equal(second, 'in-sync');
});

test('mudança de conteúdo bumpa a versão', async () => {
    const storage = fakeStorage();
    storage.setItem('mileto_voice_catalog_sync_v1', JSON.stringify({ version: 4, contentHash: 'velho' }));
    let sent = 0;
    const outcome = await syncOpsVoiceCatalog({
        storage,
        readCustomVoices: () => [{ id: 'fish-9', name: 'Nova', provider: 'fishAudio' }],
        heartbeat: async () => ({ inSync: false, storedVersion: 4 }),
        put: async (p) => { sent = p.catalogVersion; return { ok: true, applied: true }; },
        isSkippable: () => false,
    });
    assert.equal(outcome, 'pushed');
    assert.equal(sent, 5); // 4 + 1
});

test('Ops à frente (reinstalação) reconcilia a versão para vencer', async () => {
    let sent = 0;
    const outcome = await syncOpsVoiceCatalog(deps({
        heartbeat: async () => ({ inSync: false, needsSnapshot: false, storedVersion: 42 }),
        put: async (p) => { sent = p.catalogVersion; return { ok: true, applied: true }; },
    }));
    assert.equal(outcome, 'pushed');
    assert.equal(sent, 43); // storedVersion + 1
});

test('erro "não vinculado" no heartbeat é ignorado sem PUT', async () => {
    let putCalls = 0;
    const outcome = await syncOpsVoiceCatalog(deps({
        heartbeat: async () => { throw { __skippable: true }; },
        put: async () => { putCalls += 1; return {}; },
    }));
    assert.equal(outcome, 'skipped');
    assert.equal(putCalls, 0);
});

test('heartbeat indisponível (não-skippable) cai no PUT direto', async () => {
    let putCalls = 0;
    const outcome = await syncOpsVoiceCatalog(deps({
        heartbeat: async () => { throw new Error('502'); },
        put: async () => { putCalls += 1; return { ok: true, applied: true }; },
    }));
    assert.equal(outcome, 'pushed');
    assert.equal(putCalls, 1);
});

test('falha do PUT skippable não persiste estado', async () => {
    const d = deps({ put: async () => { throw { __skippable: true }; } });
    const outcome = await syncOpsVoiceCatalog(d);
    assert.equal(outcome, 'skipped');
    assert.equal(d.storage.getItem('mileto_voice_catalog_sync_v1'), null);
});
