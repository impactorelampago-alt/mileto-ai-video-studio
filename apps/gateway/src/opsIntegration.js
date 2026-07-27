import crypto from 'node:crypto';
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

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const b64u = (buffer) => Buffer.from(buffer).toString('base64url');
const pkceChallenge = (verifier) => b64u(crypto.createHash('sha256').update(String(verifier)).digest());
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const fingerprint = (value) => (normalizeEmail(value) ? sha256(normalizeEmail(value)) : null);
const safeLimit = (value, fallback = 50) => Math.min(100, Math.max(1, Number(value) || fallback));

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

const connectionRow = async (orgId, includeRevoked = false) => {
    const clause = includeRevoked ? '' : "AND status = 'active'";
    return (
        await query(
            `SELECT * FROM ops_connections WHERE org_id = $1 ${clause} ORDER BY updated_at DESC LIMIT 1`,
            [orgId]
        )
    ).rows[0];
};

const publicConnection = (row) =>
    row
        ? {
              id: row.id,
              status: row.status,
              accountId: row.ops_account_id,
              accountName: row.ops_account_name,
              scopes: row.scopes || [],
              connectedAt: row.connected_at,
              revokedAt: row.revoked_at,
              lastError: row.last_error || null,
          }
        : null;

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
        if (!refreshToken) throw httpError(401, 'ops_reconnect_required', 'Reconecte sua conta Mileto Ops.');
        let tokens;
        try {
            tokens = await refreshAccessToken(refreshToken);
        } catch (error) {
            await query(
                `UPDATE ops_connections SET status = 'error', last_error = $2, updated_at = now() WHERE id = $1`,
                [connection.id, error.code || 'refresh_failed']
            );
            throw error;
        }
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
        const nextRefresh = tokens.refreshToken || refreshToken;
        await query(
            `UPDATE ops_connections
             SET access_token_enc = $2, access_token_expires_at = $3, refresh_token_enc = $4,
                 scopes = $5, status = 'active', last_error = NULL, updated_at = now()
             WHERE id = $1`,
            [
                connection.id,
                encryptOpsToken(tokens.accessToken),
                expiresAt,
                encryptOpsToken(nextRefresh),
                tokens.scopes.length ? tokens.scopes : connection.scopes || config.ops.scopes,
            ]
        );
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
    const connection = await connectionRow(orgId);
    if (!connection) throw httpError(409, 'ops_not_connected', 'Conecte sua conta ao Mileto Ops primeiro.');
    return { connection, accessToken: await connectionAccessToken(connection) };
};

const delegationCache = new Map();

const delegatedAccess = async (orgId, aiUserId) => {
    const { connection, accessToken } = await activeConnectionWithToken(orgId);
    const link = (
        await query(
            `SELECT * FROM ops_user_links
             WHERE connection_id = $1 AND ai_user_id = $2 AND org_id = $3 AND status = 'confirmed'`,
            [connection.id, aiUserId, orgId]
        )
    ).rows[0];
    if (!link) throw httpError(403, 'ops_user_not_linked', 'Seu usuário ainda não foi vinculado ao Mileto Ops.');

    const cacheKey = `${connection.id}:${aiUserId}`;
    const cached = delegationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 30_000) {
        return { connection, link, accessToken: cached.token };
    }

    const response = await opsApi(accessToken, '/v1/delegations', {
        method: 'POST',
        body: JSON.stringify({ aiVideoUserId: String(aiUserId) }),
    });
    const data = unwrapOpsData(response) || {};
    const token = data.accessToken || data.access_token;
    if (!token) throw httpError(502, 'ops_delegation_invalid', 'O Mileto Ops não devolveu uma delegação válida.');
    const expiresAt = data.expiresAt
        ? new Date(data.expiresAt).getTime()
        : Date.now() + Math.max(30, Number(data.expiresIn || data.expires_in || 300)) * 1000;
    delegationCache.set(cacheKey, { token, expiresAt });
    return { connection, link, accessToken: token };
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

const escapeHtml = (value) =>
    String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

