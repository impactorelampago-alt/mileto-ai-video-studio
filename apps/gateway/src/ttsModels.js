export const DEFAULT_FISH_TTS_MODEL = 's2.1-pro';
export const FISH_TTS_MODELS = new Set(['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1']);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export class TtsModelError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'TtsModelError';
        this.code = code;
        this.status = 400;
    }
}

const normalizeModelIdentifier = (value) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TtsModelError(
            'tts_model_invalid',
            'O modelo de narração informado é inválido. Selecione o modelo novamente.'
        );
    }
    return value.trim();
};

const configuredFishModels = () => {
    const configured = String(process.env.FISH_TTS_AVAILABLE_MODELS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return configured.length ? new Set(configured) : FISH_TTS_MODELS;
};

/**
 * Ausência real do campo usa o padrão atual. Qualquer valor explicitamente
 * enviado precisa ser um modelo Fish conhecido e disponível: nunca convertemos
 * uma escolha inválida em outro modelo silenciosamente.
 */
export const resolveFishTtsModel = (value, { availableModels = configuredFishModels() } = {}) => {
    if (value === undefined) {
        if (!availableModels.has(DEFAULT_FISH_TTS_MODEL)) {
            throw new TtsModelError(
                'tts_model_unavailable',
                `O modelo padrão ${DEFAULT_FISH_TTS_MODEL} não está disponível para narração.`
            );
        }
        return DEFAULT_FISH_TTS_MODEL;
    }

    const model = normalizeModelIdentifier(value);
    if (!FISH_TTS_MODELS.has(model) || !availableModels.has(model)) {
        throw new TtsModelError(
            'tts_model_unavailable',
            `O modelo de narração solicitado (${model}) não está disponível. Selecione-o novamente.`
        );
    }
    return model;
};

export const resolveTtsModel = (provider, voiceSettings, options) => {
    if (provider === 'fishAudio') return resolveFishTtsModel(voiceSettings?.fishModel, options);
    if (provider === 'elevenLabs') {
        const requested = voiceSettings?.model;
        if (requested === undefined || requested === null || requested === 'eleven_multilingual_v2') {
            return 'eleven_multilingual_v2';
        }
        throw new TtsModelError(
            'tts_model_unavailable',
            `O modelo de narração solicitado (${String(requested)}) não está disponível.`
        );
    }
    throw new TtsModelError('tts_provider_unsupported', `Provedor de narração não suportado: ${String(provider)}.`);
};

/** Resolve o contrato novo (`ttsModel`) sem quebrar projetos antigos (`fishModel`). */
export const resolveTtsModelFromPayload = (provider, payload = {}, options) => {
    const voiceSettings = payload.voiceSettings && typeof payload.voiceSettings === 'object'
        ? payload.voiceSettings
        : {};
    const topLevelWasSent = own(payload, 'ttsModel');
    const legacyWasSent = provider === 'fishAudio'
        ? own(voiceSettings, 'fishModel')
        : own(voiceSettings, 'model');

    const topLevelModel = topLevelWasSent
        ? (provider === 'fishAudio'
            ? resolveFishTtsModel(payload.ttsModel, options)
            : resolveTtsModel(provider, { model: payload.ttsModel }, options))
        : null;
    const legacyModel = legacyWasSent ? resolveTtsModel(provider, voiceSettings, options) : null;

    if (topLevelModel && legacyModel && topLevelModel !== legacyModel) {
        throw new TtsModelError(
            'tts_model_conflict',
            `O payload solicita dois modelos de narração diferentes (${topLevelModel} e ${legacyModel}).`
        );
    }

    if (topLevelModel) return topLevelModel;
    if (legacyModel) return legacyModel;
    return resolveTtsModel(provider, voiceSettings, options);
};

const TTS_USD_PER_MILLION = {
    fishAudio: {
        's2.1-pro': 15,
        's2-pro': 15,
        's2.1-pro-free': 0,
        s1: 15,
    },
    elevenLabs: {
        eleven_multilingual_v2: 165,
    },
};

/** Custo bruto oficial do TTS para a combinacao realmente enviada ao provedor. */
export const ttsProviderCostUsd = (provider, model, units) => {
    const safeUnits = Number.isFinite(Number(units)) ? Math.max(0, Number(units)) : 0;
    const providerPrices = TTS_USD_PER_MILLION[provider];
    if (!providerPrices) return 0;
    const resolvedModel = provider === 'fishAudio'
        ? resolveFishTtsModel(model)
        : model || resolveTtsModel(provider);
    const usdPerMillion = providerPrices[resolvedModel] ?? 0;
    return (safeUnits / 1_000_000) * usdPerMillion;
};
