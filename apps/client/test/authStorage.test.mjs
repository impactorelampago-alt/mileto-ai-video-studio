import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/loadTs.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function storage(invoke, values = new Map(), blocked = false) {
    return loadTs('../../src/lib/authStorage.ts', {}, {
        window: invoke ? { require: () => ({ ipcRenderer: { invoke } }) } : {},
        sessionStorage: {
            getItem: key => { if (blocked) throw Error('blocked'); return values.get(key) ?? null; },
            setItem: (key, value) => { if (blocked) throw Error('blocked'); values.set(key, value); },
            removeItem: key => { if (blocked) throw Error('blocked'); values.delete(key); },
        },
    }).authStorage;
}

test('IPC false conserva a nova sessão temporária em vez do token antigo no disco', async () => {
    const values = new Map();
    const auth = storage(async channel => channel === 'auth:get' ? 'old' : false, values);
    await auth.set('new');
    assert.equal(await auth.get(), 'new');
    assert.equal(values.get('mileto_auth_token'), 'new');
    assert.equal(await storage(async () => 'old', values).get(), 'new', 'fallback sobrevive ao reload da janela');
});

test('exceção de IPC e sessionStorage bloqueado ainda permitem a sessão em memória', async () => {
    const auth = storage(async () => { throw Error('IPC failed'); }, new Map(), true);
    await auth.set('new'); assert.equal(await auth.get(), 'new');
    await auth.clear(); assert.equal(await auth.get(), null);
});

test('persistência segura bem-sucedida retira o fallback e utiliza o token cifrado', async () => {
    let saved = null;
    const values = new Map();
    const auth = storage(async (channel, token) => {
        if (channel === 'auth:set') { saved = token; return true; }
        if (channel === 'auth:clear') { saved = null; return true; }
        return saved;
    }, values);
    await auth.set('new'); assert.equal(values.size, 0); assert.equal(await auth.get(), 'new');
    await auth.clear(); assert.equal(await auth.get(), null); assert.equal(values.size, 0);
});

test('navegador sem Electron mantém sessão temporária e logout funciona', async () => {
    const auth = storage(null);
    await auth.set('browser'); assert.equal(await auth.get(), 'browser');
    await auth.clear(); assert.equal(await auth.get(), null);
});

test('enquanto a gravação cifrada está pendente, não grava token em sessionStorage', async () => {
    const saved = deferred(); const values = new Map();
    const auth = storage(async channel => channel === 'auth:set' ? saved.promise : 'new', values);
    const pending = auth.set('new');
    assert.equal(await auth.get(), 'new'); assert.equal(values.size, 0);
    saved.resolve(true); await pending; assert.equal(values.size, 0);
});

test('falha ao remover arquivo cifrado não ressuscita sessão após reload', async () => {
    const values = new Map();
    const invoke = async channel => channel === 'auth:get' ? 'old' : false;
    const auth = storage(invoke, values);
    await auth.clear(); assert.equal(await auth.get(), null);
    assert.equal(await storage(invoke, values).get(), null);
});

test('limpeza de uma sessão antiga não apaga uma nova', async () => {
    let clearCalls = 0;
    const auth = storage(async channel => { if (channel === 'auth:clear') clearCalls += 1; return false; });
    await auth.set('new');
    assert.equal(await auth.clear('old'), false);
    assert.equal(await auth.get(), 'new'); assert.equal(clearCalls, 0);
});

test('IPC verifica token esperado atomicamente e preserva sessão alterada no processo principal', async () => {
    let saved = 'old';
    const auth = storage(async channel => {
        if (channel === 'auth:clear') { saved = 'new'; return { cleared: false, reason: 'session-changed' }; }
        return saved;
    });
    assert.equal(await auth.clear('old'), false); assert.equal(await auth.get(), 'new');
});

test('encerrar fallback não recupera token persistido de outra conta', async () => {
    const auth = storage(async channel => channel === 'auth:get' ? 'old' : channel === 'auth:clear' ? { reason: 'session-changed' } : false);
    await auth.set('temporary');
    assert.equal(await auth.clear('temporary'), true); assert.equal(await auth.get(), null);
});

test('leitura IPC atrasada não substitui token definido enquanto aguardava', async () => {
    const read = deferred();
    const auth = storage(async channel => channel === 'auth:get' ? read.promise : false);
    const pending = auth.get(); await auth.set('new'); read.resolve('old');
    assert.equal(await pending, 'new');
});

test('confirmação antiga de escrita ou limpeza não remove fallback mais recente', async () => {
    const first = deferred(); let writes = 0;
    const auth = storage(async channel => channel === 'auth:set' && ++writes === 1 ? first.promise : false);
    const oldSet = auth.set('old'); await auth.set('new'); first.resolve(true); await oldSet;
    assert.equal(await auth.get(), 'new');

    const clear = deferred();
    const next = storage(async channel => channel === 'auth:clear' ? clear.promise : false);
    await next.set('old'); const pending = next.clear('old');
    await Promise.resolve(); await Promise.resolve();
    await next.set('new'); clear.resolve(true); await pending;
    assert.equal(await next.get(), 'new');
});
