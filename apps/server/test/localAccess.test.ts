import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { localAccess, LOCAL_ACCESS_HEADER } from '../src/middleware/localAccess';

async function fixture(options: Parameters<typeof localAccess>[0], run: (base: string) => Promise<void>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-local-access-'));
    fs.writeFileSync(path.join(root, 'media.mp4'), '0123456789');
    const app = express();
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.use(localAccess(options));
    app.get('/api/projects', (_req, res) => res.json({ ok: true, drafts: [] }));
    app.get('/debug', (_req, res) => res.json({ root }));
    app.use('/files', express.static(root));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
    finally {
        await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('API, debug e arquivos recusam chamadas sem capacidade ou com token incorreto', async () => {
    await fixture({ token: 'capability', allowDevBrowser: true }, async base => {
        assert.equal((await fetch(`${base}/health`)).status, 200);
        for (const route of ['/api/projects', '/debug', '/files/media.mp4']) {
            const attempts: Array<Record<string, string>> = [{}, { [LOCAL_ACCESS_HEADER]: 'wrong' }, { Origin: 'http://localhost:5173' }];
            for (const headers of attempts) {
                const response = await fetch(base + route, { headers });
                assert.equal(response.status, 401, route); assert.equal((await response.json()).code, 'LOCAL_ACCESS_DENIED');
            }
        }
    });
});

test('capacidade correta mantém APIs e leitura parcial de vídeo funcionando', async () => {
    await fixture({ token: 'capability' }, async base => {
        const headers = { [LOCAL_ACCESS_HEADER]: 'capability' };
        assert.equal((await fetch(`${base}/api/projects`, { headers })).status, 200);
        assert.equal((await fetch(`${base}/debug`, { headers })).status, 200);
        const response = await fetch(`${base}/files/media.mp4`, { headers: { ...headers, Range: 'bytes=2-5' } });
        assert.equal(response.status, 206); assert.equal(await response.text(), '2345');
        assert.equal((await fetch(`${base}/api/projects`, { headers: { 'X-Local-File-Import': 'capability' } })).status, 200);
    });
});

test('produção sem capacidade configurada falha fechada, inclusive para Vite', async () => {
    await fixture({ token: '', allowDevBrowser: false }, async base => {
        assert.equal((await fetch(`${base}/api/projects`, { headers: { Origin: 'http://localhost:5173' } })).status, 401);
    });
});

test('desenvolvimento no navegador permite somente as origens Vite explícitas', async () => {
    await fixture({ token: '', allowDevBrowser: true }, async base => {
        for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
            assert.equal((await fetch(`${base}/api/projects`, { headers: { Origin: origin } })).status, 200);
        }
        assert.equal((await fetch(`${base}/files/media.mp4`, { headers: { Referer: 'http://localhost:5173/' } })).status, 200);
        for (const origin of ['null', 'https://outside.example', 'http://localhost:5174', 'http://localhost:5173.evil.example']) {
            assert.equal((await fetch(`${base}/api/projects`, { headers: { Origin: origin, Referer: 'http://localhost:5173/' } })).status, 401);
        }
        assert.equal((await fetch(`${base}/api/projects`)).status, 401);
    });
});
