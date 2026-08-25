const DEFAULT_UPDATE_FEED_URL =
    'https://github.com/impactorelampago-alt/mileto-ai-video-studio/releases/latest/download';
const DEFAULT_UPDATE_MANIFEST_URL = `${DEFAULT_UPDATE_FEED_URL}/latest.yml`;

function parseVersion(value) {
    if (typeof value !== 'string') return null;
    const match = value
        .trim()
        .match(/^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return null;
    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] ? match[4].split('.') : [],
    };
}

function comparePrerelease(left, right) {
    if (left.length === 0 && right.length === 0) return 0;
    if (left.length === 0) return 1;
    if (right.length === 0) return -1;

    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left[index];
        const rightPart = right[index];
        if (leftPart == null) return -1;
        if (rightPart == null) return 1;
        if (leftPart === rightPart) continue;

        const leftIsNumber = /^\d+$/.test(leftPart);
        const rightIsNumber = /^\d+$/.test(rightPart);
        if (leftIsNumber && rightIsNumber) return Number(leftPart) > Number(rightPart) ? 1 : -1;
        if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1;
        return leftPart > rightPart ? 1 : -1;
    }
    return 0;
}

function compareVersions(leftValue, rightValue) {
    const left = parseVersion(leftValue);
    const right = parseVersion(rightValue);
    if (!left || !right) {
        throw new Error(`Versão inválida na verificação de atualização: ${leftValue} / ${rightValue}`);
    }

    for (let index = 0; index < left.core.length; index += 1) {
        if (left.core[index] !== right.core[index]) {
            return left.core[index] > right.core[index] ? 1 : -1;
        }
    }
    return comparePrerelease(left.prerelease, right.prerelease);
}

function isVersionNewer(candidate, current) {
    return compareVersions(candidate, current) > 0;
}

function extractManifestVersion(manifest) {
    if (typeof manifest !== 'string') throw new Error('Manifesto de atualização inválido.');
    const match = manifest.match(
        /^\s*version:\s*['"]?([vV]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)['"]?\s*(?:#.*)?$/m
    );
    if (!match || !parseVersion(match[1])) {
        throw new Error('O manifesto publicado não informa uma versão válida.');
    }
    return match[1].replace(/^[vV]/, '');
}

async function fetchPublishedVersion({
    fetchImpl = globalThis.fetch,
    manifestUrl = DEFAULT_UPDATE_MANIFEST_URL,
    now = Date.now,
} = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Cliente HTTP indisponível para confirmar a atualização.');
    const separator = manifestUrl.includes('?') ? '&' : '?';
    const response = await fetchImpl(`${manifestUrl}${separator}mileto_no_cache=${now()}`, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'follow',
        headers: { Accept: 'application/yaml, text/yaml, text/plain, */*' },
    });
    if (!response || !response.ok) {
        throw new Error(`Não foi possível consultar o manifesto publicado (HTTP ${response?.status || 'desconhecido'}).`);
    }
    return extractManifestVersion(await response.text());
}

function syntheticNoUpdateResult(version) {
    return {
        isUpdateAvailable: false,
        updateInfo: { version },
        versionInfo: { version },
    };
}

async function checkForUpdatesResilient({
    updater,
    currentVersion,
    getPublishedVersion = () => fetchPublishedVersion(),
    fallbackFeedUrl = DEFAULT_UPDATE_FEED_URL,
    logger = console,
}) {
    if (!updater || typeof updater.checkForUpdates !== 'function') {
        throw new Error('Atualizador do aplicativo indisponível.');
    }

    let primaryResult = null;
    let primaryError = null;
    try {
        primaryResult = await updater.checkForUpdates();
    } catch (error) {
        primaryError = error;
        logger.warn?.(`[updater] Consulta principal falhou: ${error?.message || error}`);
    }

    if (primaryResult?.isUpdateAvailable) {
        return {
            result: primaryResult,
            publishedVersion: primaryResult.updateInfo?.version || null,
            source: 'provider',
        };
    }

    let publishedVersion;
    try {
        publishedVersion = await getPublishedVersion();
    } catch (manifestError) {
        if (primaryError) throw primaryError;
        throw new Error(
            `Não foi possível confirmar a última versão publicada: ${manifestError?.message || manifestError}`,
            { cause: manifestError }
        );
    }

    if (!isVersionNewer(publishedVersion, currentVersion)) {
        return {
            result: primaryResult || syntheticNoUpdateResult(publishedVersion),
            publishedVersion,
            source: primaryError ? 'manifest' : 'confirmed',
        };
    }

    logger.warn?.(
        `[updater] Divergência detectada: instalada ${currentVersion}, publicada ${publishedVersion}. Tentando feed direto.`
    );
    if (typeof updater.setFeedURL !== 'function') {
        throw new Error(`A versão ${publishedVersion} está disponível, mas o atualizador não conseguiu prepará-la.`);
    }

    updater.setFeedURL({ provider: 'generic', url: fallbackFeedUrl });
    let fallbackResult;
    try {
        fallbackResult = await updater.checkForUpdates();
    } catch (error) {
        throw new Error(
            `A versão ${publishedVersion} está disponível, mas a fonte alternativa falhou: ${error?.message || error}`,
            { cause: error }
        );
    }

    if (!fallbackResult?.isUpdateAvailable) {
        throw new Error(
            `A versão ${publishedVersion} está disponível, mas o atualizador não conseguiu prepará-la. Tente novamente.`
        );
    }

    return { result: fallbackResult, publishedVersion, source: 'fallback' };
}

module.exports = {
    DEFAULT_UPDATE_FEED_URL,
    checkForUpdatesResilient,
    compareVersions,
    extractManifestVersion,
    fetchPublishedVersion,
    isVersionNewer,
};
