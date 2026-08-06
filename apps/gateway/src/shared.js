import { randomUUID } from 'node:crypto';
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';
import { pool, query } from './db.js';

const CATEGORIES = ['Imagens', 'Músicas', 'Vídeos', 'Geração por IA'];
const TRASH_DAYS = 30;

const s3 = config.r2.enabled
    ? new S3Client({
          region: 'auto',
          endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
          credentials: {
              accessKeyId: config.r2.accessKeyId,
              secretAccessKey: config.r2.secretAccessKey,
          },
      })
    : null;

const requireR2 = () => {
    if (!s3) {
        const error = new Error('O Compartilhado aguarda a configuração do Cloudflare R2 pelo administrador.');
        error.status = 503;
        error.code = 'shared_storage_not_configured';
        error.details = { missing: config.r2.missing };
        throw error;
    }
    return s3;
};

const orgIdOf = (req) => {
    const orgId = Number(req.user?.orgId);
    if (!Number.isFinite(orgId) || orgId <= 0) {
        const error = new Error('Esta conta não pertence a uma organização.');
        error.status = 403;
        throw error;
    }
    return orgId;
};

const cleanName = (value) => {
    const name = String(value || '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
        .trim()
        .slice(0, 180);
    if (!name || name === '.' || name === '..') {
        const error = new Error('Nome inválido.');
        error.status = 400;
        throw error;
    }
    return name;
};

const cleanPath = (value, { allowRoot = true } = {}) => {
    const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!raw && allowRoot) return '';
    const segments = raw.split('/').filter(Boolean).map(cleanName);
    if (!segments.length && !allowRoot) {
        const error = new Error('Escolha uma pasta de destino.');
        error.status = 400;
        throw error;
    }
    if (segments.length && !CATEGORIES.includes(segments[0])) {
        const error = new Error('O caminho deve começar por Imagens, Músicas, Vídeos ou Geração por IA.');
        error.status = 400;
        throw error;
    }
    return segments.join('/');
};

const mediaType = (category, mimeType = '', name = '') => {
    if (category === 'Músicas') return 'audio';
    if (category === 'Imagens') return 'image';
    if (category === 'Vídeos') return 'video';
    const mime = String(mimeType).toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    const ext = String(name).toLowerCase().split('.').pop();
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
    return 'video';
};
const categoryFromPath = (parentPath, fallback) => parentPath.split('/')[0] || fallback;
const prefixFor = (type) => (type === 'video' ? 'VID' : type === 'audio' ? 'AUD' : 'IMG');

const signedDownload = (objectKey) =>
    getSignedUrl(requireR2(), new GetObjectCommand({ Bucket: config.r2.bucket, Key: objectKey }), {
        expiresIn: config.r2.downloadUrlTtl,
    });

const mapItem = async (row) => ({
    id: row.id,
    category: row.category,
    name: row.name,
    relPath: [row.parent_path, row.name].filter(Boolean).join('/'),
    publicUrl: await signedDownload(row.object_key),
    filePath: '',
    type: row.media_type,
    durationSec: row.duration_sec == null ? undefined : Number(row.duration_sec),
    createdAt: row.created_at,
    size: Number(row.size_bytes),
    assetCode: row.asset_code,
    sha256: row.sha256,
    scope: 'shared',
    trashedAt: row.trashed_at,
    purgeAfter: row.purge_after,
    visibility: row.visibility,
});

const itemSelect = `
    SELECT i.*, b.sha256, b.size_bytes, b.mime_type, b.object_key, b.asset_code
      FROM media_items i
      JOIN media_blobs b ON b.id = i.blob_id`;

const createItem = async (client, { orgId, userId, blobId, parentPath, category, name, durationSec, mediaType: itemMediaType, visibility = 'library' }) => {
    const id = randomUUID();
    const result = await client.query(
        `INSERT INTO media_items
             (id, org_id, blob_id, parent_path, category, name, media_type, duration_sec, created_by, visibility, purge_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                 CASE WHEN $10 = 'project' THEN now() + interval '1 day' ELSE NULL END)
         RETURNING *`,
        [id, orgId, blobId, parentPath, category, name, itemMediaType || mediaType(category, '', name), durationSec ?? null, userId, visibility]
    );
    return result.rows[0];
};

