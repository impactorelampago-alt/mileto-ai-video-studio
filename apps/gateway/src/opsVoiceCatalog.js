// Validação/normalização do snapshot de catálogo de vozes que o Mileto AI Video
// empurra para o Mileto Ops (PUT /v1/voice-catalogs/{aiVideoUserId}).
// As vozes de sistema também chegam para receber a amostra oficial do Fish. O
// Ops injeta os nomes canônicos, mas depende deste snapshot para obter previewUrl.

const LIMITS = Object.freeze({
    voiceId: 200,
    name: 200,
    provider: 60,
    description: 2_000,
    language: 40,
    label: 80,
    modelId: 200,
    previewUrl: 2_048,
});
const MAX_VOICES = 1_000;

const compact = (value) => String(value ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const contractError = (message) => {
    const error = new Error(message);
    error.status = 422;
    error.code = 'ops_voice_catalog_invalid';
    return error;
};

const stringList = (value, max, limit) => {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const item of value) {
        const text = compact(item).slice(0, limit);
        if (text) out.push(text);
        if (out.length >= max) break;
    }
    return out;
};

export const normalizeVoiceCatalogPayload = (body = {}) => {
    const catalogVersion = Number(body?.catalogVersion);
    if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1) {
        throw contractError('catalogVersion deve ser um inteiro maior ou igual a 1.');
    }
    const rawVoices = Array.isArray(body?.voices) ? body.voices : [];
    if (rawVoices.length > MAX_VOICES) {
        throw contractError(`O catálogo de vozes excede o limite de ${MAX_VOICES}.`);
    }

    const seen = new Set();
    const voices = [];
    for (const raw of rawVoices) {
        const voiceId = compact(raw?.voiceId).slice(0, LIMITS.voiceId);
        const name = compact(raw?.name).slice(0, LIMITS.name);
        // Entradas sem id de síntese ou nome são descartadas individualmente —
        // uma voz malformada não invalida o snapshot inteiro.
        if (!voiceId || !name || seen.has(voiceId)) continue;
        seen.add(voiceId);

        const voice = { voiceId, name, isCustom: raw?.isCustom !== false };
        const provider = compact(raw?.provider).slice(0, LIMITS.provider);
        if (provider) voice.provider = provider;
        const description = compact(raw?.description).slice(0, LIMITS.description);
        if (description) voice.description = description;
        const language = compact(raw?.language).slice(0, LIMITS.language);
        if (language) voice.language = language;
        const labels = stringList(raw?.labels, 20, LIMITS.label);
        if (labels.length) voice.labels = labels;
        const modelIds = stringList(raw?.modelIds, 20, LIMITS.modelId);
        if (modelIds.length) voice.modelIds = modelIds;
        if (raw?.capabilities && typeof raw.capabilities === 'object' && !Array.isArray(raw.capabilities)) {
            voice.capabilities = raw.capabilities;
        }
        if (typeof raw?.isDefault === 'boolean') voice.isDefault = raw.isDefault;
        const previewUrl = compact(raw?.previewUrl).slice(0, LIMITS.previewUrl);
        if (previewUrl) voice.previewUrl = previewUrl;
        if (raw?.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
            voice.metadata = raw.metadata;
        }
        voices.push(voice);
    }

    return { catalogVersion, voices };
};

export const normalizeVoiceCatalogVersion = (value) => {
    const catalogVersion = Number(value);
    if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1) {
        throw contractError('catalogVersion deve ser um inteiro maior ou igual a 1.');
    }
    return catalogVersion;
};

const FISH_MODEL_BASE_URL = 'https://api.fish.audio';
const PREVIEW_LOOKUP_CONCURRENCY = 4;
const MAX_PREVIEW_LOOKUPS_PER_SYNC = 40;
const PREVIEW_LOOKUP_TIMEOUT_MS = 5_000;

const normalizedHttpUrl = (value) => {
    const raw = compact(value);
    if (!raw) return null;
    try {
        const url = new URL(raw, FISH_MODEL_BASE_URL);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
    } catch {
        return null;
    }
};

export const fishModelPreviewUrl = (model) => {
    const samples = Array.isArray(model?.samples) ? model.samples : [];
    for (const sample of samples) {
        const url = normalizedHttpUrl(sample?.audio);
        if (url) return url;
    }
    return null;
};

const isFishVoice = (voice) => !voice?.provider || ['fish_audio', 'fishAudio'].includes(voice.provider);

/**
 * Anexa a primeira amostra já existente no modelo Fish. É best-effort e não
 * sintetiza áudio: sem chave, amostra ou resposta válida, o catálogo segue sem
 * previewUrl e o botão não é exibido no Ops.
 */
export const enrichVoiceCatalogPreviews = async (
    payload,
    { fetchImpl = fetch, fishApiKey } = {},
) => {
    // Import tardio evita carregar banco/configuração em consumidores que usam
    // apenas os normalizadores puros (testes e ferramentas de contrato).
    const key = fishApiKey === undefined
        ? await import('./settings.js').then(({ getKey }) => getKey('fishAudio'))
        : fishApiKey;
    if (!key) return payload;

    const voices = payload.voices.map((voice) => ({ ...voice }));
    const indexes = voices
        .map((voice, index) => ({ voice, index }))
        .filter(({ voice }) => !voice.previewUrl && isFishVoice(voice))
        .slice(0, MAX_PREVIEW_LOOKUPS_PER_SYNC);

    for (let offset = 0; offset < indexes.length; offset += PREVIEW_LOOKUP_CONCURRENCY) {
        const batch = indexes.slice(offset, offset + PREVIEW_LOOKUP_CONCURRENCY);
        await Promise.all(batch.map(async ({ voice, index }) => {
            try {
                const response = await fetchImpl(
                    `${FISH_MODEL_BASE_URL}/model/${encodeURIComponent(voice.voiceId)}`,
                    {
                        headers: { Authorization: `Bearer ${key}` },
                        signal: AbortSignal.timeout(PREVIEW_LOOKUP_TIMEOUT_MS),
                    },
                );
                if (!response.ok) return;
                const previewUrl = fishModelPreviewUrl(await response.json());
                if (previewUrl) voices[index].previewUrl = previewUrl;
            } catch {
                // Catálogo e produção nunca são bloqueados por uma prévia ausente.
            }
        }));
    }

    return { ...payload, voices };
};
