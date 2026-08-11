import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { pool, query } from './db.js';
import { decryptOpsToken, encryptOpsToken, newId } from './crypto.js';
import {
    OpsHttpError,
    exchangeAuthorizationCode,
    opsApi,
    refreshAccessToken,
    requireOpsConfig,
    revokeToken,
    unwrapOpsData,
} from './opsClient.js';
import { maskEmailHint, renderOpsAuthorizationPage } from './opsAuthorizationPage.js';
import {
    OPS_VIEW_CONTEXT_HEADER,
    delegationCacheKey,
    normalizeViewContextId,
    sanitizeViewContexts,
} from './opsViewContext.js';
import { normalizeOpsFolderScope } from './opsAssetScope.js';
import {
    buildOpsUploadIntentPayload,
    createOpsExportIdempotencyKey,
} from './opsExportContract.js';
import {
    normalizeOpsIdempotencyKey,
    normalizeVideoJobRetryInput,
} from './opsVideoJobRevision.js';
import {
    isRecoverableStoredOpsError,
    isTransientOpsRefreshError,
    opsRefreshConnectionState,
    publicOpsRefreshError,
    refreshOpsTokenSafely,
    storedOpsRefreshIssue,
    storedOpsRefreshError,
} from './opsConnectionRecovery.js';

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const b64u = (buffer) => Buffer.from(buffer).toString('base64url');
const pkceChallenge = (verifier) => b64u(crypto.createHash('sha256').update(String(verifier)).digest());
const normalizeEmail = (value) => String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();
const fingerprint = (value) => (normalizeEmail(value) ? sha256(normalizeEmail(value)) : null);
const normalizeScopes = (scopes) => [...new Set((Array.isArray(scopes) ? scopes : [])
    .map((scope) => String(scope || '').trim())
    .filter(Boolean))];
const missingRequiredScopes = (scopes) => {
    const granted = new Set(normalizeScopes(scopes));
    return normalizeScopes(config.ops.scopes).filter((scope) => !granted.has(scope));
};
const assertRequiredScopes = (scopes) => {
    const missing = missingRequiredScopes(scopes);
    if (missing.length) {
        throw httpError(403, 'ops_scope_missing', `O Mileto Ops não concedeu os escopos obrigatórios: ${missing.join(', ')}.`);
    }
    return normalizeScopes(scopes);
};
const assertAssetsWriteScope = (connection) => {
    if (!normalizeScopes(connection?.scopes).includes('assets.write')) {
        throw httpError(403, 'ops_assets_write_required', 'A autorização atual não permite enviar vídeos ao Mileto Ops. Reconecte a conta e conceda assets.write.');
    }
};

// Algumas versoes do Ops retornam emailFingerprint junto do e-mail normalizado,
// mas o fingerprint pode ter sido gerado por outro esquema. Nunca devemos
// descartar o e-mail normalizado nesse caso: testamos ambos localmente e
// mantemos somente hashes na sincronizacao.
const opsEmailFingerprints = (opsUser) => {
    const values = new Set();
    const supplied = String(opsUser?.emailFingerprint || '').trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(supplied)) values.add(supplied);
    else {
        const derived = fingerprint(supplied);
        if (derived) values.add(derived);
    }
    for (const value of [opsUser?.normalizedEmail, opsUser?.email]) {
        const derived = fingerprint(value);
        if (derived) values.add(derived);
    }
    return [...values];
};
const safeLimit = (value, fallback = 50) => Math.min(100, Math.max(1, Number(value) || fallback));
const hashFile = (filePath) => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
});

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

const validateOpsMediaUrl = (rawUrl) => {
    let mediaUrl;
    let configuredUrl;
    try {
        mediaUrl = new URL(String(rawUrl));
        configuredUrl = new URL(config.ops.baseUrl);
    } catch {
        throw httpError(502, 'ops_media_url_invalid', 'O Mileto Ops devolveu uma URL de mídia inválida.');
    }
    if (mediaUrl.username || mediaUrl.password) {
        throw httpError(502, 'ops_media_url_invalid', 'A URL de mídia do Mileto Ops contém credenciais.');
    }
    if (mediaUrl.origin !== configuredUrl.origin) {
        throw httpError(502, 'ops_media_origin_invalid', 'A URL de mídia não pertence à origem configurada do Mileto Ops.');
    }
    if (process.env.NODE_ENV === 'production' && mediaUrl.protocol !== 'https:') {
        throw httpError(502, 'ops_media_https_required', 'A URL de mídia do Mileto Ops deve usar HTTPS.');
    }
    if (!/^\/api\/integrations\/mileto-ai-video\/delivery\/[^/]+$/.test(mediaUrl.pathname)) {
        throw httpError(502, 'ops_media_path_invalid', 'A URL de mídia não usa o caminho autorizado da integração.');
    }
    if (mediaUrl.search || mediaUrl.hash) {
        throw httpError(502, 'ops_media_url_invalid', 'A URL de mídia do Mileto Ops contém parâmetros não autorizados.');
    }
    return mediaUrl.toString();
};

const mediaProxyTickets = new Map();
const MEDIA_PROXY_MAX_TTL_MS = 10 * 60 * 1000;
const MEDIA_PROXY_MAX_TICKETS = 10_000;

const purgeMediaProxyTickets = () => {
    const now = Date.now();
    for (const [ticket, item] of mediaProxyTickets.entries()) {
        if (item.expiresAt <= now) mediaProxyTickets.delete(ticket);
    }
    if (mediaProxyTickets.size <= MEDIA_PROXY_MAX_TICKETS) return;
    const oldest = [...mediaProxyTickets.entries()]
        .sort((left, right) => left[1].createdAt - right[1].createdAt)
        .slice(0, mediaProxyTickets.size - MEDIA_PROXY_MAX_TICKETS);
    for (const [ticket] of oldest) mediaProxyTickets.delete(ticket);
};

const issueMediaProxy = (rawData, purpose = 'stream') => {
    const data = rawData && typeof rawData === 'object' ? rawData : {};
    const upstreamUrl = validateOpsMediaUrl(data.url);
    const upstreamExpiry = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
    const expiresAt = Math.min(
        Date.now() + MEDIA_PROXY_MAX_TTL_MS,
        Number.isFinite(upstreamExpiry) && upstreamExpiry > Date.now() ? upstreamExpiry : Date.now() + MEDIA_PROXY_MAX_TTL_MS
    );
    const ticket = crypto.randomBytes(32).toString('base64url');
    mediaProxyTickets.set(ticket, {
        upstreamUrl,
        purpose,
        supportsRange: data.supportsRange === true,
        createdAt: Date.now(),
        expiresAt,
    });
    purgeMediaProxyTickets();
    return {
        ...data,
        url: `/v1/integrations/mileto-ops/media/${ticket}`,
        expiresAt: new Date(expiresAt).toISOString(),
    };
};