export const storageStatus = async (req, res) => {
    orgIdOf(req);
    res.json({
        ok: true,
        configured: Boolean(config.r2.enabled),
        provider: 'cloudflare-r2',
        missing: config.r2.missing,
        trashDays: TRASH_DAYS,
    });
};

export const tree = async (req, res) => {
    const orgId = orgIdOf(req);
    const folders = (
        await query('SELECT path, parent_path, name FROM shared_folders WHERE org_id = $1 ORDER BY path', [orgId])
    ).rows;
    const root = { name: 'Arquivos', relPath: '/', isCategory: false, children: [] };
    const nodes = new Map([['', root]]);
    for (const category of CATEGORIES) {
        const node = { name: category, relPath: category, isCategory: true, children: [] };
        root.children.push(node);
        nodes.set(category, node);
    }
    for (const folder of folders) {
        const node = { name: folder.name, relPath: folder.path, isCategory: false, children: [] };
        nodes.set(folder.path, node);
        (nodes.get(folder.parent_path) || root).children.push(node);
    }
    res.json({ ok: true, root });
};

export const list = async (req, res) => {
    const orgId = orgIdOf(req);
    const parentPath = cleanPath(req.query.path || '');
    const [folderRows, fileRows] = await Promise.all([
        query('SELECT name, path AS "relPath" FROM shared_folders WHERE org_id = $1 AND parent_path = $2 ORDER BY name', [
            orgId,
            parentPath,
        ]),
        query(`${itemSelect} WHERE i.org_id = $1 AND i.parent_path = $2 AND i.trashed_at IS NULL AND i.visibility = 'library' ORDER BY i.created_at DESC`, [
            orgId,
            parentPath,
        ]),
    ]);
    const files = await Promise.all(fileRows.rows.map(mapItem));
    const folders = parentPath
        ? folderRows.rows
        : CATEGORIES.map((name) => ({ name, relPath: name }));
    res.json({ ok: true, folders, files });
};

export const trash = async (req, res) => {
    const orgId = orgIdOf(req);
    const rows = (
        await query(`${itemSelect} WHERE i.org_id = $1 AND i.trashed_at IS NOT NULL AND i.visibility = 'library' ORDER BY i.trashed_at DESC`, [orgId])
    ).rows;
    res.json({ ok: true, files: await Promise.all(rows.map(mapItem)) });
};

