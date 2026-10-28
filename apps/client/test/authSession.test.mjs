import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/loadTs.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
function harness({ me, login, logout } = {}) {
    const state = []; let token = 'A'; const writes = []; const clears = [];
    class GatewayError extends Error { constructor(status) { super('gateway'); this.status = status; } }
    const react = {
        createContext: () => ({ Provider: {} }), useContext() {}, useEffect() {},
        useRef: value => ({ current: value }), useCallback: fn => fn,
        useState: initial => { const i = state.length; state.push(initial); return [initial, value => { state[i] = value; }]; },
    };
    const exports = loadTs('../../src/context/AuthContext.tsx', {
        react,
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
        '../lib/opsProjectBrand': { invalidateOpsBrandDirectoryCache() {} },
        '../lib/authStorage': { authStorage: {
            get: async () => token,
            set: async value => { writes.push(value); token = value; },
            clear: async expected => { clears.push(expected); if (expected !== undefined && expected !== token) return false; token = null; return true; },
        } },
        '../lib/gateway': { GatewayError, gatewayApi: {
            me: me || (async () => ({ user: { id: token }, balance: 10 })),
            login: login || (async () => ({ token: 'B', user: { id: 'B' } })),
            logout: logout || (async () => {}),
        } },
    });
    return { api: exports.AuthProvider({ children: null }).props.value, state, token: () => token, writes, clears, GatewayError };
}

test('resposta bem-sucedida anterior ao logout não restaura a conta encerrada', async () => {
    const response = deferred(); const h = harness({ me: () => response.promise });
    const pending = h.api.refreshMe(); await tick(); await h.api.logout();
    response.resolve({ user: { id: 'A' }, balance: 5 }); await pending;
    assert.equal(h.state[0], 'anon'); assert.equal(h.state[1], null); assert.equal(h.token(), null);
});

test('401 de conta anterior não apaga o login da conta nova', async () => {
    const response = deferred(); let calls = 0;
    const h = harness({ me: () => ++calls === 1 ? response.promise : Promise.resolve({ user: { id: 'B' }, balance: 10 }) });
    const pending = h.api.refreshMe(); await tick(); await h.api.logout(); await h.api.login('B', 'test'); await tick();
    response.reject(new h.GatewayError(401)); await pending;
    assert.equal(h.token(), 'B'); assert.equal(h.state[0], 'authed'); assert.equal(h.state[1].id, 'B');
});

test('duas atualizações fora de ordem preservam o saldo mais recente', async () => {
    const old = deferred(), fresh = deferred(); let calls = 0;
    const h = harness({ me: () => ++calls === 1 ? old.promise : fresh.promise });
    const a = h.api.refreshMe(); await tick(); const b = h.api.refreshMe(); await tick();
    fresh.resolve({ user: { id: 'A' }, balance: 20 }); await b;
    old.resolve({ user: { id: 'A' }, balance: 1 }); await a;
    assert.equal(h.state[2], 20);
});

test('login antigo atrasado não sobrescreve credenciais de um login mais recente', async () => {
    const old = deferred(); let calls = 0;
    const h = harness({ login: () => ++calls === 1 ? old.promise : Promise.resolve({ token: 'B', user: { id: 'B' } }) });
    const a = h.api.login('A', 'test'); await h.api.login('B', 'test');
    old.resolve({ token: 'A', user: { id: 'A' } }); await a; await tick();
    assert.deepEqual(h.writes, ['B']); assert.equal(h.token(), 'B'); assert.equal(h.state[1].id, 'B');
});

test('logout atrasado não remove uma sessão iniciada depois dele', async () => {
    const old = deferred(); const h = harness({ logout: () => old.promise });
    const pending = h.api.logout(); await h.api.login('B', 'test'); await tick(); old.resolve(); await pending;
    assert.equal(h.token(), 'B'); assert.equal(h.state[0], 'authed'); assert.equal(h.clears.length, 0);
});

test('401 da sessão corrente limpa apenas o token esperado', async () => {
    const h = harness({ me: async () => { throw new h.GatewayError(401); } });
    await h.api.refreshMe();
    assert.deepEqual(h.clears, ['A']); assert.equal(h.state[0], 'anon'); assert.equal(h.token(), null);
});
