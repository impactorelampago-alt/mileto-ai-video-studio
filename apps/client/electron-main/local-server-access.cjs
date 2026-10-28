const LOCAL_ACCESS_HEADER = 'X-Mileto-Local-Token';

function trustedRenderer(url, entry, isDev) {
    try {
        const actual = new URL(url);
        if (isDev) return actual.origin === 'http://localhost:5173';
        const expected = new URL(entry);
        return actual.protocol === 'file:' && actual.host === expected.host && actual.pathname === expected.pathname;
    } catch { return false; }
}

function localServerRequestHeaders(details, { token, webContentsId, rendererUrl, entryUrl, isDev }) {
    const headers = { ...details.requestHeaders };
    for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === LOCAL_ACCESS_HEADER.toLowerCase()) delete headers[name];
    }
    let target;
    let frameUrl;
    try { target = new URL(details.url); frameUrl = details.frame?.url; } catch { return headers; }
    const local = target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '3301';
    if (local && token && details.webContentsId === webContentsId && trustedRenderer(rendererUrl, entryUrl, isDev)
        && trustedRenderer(frameUrl, entryUrl, isDev)) {
        headers[LOCAL_ACCESS_HEADER] = token;
    }
    return headers;
}

module.exports = { LOCAL_ACCESS_HEADER, localServerRequestHeaders };