export const createFolder = async (req, res) => {
    const orgId = orgIdOf(req);
    const parentPath = cleanPath(req.body.parent || '', { allowRoot: false });
    const name = cleanName(req.body.name);
    const path = `${parentPath}/${name}`;
    try {
        await query(
            `INSERT INTO shared_folders (id, org_id, path, parent_path, name, created_by)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [randomUUID(), orgId, path, parentPath, name, req.user.id]
        );
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ ok: false, message: 'Já existe uma pasta com esse nome.' });
        }
        throw error;
    }
    res.json({ ok: true, relPath: path });
};

export const prepareUpload = async (req, res) => {
    const orgId = orgIdOf(req);
    const sha256 = String(req.body.sha256 || '').toLowerCase();
    const size = Number(req.body.size);
    const mimeType = String(req.body.mimeType || 'application/octet-stream').slice(0, 120);
    const parentPath = cleanPath(req.body.parentPath || '', { allowRoot: false });
    const category = categoryFromPath(parentPath, 'Vídeos');
    const name = cleanName(req.body.name);
    const durationSec = req.body.durationSec == null ? null : Number(req.body.durationSec);
    const visibility = req.body.visibility === 'project' ? 'project' : 'library';
    if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size <= 0) {
        return res.status(400).json({ ok: false, message: 'Hash ou tamanho do arquivo inválido.' });
    }

    const existing = (
        await query('SELECT * FROM media_blobs WHERE org_id = $1 AND sha256 = $2 AND size_bytes = $3', [
            orgId,
            sha256,
            size,
        ])
    ).rows[0];
    if (existing) {
        const client = await pool.connect();
        try {
            const item = await createItem(client, {
                orgId,
                userId: req.user.id,
                blobId: existing.id,
                parentPath,
                category,
                name,
                durationSec,
                mediaType: mediaType(category, mimeType, name),
                visibility,
            });
            return res.json({
                ok: true,
                deduplicated: true,
                item: await mapItem({ ...existing, ...item }),
            });
        } finally {
            client.release();
        }
    }

    const objectKey = `org/${orgId}/blobs/${sha256}-${size}`;
    const command = new PutObjectCommand({
        Bucket: config.r2.bucket,
        Key: objectKey,
        ContentType: mimeType,
        ContentLength: size,
        Metadata: { sha256 },
    });
    const uploadUrl = await getSignedUrl(requireR2(), command, {
        expiresIn: 900,
        // O R2 precisa receber o metadado exatamente uma vez como header
        // assinado. Se ele for movido para a query, o objeto chega sem o
        // checksum disponível no HeadObject e a conclusão rejeita o arquivo.
        unhoistableHeaders: new Set(['x-amz-meta-sha256']),
    });
    res.json({
        ok: true,
        deduplicated: false,
        uploadUrl,
        uploadHeaders: {
            'Content-Type': mimeType,
            'x-amz-meta-sha256': sha256,
        },
        objectKey,
    });
};

export const completeUpload = async (req, res) => {
    const orgId = orgIdOf(req);
    const sha256 = String(req.body.sha256 || '').toLowerCase();
    const size = Number(req.body.size);
    const mimeType = String(req.body.mimeType || 'application/octet-stream').slice(0, 120);
    const parentPath = cleanPath(req.body.parentPath || '', { allowRoot: false });
    const category = categoryFromPath(parentPath, 'Vídeos');
    const name = cleanName(req.body.name);
    const durationSec = req.body.durationSec == null ? null : Number(req.body.durationSec);
    const visibility = req.body.visibility === 'project' ? 'project' : 'library';
    if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size <= 0) {
        return res.status(400).json({ ok: false, message: 'Upload inválido.' });
    }
    const objectKey = `org/${orgId}/blobs/${sha256}-${size}`;
    const head = await requireR2().send(new HeadObjectCommand({ Bucket: config.r2.bucket, Key: objectKey }));
    if (Number(head.ContentLength) !== size) {
        return res.status(409).json({
            ok: false,
            code: 'upload_size_mismatch',
            message: 'O tamanho do arquivo recebido não corresponde ao upload preparado.',
        });
    }
    if (head.Metadata?.sha256 !== sha256) {
        return res.status(409).json({
            ok: false,
            code: 'upload_checksum_mismatch',
            message: 'O checksum SHA-256 do arquivo recebido não corresponde ao upload preparado.',
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // O lock da organização serializa uploads iguais e a sequência do código.
        const org = (
            await client.query('SELECT next_asset_number FROM organizations WHERE id = $1 FOR UPDATE', [orgId])
        ).rows[0];
        let blob = (
            await client.query('SELECT * FROM media_blobs WHERE org_id = $1 AND sha256 = $2 AND size_bytes = $3', [
                orgId,
                sha256,
                size,
            ])
        ).rows[0];
        const deduplicated = Boolean(blob);
        if (!blob) {
            const code = `${prefixFor(mediaType(category, mimeType, name))}-${String(org.next_asset_number).padStart(6, '0')}`;
            await client.query('UPDATE organizations SET next_asset_number = next_asset_number + 1 WHERE id = $1', [orgId]);
            blob = (
                await client.query(
                    `INSERT INTO media_blobs (id, org_id, sha256, size_bytes, mime_type, object_key, asset_code)
                     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                    [randomUUID(), orgId, sha256, size, mimeType, objectKey, code]
                )
            ).rows[0];
        }
        const item = await createItem(client, {
            orgId,
            userId: req.user.id,
            blobId: blob.id,
            parentPath,
            category,
            name,
            durationSec,
            mediaType: mediaType(category, mimeType, name),
            visibility,
        });
        await client.query('COMMIT');
        res.json({ ok: true, deduplicated, item: await mapItem({ ...blob, ...item }) });
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const getLiveItem = async (orgId, id) =>
    (await query(`${itemSelect} WHERE i.org_id = $1 AND i.id = $2 AND i.trashed_at IS NULL`, [orgId, id])).rows[0];

const getAccessibleItem = async (orgId, id) =>
    (
        await query(
            `${itemSelect}
              WHERE i.org_id = $1 AND i.id = $2
                AND (i.trashed_at IS NULL OR EXISTS (
                    SELECT 1 FROM shared_draft_assets da WHERE da.asset_item_id = i.id
                ))`,
            [orgId, id]
        )
    ).rows[0];

