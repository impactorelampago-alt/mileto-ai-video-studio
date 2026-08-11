import { query } from './db.js';
import { AGENT_DEFINITIONS } from './agentDefaults.js';
import { TITLE_ANIMATION_ID_SET, TITLE_MODEL_ID_SET } from './titleCatalog.js';

export const VIDEO_FORMATS = ['9:16', '16:9', '4:5', '1:1'];
export const COLOR_MODES = ['brand', 'fixed'];
export const PALETTE_SLOTS = ['rotate', 'primary', 'secondary', 'tertiary'];

const AGENT_IDS = new Set(AGENT_DEFINITIONS.map((agent) => agent.id));
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const TITLE_GENERATOR_SETTING_KEY = 'title_generator_config';

const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value, fallback = '', max = 12000) => {
    const normalized = String(value ?? '').trim();
    return (normalized || fallback).slice(0, max);
};
const number = (value, fallback, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const color = (value, fallback) => (HEX_COLOR.test(String(value || '').trim()) ? String(value).toLowerCase() : fallback);
const id = (value, fallback) => {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return (normalized || fallback).slice(0, 40);
};

const layouts = (portraitY, landscapeY, scale = 1, width = 78) => ({
    '9:16': { posX: 50, posY: portraitY, scale, scaleX: 1, scaleY: 1, textBoxWidthPct: width },
    '16:9': { posX: 50, posY: landscapeY, scale: scale * 0.9, scaleX: 1, scaleY: 1, textBoxWidthPct: Math.min(width, 64) },
    '4:5': { posX: 50, posY: portraitY, scale: scale * 0.95, scaleX: 1, scaleY: 1, textBoxWidthPct: Math.min(width, 74) },
    '1:1': { posX: 50, posY: landscapeY, scale: scale * 0.92, scaleX: 1, scaleY: 1, textBoxWidthPct: Math.min(width, 70) },
});

const brandColor = (paletteSlot = 'rotate', primary = '#00e676', secondary = '#07110d') => ({
    mode: 'brand', paletteSlot, primary, secondary,
});
const fixedColor = (primary, secondary) => ({
    mode: 'fixed', paletteSlot: 'primary', primary, secondary,
});

const LEGACY_TITLE_GENERATOR_CONFIG = {
    version: 1,
    extractionPrompt: 'Selecione apenas trechos literais da narração que aumentem retenção, clareza ou conversão. Nunca invente texto, oferta, prova, urgência ou localização.',
    maxTitles: 8,
    triggers: [
        {
            id: 'hook', name: 'Gancho', enabled: true, maxOccurrences: 2,
            instructions: 'Abertura, quebra de padrão, pergunta forte ou promessa sustentada pela narração.',
            color: brandColor('primary'),
            titleTypes: [{ id: 'impacto', name: 'Impacto', styleId: 'premium-kinetic-punch', fontFamily: 'Anton', durationSec: 2, color: null, layouts: layouts(26, 24, 1, 82) }],
        },
        {
            id: 'benefit', name: 'Benefício', enabled: true, maxOccurrences: 2,
            instructions: 'Benefício concreto, transformação, diferenciador ou prova realmente pronunciada.',
            color: brandColor('rotate'),
            titleTypes: [{ id: 'beneficio', name: 'Selo de benefício', styleId: 'premium-benefit-badge', fontFamily: 'Poppins', durationSec: 2, color: null, layouts: layouts(32, 28, 0.92, 76) }],
        },
        {
            id: 'offer', name: 'Oferta', enabled: true, maxOccurrences: 2,
            instructions: 'Preço, condição, bônus, prazo ou urgência somente quando forem ditos explicitamente.',
            color: brandColor('secondary'),
            titleTypes: [{ id: 'oferta', name: 'Oferta em destaque', styleId: 'premium-sale-spotlight', fontFamily: 'Poppins', durationSec: 2, color: null, layouts: layouts(38, 32, 0.95, 76) }],
        },
        {
            id: 'local', name: 'Localização', enabled: true, maxOccurrences: 1,
            instructions: 'Cidade, bairro, região ou endereço. Nunca invente e não repita a localização.',
            color: brandColor('tertiary'),
            titleTypes: [{ id: 'pin', name: 'Pin de local', styleId: 'loc-pin-viagem', fontFamily: 'Poppins', durationSec: 2, color: null, layouts: layouts(62, 68, 0.78, 62) }],
        },
        {
            id: 'cta', name: 'Chamada para ação', enabled: true, maxOccurrences: 1,
            instructions: 'Clique, chame, agende, compre, aproveite, garanta, acesse, reserve ou outra ação explicitamente pronunciada.',
            color: { mode: 'fixed', paletteSlot: 'primary', primary: '#54a812', secondary: '#ffffff' },
            titleTypes: [{ id: 'whatsapp', name: 'WhatsApp', styleId: 'cta-whatsapp', fontFamily: 'Poppins', durationSec: 2, color: null, layouts: layouts(55, 62, 0.72, 50) }],
        },
    ],
};

const titleType = (styleId, name, fontFamily, layout, animationId = 'pop', customColor = null) => ({
    id: styleId, name, styleId, fontFamily, durationSec: 2.5, animationId, color: customColor, layouts: layout,
});

export const DEFAULT_TITLE_GENERATOR_CONFIG = {
    version: 4,
    // Permite rollback remoto imediato sem trocar o desktop nem tocar no gerador v4.
    pipeline: 'reviewed-v1',
    ai: {
        provider: 'openai',
        model: 'gpt-5-mini',
        reasoning: 'rapido',
        maxOutputTokens: 1400,
    },
    reviewer: {
        model: 'gpt-4.1-nano',
        maxOutputTokens: 512,
        timeoutMs: 8000,
    },
    extractionPrompt: 'Detecte fatos explícitos da narração e transforme cada um em uma etiqueta visual curta. Preserve separadamente o trecho literal completo usado como evidência. Priorize substantivos, nomes próprios, valores e ações concretas; remova artigos, possessivos e conectores sem valor visual. Nunca invente texto, preço, benefício, bônus, urgência ou localização.',
    maxTitles: 8,
    triggers: [
        {
            id: 'scarcity', name: 'Escassez e urgência', enabled: true, maxOccurrences: 2,
            maxWords: 3,
            instructions: 'Prazo, quantidade, vagas, lote ou estoque limitado somente quando forem pronunciados explicitamente.',
            examples: ['Somente até sábado', 'Últimas 8 unidades', '3 vagas'], sample: 'SOMENTE ATÉ SÁBADO', color: brandColor('primary'),
            titleTypes: [
                titleType('premium-urgency-pulse', 'Urgency Pulse', 'Anton', layouts(34, 30, 0.95, 76), 'pop', fixedColor('#FF3B30', '#FFFFFF')),
                titleType('premium-coupon-ticket', 'Coupon Ticket', 'Space Grotesk', layouts(38, 34, 0.9, 74), 'slide', fixedColor('#7CFF6B', '#101510')),
            ],
        },
        {
            id: 'region', name: 'Região', enabled: true, maxOccurrences: 1,
            maxWords: 3,
            instructions: 'Cidade, estado, país, bairro, região ou área atendida. Nunca invente nem repita a localização.',
            examples: ['Casimiro de Abreu', 'Rio de Janeiro', 'Todo o Brasil'], sample: 'CASIMIRO DE ABREU', color: brandColor('tertiary'),
            titleTypes: [
                titleType('loc-pin-viagem', 'Pin de Viagem', 'Inter', layouts(62, 68, 0.78, 62), 'fade', fixedColor('#00E676', '#FFFFFF')),
                titleType('loc-minimal-urbano', 'Localização Minimalista', 'Inter', layouts(68, 72, 0.72, 60), 'fade', fixedColor('#00E676', '#FFFFFF')),
            ],
        },
        {
            id: 'cta', name: 'CTA', enabled: true, maxOccurrences: 1,
            maxWords: 3,
            instructions: 'Clique, chame, agende, compre, aproveite, garanta, acesse, reserve ou outra ação explicitamente pronunciada.',
            examples: ['Clique no botão', 'Chame no WhatsApp', 'Saiba mais'], sample: 'CLIQUE NO BOTÃO', color: brandColor('primary'),
            titleTypes: [
                titleType('cta-whatsapp', 'Balão WhatsApp', 'Inter', layouts(58, 64, 0.72, 52), 'pop', fixedColor('#A3E635', '#FFFFFF')),
                titleType('cta-tap', 'Botão de Clique', 'Poppins', layouts(60, 66, 0.72, 52), 'pop', fixedColor('#A3E635', '#FFFFFF')),
            ],
        },
        {
            id: 'price', name: 'Preço', enabled: true, maxOccurrences: 2,
            maxWords: 3,
            instructions: 'Valor, desconto, parcela, condição de pagamento ou economia somente quando forem ditos.',
            examples: ['R$ 199', '12x sem juros', '50% OFF'], sample: 'R$ 199', color: brandColor('secondary'),
            titleTypes: [
                titleType('premium-price-tag', 'Price Tag Pro', 'League Spartan', layouts(40, 34, 0.95, 76), 'pop', fixedColor('#FFB800', '#111318')),
                titleType('premium-sale-spotlight', 'Sale Spotlight', 'Archivo Black', layouts(38, 32, 0.95, 76), 'pop', fixedColor('#FF2D55', '#FFFFFF')),
            ],
        },
        {
            id: 'benefit', name: 'Benefício / bônus', enabled: true, maxOccurrences: 2,
            maxWords: 4,
            instructions: 'Benefício concreto, bônus, transformação, diferenciador ou prova realmente pronunciada.',
            examples: ['Exame por nossa conta', 'Bônus incluso', 'Entrega grátis'], sample: 'EXAME POR NOSSA CONTA', color: brandColor('rotate'),
            titleTypes: [
                titleType('premium-benefit-badge', 'Benefit Badge', 'DM Sans', layouts(32, 28, 0.92, 76), 'fade', fixedColor('#00D084', '#FFFFFF')),
                titleType('premium-product-launch', 'Product Launch', 'Space Grotesk', layouts(34, 30, 0.92, 76), 'slide', fixedColor('#8B5CFF', '#FFFFFF')),
            ],
        },
        {
            id: 'product', name: 'Produto / oferta central', enabled: true, maxOccurrences: 1,
            maxWords: 5,
            instructions: 'Produto, serviço ou oferta central explicitamente apresentados, sem confundir com preço ou urgência.',
            examples: ['Óculos completo', 'Armação mais lentes', 'Consultoria personalizada'], sample: 'ÓCULOS COMPLETO', color: brandColor('primary'),
            titleTypes: [
                titleType('premium-product-launch', 'Product Launch', 'Space Grotesk', layouts(34, 30, 0.92, 76), 'slide', fixedColor('#8B5CFF', '#FFFFFF')),
                titleType('premium-creator-caption', 'Creator Caption', 'DM Sans', layouts(36, 32, 0.9, 74), 'fade', fixedColor('#00C2FF', '#FFFFFF')),
            ],
        },
        {
            id: 'differentiator', name: 'Diferencial / prova', enabled: true, maxOccurrences: 1,
            maxWords: 5,
            instructions: 'Qualidade, mecanismo, personalização, garantia ou prova concreta realmente pronunciada.',
            examples: ['Do seu jeito', 'Atendimento personalizado', 'Qualidade comprovada'], sample: 'DO SEU JEITO', color: brandColor('rotate'),
            titleTypes: [
                titleType('premium-benefit-badge', 'Benefit Badge', 'DM Sans', layouts(32, 28, 0.92, 76), 'fade', fixedColor('#00D084', '#FFFFFF')),
                titleType('premium-outline-echo', 'Outline Echo', 'Archivo Black', layouts(36, 32, 0.9, 76), 'fade', fixedColor('#8B5CFF', '#FFFFFF')),
            ],
        },
        {
            id: 'audience', name: 'Público / necessidade', enabled: true, maxOccurrences: 1,
            maxWords: 5,
            instructions: 'Público, necessidade ou problema explícito ao qual a oferta responde. Não deduza perfis não mencionados.',
            examples: ['Para quem precisa', 'Seu segundo óculos', 'Quem busca economia'], sample: 'PARA QUEM PRECISA', color: brandColor('secondary'),
            titleTypes: [
                titleType('premium-split-block', 'Split Block', 'Anton', layouts(36, 32, 0.9, 76), 'slide', fixedColor('#00D9B5', '#FFFFFF')),
                titleType('premium-kinetic-punch', 'Kinetic Punch', 'Archivo Black', layouts(34, 30, 0.92, 78), 'pop', fixedColor('#C8FF26', '#FFFFFF')),
            ],
        },
    ],
};

const DEFAULT_TRIGGER_COPY_MIGRATIONS = {
    scarcity: {
        sample: 'SOMENTE ATÉ SÁBADO', legacySamples: ['SÓ ATÉ SEXTA'],
        examples: ['Somente até sábado', 'Últimas 8 unidades', '3 vagas'],
        legacyExamples: ['Só até sexta', 'Últimas 8 unidades', '3 vagas'],
    },
    region: {
        sample: 'CASIMIRO DE ABREU', legacySamples: ['BELO HORIZONTE • MG'],
        examples: ['Casimiro de Abreu', 'Rio de Janeiro', 'Todo o Brasil'],
        legacyExamples: ['Belo Horizonte', 'Minas Gerais', 'Todo o Brasil'],
    },
    cta: {
        sample: 'CLIQUE NO BOTÃO', legacySamples: ['CHAME AGORA NO WHATSAPP', 'CLIQUE AQUI'],
        examples: ['Clique no botão', 'Chame no WhatsApp', 'Saiba mais'],
        legacyExamples: ['Clique aqui', 'Chame no WhatsApp', 'Saiba mais'],
    },
    price: {
        sample: 'R$ 199', legacySamples: ['POR APENAS R$ 99'],
        examples: ['R$ 199', '12x sem juros', '50% OFF'],
        legacyExamples: ['Por R$ 99', '12x sem juros', '50% OFF'],
    },
    benefit: {
        sample: 'EXAME POR NOSSA CONTA', legacySamples: ['ENTREGA GRÁTIS'],
        examples: ['Exame por nossa conta', 'Bônus incluso', 'Entrega grátis'],
        legacyExamples: ['Entrega grátis', 'Bônus incluso', 'Economize tempo'],
    },
};

const normalizeTriggerCopy = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');

export const normalizeTitleColor = (input, fallback = brandColor()) => {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return {
        mode: COLOR_MODES.includes(source.mode) ? source.mode : fallback.mode,
        paletteSlot: PALETTE_SLOTS.includes(source.paletteSlot) ? source.paletteSlot : fallback.paletteSlot,
        primary: color(source.primary, fallback.primary),
        secondary: color(source.secondary, fallback.secondary),
    };
};

const normalizeLayouts = (input, fallback) => Object.fromEntries(VIDEO_FORMATS.map((format) => {
    const source = input?.[format] || {};
    const base = fallback?.[format] || DEFAULT_TITLE_GENERATOR_CONFIG.triggers[0].titleTypes[0].layouts[format];
    return [format, {
        posX: number(source.posX, base.posX, 0, 100),
        posY: number(source.posY, base.posY, 0, 100),
        scale: number(source.scale, base.scale, 0.25, 4),
        scaleX: number(source.scaleX, base.scaleX || 1, 0.25, 3),
        scaleY: number(source.scaleY, base.scaleY || 1, 0.25, 3),
        // A largura é lógica (antes da escala do modelo). Valores acima de 100%
        // permitem que a caixa visual ocupe o quadro inteiro sem deformar a arte.
        textBoxWidthPct: number(source.textBoxWidthPct, base.textBoxWidthPct, 20, 300),
    }];
}));

const normalizeTitleType = (input, fallback, index) => {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return {
        id: id(source.id, fallback?.id || `tipo-${index + 1}`),
        name: text(source.name, fallback?.name || `Tipo ${index + 1}`, 80),
        styleId: TITLE_MODEL_ID_SET.has(String(source.styleId))
            ? String(source.styleId)
            : fallback?.styleId || 'premium-kinetic-punch',
        fontFamily: text(source.fontFamily, fallback?.fontFamily || 'Poppins', 80),
        durationSec: number(source.durationSec, fallback?.durationSec || 2, 0.5, 10),
        animationId: TITLE_ANIMATION_ID_SET.has(String(source.animationId))
            ? String(source.animationId)
            : fallback?.animationId || 'pop',
        color: source.color == null ? null : normalizeTitleColor(source.color, fallback?.color || brandColor()),
        layouts: normalizeLayouts(source.layouts, fallback?.layouts),
    };
};

const normalizeTrigger = (input, fallback, index) => {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const sourceTypes = Array.isArray(source.titleTypes) ? source.titleTypes.slice(0, 20) : fallback.titleTypes;
    const legacyMaxWords = sourceTypes.reduce((highest, item) => Math.max(highest, Number(item?.maxWords) || 0), 0);
    const normalizedTypes = sourceTypes.map((item, typeIndex) => normalizeTitleType(item, fallback.titleTypes[typeIndex] || fallback.titleTypes[0], typeIndex));
    const seen = new Set();
    normalizedTypes.forEach((item, typeIndex) => {
        if (seen.has(item.id)) item.id = `${item.id}-${typeIndex + 1}`;
        seen.add(item.id);
    });
    const normalized = {
        id: id(source.id, fallback?.id || `gatilho-${index + 1}`),
        name: text(source.name, fallback?.name || `Gatilho ${index + 1}`, 80),
        enabled: source.enabled === undefined ? Boolean(fallback.enabled) : Boolean(source.enabled),
        maxWords: Math.round(number(source.maxWords, legacyMaxWords || fallback.maxWords || 3, 1, 12)),
        maxOccurrences: Math.round(number(source.maxOccurrences, fallback.maxOccurrences || 1, 1, 6)),
        instructions: text(source.instructions, fallback.instructions, 3000),
        examples: (Array.isArray(source.examples) ? source.examples : fallback.examples || [])
            .map((example) => text(example, '', 80)).filter(Boolean).slice(0, 8),
        sample: text(source.sample, fallback.sample || source.name || 'TÍTULO DE EXEMPLO', 120),
        color: normalizeTitleColor(source.color, fallback.color),
        titleTypes: normalizedTypes,
    };
    const migration = DEFAULT_TRIGGER_COPY_MIGRATIONS[normalized.id];
    const normalizedSample = normalizeTriggerCopy(normalized.sample);
    const usesDefaultSample = migration && (
        !normalizedSample
        || normalizedSample === normalizeTriggerCopy(normalized.name)
        || migration.legacySamples.some((sample) => normalizeTriggerCopy(sample) === normalizedSample)
    );
    if (usesDefaultSample) {
        normalized.sample = migration.sample;
    }
    if (migration && (
        normalized.examples.length === 0
        || JSON.stringify(normalized.examples) === JSON.stringify(migration.legacyExamples)
    )) {
        normalized.examples = clone(migration.examples);
    }
    return normalized;
};

const migrateV1Config = (input) => {
    const source = clone(input || LEGACY_TITLE_GENERATOR_CONFIG);
    if (Number(source.version) >= 2) return source;
    const migrated = (Array.isArray(source.triggers) ? source.triggers : [])
        .filter((trigger) => String(trigger?.id || '').toLowerCase() !== 'hook')
        .map((trigger) => {
            const next = clone(trigger);
            if (next.id === 'local') { next.id = 'region'; next.name = 'Região'; }
            if (next.id === 'offer') { next.id = 'price'; next.name = 'Preço'; }
            return next;
        });
    const present = new Set(migrated.map((trigger) => trigger.id));
    for (const fallback of DEFAULT_TITLE_GENERATOR_CONFIG.triggers) {
        if (!present.has(fallback.id)) migrated.push(clone(fallback));
    }
    return { ...source, version: 2, triggers: migrated };
};

const migrateV2Config = (input) => {
    const source = migrateV1Config(input);
    if (Number(source.version) >= 3) return source;
    const migrated = Array.isArray(source.triggers) ? source.triggers.map((trigger) => clone(trigger)) : [];
    const present = new Set(migrated.map((trigger) => trigger.id));
    for (const fallback of DEFAULT_TITLE_GENERATOR_CONFIG.triggers) {
        if (!present.has(fallback.id)) migrated.push(clone(fallback));
    }
    return { ...source, version: 3, triggers: migrated };
};

const migrateV3Config = (input) => {
    const source = migrateV2Config(input);
    if (Number(source.version) >= 4) return source;
    const ai = source.ai || {};
    const usesLegacyAiPreset = String(ai.provider || 'openai') === 'openai'
        && String(ai.model || 'gpt-5-mini') === 'gpt-5-mini'
        && String(ai.reasoning || 'equilibrado') === 'equilibrado'
        && Number(ai.maxOutputTokens ?? 4096) === 4096;
    return {
        ...source,
        version: 4,
        ai: usesLegacyAiPreset ? clone(DEFAULT_TITLE_GENERATOR_CONFIG.ai) : ai,
    };
};

export const normalizeTitleGeneratorConfig = (input, base = DEFAULT_TITLE_GENERATOR_CONFIG) => {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const source = migrateV3Config(raw);
    const sourceTriggers = Array.isArray(source.triggers) && source.triggers.length ? source.triggers.slice(0, 30) : base.triggers;
    const triggers = sourceTriggers.map((item, index) => normalizeTrigger(
        item,
        base.triggers.find((candidate) => candidate.id === item?.id) || base.triggers[0],
        index
    ));
    const seen = new Set();
    triggers.forEach((trigger, index) => {
        if (seen.has(trigger.id)) trigger.id = `${trigger.id}-${index + 1}`;
        seen.add(trigger.id);
    });
    if (!triggers.some((trigger) => trigger.enabled)) throw new Error('Ative pelo menos um gatilho de título.');
    if (triggers.some((trigger) => trigger.enabled && !trigger.titleTypes.length)) {
        throw new Error('Todo gatilho ativo precisa ter pelo menos um modelo de título.');
    }
    return {
        version: 4,
        pipeline: base.pipeline === 'legacy-v4'
            ? 'legacy-v4'
            : ['legacy-v4', 'reviewed-v1'].includes(String(source.pipeline))
                ? String(source.pipeline)
                : base.pipeline || DEFAULT_TITLE_GENERATOR_CONFIG.pipeline,
        ai: {
            provider: ['openai', 'gemini'].includes(String(source.ai?.provider))
                ? String(source.ai.provider)
                : base.ai?.provider || DEFAULT_TITLE_GENERATOR_CONFIG.ai.provider,
            model: text(source.ai?.model, base.ai?.model || DEFAULT_TITLE_GENERATOR_CONFIG.ai.model, 160),
            reasoning: ['rapido', 'equilibrado', 'profundo'].includes(String(source.ai?.reasoning))
                ? String(source.ai.reasoning)
                : base.ai?.reasoning || DEFAULT_TITLE_GENERATOR_CONFIG.ai.reasoning,
            maxOutputTokens: Math.round(number(
                source.ai?.maxOutputTokens,
                base.ai?.maxOutputTokens || DEFAULT_TITLE_GENERATOR_CONFIG.ai.maxOutputTokens,
                512,
                32768
            )),
        },
        reviewer: {
            // reviewed-v1 possui um unico revisor aprovado: barato, rapido e sem reasoning.
            model: DEFAULT_TITLE_GENERATOR_CONFIG.reviewer.model,
            maxOutputTokens: Math.round(number(
                source.reviewer?.maxOutputTokens,
                base.reviewer?.maxOutputTokens || DEFAULT_TITLE_GENERATOR_CONFIG.reviewer.maxOutputTokens,
                512,
                1200
            )),
            timeoutMs: Math.round(number(
                source.reviewer?.timeoutMs,
                base.reviewer?.timeoutMs || DEFAULT_TITLE_GENERATOR_CONFIG.reviewer.timeoutMs,
                3000,
                15000
            )),
        },
        extractionPrompt: text(source.extractionPrompt, base.extractionPrompt, 12000),
        maxTitles: Math.round(number(source.maxTitles, base.maxTitles, 1, 12)),
        triggers,
    };
};

/**
 * O editor da organizacao recebe a config efetiva. Durante o kill switch ela vem
 * como legacy-v4, mas isso nao pode cristalizar no override ao salvar um layout.
 * A escolha de pipeline pertence exclusivamente ao global; o org salva apenas a
 * configuracao editorial que voltara a reviewed-v1 quando o switch for liberado.
 */
export const normalizeStoredOrgTitleGeneratorConfig = (input, globalConfig) => ({
    ...normalizeTitleGeneratorConfig(input, { ...globalConfig, pipeline: 'reviewed-v1' }),
    pipeline: 'reviewed-v1',
});

export const getOrgAgentPrompt = async (orgId, agentId) => {
    if (!orgId || !AGENT_IDS.has(agentId)) return null;
    const row = (await query(
        'SELECT system_prompt, updated_at FROM org_agent_prompt_overrides WHERE org_id = $1 AND agent_id = $2',
        [orgId, agentId]
    )).rows[0];
    return row ? { prompt: row.system_prompt, updatedAt: row.updated_at } : null;
};

export const setOrgAgentPrompt = async (orgId, agentId, prompt, actorId) => {
    if (!AGENT_IDS.has(agentId)) throw new Error('Agente inválido.');
    if (prompt == null) {
        await query('DELETE FROM org_agent_prompt_overrides WHERE org_id = $1 AND agent_id = $2', [orgId, agentId]);
        return null;
    }
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('O prompt da agência não pode ficar vazio.');
    if (prompt.length > 120000) throw new Error('O prompt ultrapassa 120.000 caracteres.');
    return (await query(
        `INSERT INTO org_agent_prompt_overrides (org_id, agent_id, system_prompt, updated_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (org_id, agent_id) DO UPDATE
         SET system_prompt = EXCLUDED.system_prompt, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING system_prompt, updated_at`,
        [orgId, agentId, prompt.trim(), actorId || null]
    )).rows[0];
};

export const listOrgAgentPromptOverrides = async (orgId) => (await query(
    'SELECT agent_id, system_prompt, updated_at FROM org_agent_prompt_overrides WHERE org_id = $1',
    [orgId]
)).rows;

export const getGlobalTitleGeneratorConfig = async () => {
    const row = (await query('SELECT value, updated_at FROM settings WHERE key = $1', [TITLE_GENERATOR_SETTING_KEY])).rows[0];
    let stored = null;
    try { stored = row?.value ? JSON.parse(row.value) : null; } catch { stored = null; }
    return { config: normalizeTitleGeneratorConfig(stored || DEFAULT_TITLE_GENERATOR_CONFIG), updatedAt: row?.updated_at || null };
};

export const setGlobalTitleGeneratorConfig = async (input) => {
    const config = normalizeTitleGeneratorConfig(input);
    const row = (await query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         RETURNING updated_at`,
        [TITLE_GENERATOR_SETTING_KEY, JSON.stringify(config)]
    )).rows[0];
    return { config, updatedAt: row.updated_at };
};

export const getOrgTitleGeneratorConfig = async (orgId) => {
    const global = await getGlobalTitleGeneratorConfig();
    const row = (await query('SELECT config, updated_at FROM org_title_generator_settings WHERE org_id = $1', [orgId])).rows[0];
    if (!row) return { config: clone(global.config), defaultConfig: global.config, usesDefault: true, updatedAt: global.updatedAt };
    const storedOrgConfig = normalizeStoredOrgTitleGeneratorConfig(row.config, global.config);
    return {
        config: normalizeTitleGeneratorConfig(storedOrgConfig, global.config),
        defaultConfig: global.config,
        usesDefault: false,
        updatedAt: row.updated_at,
    };
};

export const setOrgTitleGeneratorConfig = async (orgId, input, actorId) => {
    if (input == null) {
        await query('DELETE FROM org_title_generator_settings WHERE org_id = $1', [orgId]);
        return getOrgTitleGeneratorConfig(orgId);
    }
    const global = await getGlobalTitleGeneratorConfig();
    const storedConfig = normalizeStoredOrgTitleGeneratorConfig(input, global.config);
    const row = (await query(
        `INSERT INTO org_title_generator_settings (org_id, config, updated_by)
         VALUES ($1,$2,$3)
         ON CONFLICT (org_id) DO UPDATE
         SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING updated_at`,
        [orgId, storedConfig, actorId || null]
    )).rows[0];
    return {
        config: normalizeTitleGeneratorConfig(storedConfig, global.config),
        defaultConfig: global.config,
        usesDefault: false,
        updatedAt: row.updated_at,
    };
};
