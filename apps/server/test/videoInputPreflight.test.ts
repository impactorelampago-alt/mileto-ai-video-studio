import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    findMissingHybridInput,
    missingHybridInputHttpFailure,
} from '../src/services/hybridInputPreflight';

test('identifica o take ausente sem expor o caminho local', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-input-preflight-'));
    const available = path.join(directory, 'available.mp4');
    const missing = path.join(directory, 'private-user-folder', 'missing.mp4');
    fs.writeFileSync(available, Buffer.from('video'));

    try {
        const result = findMissingHybridInput([
            { id: 'take-ok', file_path: available },
            { id: 'take-missing', file_path: missing },
        ]);
        assert.deepEqual(result, { kind: 'take', reason: 'missing', index: 1, takeId: 'take-missing' });
        assert.equal(JSON.stringify(result).includes(missing), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('recusa caminho vazio, diretório e arquivo de tamanho zero como take', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-input-invalid-'));
    const empty = path.join(directory, 'empty.mp4');
    fs.writeFileSync(empty, Buffer.alloc(0));

    try {
        assert.deepEqual(findMissingHybridInput([{ id: 'empty-path', file_path: '' }]), {
            kind: 'take', reason: 'missing', index: 0, takeId: 'empty-path',
        });
        assert.deepEqual(findMissingHybridInput([{ id: 'directory', file_path: directory }]), {
            kind: 'take', reason: 'missing', index: 0, takeId: 'directory',
        });
        assert.deepEqual(findMissingHybridInput([{ id: 'empty-file', file_path: empty }]), {
            kind: 'take', reason: 'missing', index: 0, takeId: 'empty-file',
        });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('identifica transição ausente somente depois de validar todos os takes', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-transition-preflight-'));
    const available = path.join(directory, 'available.mp4');
    fs.writeFileSync(available, Buffer.from('video'));

    try {
        assert.deepEqual(
            findMissingHybridInput([{ id: 'take-ok', file_path: available }], path.join(directory, 'missing-transition.mp4')),
            { kind: 'transition', reason: 'missing' },
        );
        assert.equal(findMissingHybridInput([{ id: 'take-ok', file_path: available }]), null);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('aceita somente URL HTTPS assinada do R2 usado pelo Compartilhado', () => {
    assert.equal(findMissingHybridInput([
        {
            id: 'shared-video',
            file_path: 'https://mileto-shared-media.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/source.mp4?X-Amz-Signature=short-lived',
        },
    ]), null);
});

test('recusa URLs de loopback, localhost, link-local, RFC1918 e IPv6 privado sem expor a URL', () => {
    const privateUrls = [
        'http://127.0.0.1:3000/private.mp4',
        'http://localhost/private.mp4',
        'http://localhost./private.mp4',
        'http://foo.localhost/private.mp4',
        'http://workstation.local/private.mp4',
        'http://169.254.169.254/latest/meta-data',
        'http://10.20.30.40/private.mp4',
        'http://172.16.0.1/private.mp4',
        'http://192.168.1.10/private.mp4',
        'http://[::1]/private.mp4',
        'http://[fc00::1]/private.mp4',
        'http://[fd12::1]/private.mp4',
        'http://[fe80::1]/private.mp4',
    ];

    for (const filePath of privateUrls) {
        const result = findMissingHybridInput([{ id: 'private-source', file_path: filePath }]);
        assert.deepEqual(result, {
            kind: 'take', reason: 'unsafe', index: 0, takeId: 'private-source',
        });
        const failure = missingHybridInputHttpFailure(result!);
        assert.equal(failure.body.code, 'render_take_source_not_allowed');
        assert.equal(failure.body.retryable, false);
        assert.equal(JSON.stringify(failure).includes(filePath), false);
    }
});

test('recusa CDN pública arbitrária para impedir redirect SSRF dentro do FFmpeg', () => {
    const filePath = 'https://cdn.example.com/video.mp4?redirect=private';
    const result = findMissingHybridInput([{ id: 'untrusted-cdn', file_path: filePath }]);
    assert.deepEqual(result, {
        kind: 'take', reason: 'unsafe', index: 0, takeId: 'untrusted-cdn',
    });
    const failure = missingHybridInputHttpFailure(result!);
    assert.equal(failure.body.code, 'render_take_source_not_allowed');
    assert.equal(failure.body.retryable, false);
    assert.equal(JSON.stringify(failure).includes(filePath), false);
});

test('recusa transição remota privada com erro não-retryable e sem expor a URL', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-transition-ssrf-'));
    const available = path.join(directory, 'available.mp4');
    const privateUrl = 'http://192.168.0.20/transition.mp4';
    fs.writeFileSync(available, Buffer.from('video'));

    try {
        const result = findMissingHybridInput([{ id: 'take-ok', file_path: available }], privateUrl);
        assert.deepEqual(result, { kind: 'transition', reason: 'unsafe' });
        const failure = missingHybridInputHttpFailure(result!);
        assert.equal(failure.body.code, 'render_transition_source_not_allowed');
        assert.equal(failure.body.retryable, false);
        assert.equal(JSON.stringify(failure).includes(privateUrl), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('recusa UNC, device path e caminho relativo antes de consultar o sistema de arquivos', () => {
    for (const filePath of [
        '\\\\servidor-atacante\\share\\take.mp4',
        '\\\\?\\C:\\segredo\\take.mp4',
        '..\\fora\\take.mp4',
    ]) {
        const result = findMissingHybridInput([{ id: 'unsafe-local', file_path: filePath }]);
        assert.deepEqual(result, {
            kind: 'take', reason: 'unsafe', index: 0, takeId: 'unsafe-local',
        });
        assert.equal(JSON.stringify(missingHybridInputHttpFailure(result!)).includes(filePath), false);
    }
});

test('o oitavo input ausente é identificado como takes[7]', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-eighth-take-'));
    const available = path.join(directory, 'available.mp4');
    fs.writeFileSync(available, Buffer.from('video'));
    const takes = Array.from({ length: 10 }, (_, index) => ({
        id: `take-${index + 1}`,
        file_path: index === 7 ? path.join(directory, 'missing-8.mp4') : available,
    }));

    try {
        assert.deepEqual(findMissingHybridInput(takes), {
            kind: 'take', reason: 'missing', index: 7, takeId: 'take-8',
        });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('contrato HTTP é recuperável e nunca inclui o path ausente', () => {
    const failure = missingHybridInputHttpFailure({
        kind: 'take', reason: 'missing', index: 7, takeId: 'take-8',
    });
    assert.equal(failure.status, 422);
    assert.equal(failure.body.code, 'render_take_source_missing');
    assert.equal(failure.body.retryable, true);
    assert.deepEqual(failure.body.input, {
        kind: 'take', reason: 'missing', index: 7, takeId: 'take-8',
    });
    assert.equal(JSON.stringify(failure).includes('C:\\Users\\'), false);
    assert.equal(failure.body.message.includes('tentará recuperá-lo'), false);

    const transitionFailure = missingHybridInputHttpFailure({ kind: 'transition', reason: 'missing' });
    assert.equal(transitionFailure.body.code, 'render_transition_source_missing');
    assert.equal(transitionFailure.body.retryable, true);
});