export const getItem = async (req, res) => {
    const row = await getAccessibleItem(orgIdOf(req), req.params.assetId);
    if (!row) return res.status(404).json({ ok: false, message: 'Item não encontrado.' });
    res.json({ ok: true, item: await mapItem(row) });
};

export const renameItem = async (req, res) => {
    const orgId = orgIdOf(req);
    const result = await query(
        `UPDATE media_items SET name = $3 WHERE org_id = $1 AND id = $2 AND trashed_at IS NULL RETURNING id`,
        [orgId, req.body.id, cleanName(req.body.name)]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, message: 'Item não encontrado.' });
    res.json({ ok: true });
};

export const moveItem = async (req, res) => {
    const orgId = orgIdOf(req);
    const parentPath = cleanPath(req.body.destPath || '', { allowRoot: false });
    const category = categoryFromPath(parentPath, 'Imagens');
    const result = await query(
        `UPDATE media_items SET parent_path = $3, category = $4
         WHERE org_id = $1 AND id = $2 AND trashed_at IS NULL RETURNING id`,
        [orgId, req.body.id, parentPath, category]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, message: 'Item não encontrado.' });
    res.json({ ok: true });
};

export const copyItem = async (req, res) => {
    const orgId = orgIdOf(req);
    const source = await getLiveItem(orgId, req.body.id);
    if (!source) return res.status(404).json({ ok: false, message: 'Item não encontrado.' });
    const parentPath = cleanPath(req.body.destPath || '', { allowRoot: false });
    const category = categoryFromPath(parentPath, source.category);
    const client = await pool.connect();
    try {
        const item = await createItem(client, {
            orgId,
            userId: req.user.id,
            blobId: source.blob_id,
            parentPath,
            category,
            name: source.name,
            durationSec: source.duration_sec,
            mediaType: source.media_type,
        });
        res.json({ ok: true, item: await mapItem({ ...source, ...item }) });
    } finally {
        client.release();
    }
};

export const trashItem = async (req, res) => {
    const orgId = orgIdOf(req);
    const result = await query(
        `UPDATE media_items
            SET trashed_at = now(), purge_after = now() + interval '${TRASH_DAYS} days'
          WHERE org_id = $1 AND id = $2 AND trashed_at IS NULL RETURNING id`,
        [orgId, req.params.assetId]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, message: 'Item não encontrado.' });
    res.json({ ok: true, trashDays: TRASH_DAYS });
};

export const restoreItem = async (req, res) => {
    const orgId = orgIdOf(req);
    const result = await query(
        `UPDATE media_items SET trashed_at = NULL, purge_after = NULL
         WHERE org_id = $1 AND id = $2 AND trashed_at IS NOT NULL RETURNING id`,
        [orgId, req.params.assetId]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, message: 'Item não encontrado na lixeira.' });
    res.json({ ok: true });
};

export const purgeExpired = async () => {
    if (!s3) return;
    await query('DELETE FROM shared_drafts WHERE purge_after <= now()');
    await query(
        `UPDATE media_items i
            SET purge_after = now()
          WHERE i.visibility = 'project'
            AND i.purge_after IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM shared_draft_assets da WHERE da.asset_item_id = i.id
            )`
    );
    const expired = (
        await query(
            `DELETE FROM media_items i
              WHERE i.purge_after <= now()
                AND NOT EXISTS (
                    SELECT 1 FROM shared_draft_assets da WHERE da.asset_item_id = i.id
                )
              RETURNING blob_id`
        )
    ).rows;
    const blobIds = [...new Set(expired.map((row) => row.blob_id))];
    for (const blobId of blobIds) {
        const blob = (
            await query(
                `SELECT b.* FROM media_blobs b
                 WHERE b.id = $1 AND NOT EXISTS (SELECT 1 FROM media_items i WHERE i.blob_id = b.id)`,
                [blobId]
            )
        ).rows[0];
        if (!blob) continue;
        await s3.send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: blob.object_key }));
        await query('DELETE FROM media_blobs WHERE id = $1', [blob.id]);
    }
};

