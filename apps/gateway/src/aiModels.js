/**
 * Catálogo único de modelos de texto aceitos pelo gateway.
 *
 * A interface usa este catálogo para montar seletores, mas a segurança não
 * depende da interface: toda gravação e toda resolução de modelo são validadas
 * novamente no servidor.
 */
export const MODEL_CATALOG = Object.freeze({
    openai: Object.freeze([
        {
            id: 'gpt-5.6-luna',
            name: 'GPT-5.6 Luna',
            recommended: true,
            reasoning: true,
            reasoningEfforts: Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max']),
            endpoints: Object.freeze(['chat_completions', 'responses']),
            pricingUsdPerMillion: Object.freeze({ input: 0.2, cachedInput: 0.02, output: 1.2 }),
        },
        // Modelos de raciocínio (gpt-5*, o*): respeitam o nível configurado.
        { id: 'gpt-5', name: 'GPT-5 (raciocínio)', reasoning: true },
        { id: 'gpt-5-mini', name: 'GPT-5 Mini (raciocínio)', reasoning: true },
        { id: 'gpt-5-nano', name: 'GPT-5 Nano (raciocínio)', reasoning: true },
        { id: 'o4-mini', name: 'o4-mini (raciocínio)', reasoning: true },
        { id: 'o3-mini', name: 'o3-mini (raciocínio)', reasoning: true },
        // Modelos sem raciocínio configurável: o nível é ignorado.
        { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', reasoning: false },
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', reasoning: false },
        { id: 'gpt-4.1', name: 'GPT-4.1', reasoning: false },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', reasoning: false },
        { id: 'gpt-4o', name: 'GPT-4o', reasoning: false },
    ]),
    gemini: Object.freeze([
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', reasoning: false },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', reasoning: false },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', reasoning: false },
    ]),
});

export const AI_PROVIDERS = Object.freeze(Object.keys(MODEL_CATALOG));

export const catalogModel = (provider, model) => {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedModel = String(model || '').trim();
    return MODEL_CATALOG[normalizedProvider]?.find((entry) => entry.id === normalizedModel) || null;
};

export const isAiModelAllowed = (provider, model) => Boolean(catalogModel(provider, model));

export const catalogProviderForModel = (model) => {
    const normalizedModel = String(model || '').trim();
    return AI_PROVIDERS.find((provider) => MODEL_CATALOG[provider].some((entry) => entry.id === normalizedModel)) || null;
};

export const assertAiModelAllowed = (provider, model) => {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedModel = String(model || '').trim();
    if (!MODEL_CATALOG[normalizedProvider]) {
        throw new Error('Provedor de IA inválido.');
    }
    if (!normalizedModel) throw new Error('Informe o modelo de IA.');
    if (!isAiModelAllowed(normalizedProvider, normalizedModel)) {
        throw new Error(`O modelo ${normalizedModel} não está disponível para ${normalizedProvider}. Selecione um modelo da lista.`);
    }
    return { provider: normalizedProvider, model: normalizedModel };
};

export const isOpenAiReasoningModel = (model) => {
    const normalized = String(model || '').trim();
    const catalogEntry = catalogModel('openai', normalized);
    if (catalogEntry) return Boolean(catalogEntry.reasoning);
    // Compatibilidade de execução para configurações históricas. Novas
    // gravações continuam restritas ao catálogo por assertAiModelAllowed.
    return /^o\d/.test(normalized) || normalized.startsWith('gpt-5');
};

const REASONING_EFFORT = Object.freeze({
    rapido: 'low',
    low: 'low',
    equilibrado: 'medium',
    medium: 'medium',
    profundo: 'high',
    high: 'high',
    none: 'none',
    xhigh: 'xhigh',
    max: 'max',
});

export const openAiReasoningEffort = (model, level) => {
    const entry = catalogModel('openai', model);
    if (!isOpenAiReasoningModel(model)) return null;
    const effort = REASONING_EFFORT[String(level || '').trim().toLowerCase()] || null;
    if (!effort) return null;
    const supported = entry?.reasoningEfforts;
    return !supported || supported.includes(effort) ? effort : null;
};

/**
 * O medidor atual recebe tokens totais, sem separar entrada e saída. Para não
 * subcobrar, usa o maior preço unitário do modelo como teto conservador.
 */
export const conservativeChatUsdPerMillion = (provider, model) => {
    const pricing = catalogModel(provider, model)?.pricingUsdPerMillion;
    if (!pricing) return null;
    return Math.max(Number(pricing.input) || 0, Number(pricing.cachedInput) || 0, Number(pricing.output) || 0) || null;
};
