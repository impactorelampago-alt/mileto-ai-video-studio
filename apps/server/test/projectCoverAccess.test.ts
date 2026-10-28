import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectCover } from '../src/utils/projectCoverAccess';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mileto-cover-access-'));
const base = path.join(sandbox, 'data');
fs.mkdirSync(path.join(base, 'data'), { recursive: true });
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
const makeFile = (relative: string) => {
    const filename = path.join(sandbox, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, 'synthetic fixture');
    return filename;
};
const setIndex = (entries: unknown[]) => fs.writeFileSync(path.join(base, 'data/files_index.json'), JSON.stringify(entries));

test('mídias geridas pelo servidor continuam disponíveis como capa', () => {
    for (const folder of ['files/Imagens', 'uploads', 'videos', 'ops-cache/job', 'preview-cache', 'frame_cache']) {
        const image = makeFile(`data/${folder}/cover.png`);
        assert.equal(resolveProjectCover(base, image, 'image'), fs.realpathSync(image));
    }
    const video = makeFile('data/videos/take.mp4');
    assert.equal(resolveProjectCover(base, video, 'video'), fs.realpathSync(video));
});

test('um projeto fabricado não autoriza arquivo externo nem arquivo interno de configuração', () => {
    const outside = makeFile('private/cover.png');
    const text = makeFile('private/secret.txt');
    const project = makeFile('data/data/projects/other/ad-data.json');
    setIndex([]);
    for (const candidate of [outside, text, project]) assert.equal(resolveProjectCover(base, candidate, 'image'), null);
});

test('referência externa registrada pode ser reutilizada, sem confiar no JSON do projeto', () => {
    const outside = makeFile('authorized/cover.jpg');
    setIndex([{ id: 'known-media', type: 'image', filePath: outside }]);
    assert.equal(resolveProjectCover(base, outside, 'image'), fs.realpathSync(outside));
    assert.equal(resolveProjectCover(base, makeFile('unregistered/cover.jpg'), 'image'), null);
    assert.equal(resolveProjectCover(base, outside, 'video'), null);
});

test('índice inválido e arquivos inexistentes falham sem revelar caminhos', () => {
    fs.writeFileSync(path.join(base, 'data/files_index.json'), 'invalid-json');
    assert.equal(resolveProjectCover(base, path.join(sandbox, 'absent.png'), 'image'), null);
    assert.equal(resolveProjectCover(base, makeFile('private/unknown.png'), 'image'), null);
    assert.equal(resolveProjectCover(base, 'relative.png', 'image'), null);
});

test('symlink dentro do acervo não autoriza saída para outro diretório', t => {
    const external = path.join(sandbox, 'linked-external');
    fs.mkdirSync(external, { recursive: true });
    const outside = makeFile('linked-external/cover.png');
    const link = path.join(base, 'files/linked');
    try { fs.symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('symlink não permitido neste ambiente'); return; } throw error; }
    const candidate = path.join(link, 'cover.png');
    setIndex([{ id: 'not-authorized', type: 'image', filePath: candidate }]);
    assert.equal(resolveProjectCover(base, candidate, 'image'), null);
    assert.equal(resolveProjectCover(base, outside, 'image'), null);
});

test('controller recusa a reprodução original e serve uma capa legítima', async () => {
    process.env.USER_DATA_PATH = base;
    const controller = require('../src/controllers/projectController') as typeof import('../src/controllers/projectController');
    const external = makeFile('private/controller.png');
    const valid = makeFile('data/uploads/controller.png');
    let status = 200; let sent: string | null = null;
    const response = {
        status(code: number) { status = code; return this; }, json() { return this; }, setHeader() {},
        sendFile(filename: string) { sent = filename; return this; },
    };
    const request = (source: string) => ({ params: { projectId: 'cover-test' }, body: { data: { mediaTakes: [{ type: 'image', url: source }] } } });
    setIndex([]);
    await controller.saveProjectData(request(external) as never, response as never);
    await controller.getProjectCover(request(external) as never, response as never);
    assert.equal(status, 404); assert.equal(sent, null);
    status = 200;
    await controller.saveProjectData(request(valid) as never, response as never);
    await controller.getProjectCover(request(valid) as never, response as never);
    assert.equal(status, 200); assert.equal(sent, fs.realpathSync(valid));
});