export const proxyMedia = async (req, res) => {
    const ticket = String(req.params.ticket || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return res.status(404).end();
    const media = mediaProxyTickets.get(ticket);
    if (!media || media.expiresAt <= Date.now()) {
        mediaProxyTickets.delete(ticket);
        return res.status(410).end();
    }

    const abortController = new AbortController();
    const abort = () => abortController.abort();
    req.once('aborted', abort);
    res.once('close', abort);
    try {
        const range = String(req.headers.range || '');
        const upstream = await fetch(media.upstreamUrl, {
            method: 'GET',
            headers: /^bytes=\d*-\d*$/i.test(range) ? { Range: range } : {},
            redirect: 'manual',
            signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(120_000)]),
        });
        if ([301, 302, 303, 307, 308].includes(upstream.status)) {
            throw httpError(502, 'ops_media_redirect_blocked', 'A entrega de mídia do Mileto Ops redirecionou para uma origem não autorizada.');
        }
        if ([401, 403, 404, 410].includes(upstream.status)) {
            mediaProxyTickets.delete(ticket);
            return res.status(410).end();
        }
        if (!upstream.ok && upstream.status !== 206) {
            return res.status(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502).end();
        }
        const copyHeader = (name) => {
            const value = upstream.headers.get(name);
            if (value && value.length <= 512 && !/[\r\n]/.test(value)) res.setHeader(name, value);
        };
        ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'etag', 'last-modified'].forEach(copyHeader);
        // Supabase Storage returns a valid 206/Content-Range but may omit
        // Accept-Ranges. Chromium then treats MP4 files whose `moov` atom is at
        // the end as non-seekable and can download the whole file before it
        // knows the duration. The Ops contract already declares range support,
        // so make that capability explicit at the browser-facing boundary.
        if (media.supportsRange || upstream.status === 206 || upstream.headers.get('content-range')) {
            res.setHeader('Accept-Ranges', 'bytes');
        }
        // A short private cache lets the desktop player reuse the metadata and
        // initial byte ranges when the same preview is reopened. It is never
        // shared and remains bounded by the temporary proxy ticket.
        res.setHeader(
            'Cache-Control',
            media.purpose === 'download' ? 'private, no-store' : 'private, max-age=60, no-transform'
        );
        res.setHeader('Vary', 'Range');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.status(upstream.status);
        if (!upstream.body) return res.end();
        try {
            await pipeline(Readable.fromWeb(upstream.body), res);
        } catch (error) {
            if (!abortController.signal.aborted) throw error;
        }
    } finally {
        req.off('aborted', abort);
        res.off('close', abort);
    }
};

const connectionRow = async (orgId, includeRevoked = false) => {
    const clause = includeRevoked ? '' : "AND status = 'active'";
    return (
        await query(
            `SELECT * FROM ops_connections WHERE org_id = $1 ${clause} ORDER BY updated_at DESC LIMIT 1`,
            [orgId]
        )
    ).rows[0];
};

const publicConnection = (row) => {
    if (!row) return null;
    const refreshIssue = row.status === 'active' ? storedOpsRefreshIssue(row.last_error) : null;
    return {
        id: row.id,
        status: row.status,
        accountId: row.ops_account_id,
        accountName: row.ops_account_name,
        scopes: row.scopes || [],
        connectedAt: row.connected_at,
        revokedAt: row.revoked_at,
        lastError: publicOpsRefreshError(row.last_error),
        temporarilyUnavailable: refreshIssue === 'temporary',
        configurationIssue: refreshIssue === 'configuration',
    };
};

const recoverTransientConnection = async (connection) => {
    if (
        !connection
        || connection.status !== 'error'
        || !connection.refresh_token_enc
        || !isRecoverableStoredOpsError(connection.last_error)
    ) {
        return connection;
    }
    const lastError = storedOpsRefreshError({ code: publicOpsRefreshError(connection.last_error), status: 503 });
    await query(
        `UPDATE ops_connections
         SET status = 'active', last_error = $2, revoked_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'error'`,
        [connection.id, lastError]
    );
    return { ...connection, status: 'active', last_error: lastError, revoked_at: null };
};

const markConnectionAttempt = async (orgId, status, lastError = null) => {
    await query(
        `INSERT INTO ops_connections (id, org_id, status, last_error, updated_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (org_id) DO UPDATE SET
            status = EXCLUDED.status,
            last_error = EXCLUDED.last_error,
            updated_at = now()
         WHERE ops_connections.status <> 'active'`,
        [newId(), orgId, status, lastError]
    );
};

