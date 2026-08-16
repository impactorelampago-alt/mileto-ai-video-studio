import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clearOpsListingCache,
    opsListingCacheKey,
    readOpsListingCache,
    removeOpsListingCache,
    writeOpsListingCache,
} from '../src/lib/opsLibraryCache.ts';

const fakeStorage = () => {
    const map = new Map();
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => void map.set(key, String(value)),
        removeItem: (key) => void map.delete(key),
        key: (index) => [...map.keys()][index] ?? null,
        get length() {
            return map.size;
        },
        _map: map,
    };
};

test('chave de cache junta as partes e tolera valores ausentes', () => {
    const key = opsListingCacheKey('assets', 'owner:conta', 'empresa-1', undefined, 'root');
    assert.match(key, /^mileto_ops_library_cache_v1:/);
    assert.ok(key.endsWith('assets|owner:conta|empresa-1||root'));
});

test('escrita e leitura fazem o ciclo completo com os dados intactos', () => {
    const storage = fakeStorage();
    const key = opsListingCacheKey('assets', 'empresa-1', 'root');
    const data = [{ id: 'a1', name: 'IMG_7966.mp4' }, { id: 'a2', name: 'IMG_7967.mp4' }];
    writeOpsListingCache(key, data, { storage });
    assert.deepEqual(readOpsListingCache(key, { storage }), data);
});

test('cache vencido e removido e retorna null', () => {
    const storage = fakeStorage();
    const key = opsListingCacheKey('assets', 'empresa-1');
    storage.setItem(key, JSON.stringify({ savedAt: Date.now() - 10_000, data: ['velho'] }));
    assert.equal(readOpsListingCache(key, { storage, maxAgeMs: 5_000 }), null);
    assert.equal(storage.getItem(key), null);
});

test('payload corrompido ou sem carimbo nunca quebra a leitura', () => {
    const storage = fakeStorage();
    storage.setItem('k1', '{nao-e-json');
    storage.setItem('k2', JSON.stringify({ data: ['sem savedAt'] }));
    assert.equal(readOpsListingCache('k1', { storage }), null);
    assert.equal(readOpsListingCache('k2', { storage }), null);
});

test('cota estourada limpa somente as chaves do cache e tenta de novo', () => {
    const storage = fakeStorage();
    storage.setItem('outra_coisa_do_app', 'preservar');
    writeOpsListingCache(opsListingCacheKey('assets', 'empresa-1'), ['antigo'], { storage });

    let failures = 1;
    const original = storage.setItem;
    storage.setItem = (key, value) => {
        if (failures > 0) {
            failures -= 1;
            throw new Error('QuotaExceededError');
        }
        original(key, value);
    };

    const key = opsListingCacheKey('assets', 'empresa-2');
    writeOpsListingCache(key, ['novo'], { storage });
    assert.deepEqual(readOpsListingCache(key, { storage }), ['novo']);
    assert.equal(storage.getItem('outra_coisa_do_app'), 'preservar');
    assert.equal(readOpsListingCache(opsListingCacheKey('assets', 'empresa-1'), { storage }), null);
});

test('remocao pontual e limpeza total respeitam o prefixo', () => {
    const storage = fakeStorage();
    const key = opsListingCacheKey('folders', 'empresa-1');
    writeOpsListingCache(key, ['pasta'], { storage });
    storage.setItem('fora_do_prefixo', 'fica');

    removeOpsListingCache(key, { storage });
    assert.equal(readOpsListingCache(key, { storage }), null);

    writeOpsListingCache(key, ['pasta'], { storage });
    clearOpsListingCache(storage);
    assert.equal(readOpsListingCache(key, { storage }), null);
    assert.equal(storage.getItem('fora_do_prefixo'), 'fica');
});

test('sem storage disponivel tudo degrada em silencio', () => {
    assert.equal(readOpsListingCache('k', { storage: null }), null);
    writeOpsListingCache('k', ['dado'], { storage: null });
    removeOpsListingCache('k', { storage: null });
    clearOpsListingCache(null);
});
