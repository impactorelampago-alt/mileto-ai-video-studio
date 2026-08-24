import { query } from './db.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { config } from './config.js';
import {
    AGENT_DEFINITIONS,
    AGENT_REASONING_LEVELS,
    AGENT_TIERS,
    DEFAULT_AGENT_CONFIGS,
    NARRATOR_FINAL_DELIVERY_CONTRACT,
    upgradeBundledAgentSystemPrompt,
} from './agentDefaults.js';
import { getOrgAgentPrompt } from './orgAi.js';
import {
    MODEL_CATALOG,
    assertAiModelAllowed,
} from './aiModels.js';

export { MODEL_CATALOG } from './aiModels.js';

export const PROVIDERS = [
    { id: 'fishAudio', label: 'Fish Audio', help: 'Narração (TTS). Cobra por byte UTF-8.' },
    { id: 'elevenLabs', label: 'ElevenLabs', help: 'Narração expressiva.' },
    { id: 'openai', label: 'OpenAI', help: 'Roteiros e chat.' },
    { id: 'gemini', label: 'Google Gemini', help: 'Roteiros e chat (alternativa).' },
    { id: 'seedance', label: 'Seedance', help: 'Geração de vídeo por IA. A chave fica somente no gateway.' },
];

// Cache em memória: evita descriptografar a cada chamada de IA.
let cache = null;

const load = async () => {
    const { rows } = await query('SELECT key, value FROM settings');
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    cache = map;
    return map;
};

const ensure = async () => cache || (await load());

/**
 * Chave de um provedor. Prioridade: banco (definida no painel) → .env (fallback).
 * O painel é a fonte de verdade; o .env só existe para não travar o boot inicial.
 */
export const getKey = async (provider) => {
    const map = await ensure();
    const fromDb = map[`key_${provider}`];
    if (fromDb) return decryptSecret(fromDb);
    return config.keys[provider] || '';
};

export const setKey = async (provider, plain) => {
    const value = plain ? encryptSecret(plain) : null;
    await query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [`key_${provider}`, value]
    );
    cache = null; // invalida
};

/** Status das chaves para o painel — NUNCA devolve a chave inteira. */
export const keyStatus = async () => {
    const out = [];
    for (const p of PROVIDERS) {
        const key = await getKey(p.id);
        const map = await ensure();
        out.push({
            id: p.id,
            label: p.label,
            help: p.help,
            configured: !!key,
            source: map[`key_${p.id}`] ? 'painel' : config.keys[p.id] ? 'env' : null,
            preview: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : null,
        });
    }
    return out;
};

// ── Tiers Mileto (o que o cliente vê) → provedor + modelo real (escondido) ──

export const TIERS = [
    { id: 'lite', label: 'Mileto Lite', hint: 'Mais rápido e barato — rascunhos e respostas ágeis.' },
    { id: 'plus', label: 'Mileto Plus', hint: 'Equilíbrio entre qualidade e custo — uso do dia a dia.' },
    { id: 'ultra', label: 'Mileto Ultra', hint: 'Máxima qualidade — roteiros mais elaborados.' },
];

// Padrão sensato: Lite/Plus RÁPIDOS (sem raciocínio); Ultra = gpt-5 (RACIOCÍNIO),
// para o seletor Rápido/Equilibrado/Profundo do app realmente mudar o comportamento.
const TIER_DEFAULTS = {
    lite: { provider: 'openai', model: 'gpt-4.1-nano' },
    plus: { provider: 'openai', model: 'gpt-4.1-mini' },
    ultra: { provider: 'openai', model: 'gpt-5' },
};

export const getTiers = async () => {
    const map = await ensure();
    return TIERS.map((t) => {
        let cfg = TIER_DEFAULTS[t.id];
        try {
            if (map[`tier_${t.id}`]) cfg = JSON.parse(map[`tier_${t.id}`]);
        } catch {
            /* usa default */
        }
        return { ...t, provider: cfg.provider, model: cfg.model };
    });
};

