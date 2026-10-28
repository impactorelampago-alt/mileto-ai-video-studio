import assert from 'node:assert/strict';
import test from 'node:test';
import access from '../electron-main/local-server-access.cjs';

const entry = 'file:///C:/Mileto/resources/app.asar/dist/index.html';
const options = { token: 'local-capability', webContentsId: 7, rendererUrl: entry, entryUrl: entry, isDev: false };
const request = (overrides = {}) => ({ url: 'http://localhost:3301/files/video.mp4', webContentsId: 7, frame: { url: entry }, requestHeaders: { Range: 'bytes=0-10' }, ...overrides });

test('requisições de mídia e API recebem capacidade preservando Range e Bearer', () => {
    for (const route of ['files/video.mp4', 'api/projects', 'narrations/voice.mp3', 'system-music/default.mp3']) {
        const headers = access.localServerRequestHeaders(request({ url: `http://127.0.0.1:3301/${route}`, requestHeaders: { Range: 'bytes=0-10', Authorization: 'Bearer gateway' } }), options);
        assert.equal(headers[access.LOCAL_ACCESS_HEADER], options.token);
        assert.equal(headers.Range, 'bytes=0-10'); assert.equal(headers.Authorization, 'Bearer gateway');
    }
});

test('redirecionamentos externos nunca recebem a capacidade local', () => {
    const headers = access.localServerRequestHeaders(request({ url: 'https://cdn.example/video.mp4', requestHeaders: { 'x-mileto-local-token': options.token } }), options);
    assert.equal(Object.keys(headers).length, 0);
});

test('outra janela, frame externo, frame perdido e renderer externo não são autorizados', () => {
    for (const details of [request({ webContentsId: 8 }), request({ frame: { url: 'https://outside.example' } }), request({ frame: null })]) {
        assert.equal(access.localServerRequestHeaders(details, options)[access.LOCAL_ACCESS_HEADER], undefined);
    }
    assert.equal(access.localServerRequestHeaders(request(), { ...options, rendererUrl: 'https://outside.example' })[access.LOCAL_ACCESS_HEADER], undefined);
});

test('outro arquivo local ou outra porta não recebem capacidade', () => {
    assert.equal(access.localServerRequestHeaders(request({ frame: { url: 'file:///C:/Downloads/untrusted.html' } }), options)[access.LOCAL_ACCESS_HEADER], undefined);
    assert.equal(access.localServerRequestHeaders(request({ url: 'http://localhost:4000/api' }), options)[access.LOCAL_ACCESS_HEADER], undefined);
    assert.equal(access.localServerRequestHeaders(request({ frame: { url: 'file://outside.example/C:/Mileto/resources/app.asar/dist/index.html' } }), options)[access.LOCAL_ACCESS_HEADER], undefined);
});

test('Electron de desenvolvimento autoriza somente o Vite esperado', () => {
    const dev = { ...options, isDev: true, rendererUrl: 'http://localhost:5173/' };
    assert.equal(access.localServerRequestHeaders(request({ frame: { url: dev.rendererUrl } }), dev)[access.LOCAL_ACCESS_HEADER], options.token);
    assert.equal(access.localServerRequestHeaders(request({ frame: { url: 'http://localhost:5174/' } }), dev)[access.LOCAL_ACCESS_HEADER], undefined);
});
