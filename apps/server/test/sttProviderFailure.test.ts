import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { Request, Response } from 'express';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-stt-error-'));
const originalUserDataPath = process.env.USER_DATA_PATH;
const originalGatewayUrl = process.env.GATEWAY_BASE_URL;
fs.mkdirSync(path.join(directory, 'narrations'));
fs.writeFileSync(path.join(directory, 'narrations', 'test.mp3'), 'fixture-audio');
let nextResponse = { status: 200, body: {} as Record<string, unknown> };
let gatewayCalls = 0;
const gateway = http.createServer((req, res) => {
    gatewayCalls += 1;
    assert.equal(req.url, '/v1/stt');
    assert.equal(req.headers.authorization, 'Bearer synthetic-test-token');
    req.resume();
    req.on('end', () => {
        res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nextResponse.body));
    });
});
let generateCaptions: (req: Request, res: Response) => Promise<unknown>;

before(async () => {
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const address = gateway.address() as { port: number };
    process.env.USER_DATA_PATH = directory;
    process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${address.port}`;
    ({ generateCaptions } = require('../src/controllers/sttController'));
});
after(async () => {
    await new Promise<void>((resolve, reject) => gateway.close(error => error ? reject(error) : resolve()));
    if (originalUserDataPath === undefined) delete process.env.USER_DATA_PATH;
    else process.env.USER_DATA_PATH = originalUserDataPath;
    if (originalGatewayUrl === undefined) delete process.env.GATEWAY_BASE_URL;
    else process.env.GATEWAY_BASE_URL = originalGatewayUrl;
    fs.rmSync(directory, { recursive: true, force: true });
});

const requestCaptions = async (status: number, body: Record<string, unknown>) => {
    nextResponse = { status, body };
    const response = {
        statusCode: 200,
        body: {} as Record<string, unknown>,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: Record<string, unknown>) { this.body = payload; return this; },
    };
    const beforeCalls = gatewayCalls;
    await generateCaptions({
        body: { audioUrl: '/narrations/test.mp3', narrationText: 'Olá mundo' },
        headers: { authorization: 'Bearer synthetic-test-token' },
    } as Request, response as unknown as Response);
    assert.equal(gatewayCalls - beforeCalls, 1);
    return response;
};

test('legendas preservam o código de saldo do provedor e não indicam recarga Mileto', async () => {
    const response = await requestCaptions(503, { code: 'STT_PROVIDER_QUOTA_EXHAUSTED', message: 'Provider unavailable' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'STT_PROVIDER_QUOTA_EXHAUSTED');
    assert.match(String(response.body.message), /saldo na OpenAI/);
    assert.doesNotMatch(String(response.body.message), /Recarregue/);
    assert.equal(response.body.segments, undefined);
});

test('legendas traduzem a resposta legada da imagem sem exibir JSON ou detalhes privados', async () => {
    const response = await requestCaptions(502, {
        message: 'Falha na transcrição: Whisper 429: {"error":{"type":"insufficient_quota","code":"credit_balance_exhausted","message":"private-provider-details"}}',
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'STT_PROVIDER_QUOTA_EXHAUSTED');
    assert.doesNotMatch(String(response.body.message), /private-provider|Whisper|\{/);
});

test('saldo Mileto insuficiente e sessão expirada mantêm suas ações corretas', async () => {
    const insufficient = await requestCaptions(402, { message: 'Insufficient Mileto credit' });
    assert.equal(insufficient.statusCode, 402);
    assert.match(String(insufficient.body.message), /Seus créditos Mileto acabaram/);
    assert.equal(insufficient.body.code, undefined);
    const expired = await requestCaptions(401, { message: 'Expired' });
    assert.equal(expired.statusCode, 401);
    assert.match(String(expired.body.message), /Sessão expirada/);
});

test('transcrição bem-sucedida mantém texto e timestamps vindos do gateway', async () => {
    const response = await requestCaptions(200, {
        ok: true, words: [{ word: 'Olá', start: 0.1, end: 0.4 }, { word: 'mundo', start: 0.5, end: 1.2 }],
        demo: false, charged: 0.01, balance: 10,
    });
    assert.equal(response.statusCode, 200);
    const segments = response.body.segments as Array<{ start: number; end: number; text: string }>;
    assert.equal(segments.length > 0, true);
    assert.equal(segments[0].start, 0.1);
    assert.equal(segments.at(-1)?.end, 1.2);
    assert.match(segments.map(segment => segment.text).join(' '), /Olá mundo/i);
});
