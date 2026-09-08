import test from 'node:test';
import assert from 'node:assert/strict';
import { opsMediaOriginsFor } from '../src/services/opsMediaOrigin';

test('aceita os dois domínios oficiais durante a migração do Ops', () => {
    assert.deepEqual(
        [...opsMediaOriginsFor('https://miletoops.com')].sort(),
        ['https://apoloops.com', 'https://miletoops.com']
    );
    assert.deepEqual(
        [...opsMediaOriginsFor('https://apoloops.com')].sort(),
        ['https://apoloops.com', 'https://miletoops.com']
    );
});

test('não amplia a confiança de uma instalação com origem própria', () => {
    assert.deepEqual([...opsMediaOriginsFor('https://ops.exemplo.com.br')], ['https://ops.exemplo.com.br']);
});

test('não aceita domínios parecidos com os oficiais', () => {
    const origins = opsMediaOriginsFor('https://apoloops.com');
    assert.equal(origins.has('https://apoloops.com.evil.example'), false);
    assert.equal(origins.has('https://www.apoloops.com'), false);
});
