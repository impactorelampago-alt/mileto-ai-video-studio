import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const asset = new URL('../../server/public/transitions/builtins/film-burn-08.mp4', import.meta.url);
const builder = readFileSync(new URL('../../client/electron-builder.yml', import.meta.url), 'utf8');
const gitignore = readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8');

test('Film Burn oficial acompanha clones e instaladores sem liberar uploads dos usuários', () => {
    assert.equal(statSync(asset).size, 859_054);
    assert.equal(
        createHash('sha256').update(readFileSync(asset)).digest('hex'),
        '1fa1837aa964ea4088827d5975fbbb3c9d52b74e524f483546ba35dcffe87366',
    );
    assert.match(builder, /public\/transitions\/\*\*\/\*/);
    assert.match(gitignore, /!apps\/server\/public\/transitions\/builtins\/film-burn-08\.mp4/);
    assert.match(gitignore, /apps\/server\/public\/transitions\/builtins\/\*/);
});