const audit = async ({ req, connectionId = null, action, resourceType = null, resourceId = null, result, detail = {} }) => {
    await query(
        `INSERT INTO ops_audit_events
         (id, org_id, connection_id, actor_user_id, action, resource_type, resource_id, result, request_id, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
            newId(),
            req.user?.orgId || null,
            connectionId,
            req.user?.id || null,
            action,
            resourceType,
            resourceId,
            result,
            req.headers['x-request-id'] || null,
            detail,
        ]
    ).catch(() => undefined);
};

const tokenRefreshes = new Map();

const refreshConnection = async (connection) => {
    const existing = tokenRefreshes.get(connection.id);
    if (existing) return existing;
    const task = (async () => {
        const refreshToken = decryptOpsToken(connection.refresh_token_enc);
        if (!refreshToken) {
            await query(
                `UPDATE ops_connections SET status = 'error', last_error = 'ops_reconnect_required', updated_at = now() WHERE id = $1`,
                [connection.id]
            );
            throw httpError(401, 'ops_reconnect_required', 'Reconecte sua conta Mileto Ops.');
        }
        let tokens;
        try {
            tokens = await refreshOpsTokenSafely(() => refreshAccessToken(refreshToken));
        } catch (error) {
            const temporary = isTransientOpsRefreshError(error);
            await query(
                `UPDATE ops_connections
                 SET status = $2, last_error = $3, updated_at = now()
                 WHERE id = $1`,
                [connection.id, temporary ? 'active' : 'error', storedOpsRefreshError(error)]
            );
            throw error;
        }
        const refreshState = opsRefreshConnectionState({
            tokenScopes: tokens.scopes,
            storedScopes: connection.scopes,
            requiredScopes: config.ops.scopes,
        });
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
        const nextRefresh = tokens.refreshToken || refreshToken;
        await query(
            `UPDATE ops_connections
             SET access_token_enc = $2, access_token_expires_at = $3, refresh_token_enc = $4,
                 scopes = $5, status = $6, last_error = $7, updated_at = now()
             WHERE id = $1`,
            [
                connection.id,
                encryptOpsToken(tokens.accessToken),
                expiresAt,
                encryptOpsToken(nextRefresh),
                refreshState.scopes,
                refreshState.status,
                refreshState.lastError,
            ]
        );
        if (refreshState.missingScopes.length) {
            throw httpError(
                403,
                refreshState.lastError,
                `Atualize a autorização do Mileto Ops para conceder: ${refreshState.missingScopes.join(', ')}.`
            );
        }
        return tokens.accessToken;
    })();
    tokenRefreshes.set(connection.id, task);
    try {
        return await task;
    } finally {
        tokenRefreshes.delete(connection.id);
    }
};

const connectionAccessToken = async (connection) => {
    if (!connection || connection.status !== 'active') {
        throw httpError(409, 'ops_not_connected', 'A organização ainda não está conectada ao Mileto Ops.');
    }
    const expires = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
    if (connection.access_token_enc && expires > Date.now() + 90_000) {
        const token = decryptOpsToken(connection.access_token_enc);
        if (token) return token;
    }
    return refreshConnection(connection);
};

const activeConnectionWithToken = async (orgId) => {
    requireOpsConfig();
    const connection = await recoverTransientConnection(await connectionRow(orgId, true));
    if (!connection) throw httpError(409, 'ops_not_connected', 'Conecte sua conta ao Mileto Ops primeiro.');
    return { connection, accessToken: await connectionAccessToken(connection) };
};

const delegationCache = new Map();

const clearDelegationCacheForUser = (connectionId, aiUserId) => {
    const prefix = `${connectionId}:${aiUserId}:`;
    for (const key of delegationCache.keys()) {
        if (key.startsWith(prefix)) delegationCache.delete(key);
    }
};

const delegatedAccess = async (orgId, aiUserId, rawViewContextId = null) => {
    const viewContextId = normalizeViewContextId(rawViewContextId);
    const { connection, accessToken } = await activeConnectionWithToken(orgId);
    const link = (
        await query(
            `SELECT * FROM ops_user_links
             WHERE connection_id = $1 AND ai_user_id = $2 AND org_id = $3 AND status = 'confirmed'`,
            [connection.id, aiUserId, orgId]
        )
    ).rows[0];
    if (!link) throw httpError(403, 'ops_user_not_linked', 'Seu usuário ainda não foi vinculado ao Mileto Ops.');

    const cacheKey = delegationCacheKey(connection.id, aiUserId, viewContextId);
    const cached = delegationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 30_000) {
        return { connection, link, accessToken: cached.token, cacheKey, viewContextId };
    }

    const body = { aiVideoUserId: String(aiUserId) };
    if (viewContextId) body.viewContextId = viewContextId;
    const response = await opsApi(accessToken, '/v1/delegations', {
        method: 'POST',
        body: JSON.stringify(body),
    });
    const data = unwrapOpsData(response) || {};
    const token = data.accessToken || data.access_token;
    if (!token) throw httpError(502, 'ops_delegation_invalid', 'O Mileto Ops não devolveu uma delegação válida.');
    const expiresAt = data.expiresAt
        ? new Date(data.expiresAt).getTime()
        : Date.now() + Math.max(30, Number(data.expiresIn || data.expires_in || 300)) * 1000;
    delegationCache.set(cacheKey, { token, expiresAt });
    return { connection, link, accessToken: token, cacheKey, viewContextId };
};

const requestViewContextId = (req) => normalizeViewContextId(req.headers[OPS_VIEW_CONTEXT_HEADER]);

const withDelegatedAccess = async (req, task) => {
    const viewContextId = requestViewContextId(req);
    const access = await delegatedAccess(req.user.orgId, req.user.id, viewContextId);
    try {
        return await task(access);
    } catch (error) {
        if (
            [
                'view_context_forbidden',
                'invalid_token',
                'connection_revoked',
                'actor_missing',
                'actor_unavailable',
                'linked_profile_unavailable',
            ].includes(error?.code)
        ) {
            delegationCache.delete(access.cacheKey);
        }
        throw error;
    }
};

const opsPathWithQuery = (base, queryValues) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queryValues || {})) {
        if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
    }
    const queryString = params.toString();
    return queryString ? `${base}?${queryString}` : base;
};

const waitForMediaRetry = async (signal, seconds) => {
    if (signal.aborted) throw httpError(499, 'ops_request_cancelled', 'A preparação da mídia foi cancelada.');
    const delayMs = Math.min(10, Math.max(1, Number(seconds) || 5)) * 1000;
    await new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(httpError(499, 'ops_request_cancelled', 'A preparação da mídia foi cancelada.'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, delayMs);
        signal.addEventListener('abort', onAbort, { once: true });
    });
};

/**
 * Cloudflare Stream pode precisar preparar o MP4 antes de emitir a URL. O Ops
 * responde 202/ready=false; como o renderer nunca fala diretamente com o Ops,
 * o gateway repete o mesmo pedido de forma limitada e cancelável.
 */
const requestReadyMediaIntent = async (req, res, accessToken, path, body = {}) => {
    const abortController = new AbortController();
    const cancel = () => abortController.abort();
    req.once('aborted', cancel);
    res.once('close', cancel);
    try {
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const payload = await opsApi(accessToken, path, {
                method: 'POST',
                body: JSON.stringify(body),
                signal: abortController.signal,
            });
            const data = unwrapOpsData(payload) || {};
            if (data.url && data.ready !== false) {
                data.url = validateOpsMediaUrl(data.url);
                return payload;
            }
            if (data.ready !== false) {
                throw httpError(502, 'ops_media_intent_invalid', 'O Mileto Ops não devolveu uma URL de mídia válida.');
            }
            if (attempt >= 11) break;
            await waitForMediaRetry(abortController.signal, data.retryAfterSeconds);
        }
        throw httpError(504, 'ops_media_not_ready', 'O vídeo ainda está sendo preparado pelo provedor. Tente novamente.');
    } finally {
        req.off('aborted', cancel);
        res.off('close', cancel);
    }
};

export const integrationStatus = async (req, res) => {
    const connection = req.user.orgId
        ? await recoverTransientConnection(await connectionRow(req.user.orgId, true))
        : null;
    const link = connection
        ? (
              await query(
                  `SELECT ops_profile_id, status, confirmed_at
                   FROM ops_user_links WHERE connection_id = $1 AND ai_user_id = $2`,
                  [connection.id, req.user.id]
              )
          ).rows[0]
        : null;
    res.json({
        ok: true,
        enabled: config.ops.enabled,
        connection: publicConnection(connection),
        userLink: link
            ? { opsProfileId: link.ops_profile_id, status: link.status, confirmedAt: link.confirmed_at }
            : null,
    });
};

export const startConnection = async (req, res) => {
    requireOpsConfig();
    const current = await connectionRow(req.user.orgId, true);
    const reconnect = req.body?.reconnect === true;
    if (current?.status === 'active' && !reconnect) {
        return res.status(409).json({ ok: false, code: 'ops_already_connected', message: 'A conta já está conectada.' });
    }

    if (reconnect && current?.status !== 'active') {
        return res.status(409).json({ ok: false, code: 'ops_reconnect_unavailable', message: 'Não há uma conexão ativa para renovar. Conecte a conta normalmente.' });
    }

    const state = b64u(crypto.randomBytes(32));
    const verifier = b64u(crypto.randomBytes(48));
    const challenge = pkceChallenge(verifier);
    const attemptId = newId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const returnTo = typeof req.body?.returnTo === 'string' ? req.body.returnTo.slice(0, 500) : null;
    await query(
        `INSERT INTO ops_authorization_attempts
         (id, org_id, created_by, reconnect, connection_id, state_hash, code_verifier_enc, return_to, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [attemptId, req.user.orgId, req.user.id, reconnect, reconnect ? current.id : null, sha256(state), encryptOpsToken(verifier), returnTo, expiresAt]
    );
    await markConnectionAttempt(req.user.orgId, 'pending');

    const authorize = new URL(`${config.ops.baseUrl}/api/integrations/mileto-ai-video/authorize`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', config.ops.clientId);
    authorize.searchParams.set('redirect_uri', config.ops.redirectUri);
    authorize.searchParams.set('scope', config.ops.scopes.join(' '));
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    // Derivado exclusivamente da sessão autenticada do AI Video. O renderer não
    // escolhe o workspace que será vinculado no Mileto Ops.
    authorize.searchParams.set('workspace_id', String(req.user.orgId));

    await audit({ req, connectionId: current?.id || null, action: 'ops.connection.started', result: 'success', detail: { attemptId, reconnect } });
    res.status(201).json({ ok: true, attemptId, authorizationUrl: authorize.toString(), expiresAt });
};

export const authorizationCallback = async (req, res) => {
    const state = String(req.query.state || '');
    const code = String(req.query.code || '');
    if (!state || !code || !config.ops.enabled) {
        return res.status(400).send('Autorização inválida ou integração não configurada.');
    }

    const client = await pool.connect();
    let attempt;
    try {
        await client.query('BEGIN');
        attempt = (
            await client.query(
                `UPDATE ops_authorization_attempts SET consumed_at = now()
                 WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
                 RETURNING *`,
                [sha256(state)]
            )
        ).rows[0];
        if (!attempt) {
            await client.query('ROLLBACK');
            return res.status(410).send('Esta autorização expirou ou já foi utilizada.');
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }

    let authorizationContext = {};
    let issuedTokens = null;
    let connectionPersisted = false;
    try {
        const verifier = decryptOpsToken(attempt.code_verifier_enc);
        const tokens = await exchangeAuthorizationCode(code, verifier);
        issuedTokens = tokens;
        const grantedScopes = assertRequiredScopes(tokens.scopes);
        const accountPayload = await opsApi(tokens.accessToken, '/v1/account');
        const account = unwrapOpsData(accountPayload) || {};
        const accountId = String(account.id || account.accountId || '');
        if (!accountId) throw new OpsHttpError(502, 'ops_account_invalid', 'O Mileto Ops não informou a conta conectada.');
        if (!tokens.refreshToken) {
            await revokeToken(tokens.accessToken);
            throw new OpsHttpError(502, 'ops_refresh_missing', 'O Mileto Ops não devolveu refresh token rotativo.');
        }

        const aiOwner = (
            await query(
                `SELECT u.email, u.name, o.name AS organization_name
                 FROM users u
                 INNER JOIN organizations o ON o.id = u.org_id
                 WHERE u.id = $1 AND u.org_id = $2 AND u.role = 'owner' AND u.status = 'active'`,
                [attempt.created_by, attempt.org_id]
            )
        ).rows[0];
        if (!aiOwner) {
            await Promise.all([revokeToken(tokens.accessToken), revokeToken(tokens.refreshToken)]);
            throw new OpsHttpError(409, 'ops_owner_missing', 'Não foi possível confirmar o dono desta empresa no Mileto AI Video.');
        }

        authorizationContext = {
            organizationName: aiOwner.organization_name,
            accountName: account.name || account.accountName || 'Conta Mileto Ops',
            expectedEmailHint: maskEmailHint(aiOwner.email),
        };

        const expectedOwnerFingerprint = fingerprint(aiOwner.email);
        const opsUsers = await fetchAllOpsUsers(tokens.accessToken);
        const matchingOwner = opsUsers.some((opsUser) => {
            const memberships = Array.isArray(opsUser.memberships) ? opsUser.memberships : [];
            const isOwner = String(opsUser.primaryRole || '').toUpperCase() === 'DONO'
                || memberships.some((role) => String(role).toUpperCase() === 'DONO');
            return isOwner && opsEmailFingerprints(opsUser).includes(expectedOwnerFingerprint);
        });
        if (!matchingOwner) {
            await Promise.all([revokeToken(tokens.accessToken), revokeToken(tokens.refreshToken)]);
            const mismatch = new OpsHttpError(
                409,
                'ops_owner_mismatch',
                'A conta aberta no Mileto Ops não pertence ao dono desta empresa.'
            );
            mismatch.authorizationContext = authorizationContext;
            throw mismatch;
        }

        const previous = await connectionRow(attempt.org_id, true);
        if (attempt.reconnect && (!previous || previous.id !== attempt.connection_id || previous.status !== 'active')) {
            throw httpError(409, 'ops_reconnect_changed', 'A conexão mudou durante a renovação. Nenhuma credencial foi substituída. Tente reconectar novamente.');
        }
        if (previous?.ops_account_id && String(previous.ops_account_id) !== accountId) {
            await Promise.all([revokeToken(tokens.accessToken), revokeToken(tokens.refreshToken)]);
            const mismatch = new OpsHttpError(
                409,
                'ops_account_mismatch',
                'Esta empresa já foi vinculada a outra conta do Mileto Ops.'
            );
            mismatch.authorizationContext = authorizationContext;
            throw mismatch;
        }

        const connectionId = attempt.reconnect ? previous.id : previous?.id || newId();
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
        const scopes = grantedScopes;
        const result = await query(
            `INSERT INTO ops_connections
             (id, org_id, ops_account_id, ops_account_name, status, scopes,
              access_token_enc, access_token_expires_at, refresh_token_enc,
              connected_by, connected_at, updated_at)
             VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,now(),now())
             ON CONFLICT (org_id) DO UPDATE SET
                ops_account_id = EXCLUDED.ops_account_id,
                ops_account_name = EXCLUDED.ops_account_name,
                status = 'active', scopes = EXCLUDED.scopes,
                access_token_enc = EXCLUDED.access_token_enc,
                access_token_expires_at = EXCLUDED.access_token_expires_at,
                refresh_token_enc = EXCLUDED.refresh_token_enc,
                connected_by = EXCLUDED.connected_by,
                connected_at = now(), revoked_at = NULL, last_error = NULL, updated_at = now()
             RETURNING id`,
            [
                connectionId,
                attempt.org_id,
                accountId,
                account.name || account.accountName || null,
                scopes,
                encryptOpsToken(tokens.accessToken),
                expiresAt,
                encryptOpsToken(tokens.refreshToken),
                attempt.created_by,
            ]
        );
        const persistedId = result.rows[0].id;
        await query(
            `INSERT INTO ops_audit_events
             (id, org_id, connection_id, actor_user_id, action, result, detail)
             VALUES ($1,$2,$3,$4,'ops.connection.completed','success',$5)`,
            [newId(), attempt.org_id, persistedId, attempt.created_by, { accountId, reconnect: Boolean(attempt.reconnect), scopes }]
        );
        connectionPersisted = true;
        res.type('html').send(
            renderOpsAuthorizationPage({
                kind: 'success',
                eyebrow: 'Conexão protegida concluída',
                title: `${aiOwner.organization_name} está conectada`,
                message: `${account.name || 'A conta do Mileto Ops'} foi vinculada ao Mileto AI Video com a identidade do dono confirmada.`,
                organizationName: aiOwner.organization_name,
                accountName: account.name || account.accountName || 'Conta Mileto Ops',
            })
        );
    } catch (error) {
        const errorCode = error.code || 'callback_failed';
        if (issuedTokens && !connectionPersisted) {
            await Promise.all([
                revokeToken(issuedTokens.accessToken),
                revokeToken(issuedTokens.refreshToken),
            ]);
        }
        await markConnectionAttempt(attempt.org_id, 'error', errorCode).catch(() => undefined);
        await query(
            `INSERT INTO ops_audit_events
             (id, org_id, actor_user_id, action, result, detail)
             VALUES ($1,$2,$3,'ops.connection.completed','failure',$4)`,
            [newId(), attempt.org_id, attempt.created_by, { code: errorCode }]
        ).catch(() => undefined);
        const status = Number(error.status) || 502;
        const mismatch = ['ops_owner_mismatch', 'ops_account_mismatch'].includes(errorCode);
        const context = error.authorizationContext || authorizationContext;
        res.status(status).type('html').send(
            renderOpsAuthorizationPage({
                kind: mismatch ? 'mismatch' : 'error',
                eyebrow: mismatch ? 'Conta incompatível' : 'Conexão não concluída',
                title: mismatch
                    ? `Esta não é a conta de ${context.organizationName || 'sua empresa'}`
                    : 'Não foi possível concluir a conexão',
                message: mismatch
                    ? 'A identidade do dono não corresponde à empresa aberta no Mileto AI Video. Nenhuma conexão foi salva e os acessos temporários foram revogados.'
                    : error.message || 'Ocorreu uma falha ao autenticar a conta do Mileto Ops.',
                organizationName: context.organizationName,
                accountName: context.accountName,
                expectedEmailHint: context.expectedEmailHint,
                actionUrl: config.ops.baseUrl,
            })
        );
    }
};

export const disconnect = async (req, res) => {
    const connection = await connectionRow(req.user.orgId, true);
    if (!connection) return res.status(404).json({ ok: false, message: 'Conexão não encontrada.' });
    let refresh = '';
    let access = '';
    try {
        refresh = connection.refresh_token_enc ? decryptOpsToken(connection.refresh_token_enc) : '';
        access = connection.access_token_enc ? decryptOpsToken(connection.access_token_enc) : '';
    } catch {
        // Mesmo sem a chave antiga disponível, a revogação local precisa funcionar.
    }
    await Promise.all([revokeToken(refresh), revokeToken(access)]);
    await query(
        `UPDATE ops_connections
         SET status = 'revoked', access_token_enc = NULL, refresh_token_enc = NULL,
             access_token_expires_at = NULL, revoked_at = now(), updated_at = now()
         WHERE id = $1`,
        [connection.id]
    );
    delegationCache.clear();
    await audit({ req, connectionId: connection.id, action: 'ops.connection.revoked', result: 'success' });
    res.json({ ok: true });
};

const fetchAllOpsUsers = async (accessToken) => {
    const users = [];
    let cursor = '';
    for (let page = 0; page < 100; page += 1) {
        let response;
        let lastError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                response = await opsApi(accessToken, opsPathWithQuery('/v1/users', { cursor, limit: 100 }));
                break;
            } catch (error) {
                lastError = error;
                const transient = [502, 503, 504].includes(Number(error?.status));
                if (!transient || attempt === 2) throw error;
                await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
            }
        }
        if (!response) throw lastError;
        const data = unwrapOpsData(response);
        const rows = Array.isArray(data) ? data : Array.isArray(data?.users) ? data.users : [];
        users.push(...rows);
        const next = response?.meta?.nextCursor || data?.nextCursor || null;
        if (!next) break;
        cursor = String(next);
    }
    return users;
};

export const syncUsers = async (req, res) => {
    const { connection, accessToken } = await activeConnectionWithToken(req.user.orgId);
    const runId = newId();
    await query(
        `INSERT INTO ops_sync_runs (id, org_id, connection_id, started_by) VALUES ($1,$2,$3,$4)`,
        [runId, req.user.orgId, connection.id, req.user.id]
    );
    try {
        const [opsUsers, aiUsers, linkedRows] = await Promise.all([
            fetchAllOpsUsers(accessToken),
            query('SELECT id, name, email, role, status FROM users WHERE org_id = $1 ORDER BY id', [req.user.orgId]),
            query(`SELECT ai_user_id, ops_profile_id FROM ops_user_links WHERE connection_id = $1 AND status = 'confirmed'`, [
                connection.id,
            ]),
        ]);
        const aiByHash = new Map();
        for (const user of aiUsers.rows) {
            const hash = fingerprint(user.email);
            if (!aiByHash.has(hash)) aiByHash.set(hash, []);
            aiByHash.get(hash).push(user);
        }
        const linkedAi = new Set(linkedRows.rows.map((row) => String(row.ai_user_id)));
        const linkedOps = new Set(linkedRows.rows.map((row) => String(row.ops_profile_id)));
        const matchedAi = new Set();
        const suggestions = [];

        for (const opsUser of opsUsers) {
            const opsProfileId = String(opsUser.id || opsUser.opsProfileId || '');
            if (!opsProfileId || linkedOps.has(opsProfileId)) continue;
            const emailFingerprints = opsEmailFingerprints(opsUser);
            const candidatesById = new Map();
            for (const emailFingerprint of emailFingerprints) {
                for (const candidate of aiByHash.get(emailFingerprint) || []) candidatesById.set(String(candidate.id), candidate);
            }
            const candidates = [...candidatesById.values()];
            const kind = candidates.length === 1 ? 'unique_match' : candidates.length > 1 ? 'ambiguous' : 'ops_only';
            const aiUser = candidates.length === 1 ? candidates[0] : null;
            if (aiUser) matchedAi.add(String(aiUser.id));
            suggestions.push({
                id: newId(),
                runId,
                kind,
                aiUserId: aiUser?.id || null,
                aiName: aiUser?.name || null,
                aiRole: aiUser?.role || null,
                opsProfileId,
                opsName: opsUser.name || null,
                opsRole: opsUser.primaryRole || null,
                emailFingerprint: aiUser ? fingerprint(aiUser.email) : emailFingerprints[0] || null,
            });
        }

        for (const aiUser of aiUsers.rows) {
            if (linkedAi.has(String(aiUser.id)) || matchedAi.has(String(aiUser.id))) continue;
            const hash = fingerprint(aiUser.email);
            const existsInOps = opsUsers.some(
                (opsUser) => opsEmailFingerprints(opsUser).includes(hash)
            );
            if (!existsInOps) {
                suggestions.push({
                    id: newId(),
                    runId,
                    kind: 'ai_only',
                    aiUserId: aiUser.id,
                    aiName: aiUser.name,
                    aiRole: aiUser.role,
                    opsProfileId: null,
                    opsName: null,
                    opsRole: null,
                    emailFingerprint: hash,
                });
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const suggestion of suggestions) {
                await client.query(
                    `INSERT INTO ops_sync_conflicts
                     (id, run_id, org_id, ai_user_id, ops_profile_id, email_fingerprint, kind, detail)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [
                        suggestion.id,
                        runId,
                        req.user.orgId,
                        suggestion.aiUserId,
                        suggestion.opsProfileId,
                        suggestion.emailFingerprint,
                        suggestion.kind,
                        {
                            aiName: suggestion.aiName,
                            aiRole: suggestion.aiRole,
                            opsName: suggestion.opsName,
                            opsRole: suggestion.opsRole,
                        },
                    ]
                );
            }
            const stats = {
                opsUsers: opsUsers.length,
                aiUsers: aiUsers.rows.length,
                linked: linkedRows.rows.length,
                uniqueMatch: suggestions.filter((item) => item.kind === 'unique_match').length,
                ambiguous: suggestions.filter((item) => item.kind === 'ambiguous').length,
                opsOnly: suggestions.filter((item) => item.kind === 'ops_only').length,
                aiOnly: suggestions.filter((item) => item.kind === 'ai_only').length,
            };
            await client.query(
                `UPDATE ops_sync_runs SET status = 'completed', stats = $2, finished_at = now() WHERE id = $1`,
                [runId, stats]
            );
            await client.query('COMMIT');
            await audit({ req, connectionId: connection.id, action: 'ops.users.synced', result: 'success', detail: stats });
            res.json({ ok: true, runId, stats, suggestions });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        await query(
            `UPDATE ops_sync_runs SET status = 'failed', error_code = $2, finished_at = now() WHERE id = $1`,
            [runId, error.code || 'sync_failed']
        ).catch(() => undefined);
        await audit({ req, connectionId: connection.id, action: 'ops.users.synced', result: 'failure', detail: { code: error.code || 'sync_failed' } });
        throw error;
    }
};

export const listConflicts = async (req, res) => {
    const rows = (
        await query(
            `SELECT c.id, c.run_id AS "runId", c.ai_user_id AS "aiUserId",
                    c.ops_profile_id AS "opsProfileId", c.email_fingerprint AS "emailFingerprint",
                    c.kind, c.detail, c.created_at AS "createdAt"
             FROM ops_sync_conflicts c
             WHERE c.org_id = $1 AND c.resolved_at IS NULL
               AND c.run_id = (SELECT id FROM ops_sync_runs WHERE org_id = $1 ORDER BY started_at DESC LIMIT 1)
             ORDER BY c.created_at, c.kind`,
            [req.user.orgId]
        )
    ).rows;
    res.json({ ok: true, conflicts: rows });
};

export const confirmUserLink = async (req, res) => {
    const aiUserId = Number(req.params.aiUserId);
    if (!Number.isSafeInteger(aiUserId) || aiUserId <= 0) {
        return res.status(400).json({ ok: false, message: 'Usuário AI inválido.' });
    }
    const opsProfileId = String(req.body?.opsProfileId || '').trim();
    if (!opsProfileId) return res.status(400).json({ ok: false, message: 'Informe o usuário do Mileto Ops.' });
    const aiUser = (
        await query('SELECT id, name, email FROM users WHERE id = $1 AND org_id = $2', [aiUserId, req.user.orgId])
    ).rows[0];
    if (!aiUser) return res.status(404).json({ ok: false, message: 'Usuário AI não encontrado nesta organização.' });

    const { connection, accessToken } = await activeConnectionWithToken(req.user.orgId);
    const occupied = (
        await query(
            `SELECT ai_user_id FROM ops_user_links
             WHERE connection_id = $1 AND ops_profile_id = $2 AND status = 'confirmed' AND ai_user_id <> $3`,
            [connection.id, opsProfileId, aiUserId]
        )
    ).rows[0];
    if (occupied) {
        return res.status(409).json({
            ok: false,
            code: 'ops_link_conflict',
            message: 'Esse usuário do Mileto Ops já está vinculado a outra pessoa.',
        });
    }
    await opsApi(accessToken, `/v1/user-links/${encodeURIComponent(String(aiUserId))}`, {
        method: 'PUT',
        body: JSON.stringify({ opsProfileId }),
    });
    try {
        const row = (
            await query(
                `INSERT INTO ops_user_links
                 (id, org_id, connection_id, ai_user_id, ops_profile_id, email_fingerprint,
                  status, confirmed_by, confirmed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,'confirmed',$7,now())
                 ON CONFLICT (connection_id, ai_user_id) DO UPDATE SET
                    ops_profile_id = EXCLUDED.ops_profile_id,
                    email_fingerprint = EXCLUDED.email_fingerprint,
                    status = 'confirmed', confirmed_by = EXCLUDED.confirmed_by,
                    confirmed_at = now(), updated_at = now()
                 RETURNING id, ai_user_id AS "aiUserId", ops_profile_id AS "opsProfileId", status, confirmed_at AS "confirmedAt"`,
                [newId(), req.user.orgId, connection.id, aiUserId, opsProfileId, fingerprint(aiUser.email), req.user.id]
            )
        ).rows[0];
        await query(
            `UPDATE ops_sync_conflicts SET resolved_at = now(), resolved_by = $3
             WHERE org_id = $1 AND (ai_user_id = $2 OR ops_profile_id = $4) AND resolved_at IS NULL`,
            [req.user.orgId, aiUserId, req.user.id, opsProfileId]
        );
        clearDelegationCacheForUser(connection.id, aiUserId);
        await audit({ req, connectionId: connection.id, action: 'ops.user_link.confirmed', resourceType: 'user', resourceId: String(aiUserId), result: 'success', detail: { opsProfileId } });
        res.json({ ok: true, link: row });
    } catch (error) {
        if (error.code === '23505') {
            throw httpError(409, 'ops_link_conflict', 'Esse usuário do Mileto Ops já está vinculado a outra pessoa.');
        }
        throw error;
    }
};

export const removeUserLink = async (req, res) => {
    const aiUserId = Number(req.params.aiUserId);
    if (!Number.isSafeInteger(aiUserId) || aiUserId <= 0) {
        return res.status(400).json({ ok: false, message: 'Usuário AI inválido.' });
    }
    const { connection, accessToken } = await activeConnectionWithToken(req.user.orgId);
    const link = (
        await query(
            `SELECT * FROM ops_user_links WHERE connection_id = $1 AND ai_user_id = $2 AND org_id = $3`,
            [connection.id, aiUserId, req.user.orgId]
        )
    ).rows[0];
    if (!link) return res.status(404).json({ ok: false, message: 'Vínculo não encontrado.' });
    await opsApi(accessToken, `/v1/user-links/${encodeURIComponent(String(aiUserId))}`, { method: 'DELETE' });
    await query(`UPDATE ops_user_links SET status = 'unlinked', updated_at = now() WHERE id = $1`, [link.id]);
    clearDelegationCacheForUser(connection.id, aiUserId);
    await audit({ req, connectionId: connection.id, action: 'ops.user_link.removed', resourceType: 'user', resourceId: String(aiUserId), result: 'success' });
    res.json({ ok: true });
};

const delegatedGet = async (req, path) => {
    return withDelegatedAccess(req, async ({ connection, accessToken }) => {
        const payload = await opsApi(accessToken, path);
        return { connection, payload };
    });
};

export const listViewContexts = async (req, res) => {
    const { connection, accessToken } = await delegatedAccess(req.user.orgId, req.user.id);
    const payload = await opsApi(accessToken, '/v1/me/view-contexts');
    const data = sanitizeViewContexts(unwrapOpsData(payload));
    await audit({
        req,
        connectionId: connection.id,
        action: 'ops.view_contexts.listed',
        result: 'success',
        detail: {
            count: data.contexts.length,
            canViewTeam: data.capabilities.canViewTeam,
            canViewProfiles: data.capabilities.canViewProfiles,
        },
    });
    res.json({ ok: true, data, meta: payload.meta || {} });
};

export const listCompanies = async (req, res) => {
    const { payload } = await delegatedGet(
        req,
        opsPathWithQuery('/v1/me/companies', { cursor: req.query.cursor, limit: safeLimit(req.query.limit), q: req.query.q })
    );
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
};

/** Resolve uma empresa específica dentro da delegação e do X-Ops-View-Context atuais. */
export const getCompany = async (req, res) => {
    const companyId = encodeURIComponent(String(req.params.companyId || '').trim());
    if (!companyId) throw httpError(400, 'invalid_company', 'Informe a empresa do Mileto Ops.');
    const { payload } = await delegatedGet(req, `/v1/companies/${companyId}`);
    const company = unwrapOpsData(payload);
    if (!company || company.kind === 'archive') {
        throw httpError(404, 'company_not_found', 'Empresa não encontrada no contexto delegado.');
    }
    res.json({ ok: true, data: company, meta: payload.meta || {} });
};

export const listFolders = async (req, res) => {
    const companyId = encodeURIComponent(String(req.params.companyId));
    const { payload } = await delegatedGet(req, `/v1/companies/${companyId}/folders`);
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
};

export const createFolder = async (req, res) => {
    const companyId = String(req.params.companyId || '').trim();
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
    const parentId = req.body?.parentId === null ? null : String(req.body?.parentId || '').trim() || null;
    if (!companyId || !name || name.length > 80) {
        throw httpError(400, 'invalid_folder', 'Informe uma empresa e um nome de pasta valido.');
    }
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken }) => {
        assertAssetsWriteScope(connection);
        const payload = await opsApi(accessToken, `/v1/companies/${encodeURIComponent(companyId)}/folders`, {
            method: 'POST',
            body: JSON.stringify({ name, parentId }),
        });
        return { connection, payload };
    });
    const folder = unwrapOpsData(payload);
    await audit({
        req,
        connectionId: connection.id,
        action: 'ops.folder.created',
        resourceType: 'folder',
        resourceId: folder?.id || null,
        result: 'success',
        detail: { companyId, parentId },
    });
    res.status(201).json({ ok: true, data: folder, meta: payload.meta || {} });
};

export const updateFolder = async (req, res) => {
    const folderId = String(req.params.folderId || '').trim();
    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasParentId = Object.prototype.hasOwnProperty.call(req.body || {}, 'parentId');
    if (!folderId || hasName === hasParentId) {
        throw httpError(400, 'invalid_folder_update', 'Informe somente name ou parentId.');
    }
    const body = hasName
        ? { name: String(req.body.name || '').trim().replace(/\s+/g, ' ') }
        : { parentId: req.body.parentId === null ? null : String(req.body.parentId || '').trim() };
    if ((hasName && (!body.name || body.name.length > 80)) || (hasParentId && body.parentId === '')) {
        throw httpError(400, 'invalid_folder_update', 'Alteracao de pasta invalida.');
    }
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken }) => {
        assertAssetsWriteScope(connection);
        const payload = await opsApi(accessToken, `/v1/folders/${encodeURIComponent(folderId)}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        return { connection, payload };
    });
    const folder = unwrapOpsData(payload);
    await audit({
        req,
        connectionId: connection.id,
        action: hasName ? 'ops.folder.renamed' : 'ops.folder.moved',
        resourceType: 'folder',
        resourceId: folderId,
        result: 'success',
        detail: body,
    });
    res.json({ ok: true, data: folder, meta: payload.meta || {} });
};

export const deleteFolder = async (req, res) => {
    const folderId = String(req.params.folderId || '').trim();
    if (!folderId) throw httpError(400, 'invalid_folder', 'Pasta invalida.');
    const { connection } = await withDelegatedAccess(req, async ({ connection, accessToken }) => {
        assertAssetsWriteScope(connection);
        await opsApi(accessToken, `/v1/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' });
        return { connection };
    });
    await audit({
        req,
        connectionId: connection.id,
        action: 'ops.folder.deleted',
        resourceType: 'folder',
        resourceId: folderId,
        result: 'success',
    });
    res.status(204).end();
};

export const listAssets = async (req, res) => {
    const companyId = encodeURIComponent(String(req.params.companyId));
    const folderId = normalizeOpsFolderScope(req.query.folderId);
    const path = opsPathWithQuery(`/v1/companies/${companyId}/assets`, {
        // v0.1.2: omitido = busca global; root = raiz real; UUID = pasta exata.
        folderId,
        cursor: req.query.cursor,
        limit: safeLimit(req.query.limit),
        q: req.query.q,
    });
    const { payload } = await delegatedGet(req, path);
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
};

// O renderer nunca recebe a URL/grant temporário do Ops. Ele envia o MP4 ao
// servidor local, que o encaminha ao gateway; só aqui a intenção é criada,
// os bytes são transferidos e a conclusão é confirmada.
// Fila do agente Video Maker. O gateway nunca executa a edição: ele somente
// troca a sessão do usuário pela delegação correspondente e mantém o
// X-Ops-View-Context e o escopo assets.write em todas as operações.
export const nextVideoJob = async (req, res) => {
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken, viewContextId }) => {
        assertAssetsWriteScope(connection);
        return {
            connection,
            payload: await opsApi(accessToken, '/v1/video-jobs/next', {
                headers: viewContextId ? { [OPS_VIEW_CONTEXT_HEADER]: viewContextId } : {},
            }),
        };
    });
    const data = unwrapOpsData(payload);
    await audit({
        req,
        connectionId: connection.id,
        action: 'ops.video_job.polled',
        resourceType: data?.id ? 'video_job' : null,
        resourceId: data?.id || null,
        result: 'success',
    });
    res.json({ ok: true, data: data || null, meta: payload.meta || {} });
};

export const getVideoJob = async (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    if (!jobId) throw httpError(400, 'invalid_video_job', 'Informe o trabalho de vídeo.');
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken, viewContextId }) => {
        assertAssetsWriteScope(connection);
        return {
            connection,
            payload: await opsApi(accessToken, `/v1/video-jobs/${encodeURIComponent(jobId)}`, {
                headers: viewContextId ? { [OPS_VIEW_CONTEXT_HEADER]: viewContextId } : {},
            }),
        };
    });
    await audit({
        req,
        connectionId: connection.id,
        action: 'ops.video_job.read',
        resourceType: 'video_job',
        resourceId: jobId,
        result: 'success',
    });
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
};

export const heartbeatVideoWorker = async (req, res) => {
    const body = req.body || {};
    const normalized = {
        appVersion: String(body.appVersion || '').trim().slice(0, 80),
        mode: body.mode === 'background' ? 'background' : 'foreground',
        state: ['idle', 'busy', 'offline'].includes(body.state) ? body.state : 'idle',
        currentJobId: body.currentJobId ? String(body.currentJobId).trim() : null,
    };
    if (!normalized.appVersion) {
        throw httpError(400, 'invalid_worker_heartbeat', 'Informe a versão do Mileto AI Video.');
    }
    const result = await withDelegatedAccess(req, async ({ connection, accessToken, viewContextId }) => {
        assertAssetsWriteScope(connection);
        try {
            const payload = await opsApi(accessToken, '/v1/video-workers/heartbeat', {
                method: 'POST',
                headers: viewContextId ? { [OPS_VIEW_CONTEXT_HEADER]: viewContextId } : {},
                body: JSON.stringify(normalized),
            });
            return { connection, payload, supported: true };
        } catch (error) {
            if (error instanceof OpsHttpError && error.status === 404) {
                return { connection, payload: null, supported: false };
            }
            throw error;
        }
    });
    await audit({
        req,
        connectionId: result.connection.id,
        action: 'ops.video_worker.heartbeat',
        resourceType: normalized.currentJobId ? 'video_job' : null,
        resourceId: normalized.currentJobId,
        result: result.supported ? 'success' : 'unsupported',
        detail: { mode: normalized.mode, state: normalized.state },
    });
    res.json({
        ok: true,
        data: result.supported
            ? { supported: true, ...unwrapOpsData(result.payload) }
            : { supported: false, receivedAt: new Date().toISOString() },
    });
};

export const claimVideoJob = async (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    if (!jobId) throw httpError(400, 'invalid_video_job', 'Informe o trabalho de vídeo.');
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken, viewContextId }) => {
        assertAssetsWriteScope(connection);
        return {
            connection,
            payload: await opsApi(accessToken, `/v1/video-jobs/${encodeURIComponent(jobId)}/claim`, {
                method: 'POST',
                headers: viewContextId ? { [OPS_VIEW_CONTEXT_HEADER]: viewContextId } : {},
            }),
        };
    });
    await audit({
        req,
        connectionId: connection.id,
        action: 'ops.video_job.claimed',
        resourceType: 'video_job',
        resourceId: jobId,
        result: 'success',
    });
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
};

export const retryVideoJob = async (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    if (!jobId) throw httpError(400, 'invalid_video_job', 'Informe o trabalho de video.');
    const idempotencyKey = normalizeOpsIdempotencyKey(req.headers['idempotency-key']);
    const input = normalizeVideoJobRetryInput(req.body);
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken, viewContextId }) => {
        assertAssetsWriteScope(connection);
        return {
            connection,
            payload: await opsApi(accessToken, `/v1/video-jobs/${encodeURIComponent(jobId)}/retry`, {
                method: 'POST',
                headers: {
                    ...(viewContextId ? { [OPS_VIEW_CONTEXT_HEADER]: viewContextId } : {}),
                    'Idempotency-Key': idempotencyKey,
                },
                body: JSON.stringify(input),
            }),
        };
    });
    const data = unwrapOpsData(payload) || {};
    await audit({
        req,
        connectionId: connection.id,
        action: 'ops.video_job.retry_requested',
        resourceType: 'video_job',
        resourceId: jobId,
        result: 'success',
        detail: {
            projectId: input.projectId,
            expectedRevision: input.expectedRevision,
            reason: input.reason || null,
            minimumAppVersion: input.minimumAppVersion,
        },
    });
    res.json({ ok: true, data, meta: payload.meta || {} });
};

export const updateVideoJob = async (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    const claimToken = String(req.headers['x-mileto-job-token'] || '').trim();
    if (!jobId || !claimToken) {
        throw httpError(400, 'invalid_video_job_update', 'Informe o trabalho e o token de execução.');
    }
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken, viewContextId }) => {
        assertAssetsWriteScope(connection);
        return {
            connection,
            payload: await opsApi(accessToken, `/v1/video-jobs/${encodeURIComponent(jobId)}`, {
                method: 'PATCH',
                headers: {
                    ...(viewContextId ? { [OPS_VIEW_CONTEXT_HEADER]: viewContextId } : {}),
                    'X-Mileto-Job-Token': claimToken,
                },
                body: JSON.stringify(req.body || {}),
            }),
        };
    });
    await audit({
        req,
        connectionId: connection.id,
        action: 'ops.video_job.updated',
        resourceType: 'video_job',
        resourceId: jobId,
        result: 'success',
        detail: { status: req.body?.status, stage: req.body?.stage },
    });
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
};

export const uploadExport = async (req, res) => {
    const file = req.file;
    const companyId = String(req.params.companyId || '').trim();
    const folderId = req.body?.folderId ? String(req.body.folderId) : null;
    try {
        if (!file || !companyId) throw httpError(400, 'invalid_upload_request', 'Informe o vídeo e a empresa de destino.');
        if (!/^video\//i.test(String(file.mimetype || '')) || !/\.mp4$/i.test(String(file.originalname || ''))) {
            throw httpError(400, 'invalid_upload_request', 'A exportação precisa ser um arquivo MP4.');
        }

        const checksum = await hashFile(file.path);
        const intentPayload = buildOpsUploadIntentPayload({
            folderId,
            fileName: file.originalname,
            sizeBytes: file.size,
            checksum,
            metadata: req.body,
        });
        // Revisoes fornecem uma chave nova e persistida pelo executor. Clientes
        // anteriores continuam idempotentes pela chave deterministica do arquivo.
        const hasSuppliedIdempotencyKey = Object.prototype.hasOwnProperty.call(req.body || {}, 'idempotencyKey');
        const suppliedIdempotencyKey = normalizeOpsIdempotencyKey(req.body?.idempotencyKey, {
            required: hasSuppliedIdempotencyKey,
        });
        const idempotencyKey = suppliedIdempotencyKey || createOpsExportIdempotencyKey(intentPayload, companyId);
        const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken }) => {
            assertAssetsWriteScope(connection);
        const intentResponse = await opsApi(
            accessToken,
            `/v1/companies/${encodeURIComponent(companyId)}/assets/upload-intents`,
            { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(intentPayload) }
        );
        const intent = unwrapOpsData(intentResponse) || {};
        let completed = intent;
        if (!intent.deduplicated) {
            const upload = intent.upload || {};
            if (!upload.url || String(upload.method || 'PUT').toUpperCase() !== 'PUT') {
                throw httpError(502, 'ops_upload_intent_invalid', 'O Mileto Ops não preparou o envio do vídeo.');
            }
            const uploadResponse = await fetch(String(upload.url), {
                method: 'PUT',
                headers: { ...(upload.requiredHeaders || {}), 'Content-Length': String(file.size) },
                body: fs.createReadStream(file.path),
                duplex: 'half',
                redirect: 'manual',
                signal: AbortSignal.timeout(15 * 60 * 1000),
            });
            if (!uploadResponse.ok) {
                throw httpError(502, 'ops_upload_failed', 'O Mileto Ops não aceitou os bytes do vídeo.');
            }
            const completeResponse = await opsApi(accessToken, `/v1/assets/upload-intents/${encodeURIComponent(String(intent.uploadId))}/complete`, {
                method: 'POST',
                headers: { 'Idempotency-Key': idempotencyKey },
                body: JSON.stringify({ sizeBytes: file.size, checksum: { algorithm: 'sha256', value: checksum } }),
            });
            completed = unwrapOpsData(completeResponse) || {};
        }
        const assetId = String(
            completed.assetId
            || completed.id
            || completed.asset?.id
            || intent.assetId
            || intent.asset?.id
            || ''
        ).trim();
        if (!assetId) {
            throw httpError(502, 'ops_asset_id_missing', 'O Mileto Ops concluiu o envio sem devolver o assetId do vídeo.');
        }
        return {
            connection,
            payload: { ...completed, assetId, idempotencyKey, deduplicated: Boolean(intent.deduplicated) },
        };
        });
        await audit({
            req,
            connectionId: connection.id,
            action: 'ops.asset.exported',
            resourceType: 'company',
            resourceId: companyId,
            result: 'success',
            detail: { folderId, sizeBytes: file.size, sourceProjectId: intentPayload.sourceProjectId },
        });
        res.json({ ok: true, data: payload });
    } finally {
        if (file?.path) await fs.promises.unlink(file.path).catch(() => undefined);
    }
};

export const getAsset = async (req, res) => {
    const assetId = encodeURIComponent(String(req.params.assetId));
    const { payload } = await delegatedGet(req, `/v1/assets/${assetId}`);
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
};

export const getAssetUrl = async (req, res) => {
    const kind = String(req.params.kind || '');
    if (!['thumbnail', 'stream', 'download'].includes(kind)) {
        return res.status(400).json({ ok: false, message: 'Tipo de URL inválido.' });
    }
    const assetId = encodeURIComponent(String(req.params.assetId));
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken }) => ({
        connection,
        payload: await requestReadyMediaIntent(
            req,
            res,
            accessToken,
            `/v1/assets/${assetId}/${kind}-url`
        ),
    }));
    await audit({ req, connectionId: connection.id, action: `ops.asset.${kind}_url`, resourceType: 'asset', resourceId: String(req.params.assetId), result: 'success' });
    res.json({ ok: true, data: issueMediaProxy(unwrapOpsData(payload), kind), meta: payload.meta || {} });
};

const publicReference = (row) => ({
    id: row.id,
    connectionId: row.connection_id,
    accountId: row.ops_account_id,
    companyId: row.ops_company_id,
    folderId: row.ops_folder_id,
    assetId: row.ops_asset_id,
    name: row.name,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    mid: row.mid,
    version: row.version,
    checksum: row.checksum,
    opsUpdatedAt: row.ops_updated_at,
    capabilities: row.capabilities || {},
});

export const createReference = async (req, res) => {
    const assetId = String(req.body?.assetId || '').trim();
    if (!assetId) return res.status(400).json({ ok: false, message: 'Informe o ativo do Mileto Ops.' });
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken }) => ({
        connection,
        payload: await opsApi(accessToken, `/v1/assets/${encodeURIComponent(assetId)}`),
    }));
    const asset = unwrapOpsData(payload) || {};
    const companyId = String(asset.companyId || '');
    if (!companyId || !asset.id) throw httpError(502, 'ops_asset_invalid', 'O Mileto Ops devolveu um ativo inválido.');
    const row = (
        await query(
            `INSERT INTO external_media_references
             (id, org_id, connection_id, ops_account_id, ops_company_id, ops_folder_id,
              ops_asset_id, name, kind, mime_type, size_bytes, mid, version, checksum,
              ops_updated_at, capabilities, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (org_id, connection_id, ops_asset_id) DO UPDATE SET
                ops_company_id = EXCLUDED.ops_company_id,
                ops_folder_id = EXCLUDED.ops_folder_id,
                name = EXCLUDED.name, kind = EXCLUDED.kind,
                mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes,
                mid = EXCLUDED.mid, version = EXCLUDED.version, checksum = EXCLUDED.checksum,
                ops_updated_at = EXCLUDED.ops_updated_at,
                capabilities = EXCLUDED.capabilities, updated_at = now()
             RETURNING *`,
            [
                newId(),
                req.user.orgId,
                connection.id,
                connection.ops_account_id,
                companyId,
                asset.folderId || null,
                String(asset.id),
                String(asset.name || 'Mídia do Mileto Ops'),
                String(asset.kind || 'video'),
                asset.mimeType || null,
                asset.sizeBytes ?? null,
                asset.mid || null,
                asset.version || null,
                asset.checksum || null,
                asset.updatedAt || null,
                asset.capabilities || {},
                req.user.id,
            ]
        )
    ).rows[0];
    await audit({ req, connectionId: connection.id, action: 'ops.reference.created', resourceType: 'asset', resourceId: assetId, result: 'success' });
    res.status(201).json({ ok: true, reference: publicReference(row) });
};

const referenceForUser = async (req) => {
    const row = (
        await query(
            `SELECT r.* FROM external_media_references r
             WHERE r.id = $1 AND r.org_id = $2`,
            [String(req.params.referenceId), req.user.orgId]
        )
    ).rows[0];
    if (!row) throw httpError(404, 'ops_reference_not_found', 'Referência de mídia não encontrada.');
    return row;
};

export const getReference = async (req, res) => {
    const row = await referenceForUser(req);
    res.json({ ok: true, reference: publicReference(row) });
};

export const getReferenceDownload = async (req, res) => {
    const row = await referenceForUser(req);
    const { connection, payload } = await withDelegatedAccess(req, async ({ connection, accessToken }) => {
        if (connection.id !== row.connection_id) {
            throw httpError(409, 'ops_reference_stale', 'Esta referência pertence a outra conexão.');
        }
        return {
            connection,
            payload: await requestReadyMediaIntent(
                req,
                res,
                accessToken,
                `/v1/assets/${encodeURIComponent(row.ops_asset_id)}/download-url`,
                { purpose: 'ai_video_local_cache' }
            ),
        };
    });
    await audit({ req, connectionId: connection.id, action: 'ops.reference.download', resourceType: 'asset', resourceId: row.ops_asset_id, result: 'success' });
    res.json({ ok: true, reference: publicReference(row), download: unwrapOpsData(payload), meta: payload.meta || {} });
};

export const purgeExpiredAttempts = async () => {
    await query(`DELETE FROM ops_authorization_attempts WHERE expires_at < now() - interval '1 day'`);
};