export const listDrafts = async (req, res) => {
    const orgId = orgIdOf(req);
    const rows = (
        await query(
            `SELECT d.id, d.title, d.updated_at AS "updatedAt", d.created_at AS "createdAt",
                    d.created_by AS "createdBy", u.name AS "authorName", u.email AS "authorEmail"
               FROM shared_drafts d LEFT JOIN users u ON u.id = d.updated_by
              WHERE d.org_id = $1 AND d.trashed_at IS NULL ORDER BY d.updated_at DESC`,
            [orgId]
        )
    ).rows;
    res.json({ ok: true, drafts: rows });
};

export const getDraft = async (req, res) => {
    const orgId = orgIdOf(req);
    const row = (
        await query('SELECT id, title, data, updated_at AS "updatedAt" FROM shared_drafts WHERE org_id = $1 AND id = $2 AND trashed_at IS NULL', [
            orgId,
            req.params.draftId,
        ])
    ).rows[0];
    if (!row) return res.status(404).json({ ok: false, message: 'Rascunho não encontrado.' });
    res.json({ ok: true, data: { ...row.data, title: row.title, updatedAt: row.updatedAt } });
};

export const saveDraft = async (req, res) => {
    const orgId = orgIdOf(req);
    const title = cleanName(req.body.title || req.body.data?.title || 'Rascunho sem título');
    const data = req.body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({ ok: false, message: 'Conteúdo do rascunho inválido.' });
    }
    const referencedIds = new Set();
    for (const take of Array.isArray(data.mediaTakes) ? data.mediaTakes : []) {
        if (take?.sharedAssetId) referencedIds.add(String(take.sharedAssetId));
    }
    for (const key of ['sharedNarrationAssetId', 'sharedMusicAssetId', 'sharedMasterAssetId']) {
        if (data.adData?.[key]) referencedIds.add(String(data.adData[key]));
    }
    const assetIds = [...referencedIds].filter((id) => /^[0-9a-f-]{36}$/i.test(id));

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO shared_drafts (id, org_id, title, data, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$5)
             ON CONFLICT (org_id, id) DO UPDATE
                 SET title = EXCLUDED.title, data = EXCLUDED.data, updated_by = EXCLUDED.updated_by,
                     updated_at = now(), trashed_at = NULL, purge_after = NULL`,
            [req.params.draftId, orgId, title, JSON.stringify(data), req.user.id]
        );
        await client.query('DELETE FROM shared_draft_assets WHERE draft_id = $1 AND org_id = $2', [req.params.draftId, orgId]);
        if (assetIds.length) {
            await client.query(
                `INSERT INTO shared_draft_assets (draft_id, asset_item_id, org_id)
                 SELECT $1, i.id, $2 FROM media_items i
                  WHERE i.org_id = $2 AND i.id = ANY($3::uuid[])`,
                [req.params.draftId, orgId, assetIds]
            );
            await client.query(
                `UPDATE media_items i
                    SET purge_after = NULL
                  WHERE i.org_id = $1
                    AND i.visibility = 'project'
                    AND i.id = ANY($2::uuid[])`,
                [orgId, assetIds]
            );
        }
        await client.query(
            `UPDATE media_items i
                SET purge_after = COALESCE(i.purge_after, now())
              WHERE i.org_id = $1
                AND i.visibility = 'project'
                AND NOT EXISTS (
                    SELECT 1 FROM shared_draft_assets da WHERE da.asset_item_id = i.id
                )`,
            [orgId]
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    res.json({ ok: true, id: req.params.draftId, title });
};

export const trashDraft = async (req, res) => {
    const orgId = orgIdOf(req);
    const draftId = String(req.params.draftId || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)) {
        return res.status(400).json({ ok: false, message: 'Identificador do rascunho inválido.' });
    }
    const result = await query(
        `UPDATE shared_drafts
            SET trashed_at = CURRENT_TIMESTAMP,
                purge_after = CURRENT_TIMESTAMP + ($3::integer * INTERVAL '1 day'),
                updated_at = CURRENT_TIMESTAMP
          WHERE org_id = $1::bigint AND id = $2::uuid AND trashed_at IS NULL RETURNING id`,
        [orgId, draftId, TRASH_DAYS]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, message: 'Rascunho não encontrado.' });
    res.json({ ok: true, trashDays: TRASH_DAYS });
};
