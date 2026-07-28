import test from 'node:test';
import assert from 'node:assert/strict';
import {
    delegationCacheKey,
    normalizeViewContextId,
    sanitizeViewContexts,
} from '../src/opsViewContext.js';

const contextId = (suffix) => `mav_vc_${String(suffix).padEnd(24, 'x')}`;

test('normaliza somente contextos opacos válidos', () => {
    assert.equal(normalizeViewContextId(undefined), null);
    assert.equal(normalizeViewContextId(contextId('self')), contextId('self'));
    assert.throws(() => normalizeViewContextId('curto'), /inválido/);
    assert.throws(() => normalizeViewContextId('mav_vc_contexto com espaço'), /inválido/);
});

test('a chave de cache separa self, team e perfis sem expor o contextId', () => {
    const selfKey = delegationCacheKey('connection', 7, null);
    const teamKey = delegationCacheKey('connection', 7, contextId('team'));
    const profileKey = delegationCacheKey('connection', 7, contextId('profile'));
    assert.notEqual(selfKey, teamKey);
    assert.notEqual(teamKey, profileKey);
    assert.equal(teamKey.includes(contextId('team')), false);
});

test('sanitiza a resposta antes de entregá-la ao renderer', () => {
    const self = contextId('self');
    const profile = contextId('profile');
    const result = sanitizeViewContexts({
        defaultContextId: self,
        expiresIn: 600,
        capabilities: { canViewTeam: false, canViewProfiles: true, internalRule: 'não vazar' },
        contexts: [
            {
                contextId: self,
                mode: 'self',
                label: 'Minha conta',
                subtitle: 'Dono',
                opsProfileId: 'segredo-interno',
                email: 'nao@expor.test',
            },
            {
                contextId: profile,
                mode: 'profile',
                label: 'Otavio',
                subtitle: 'Vendedor',
                relationship: 'subordinate',
                hierarchy: ['interno'],
            },
        ],
    });

    assert.deepEqual(Object.keys(result.contexts[0]).sort(), [
        'contextId',
        'isDefault',
        'label',
        'mode',
        'subtitle',
    ]);
    assert.equal(result.contexts[1].relationship, 'subordinate');
    assert.equal(JSON.stringify(result).includes('segredo-interno'), false);
    assert.equal(JSON.stringify(result).includes('nao@expor.test'), false);
});

test('ignora opções forjadas e falha fechado quando nenhuma opção é válida', () => {
    const valid = contextId('valid');
    const sanitized = sanitizeViewContexts({
        contexts: [
            { contextId: 'forjado', mode: 'team', label: 'Todos' },
            { contextId: valid, mode: 'admin', label: 'Administrador' },
            { contextId: valid, mode: 'self', label: 'Minha conta' },
        ],
    });
    assert.equal(sanitized.contexts.length, 1);
    assert.equal(sanitized.contexts[0].mode, 'self');
    assert.throws(() => sanitizeViewContexts({ contexts: [] }), /não devolveu contextos/);
});
