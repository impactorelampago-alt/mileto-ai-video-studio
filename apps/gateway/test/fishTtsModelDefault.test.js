import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const loadProxyTtsWithConfiguredKey = async () => {
    const sourceUrl = new URL('../src/providers.js', import.meta.url);
    const source = readFileSync(sourceUrl, 'utf8').replace(
        /import\s+\{\s*getKey\s*\}\s+from\s+['"]\.\/settings\.js['"];?/,
        "const getKey = async () => 'fish-test-key';",
    ).replace(
        /import\s+\{\s*resolveTtsModelFromPayload\s*\}\s+from\s+['"]\.\/ttsModels\.js['"];?/,
        `const resolveTtsModelFromPayload = (provider, payload = {}) => {
            if (provider !== 'fishAudio') return 'eleven_multilingual_v2';
            const allowed = new Set(['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1']);
            const top = payload.ttsModel;
            const legacy = payload.voiceSettings?.fishModel;
            for (const value of [top, legacy]) {
                if (value !== undefined && !allowed.has(value)) throw new Error('tts_model_unavailable');
            }
            if (top && legacy && top !== legacy) throw new Error('tts_model_conflict');
            return top || legacy || 's2.1-pro';
        };`,
    ).replace(
        /import\s+\{\s*isOpenAiReasoningModel\s*,\s*openAiReasoningEffort\s*\}\s+from\s+['"]\.\/aiModels\.js['"];?/,
        'const isOpenAiReasoningModel = () => false; const openAiReasoningEffort = () => null;',
    );
    const isolatedModuleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(isolatedModuleUrl);
};

const captureFishRequest = async ({ voiceSettings, model, text = 'Narração profissional' } = {}) => {
    const { proxyTts } = await loadProxyTtsWithConfiguredKey();
    const originalFetch = globalThis.fetch;
    let request = null;
    globalThis.fetch = async (url, init) => {
        request = { url: String(url), init };
        return {
            ok: true,
            arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
        };
    };
    try {
        const result = await proxyTts({
            provider: 'fishAudio',
            voiceId: 'voice-test',
            text,
            voiceSettings,
            ...(model !== undefined ? { model } : {}),
        });
        return { request, result };
    } finally {
        globalThis.fetch = originalFetch;
    }
};

test('proxy Fish usa s2.1-pro quando nenhum modelo é informado', async () => {
    const { request, result } = await captureFishRequest({ voiceSettings: { speed: 1, volume: 0 } });
    assert.equal(request.init.headers.model, 's2.1-pro');
    assert.equal(result.model, 's2.1-pro');
});

test('proxy Fish preserva modelos antigos válidos explicitamente escolhidos', async () => {
    for (const model of ['s2.1-pro-free', 's2-pro', 's1']) {
        const { request, result } = await captureFishRequest({ voiceSettings: { fishModel: model } });
        assert.equal(request.init.headers.model, model);
        assert.equal(result.model, model);
    }
});

test('proxy Fish preserva direção natural exatamente no request', async () => {
    const text = '[warm and reassuring] Cuide hoje da sua visão.';
    const { request } = await captureFishRequest({ model: 's2.1-pro', text });
    assert.equal(JSON.parse(request.init.body).text, text);
});

test('proxy Fish rejeita modelo arbitrário antes de chamar fetch e sem fallback', async () => {
    const { proxyTts } = await loadProxyTtsWithConfiguredKey();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('fetch não deveria ser chamado');
    };
    try {
        await assert.rejects(
            proxyTts({
                provider: 'fishAudio',
                voiceId: 'voice-test',
                text: 'Teste',
                voiceSettings: { fishModel: 'modelo-inventado' },
            }),
            /tts_model_unavailable/
        );
        assert.equal(fetchCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('provider rejeita divergência entre modelo resolvido e modelo legado', async () => {
    const { proxyTts } = await loadProxyTtsWithConfiguredKey();
    await assert.rejects(
        proxyTts({
            provider: 'fishAudio',
            voiceId: 'voice-test',
            text: 'Teste',
            model: 's2.1-pro',
            voiceSettings: { fishModel: 's1' },
        }),
        /tts_model_conflict/
    );
});
