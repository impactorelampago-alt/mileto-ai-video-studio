import assert from 'node:assert/strict';
import test from 'node:test';
import { accountId, sameBackupOwner } from '../src/lib/backupOwner.ts';

test('o ID BIGINT do gateway em texto corresponde ao vínculo local numérico da mesma conta', () => {
    const owner = { userId: 42, orgId: 7 };
    assert.equal(sameBackupOwner(owner, { id: '42', orgId: '7' }), true);
    assert.equal(sameBackupOwner(owner, { id: 42, orgId: 7 }), true);
});

test('contas diferentes continuam isoladas, mesmo com tipos de ID mistos', () => {
    const owner = { userId: 42, orgId: 7 };
    assert.equal(sameBackupOwner(owner, { id: '43', orgId: '7' }), false);
    assert.equal(sameBackupOwner(owner, { id: '42', orgId: '8' }), false);
    assert.equal(sameBackupOwner(null, { id: '42', orgId: '7' }), false);
});

test('IDs inválidos ou fora da precisão segura nunca autorizam o vínculo', () => {
    assert.equal(accountId('42.0'), null);
    assert.equal(accountId('0'), null);
    assert.equal(accountId('9007199254740993'), null);
    assert.equal(sameBackupOwner({ userId: 42, orgId: 7 }, { id: '42x', orgId: '7' }), false);
});
