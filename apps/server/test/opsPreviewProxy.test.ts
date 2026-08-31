import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOpsPreviewProxyProfile } from '../src/services/opsPreviewProxy';

const choose = (overrides: Partial<Parameters<typeof selectOpsPreviewProxyProfile>[0]> = {}) =>
    selectOpsPreviewProxyProfile({
        filePath: 'C:\\cache\\take.mp4',
        mimeType: 'video/mp4',
        codecName: 'h264',
        pixelFormat: 'yuv420p',
        skipProxy: true,
        ...overrides,
    });

test('recorte mantém abertura rápida para MP4 H.264 compatível', () => {
    assert.equal(choose(), null);
});

test('recorte gera proxy leve para MOV/HEVC de celular', () => {
    assert.equal(choose({
        filePath: 'C:\\cache\\IMG_8930.MOV',
        mimeType: 'video/quicktime',
        codecName: 'hevc',
    }), 'trim');
});

test('recorte também protege MP4 com HEVC e H.264 de 10 bits', () => {
    assert.equal(choose({ codecName: 'hevc' }), 'trim');
    assert.equal(choose({ codecName: 'h264', pixelFormat: 'yuv420p10le' }), 'trim');
});

test('editor principal sempre recebe proxy padrão', () => {
    assert.equal(choose({ skipProxy: false }), 'standard');
});