/** Resolve o tier escolhido pelo cliente no modelo real. Aceita id de modelo direto também. */
export const resolveModel = async (tierOrModel) => {
    const tier = TIERS.find((t) => t.id === tierOrModel || `mileto-${t.id}` === tierOrModel);
    if (!tier) return tierOrModel; // compatibilidade com IDs legados já publicados
    const tiers = await getTiers();
    return tiers.find((t) => t.id === tier.id).model;
};

/**
 * Resolve o tier em { provider, model } reais.
 * O cliente manda "mileto-ultra"; aqui vira o provider+modelo configurado no painel.
 * Se vier um id de modelo cru, deduz o provider pelo catálogo.
 */
export const resolveTier = async (tierOrModel) => {
    const tier = TIERS.find((t) => t.id === tierOrModel || `mileto-${t.id}` === tierOrModel);
    if (tier) {
        const cfg = (await getTiers()).find((t) => t.id === tier.id);
        return { provider: cfg.provider, model: cfg.model };
    }
    const isGemini =
        MODEL_CATALOG.gemini.some((m) => m.id === tierOrModel) || String(tierOrModel).startsWith('gemini');
    return { provider: isGemini ? 'gemini' : 'openai', model: tierOrModel };
};

export const setTier = async (id, provider, model) => {
    const normalized = assertAiModelAllowed(provider, model);
    await query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [`tier_${id}`, JSON.stringify(normalized)]
    );
    cache = null;
};

// ── Prompt do chat Mileto ───────────────────────────────────────────────────

export const getPrompt = async () => {
    const map = await ensure();
    return map.chat_prompt || '';
};

const LANG_NAMES = {
    pt: 'Português do Brasil', 'pt-br': 'Português do Brasil', 'pt-pt': 'Português de Portugal',
    en: 'English', 'en-us': 'English', es: 'Español', fr: 'Français', de: 'Deutsch',
    it: 'Italiano', ja: '日本語', ko: '한국어', zh: '中文',
};

/** Prompt do chat com {idioma} já substituído pelo idioma do usuário. */
export const getSystemPrompt = async (locale = 'pt-BR') => {
    const raw = await getPrompt();
    if (!raw) return '';
    const key = String(locale).toLowerCase();
    const lang = LANG_NAMES[key] || LANG_NAMES[key.split('-')[0]] || 'Português do Brasil';
    return raw.split('{idioma}').join(lang);
};

