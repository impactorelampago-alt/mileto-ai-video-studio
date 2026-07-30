import { getKey } from './settings.js';

/** Ha chave real para este provedor? (define modo demo antes de reservar credito). */
export const hasKey = async (provider) => !!(await getKey(provider));

/**
 * MP3 silencioso mínimo (um frame MPEG). Devolvido no modo demo para que o app
 * receba um áudio tocável sem gastar dinheiro nem exigir chave configurada.
 */
const SILENT_MP3 = Buffer.from(
    '//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA' +
        'gICAgICAgICAgICAgICAgICAgICAgICAgICAgP////////////////' +
        '8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAnGMUKZa',
    'base64'
);

/**
 * Proxy de TTS. As chaves ficam AQUI, no servidor — nunca no cliente.
 * Sem chave configurada → modo demo (áudio silencioso), para ver o fluxo local.
 */
export const proxyTts = async ({ provider, voiceId, text, voiceSettings }) => {
    const apiKey = await getKey(provider);
    if (!apiKey) return { audio: SILENT_MP3, demo: true };

    if (provider === 'fishAudio') {
        const model = voiceSettings?.fishModel || 's2.1-pro-free';
        const prosody =
            voiceSettings && (voiceSettings.speed !== 1 || voiceSettings.volume !== 0)
                ? { speed: voiceSettings.speed ?? 1, volume: voiceSettings.volume ?? 0 }
                : undefined;

        const res = await fetch('https://api.fish.audio/v1/tts', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                model,
            },
            body: JSON.stringify({
                text,
                reference_id: voiceId,
                // O texto em pt-BR já chega com números, moedas, datas e horas
                // escritos por extenso pelo gateway. A normalização nativa da
                // Fish é documentada para inglês/chinês e pode reinterpretar
                // valores em português (por exemplo, R$ 199) mesmo depois da
                // nossa normalização determinística.
                normalize: false,
                format: 'mp3',
                mp3_bitrate: 128,
                latency: 'normal',
                temperature: 0.4,
                top_p: 0.6,
                ...(prosody ? { prosody } : {}),
            }),
        });
        if (!res.ok) throw new Error(`Fish Audio ${res.status}: ${await res.text()}`);
        return { audio: Buffer.from(await res.arrayBuffer()), demo: false };
    }

    if (provider === 'elevenLabs') {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: voiceSettings?.stability ?? 0.4,
                    similarity_boost: voiceSettings?.similarityBoost ?? 0.75,
                    speed: voiceSettings?.speed ?? 1,
                },
            }),
        });
        if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
        return { audio: Buffer.from(await res.arrayBuffer()), demo: false };
    }

    throw new Error(`Provedor de TTS não suportado: ${provider}`);
};

/**
 * Proxy de STT (legendas). Recebe o áudio em buffer e devolve as PALAVRAS com
 * timestamps (o server local agrupa em blocos). A chave da OpenAI fica aqui.
 * Sem chave → modo demo (sem palavras, legendas ficam vazias mas o fluxo roda).
 */
export const proxyStt = async ({ audio, filename = 'audio.mp3', language = 'pt' }) => {
    const apiKey = await getKey('openai');
    if (!apiKey) return { words: [], durationSec: 0, demo: true };

    const fd = new FormData();
    fd.append('file', new Blob([audio]), filename);
    fd.append('model', 'whisper-1');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');
    fd.append('language', language);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
    });
    if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const words = (data.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
    const durationSec = data.duration
        ? Math.ceil(Number(data.duration))
        : words.length
          ? Math.ceil(words[words.length - 1].end)
          : 0;
    return { words, durationSec, demo: false };
};

// Modelos de raciocínio da OpenAI: não aceitam temperature e usam max_completion_tokens.
const isReasoningModel = (model) => /^o\d/.test(model) || String(model).startsWith('gpt-5');

// Nível do app (rápido/equilibrado/profundo) → reasoning_effort da OpenAI.
const REASONING_MAP = {
    rapido: 'low', low: 'low',
    equilibrado: 'medium', medium: 'medium',
    profundo: 'high', high: 'high',
};

// Modelos de raciocínio podem levar mais de um minuto, mas uma conexão muda não
// pode manter créditos reservados indefinidamente. O servidor local espera um
// pouco mais que este limite para receber a resposta de erro e encerrar o fluxo.
// Chat comum não deve prender a interface por vários minutos. Há uma tentativa
// adicional apenas para falhas transitórias ou respostas vazias.
const CHAT_PROVIDER_TIMEOUT_MS = 75000;
const CHAT_RETRY_DELAY_MS = 600;

const isRetryableChatError = (error) => {
    const message = String(error?.message || error || '');
    return /(?:OpenAI|Gemini)\s+(?:408|409|425|429|5\d\d)\b|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i.test(message);
};

