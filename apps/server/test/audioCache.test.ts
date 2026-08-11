import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { execFileSync } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import {
    buildAudioMixCacheHash,
    downloadRemoteAudioFile,
    ensureValidAudioCacheFile,
    isAllowedRemoteAudioUrl,
    isUsableAudioCacheFile,
} from '../src/controllers/audioController';

const audioControllerSource = fs.readFileSync(
    path.resolve(__dirname, '../src/controllers/audioController.ts'),
    'utf8',
);

const temporaryDirectory = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-audio-cache-'));

const textValidator = async (filePath: string): Promise<boolean> => {
    try {
        return (await fs.promises.readFile(filePath, 'utf8')) === 'valid-audio';
    } catch {
        return false;
    }
};

const listenOnLoopback = async (server: Server): Promise<string> => {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
};

const closeServer = async (server: Server): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
};

test('cache válido é reutilizado sem executar o produtor', async () => {
    const directory = temporaryDirectory();
    try {
        const target = path.join(directory, 'mix.mp3');
        await fs.promises.writeFile(target, 'valid-audio');
        let productions = 0;

        await ensureValidAudioCacheFile(target, async () => {
            productions += 1;
        }, textValidator);

        assert.equal(productions, 0);
        assert.equal(await fs.promises.readFile(target, 'utf8'), 'valid-audio');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('cache corrompido é substituído somente depois de validar o temporário', async () => {
    const directory = temporaryDirectory();
    try {
        const target = path.join(directory, 'mix.mp3');
        await fs.promises.writeFile(target, 'corrompido');
        let producedPath = '';

        await ensureValidAudioCacheFile(target, async (temporaryPath) => {
            producedPath = temporaryPath;
            assert.notEqual(temporaryPath, target);
            assert.equal(fs.existsSync(target), false);
            await fs.promises.writeFile(temporaryPath, 'valid-audio');
        }, textValidator);

        assert.equal(await fs.promises.readFile(target, 'utf8'), 'valid-audio');
        assert.equal(fs.existsSync(producedPath), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('requisições concorrentes do mesmo cache compartilham uma única produção', async () => {
    const directory = temporaryDirectory();
    try {
        const target = path.join(directory, 'mix.mp3');
        let productions = 0;
        const producer = async (temporaryPath: string) => {
            productions += 1;
            await new Promise((resolve) => setTimeout(resolve, 25));
            await fs.promises.writeFile(temporaryPath, 'valid-audio');
        };

        await Promise.all(Array.from({ length: 12 }, () => (
            ensureValidAudioCacheFile(target, producer, textValidator)
        )));

        assert.equal(productions, 1);
        assert.equal(await fs.promises.readFile(target, 'utf8'), 'valid-audio');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('falha do produtor remove o parcial e nunca publica o destino final', async () => {
    const directory = temporaryDirectory();
    try {
        const target = path.join(directory, 'mix.mp3');
        let partialPath = '';

        await assert.rejects(
            ensureValidAudioCacheFile(target, async (temporaryPath) => {
                partialPath = temporaryPath;
                await fs.promises.writeFile(temporaryPath, 'parcial');
                throw new Error('ffmpeg interrompido');
            }, textValidator),
            /ffmpeg interrompido/,
        );

        assert.equal(fs.existsSync(target), false);
        assert.equal(fs.existsSync(partialPath), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('produtor que termina com áudio inválido também não publica cache', async () => {
    const directory = temporaryDirectory();
    try {
        const target = path.join(directory, 'mix.mp3');

        await assert.rejects(
            ensureValidAudioCacheFile(target, async (temporaryPath) => {
                await fs.promises.writeFile(temporaryPath, 'não-áudio');
            }, textValidator),
            /vazio ou corrompido/,
        );

        assert.equal(fs.existsSync(target), false);
        assert.deepEqual(fs.readdirSync(directory), []);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('download remoto segue redirect permitido e publica somente o corpo final', async () => {
    const directory = temporaryDirectory();
    const server = createServer((request, response) => {
        if (request.url === '/redirect') {
            response.writeHead(302, { Location: '/audio-final.mp3' });
            response.end('corpo intermediário não deve ser gravado');
            return;
        }
        response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        response.end('valid-audio');
    });
    try {
        const origin = await listenOnLoopback(server);
        const target = path.join(directory, 'remote.mp3');

        await ensureValidAudioCacheFile(
            target,
            (temporaryPath) => downloadRemoteAudioFile(
                `${origin}/redirect`,
                temporaryPath,
                1024,
                () => true,
            ),
            textValidator,
        );

        assert.equal(await fs.promises.readFile(target, 'utf8'), 'valid-audio');
    } finally {
        await closeServer(server);
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('allowlist remota aceita Pixabay/R2 e recusa DNS ou rede arbitrária', () => {
    assert.equal(isAllowedRemoteAudioUrl('https://cdn.pixabay.com/audio/source.mp3'), true);
    assert.equal(isAllowedRemoteAudioUrl(
        'https://mileto-shared-media.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/source.mp3?signature=x',
    ), true);
    assert.equal(isAllowedRemoteAudioUrl('https://cdn.example.com/audio.mp3'), false);
    assert.equal(isAllowedRemoteAudioUrl('http://100.100.100.200/latest/meta-data'), false);
    assert.equal(isAllowedRemoteAudioUrl('http://localhost./audio.mp3'), false);
});

test('cache remoto v2 nunca reutiliza o nome parcial publicado por builds antigas', () => {
    assert.match(audioControllerSource, /`ext_v2_\$\{type\}_\$\{urlHash\}\.mp3`/);
    assert.doesNotMatch(audioControllerSource, /`ext_\$\{type\}_\$\{urlHash\}\.mp3`/);
});

test('download remoto bloqueia redirect para destino inseguro e remove o parcial', async () => {
    const directory = temporaryDirectory();
    const server = createServer((_request, response) => {
        response.writeHead(302, { Location: 'http://127.0.0.1:1/rede-interna.mp3' });
        response.end();
    });
    try {
        const origin = await listenOnLoopback(server);
        const target = path.join(directory, 'remote.mp3');

        await assert.rejects(
            ensureValidAudioCacheFile(
                target,
                (temporaryPath) => downloadRemoteAudioFile(`${origin}/redirect`, temporaryPath, 1024),
                async () => false,
            ),
            /destino não permitido/,
        );

        assert.deepEqual(fs.readdirSync(directory), []);
    } finally {
        await closeServer(server);
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('download remoto interrompe loop ao exceder três redirects', async () => {
    const directory = temporaryDirectory();
    let requests = 0;
    const server = createServer((_request, response) => {
        requests += 1;
        response.writeHead(302, { Location: '/loop' });
        response.end();
    });
    try {
        const origin = await listenOnLoopback(server);
        const target = path.join(directory, 'remote.mp3');

        await assert.rejects(
            ensureValidAudioCacheFile(
                target,
                (temporaryPath) => downloadRemoteAudioFile(
                    `${origin}/loop`,
                    temporaryPath,
                    1024,
                    () => true,
                ),
                async () => false,
            ),
            /limite de 3 redirecionamentos/,
        );

        assert.equal(requests, 4, 'requisição inicial + três redirects permitidos');
        assert.deepEqual(fs.readdirSync(directory), []);
    } finally {
        await closeServer(server);
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('download remoto limita o corpo durante o stream e remove o parcial', async () => {
    const directory = temporaryDirectory();
    const server = createServer((_request, response) => {
        // Sem Content-Length: comprova que o limite vem do contador do stream,
        // e não apenas de um cabeçalho declarado pelo servidor remoto.
        response.write(Buffer.alloc(48, 1));
        response.end(Buffer.alloc(48, 2));
    });
    try {
        const origin = await listenOnLoopback(server);
        const target = path.join(directory, 'remote.mp3');

        await assert.rejects(
            ensureValidAudioCacheFile(
                target,
                (temporaryPath) => downloadRemoteAudioFile(`${origin}/large`, temporaryPath, 64),
                async () => false,
            ),
            /excedeu o limite de 64 bytes/,
        );

        assert.deepEqual(fs.readdirSync(directory), []);
    } finally {
        await closeServer(server);
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('trocar os bytes no mesmo caminho gera uma chave de mix distinta', async () => {
    const directory = temporaryDirectory();
    try {
        const musicPath = path.join(directory, 'musica.mp3');
        const config = { enabled: true, volume: 0.3, trimStart: 0, trimEnd: 4 };
        await fs.promises.writeFile(musicPath, Buffer.from('audio-A'));
        const originalStat = await fs.promises.stat(musicPath);
        const first = await buildAudioMixCacheHash({
            musicUrl: 'http://localhost:3301/files/M%C3%BAsicas/musica.mp3',
            musicPath,
            musicConfig: config,
        });

        // Mesmo caminho, mesmo tamanho e até o mesmo mtime: somente os bytes mudam.
        await fs.promises.writeFile(musicPath, Buffer.from('audio-B'));
        await fs.promises.utimes(musicPath, originalStat.atime, originalStat.mtime);
        const second = await buildAudioMixCacheHash({
            musicUrl: 'http://localhost:3301/files/M%C3%BAsicas/musica.mp3',
            musicPath,
            musicConfig: config,
        });

        assert.match(first, /^[a-f0-9]{64}$/);
        assert.match(second, /^[a-f0-9]{64}$/);
        assert.notEqual(second, first);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

const bundledFfmpeg = path.resolve(__dirname, '../../client/resources/bin/ffmpeg.exe');
const bundledFfprobe = path.resolve(__dirname, '../../client/resources/bin/ffprobe.exe');
const hasBundledAudioTools = fs.existsSync(bundledFfmpeg) && fs.existsSync(bundledFfprobe);

test('valida o conteúdo real do cache com ffprobe', { skip: !hasBundledAudioTools }, async () => {
    const directory = temporaryDirectory();
    try {
        const valid = path.join(directory, 'valid.mp3');
        const invalid = path.join(directory, 'invalid.mp3');
        ffmpeg.setFfprobePath(bundledFfprobe);
        execFileSync(bundledFfmpeg, [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25',
            '-q:a', '9', valid,
        ]);
        await fs.promises.writeFile(invalid, '<html>erro remoto</html>');

        assert.equal(await isUsableAudioCacheFile(valid), true);
        assert.equal(await isUsableAudioCacheFile(invalid), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