export const setPrompt = async (text) => {
    await query(
        `INSERT INTO settings (key, value) VALUES ('chat_prompt',$1)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        [String(text)]
    );
    cache = null;
};

// ── Agentes especializados ───────────────────────────────────────────────

export { AGENT_DEFINITIONS, AGENT_REASONING_LEVELS, AGENT_TIERS };

const agentDefinition = (id) => AGENT_DEFINITIONS.find((agent) => agent.id === id) || null;
const agentSettingKey = (id) => `agent_${id}`;
const agentHistoryKey = (id) => `agent_history_${id}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

const parseJsonSetting = (map, key, fallback) => {
    try {
        return map[key] ? JSON.parse(map[key]) : fallback;
    } catch {
        return fallback;
    }
};

export const normalizeAgentTierId = (value) => {
    const raw = String(value || '').toLowerCase();
    if (raw === 'lite' || raw === 'mileto-lite') return 'lite';
    if (raw === 'ultra' || raw === 'mileto-ultra') return 'ultra';
    return 'mileto';
};

const normalizeAgentTier = (definition, input = {}, fallback = {}) => {
    const provider = String(input.provider ?? fallback.provider ?? 'openai').trim().toLowerCase();
    if (!['openai', 'gemini'].includes(provider)) {
        throw new Error('O cérebro do agente deve usar OpenAI ou Gemini.');
    }
    const model = String(input.model ?? fallback.model ?? '').trim();
    if (!model) throw new Error('Informe o modelo do agente.');
    const reasoning = String(input.reasoning ?? fallback.reasoning ?? 'equilibrado').trim().toLowerCase();
    if (!AGENT_REASONING_LEVELS.some((level) => level.id === reasoning)) {
        throw new Error('Modo de raciocínio inválido.');
    }
    const maxOutputTokens = Math.round(Number(input.maxOutputTokens ?? fallback.maxOutputTokens ?? 4096));
    if (!Number.isFinite(maxOutputTokens) || maxOutputTokens < 512 || maxOutputTokens > 32768) {
        throw new Error('O limite de saída deve ficar entre 512 e 32768 tokens.');
    }
    const productionAgent = ['image', 'video'].includes(definition.kind);
    const generationProvider = productionAgent
        ? String(input.generationProvider ?? fallback.generationProvider ?? '').trim().toLowerCase().slice(0, 60)
        : '';
    const generationModel = productionAgent
        ? String(input.generationModel ?? fallback.generationModel ?? '').trim().slice(0, 160)
        : '';
    const generationCostUsd = productionAgent
        ? Number(input.generationCostUsd ?? fallback.generationCostUsd ?? 0)
        : 0;
    if (!Number.isFinite(generationCostUsd) || generationCostUsd < 0 || generationCostUsd > 10000) {
        throw new Error('O custo máximo por geração deve ficar entre US$ 0 e US$ 10.000.');
    }
    return {
        provider,
        model: model.slice(0, 160),
        reasoning,
        maxOutputTokens,
        generationProvider,
        generationModel,
        generationCostUsd: Math.round(generationCostUsd * 1_000_000) / 1_000_000,
    };
};

/** Normaliza os três níveis e migra silenciosamente configurações antigas para "Mileto". */
export const normalizeAgentConfig = (id, input = {}, baseConfig = null) => {
    const definition = agentDefinition(id);
    if (!definition) throw new Error('Agente inválido.');
    const defaults = DEFAULT_AGENT_CONFIGS[id];
    const base = baseConfig || defaults;
    const inputTiers = input.tiers && typeof input.tiers === 'object' ? input.tiers : {};
    const baseTiers = base.tiers && typeof base.tiers === 'object' ? base.tiers : defaults.tiers;
    const legacyInput = input.provider || input.model ? input : {};
    const legacyBase = base.provider || base.model ? base : {};
    const tiers = Object.fromEntries(
        AGENT_TIERS.map((tier) => {
            const defaultTier = defaults.tiers[tier.id];
            const fallback = {
                ...defaultTier,
                ...(baseTiers?.[tier.id] || {}),
                ...(tier.id === 'mileto' ? legacyBase : {}),
            };
            const incoming = {
                ...(tier.id === 'mileto' ? legacyInput : {}),
                ...(inputTiers?.[tier.id] || {}),
            };
            return [tier.id, normalizeAgentTier(definition, incoming, fallback)];
        })
    );
    const systemPrompt = String(input.systemPrompt ?? base.systemPrompt ?? '').trim();
    if (!systemPrompt && id !== 'prompt_sales') throw new Error('O prompt de sistema não pode ficar vazio.');
    if (systemPrompt.length > 120000) throw new Error('O prompt de sistema ultrapassa 120.000 caracteres.');
    const internalVideoInstruction = id === 'prompt_sales'
        ? String(
            input.internalVideoInstruction
            ?? base.internalVideoInstruction
            ?? defaults.internalVideoInstruction
            ?? ''
        ).trim()
        : null;
    if (internalVideoInstruction && internalVideoInstruction.length > 120000) {
        throw new Error('A instrução interna do AI Video ultrapassa 120.000 caracteres.');
    }

    return {
        enabled: input.enabled === undefined ? Boolean(base.enabled) : Boolean(input.enabled),
        tiers,
        systemPrompt,
        ...(id === 'prompt_sales' ? { internalVideoInstruction } : {}),
    };
};

export const composeAgentSystemPrompt = (id, systemPrompt = '', internalVideoInstruction = '') => {
    const parts = [];
    const publicPrompt = String(systemPrompt || '').trim();
    if (publicPrompt) parts.push(publicPrompt);
    if (id === 'prompt_sales') {
        const privateInstruction = String(internalVideoInstruction || '').trim();
        if (privateInstruction) parts.push(privateInstruction);
        parts.push(NARRATOR_FINAL_DELIVERY_CONTRACT);
    }
    return parts.join('\n\n');
};

export const assertAgentModelsAllowed = (config) => {
    for (const tier of AGENT_TIERS) {
        const selected = config?.tiers?.[tier.id];
        if (selected) assertAiModelAllowed(selected.provider, selected.model);
    }
    return config;
};

export const upgradeBundledAgentConfig = (id, value) => value && typeof value === 'object'
    ? { ...value, systemPrompt: upgradeBundledAgentSystemPrompt(id, value.systemPrompt) }
    : value;

export const getAgentConfig = async (id) => {
    const definition = agentDefinition(id);
    if (!definition) throw new Error('Agente inválido.');
    const map = await ensure();
    const stored = parseJsonSetting(map, agentSettingKey(id), null);
    const defaults = clone(DEFAULT_AGENT_CONFIGS[id]);
    // Preserva o prompt do Chat Mileto existente na primeira adoção do Diretor.
    if (!stored && id === 'director' && map.chat_prompt) defaults.systemPrompt = map.chat_prompt;
    const effectiveStored = upgradeBundledAgentConfig(id, stored);
    const normalized = normalizeAgentConfig(id, effectiveStored || defaults, defaults);
    return {
        ...normalized,
        version: Number(stored?.version) || 1,
        publishedAt: stored?.publishedAt || null,
        publishedBy: stored?.publishedBy || null,
        rollbackOf: stored?.rollbackOf || null,
    };
};

export const getAgents = async () => {
    const agents = await Promise.all(
        AGENT_DEFINITIONS.map(async (definition) => ({ ...definition, config: await getAgentConfig(definition.id) }))
    );
    return { agents, catalog: MODEL_CATALOG, reasoningLevels: AGENT_REASONING_LEVELS, tiers: AGENT_TIERS };
};

export const publishAgentConfig = async (id, input, actorId = null, metadata = {}) => {
    const map = await ensure();
    const current = await getAgentConfig(id);
    const normalized = assertAgentModelsAllowed(normalizeAgentConfig(
        id,
        upgradeBundledAgentConfig(id, input),
        current
    ));
    const history = parseJsonSetting(map, agentHistoryKey(id), [])
        .map((item) => upgradeBundledAgentConfig(id, item));
    const highestVersion = Math.max(current.version || 1, ...history.map((item) => Number(item.version) || 0));
    const published = {
        ...normalized,
        version: highestVersion + 1,
        publishedAt: new Date().toISOString(),
        publishedBy: actorId || null,
        rollbackOf: metadata.rollbackOf || null,
    };
    const nextHistory = [published, current, ...history]
        .filter((item, index, items) => items.findIndex((other) => Number(other.version) === Number(item.version)) === index)
        .slice(0, 30);
    await query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [agentSettingKey(id), JSON.stringify(published)]
    );
    await query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [agentHistoryKey(id), JSON.stringify(nextHistory)]
    );
    cache = null;
    return published;
};

