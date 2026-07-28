import crypto from 'node:crypto';

const ALLOWED_MODES = new Set(['self', 'team', 'profile']);
const ALLOWED_RELATIONSHIPS = new Set(['self', 'subordinate']);

export const OPS_VIEW_CONTEXT_HEADER = 'x-ops-view-context';

export const normalizeViewContextId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (Array.isArray(value)) {
        throw Object.assign(new Error('Contexto do Mileto Ops inválido.'), {
            status: 422,
            code: 'ops_view_context_invalid',
        });
    }
    const contextId = String(value).trim();
    if (
        contextId.length < 20 ||
        contextId.length > 300 ||
        !/^[A-Za-z0-9._~-]+$/.test(contextId)
    ) {
        throw Object.assign(new Error('Contexto do Mileto Ops inválido.'), {
            status: 422,
            code: 'ops_view_context_invalid',
        });
    }
    return contextId;
};

export const delegationCacheKey = (connectionId, aiUserId, viewContextId = null) => {
    const contextFingerprint = viewContextId
        ? crypto.createHash('sha256').update(viewContextId).digest('hex')
        : 'self';
    return `${connectionId}:${aiUserId}:${contextFingerprint}`;
};

const safeText = (value, maxLength) => {
    const text = String(value || '').trim();
    return text ? text.slice(0, maxLength) : '';
};

export const sanitizeViewContexts = (rawData) => {
    const source = rawData && typeof rawData === 'object' ? rawData : {};
    const contexts = [];
    const seen = new Set();

    for (const item of Array.isArray(source.contexts) ? source.contexts : []) {
        if (!item || typeof item !== 'object') continue;
        let contextId;
        try {
            contextId = normalizeViewContextId(item.contextId);
        } catch {
            continue;
        }
        const mode = String(item.mode || '');
        const label = safeText(item.label, 120);
        if (!contextId || seen.has(contextId) || !ALLOWED_MODES.has(mode) || !label) continue;

        const sanitized = {
            contextId,
            mode,
            label,
            subtitle: safeText(item.subtitle, 160),
            isDefault: Boolean(item.isDefault),
        };
        const relationship = String(item.relationship || '');
        if (mode === 'profile' && ALLOWED_RELATIONSHIPS.has(relationship)) {
            sanitized.relationship = relationship;
        }
        contexts.push(sanitized);
        seen.add(contextId);
    }

    if (!contexts.length) {
        throw Object.assign(new Error('O Mileto Ops não devolveu contextos de visualização válidos.'), {
            status: 502,
            code: 'ops_view_contexts_invalid',
        });
    }

    let defaultContextId = null;
    try {
        defaultContextId = normalizeViewContextId(source.defaultContextId);
    } catch {
        defaultContextId = null;
    }
    if (!defaultContextId || !seen.has(defaultContextId)) {
        defaultContextId =
            contexts.find((context) => context.isDefault)?.contextId ||
            contexts.find((context) => context.mode === 'self')?.contextId ||
            contexts[0].contextId;
    }

    return {
        defaultContextId,
        expiresIn: Math.min(1800, Math.max(60, Number(source.expiresIn) || 600)),
        capabilities: {
            canViewTeam: Boolean(source.capabilities?.canViewTeam),
            canViewProfiles: Boolean(source.capabilities?.canViewProfiles),
        },
        contexts: contexts.map((context) => ({
            ...context,
            isDefault: context.contextId === defaultContextId,
        })),
    };
};