const pauseBeforeChatRetry = async (signal) => {
    if (signal?.aborted) {
        const cancelled = new Error('A conexão com o cliente foi encerrada.');
        cancelled.code = 'CHAT_CLIENT_DISCONNECTED';
        throw cancelled;
    }
    await new Promise((resolve) => setTimeout(resolve, CHAT_RETRY_DELAY_MS));
    if (signal?.aborted) {
        const cancelled = new Error('A conexão com o cliente foi encerrada.');
        cancelled.code = 'CHAT_CLIENT_DISCONNECTED';
        throw cancelled;
    }
};

// O segundo resultado soma o uso do primeiro para a conciliação de créditos.
const completeChatRequest = async (request, signal) => {
    let first;
    try {
        first = await request();
    } catch (error) {
        if (!isRetryableChatError(error)) throw error;
        await pauseBeforeChatRetry(signal);
        return request();
    }
    if (String(first?.text || '').trim()) return first;

    await pauseBeforeChatRetry(signal);
    const second = await request();
    if (String(second?.text || '').trim()) {
        return { ...second, usageTokens: Number(first?.usageTokens || 0) + Number(second?.usageTokens || 0) };
    }
    const empty = new Error('O provedor respondeu sem texto.');
    empty.code = 'CHAT_EMPTY_RESPONSE';
    throw empty;
};

const fetchChatProvider = async (url, init, externalSignal) => {
    const timeoutSignal = AbortSignal.timeout(CHAT_PROVIDER_TIMEOUT_MS);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
    try {
        return await fetch(url, { ...init, signal });
    } catch (error) {
        if (externalSignal?.aborted) {
            const cancelled = new Error('A conexão com o cliente foi encerrada.');
            cancelled.code = 'CHAT_CLIENT_DISCONNECTED';
            throw cancelled;
        }
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
            const timeout = new Error('O provedor de IA demorou demais para responder. Tente novamente.');
            timeout.code = 'CHAT_PROVIDER_TIMEOUT';
            throw timeout;
        }
        throw error;
    }
};

/**
 * Proxy de chat/LLM. Recebe provider+model JÁ RESOLVIDOS (o tier virou modelo real
 * no server). `messages` já pode conter a mensagem de sistema (persona do painel).
 * Modo demo devolve texto fixo quando não há chave.
 */
export const proxyChat = async ({ messages, model, provider, reasoning, json, maxOutputTokens = 4096, signal }) => {
    const outputLimit = Math.max(512, Math.min(32768, Math.round(Number(maxOutputTokens) || 4096)));
    const apiKey = await getKey(provider);
    if (!apiKey) {
        return {
            text: '[modo demo] Configure a chave no painel do super admin (aba IA) para respostas reais.',
            demo: true,
            usageTokens: 0,
        };
    }

    if (provider === 'gemini') {
        // Gemini não tem role 'system': vira um par user/model no início.
        const sys = messages.find((m) => m.role === 'system');
        const rest = messages.filter((m) => m.role !== 'system');
        const contents = [];
        if (sys) {
            contents.push({ role: 'user', parts: [{ text: sys.content }] });
            contents.push({ role: 'model', parts: [{ text: 'Entendido.' }] });
        }
        for (const m of rest) {
            contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
        }
        const geminiBody = {
            contents,
            generationConfig: {
                maxOutputTokens: outputLimit,
                ...(json ? { responseMimeType: 'application/json' } : {}),
            },
        };
        // Chave no HEADER (x-goog-api-key), nunca na query string — a URL vaza em log/proxy/CDN.
        return completeChatRequest(async () => {
            const res = await fetchChatProvider(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                    body: JSON.stringify(geminiBody),
                },
                signal
            );
            if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
            const data = await res.json();
            return {
                text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
                demo: false,
                usageTokens: data.usageMetadata?.totalTokenCount || 0,
            };
        }, signal);
    }

    // OpenAI
    const body = { model, messages };
    if (json) body.response_format = { type: 'json_object' };
    if (isReasoningModel(model)) {
        body.max_completion_tokens = outputLimit;
        if (reasoning && REASONING_MAP[reasoning]) body.reasoning_effort = REASONING_MAP[reasoning];
    } else {
        body.temperature = 0.7;
        body.max_tokens = outputLimit;
    }
    return completeChatRequest(async () => {
    const res = await fetchChatProvider(
        'https://api.openai.com/v1/chat/completions',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        signal
    );
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    // Tokens REAIS (inclui reasoning oculto dos modelos o*/gpt-5) — cobrar por len/4 subcobra.
    return {
        text: data.choices?.[0]?.message?.content || '',
        demo: false,
        usageTokens: data.usage?.total_tokens || 0,
    };
    }, signal);
};