export const getAgentHistory = async (id) => {
    if (!agentDefinition(id)) throw new Error('Agente inválido.');
    const map = await ensure();
    const history = parseJsonSetting(map, agentHistoryKey(id), [])
        .map((item) => upgradeBundledAgentConfig(id, item));
    if (history.length) return history;
    return [await getAgentConfig(id)];
};

export const rollbackAgentConfig = async (id, version, actorId = null) => {
    const history = await getAgentHistory(id);
    const target = history.find((item) => Number(item.version) === Number(version));
    if (!target) throw new Error('Versão do agente não encontrada.');
    return publishAgentConfig(id, target, actorId, { rollbackOf: Number(version) });
};

/** Resolve somente no gateway: o renderer nunca recebe prompt, provedor ou modelo reais. */
export const resolveAgent = async (id, locale = 'pt-BR', requestedTier = 'mileto', orgId = null) => {
    const definition = agentDefinition(id);
    if (!definition) throw new Error('Agente inválido.');
    const config = await getAgentConfig(id);
    const tierId = normalizeAgentTierId(requestedTier);
    const tier = config.tiers[tierId];
    const key = String(locale).toLowerCase();
    const orgOverride = orgId ? await getOrgAgentPrompt(orgId, id) : null;
    const effectivePrompt = orgOverride
        ? upgradeBundledAgentSystemPrompt(id, orgOverride.prompt)
        : config.systemPrompt;
    const language = LANG_NAMES[key] || LANG_NAMES[key.split('-')[0]] || 'Português do Brasil';
    const systemPrompt = composeAgentSystemPrompt(id, effectivePrompt, config.internalVideoInstruction);
    return {
        id,
        label: definition.label,
        kind: definition.kind,
        enabled: config.enabled,
        tier: tierId,
        provider: tier.provider,
        model: tier.model,
        reasoning: tier.reasoning,
        maxOutputTokens: tier.maxOutputTokens,
        generationProvider: tier.generationProvider,
        generationModel: tier.generationModel,
        generationCostUsd: tier.generationCostUsd,
        systemPrompt: systemPrompt.split('{idioma}').join(language),
        promptSource: orgOverride ? 'organization' : 'global',
        promptUpdatedAt: orgOverride?.updatedAt || config.publishedAt || null,
        version: config.version,
    };
};

