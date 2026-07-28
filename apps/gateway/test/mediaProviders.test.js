import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderMedia } from '../src/mediaProviders.js';

test('bloqueia mídia fora dos domínios autorizados antes de acessar a rede', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return new Response('não deveria ser chamado');
    };
    try {
        await assert.rejects(() => fetchProviderMedia('https://example.com/video.mp4'), /não autorizado/i);
        assert.equal(calls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('aceita redirecionamento relativo somente dentro do domínio do provedor', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        if (calls.length === 1) {
            return new Response(null, { status: 302, headers: { location: '/resultado/video.mp4' } });
        }
        return new Response(Buffer.from('video'), {
            status: 200,
            headers: { 'content-type': 'video/mp4', 'content-length': '5' },
        });
    };
    try {
        const media = await fetchProviderMedia('https://media.bytepluses.com/tarefa/123');
        const chunks = [];
        for await (const chunk of media.body) chunks.push(chunk);
        assert.equal(Buffer.concat(chunks).toString(), 'video');
        assert.deepEqual(calls, [
            'https://media.bytepluses.com/tarefa/123',
            'https://media.bytepluses.com/resultado/video.mp4',
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('rejeita redirecionamento que tenta sair do provedor', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
        new Response(null, { status: 302, headers: { location: 'https://example.com/roubo.mp4' } });
    try {
        await assert.rejects(
            () => fetchProviderMedia('https://media.bytepluses.com/tarefa/123'),
            /redirecionamento.+não autorizado/i
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});
