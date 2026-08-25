import assert from 'node:assert/strict';
import test from 'node:test';
import updaterCheck from '../electron-main/update-check.cjs';

const {
    checkForUpdatesResilient,
    compareVersions,
    extractManifestVersion,
    fetchPublishedVersion,
    isVersionNewer,
} = updaterCheck;

const silentLogger = { warn() {} };

test('compara versões estáveis e pré-lançamentos semanticamente', () => {
    assert.equal(compareVersions('1.4.51', '1.4.47'), 1);
    assert.equal(compareVersions('v1.4.51', '1.4.51'), 0);
    assert.equal(compareVersions('1.5.0-beta.2', '1.5.0-beta.1'), 1);
    assert.equal(compareVersions('1.5.0', '1.5.0-beta.2'), 1);
    assert.equal(isVersionNewer('1.4.47', '1.4.51'), false);
});

test('extrai a versão do manifesto publicado com ou sem aspas', () => {
    assert.equal(extractManifestVersion('version: 1.4.51\nfiles: []\n'), '1.4.51');
    assert.equal(extractManifestVersion("version: 'v2.0.0-beta.1'\n"), '2.0.0-beta.1');
    assert.throws(() => extractManifestVersion('files: []\n'), /não informa uma versão válida/i);
});

test('consulta o manifesto sem cache', async () => {
    let requestedUrl = '';
    let requestedOptions = null;
    const version = await fetchPublishedVersion({
        now: () => 123,
        manifestUrl: 'https://updates.example/latest.yml',
        fetchImpl: async (url, options) => {
            requestedUrl = url;
            requestedOptions = options;
            return { ok: true, text: async () => 'version: 1.4.51\n' };
        },
    });

    assert.equal(version, '1.4.51');
    assert.equal(requestedUrl, 'https://updates.example/latest.yml?mileto_no_cache=123');
    assert.equal(requestedOptions.cache, 'no-store');
});

test('aceita imediatamente a atualização encontrada pelo provedor principal', async () => {
    let manifestChecks = 0;
    const available = { isUpdateAvailable: true, updateInfo: { version: '1.4.51' } };
    const updater = { checkForUpdates: async () => available };

    const checked = await checkForUpdatesResilient({
        updater,
        currentVersion: '1.4.47',
        getPublishedVersion: async () => {
            manifestChecks += 1;
            return '1.4.51';
        },
        logger: silentLogger,
    });

    assert.equal(checked.result, available);
    assert.equal(checked.source, 'provider');
    assert.equal(manifestChecks, 0);
});

test('só confirma sistema atualizado após confrontar o manifesto', async () => {
    const unavailable = { isUpdateAvailable: false, updateInfo: { version: '1.4.51' } };
    const updater = { checkForUpdates: async () => unavailable };

    const checked = await checkForUpdatesResilient({
        updater,
        currentVersion: '1.4.51',
        getPublishedVersion: async () => '1.4.51',
        logger: silentLogger,
    });

    assert.equal(checked.result, unavailable);
    assert.equal(checked.publishedVersion, '1.4.51');
    assert.equal(checked.source, 'confirmed');
});

test('divergência aciona o feed direto e mantém a atualização pronta para download', async () => {
    const checks = [
        { isUpdateAvailable: false, updateInfo: { version: '1.4.47' } },
        { isUpdateAvailable: true, updateInfo: { version: '1.4.51' } },
    ];
    let selectedFeed = null;
    const updater = {
        checkForUpdates: async () => checks.shift(),
        setFeedURL: (feed) => {
            selectedFeed = feed;
        },
    };

    const checked = await checkForUpdatesResilient({
        updater,
        currentVersion: '1.4.47',
        getPublishedVersion: async () => '1.4.51',
        fallbackFeedUrl: 'https://updates.example/latest',
        logger: silentLogger,
    });

    assert.deepEqual(selectedFeed, { provider: 'generic', url: 'https://updates.example/latest' });
    assert.equal(checked.result.isUpdateAvailable, true);
    assert.equal(checked.source, 'fallback');
});

test('falha da consulta principal também é recuperada pelo manifesto e feed direto', async () => {
    let attempt = 0;
    const updater = {
        checkForUpdates: async () => {
            attempt += 1;
            if (attempt === 1) throw new Error('feed do GitHub indisponível');
            return { isUpdateAvailable: true, updateInfo: { version: '1.4.51' } };
        },
        setFeedURL() {},
    };

    const checked = await checkForUpdatesResilient({
        updater,
        currentVersion: '1.4.47',
        getPublishedVersion: async () => '1.4.51',
        logger: silentLogger,
    });

    assert.equal(attempt, 2);
    assert.equal(checked.result.isUpdateAvailable, true);
    assert.equal(checked.source, 'fallback');
});

test('não confirma versão atual quando o manifesto independente não pode ser consultado', async () => {
    const updater = {
        checkForUpdates: async () => ({ isUpdateAvailable: false, updateInfo: { version: '1.4.47' } }),
    };

    await assert.rejects(
        checkForUpdatesResilient({
            updater,
            currentVersion: '1.4.47',
            getPublishedVersion: async () => {
                throw new Error('sem conexão');
            },
            logger: silentLogger,
        }),
        /não foi possível confirmar a última versão publicada/i
    );
});

test('não informa falsamente que está atualizado se o feed direto também divergir', async () => {
    const updater = {
        checkForUpdates: async () => ({ isUpdateAvailable: false, updateInfo: { version: '1.4.47' } }),
        setFeedURL() {},
    };

    await assert.rejects(
        checkForUpdatesResilient({
            updater,
            currentVersion: '1.4.47',
            getPublishedVersion: async () => '1.4.51',
            logger: silentLogger,
        }),
        /versão 1\.4\.51 está disponível/i
    );
});