// ── Créditos de IA: multiplicador de revenda por RECURSO ────────────────────
// "Quantas vezes cobramos em cima do custo de IA" — configurável por feature.
// Vídeo e imagem já ficam prontos aqui, mesmo desligados no app v1 (ver ROADMAP-IMAGEM-VIDEO.md).
export const CREDIT_FEATURES = [
    { kind: 'tts', label: 'Narração (voz)', help: 'Síntese de voz (Fish/ElevenLabs).' },
    { kind: 'chat', label: 'Chat e roteiros', help: 'Assistente e geração de texto.' },
    { kind: 'stt', label: 'Legendas', help: 'Transcrição de áudio (Whisper).' },
    { kind: 'audio_isolation', label: 'Isolamento de voz', help: 'Separação de voz e ruído/música (ElevenLabs).' },
    { kind: 'image', label: 'Imagem (em breve)', help: 'Geração de imagem — v2 (Banana/Gemini).' },
    { kind: 'video', label: 'Vídeo (em breve)', help: 'Geração de vídeo — v2 (Seedance).' },
];

/**
 * Multiplicador de revenda. Com `kind`, usa o específico da feature; sem, o global.
 * Prioridade: mult_<kind> → resell_multiplier (global) → .env.
 */
export const getMultiplier = async (kind) => {
    const map = await ensure();
    if (kind) {
        const k = Number(map[`mult_${kind}`]);
        if (Number.isFinite(k) && k > 0) return k;
    }
    const g = Number(map.resell_multiplier);
    return Number.isFinite(g) && g > 0 ? g : config.resellMultiplier;
};

/** Multiplicador global (fallback quando a feature não tem valor próprio). */
export const setMultiplier = async (value) => {
    await query(
        `INSERT INTO settings (key, value) VALUES ('resell_multiplier',$1)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        [String(value)]
    );
    cache = null;
};

export const setKindMultiplier = async (kind, value) => {
    await query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [`mult_${kind}`, String(value)]
    );
    cache = null;
};

/** Todos os multiplicadores por feature (para a aba Créditos). */
export const getAllMultipliers = async () => {
    const out = { global: await getMultiplier() };
    for (const f of CREDIT_FEATURES) out[f.kind] = await getMultiplier(f.kind);
    return out;
};
