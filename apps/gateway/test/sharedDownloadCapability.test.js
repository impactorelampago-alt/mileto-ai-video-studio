import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sharedDownloadContentDisposition } from '../src/sharedDownloadCapability.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const shared = read('../src/shared.js');
const server = read('../src/server.js');
const clientGateway = read('../../client/src/lib/gateway.ts');

test('nome do anexo é seguro, legível e preserva UTF-8 no parâmetro padrão', () => {
    const disposition = sharedDownloadContentDisposition('Vídeo promoção (sábado).mp4');
    assert.match(disposition, /^attachment; filename="Video promocao \(sabado\)\.mp4";/);
    assert.match(disposition, /filename\*=UTF-8''V%C3%ADdeo%20promo%C3%A7%C3%A3o%20%28s%C3%A1bado%29\.mp4$/);
    assert.doesNotMatch(disposition, /[\r\n]/);
});

test('capability de download compartilhado é autenticada, isolada por organização e força attachment', () => {
    assert.match(server, /app\.post\('\/shared\/files\/item\/:assetId\/download-url', authed, asyncHandler\(shared\.getItemDownload\)\)/);
    assert.match(shared, /getAccessibleItem\(orgIdOf\(req\), req\.params\.assetId\)/);
    assert.match(shared, /ResponseContentDisposition: sharedDownloadContentDisposition\(name\)/);
    assert.match(shared, /url: await signedAttachment\(row\.object_key, row\.name\)/);
    assert.doesNotMatch(shared.slice(shared.indexOf('export const getItemDownload'), shared.indexOf('export const renameItem')), /object_key:/);
});

test('cliente pede uma URL de download nova somente no clique', () => {
    assert.match(clientGateway, /async sharedAssetDownload\(id: string\)/);
    assert.match(clientGateway, /`\/shared\/files\/item\/\$\{encodeURIComponent\(id\)\}\/download-url`/);
    assert.match(clientGateway, /\{ method: 'POST' \}/);
});