export const integrationStatus = async (req, res) => {
    const connection = req.user.orgId ? await connectionRow(req.user.orgId, true) : null;
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
    if (current?.status === 'active') {
        return res.status(409).json({ ok: false, code: 'ops_already_connected', message: 'A conta já está conectada.' });
    }

    const state = b64u(crypto.randomBytes(32));
    const verifier = b64u(crypto.randomBytes(48));
    const challenge = pkceChallenge(verifier);
    const attemptId = newId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const returnTo = typeof req.body?.returnTo === 'string' ? req.body.returnTo.slice(0, 500) : null;
    await query(
        `INSERT INTO ops_authorization_attempts
         (id, org_id, created_by, state_hash, code_verifier_enc, return_to, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [attemptId, req.user.orgId, req.user.id, sha256(state), encryptOpsToken(verifier), returnTo, expiresAt]
    );

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

    await audit({ req, action: 'ops.connection.started', result: 'success', detail: { attemptId } });
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

    try {
        const verifier = decryptOpsToken(attempt.code_verifier_enc);
        const tokens = await exchangeAuthorizationCode(code, verifier);
        const accountPayload = await opsApi(tokens.accessToken, '/v1/account');
        const account = unwrapOpsData(accountPayload) || {};
        const accountId = String(account.id || account.accountId || '');
        if (!accountId) throw new OpsHttpError(502, 'ops_account_invalid', 'O Mileto Ops não informou a conta conectada.');
        if (!tokens.refreshToken) {
            await revokeToken(tokens.accessToken);
            throw new OpsHttpError(502, 'ops_refresh_missing', 'O Mileto Ops não devolveu refresh token rotativo.');
        }
        const previous = await connectionRow(attempt.org_id, true);
        if (previous?.ops_account_id && String(previous.ops_account_id) !== accountId) {
            await Promise.all([revokeToken(tokens.accessToken), revokeToken(tokens.refreshToken)]);
            throw new OpsHttpError(
                409,
                'ops_account_mismatch',
                'Esta organização já foi vinculada a outra conta do Mileto Ops. Solicite revisão manual.'
            );
        }

        const connectionId = newId();
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
        const scopes = tokens.scopes.length ? tokens.scopes : config.ops.scopes;
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
            [newId(), attempt.org_id, persistedId, attempt.created_by, { accountId }]
        );
        res.type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Mileto Ops conectado</title><body style="font-family:system-ui;background:#08110f;color:#fff;display:grid;place-items:center;min-height:100vh"><main style="max-width:540px;padding:32px;text-align:center"><h1 style="color:#25e18a">Conta conectada</h1><p>${escapeHtml(account.name || 'Mileto Ops')} foi conectada ao Mileto AI Video.</p><p>Você já pode fechar esta janela e voltar ao aplicativo.</p></main></body></html>`);
    } catch (error) {
        await query(
            `INSERT INTO ops_audit_events
             (id, org_id, actor_user_id, action, result, detail)
             VALUES ($1,$2,$3,'ops.connection.completed','failure',$4)`,
            [newId(), attempt.org_id, attempt.created_by, { code: error.code || 'callback_failed' }]
        ).catch(() => undefined);
        const status = Number(error.status) || 502;
        res.status(status).type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Falha na conexão</title><body style="font-family:system-ui;background:#120909;color:#fff;display:grid;place-items:center;min-height:100vh"><main style="max-width:540px;padding:32px;text-align:center"><h1 style="color:#ff6b6b">Não foi possível conectar</h1><p>${escapeHtml(error.message || 'Falha na autenticação do Mileto Ops.')}</p><p>Volte ao Mileto AI Video e tente novamente.</p></main></body></html>`);
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
        const response = await opsApi(accessToken, opsPathWithQuery('/v1/users', { cursor, limit: 100 }));
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
            const emailFingerprint = String(
                opsUser.emailFingerprint || fingerprint(opsUser.normalizedEmail || opsUser.email) || ''
            ).toLowerCase();
            const candidates = emailFingerprint ? aiByHash.get(emailFingerprint) || [] : [];
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
                emailFingerprint: emailFingerprint || null,
            });
        }

        for (const aiUser of aiUsers.rows) {
            if (linkedAi.has(String(aiUser.id)) || matchedAi.has(String(aiUser.id))) continue;
            const hash = fingerprint(aiUser.email);
            const existsInOps = opsUsers.some(
                (opsUser) => String(opsUser.emailFingerprint || fingerprint(opsUser.normalizedEmail || opsUser.email) || '') === hash
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
        delegationCache.delete(`${connection.id}:${aiUserId}`);
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
    delegationCache.delete(`${connection.id}:${aiUserId}`);
    await audit({ req, connectionId: connection.id, action: 'ops.user_link.removed', resourceType: 'user', resourceId: String(aiUserId), result: 'success' });
    res.json({ ok: true });
};

const delegatedGet = async (req, path) => {
    const { connection, accessToken } = await delegatedAccess(req.user.orgId, req.user.id);
    const payload = await opsApi(accessToken, path);
    return { connection, payload };
};

export const listCompanies = async (req, res) => {
    const { payload } = await delegatedGet(
        req,
        opsPathWithQuery('/v1/me/companies', { cursor: req.query.cursor, limit: safeLimit(req.query.limit), q: req.query.q })
    );
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
};

export const listFolders = async (req, res) => {
    const companyId = encodeURIComponent(String(req.params.companyId));
    const { payload } = await delegatedGet(req, `/v1/companies/${companyId}/folders`);
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
};

export const listAssets = async (req, res) => {
    const companyId = encodeURIComponent(String(req.params.companyId));
    const path = opsPathWithQuery(`/v1/companies/${companyId}/assets`, {
        folderId: req.query.folderId,
        cursor: req.query.cursor,
        limit: safeLimit(req.query.limit),
        q: req.query.q,
    });
    const { payload } = await delegatedGet(req, path);
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
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
    const { connection, accessToken } = await delegatedAccess(req.user.orgId, req.user.id);
    const payload = await requestReadyMediaIntent(
        req,
        res,
        accessToken,
        `/v1/assets/${assetId}/${kind}-url`
    );
    await audit({ req, connectionId: connection.id, action: `ops.asset.${kind}_url`, resourceType: 'asset', resourceId: String(req.params.assetId), result: 'success' });
    res.json({ ok: true, data: unwrapOpsData(payload), meta: payload.meta || {} });
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
    const { connection, accessToken } = await delegatedAccess(req.user.orgId, req.user.id);
    const payload = await opsApi(accessToken, `/v1/assets/${encodeURIComponent(assetId)}`);
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
    const { connection, accessToken } = await delegatedAccess(req.user.orgId, req.user.id);
    if (connection.id !== row.connection_id) throw httpError(409, 'ops_reference_stale', 'Esta referência pertence a outra conexão.');
    const payload = await requestReadyMediaIntent(
        req,
        res,
        accessToken,
        `/v1/assets/${encodeURIComponent(row.ops_asset_id)}/download-url`,
        { purpose: 'ai_video_local_cache' }
    );
    await audit({ req, connectionId: connection.id, action: 'ops.reference.download', resourceType: 'asset', resourceId: row.ops_asset_id, result: 'success' });
    res.json({ ok: true, reference: publicReference(row), download: unwrapOpsData(payload), meta: payload.meta || {} });
};

export const purgeExpiredAttempts = async () => {
    await query(`DELETE FROM ops_authorization_attempts WHERE expires_at < now() - interval '1 day'`);
};
