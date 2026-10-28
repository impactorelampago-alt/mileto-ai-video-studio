import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafeRemoteUrl } from '../src/utils/safePath';

test('hostnames públicos não são confundidos com prefixos IPv6 privados', () => {
    for (const host of ['cdn.example.com', 'fcdn.example.com', 'fdmedia.example.com', 'features.example.com', 'fea.example.com']) {
        assert.equal(isSafeRemoteUrl(`https://${host}/video.mp4`), true, host);
    }
});

test('continua recusando IPv4 e IPv6 privados, aliases locais e esquemas inseguros', () => {
    for (const url of ['http://127.0.0.1/a', 'http://2130706433/a', 'http://10.1.2.3/a', 'http://192.168.1.2/a',
        'http://169.254.169.254/a', 'http://[::1]/a', 'http://[fc00::1]/a', 'http://[fd00::1]/a',
        'http://[fe80::1]/a', 'http://[::ffff:127.0.0.1]/a', 'http://localhost/a', 'http://media.local/a', 'file:///tmp/a']) {
        assert.equal(isSafeRemoteUrl(url), false, url);
    }
    assert.equal(isSafeRemoteUrl('https://[2606:4700:4700::1111]/a'), true);
});
