import { query } from './db.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { config } from './config.js';

export const PROVIDERS = [
    { id: 'fishAudio', label: 'Fish Audio', help: 'Narração (TTS). Cobra por byte UTF-8.' },
    { id: 'elevenLabs', label: 'ElevenLabs', help: 'Narração expressiva.' },
    { id: 'openai', label: 'OpenAI', help: 'Roteiros e chat.' },
    { id: 'gemini', label: 'Google Gemini', help: 'Roteiros e chat (alternativa).' },
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

/** Catálogo sugerido (os mesmos IDs que o app já usa). Aceita ID custom também. */
export const MODEL_CATALOG = {
    openai: [
        // Modelos de RACIOCÍNIO (gpt-5*, o*): respeitam o nível Rápido/Equilibrado/Profundo.
        { id: 'gpt-5', name: 'GPT-5 (raciocínio)' },
        { id: 'gpt-5-mini', name: 'GPT-5 Mini (raciocínio)' },
        { id: 'gpt-5-nano', name: 'GPT-5 Nano (raciocínio)' },
        { id: 'o4-mini', name: 'o4-mini (raciocínio)' },
        { id: 'o3-mini', name: 'o3-mini (raciocínio)' },
        // Modelos rápidos (sem raciocínio): o nível é ignorado.
        { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
        { id: 'gpt-4.1', name: 'GPT-4.1' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-4o', name: 'GPT-4o' },
    ],
    gemini: [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    ],
};

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
    if (!tier) return tierOrModel; // já é um id de modelo real
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
    await query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [`tier_${id}`, JSON.stringify({ provider, model })]
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

// ── Créditos de IA: multiplicador de revenda por RECURSO ────────────────────
// "Quantas vezes cobramos em cima do custo de IA" — configurável por feature.
// Vídeo e imagem já ficam prontos aqui, mesmo desligados no app v1 (ver ROADMAP-IMAGEM-VIDEO.md).
export const CREDIT_FEATURES = [
    { kind: 'tts', label: 'Narração (voz)', help: 'Síntese de voz (Fish/ElevenLabs).' },
    { kind: 'chat', label: 'Chat e roteiros', help: 'Assistente e geração de texto.' },
    { kind: 'stt', label: 'Legendas', help: 'Transcrição de áudio (Whisper).' },
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
