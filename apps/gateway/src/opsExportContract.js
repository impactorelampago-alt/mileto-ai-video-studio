import crypto from 'node:crypto';

const LIMITS = Object.freeze({
    title: 200,
    description: 2_000,
    narrationSummary: 4_000,
    sourceProjectId: 200,
    sourceProjectTitle: 200,
});

export const compactOpsExportText = (value) => String(value ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const contractError = (message) => {
    const error = new Error(message);
    error.status = 422;
    error.code = 'ops_export_metadata_invalid';
    return error;
};

const normalizedField = (field, value, { required = false } = {}) => {
    const normalized = compactOpsExportText(value);
    if (required && !normalized) throw contractError(`${field} é obrigatório para exportar ao Mileto Ops.`);
    if (normalized.length > LIMITS[field]) {
        throw contractError(`${field} excede o limite de ${LIMITS[field]} caracteres do Mileto Ops.`);
    }
    return normalized;
};

export const normalizeOpsExportMetadata = (value = {}) => ({
    title: normalizedField('title', value.title, { required: true }),
    description: normalizedField('description', value.description, { required: true }),
    // O Ops aceita o resumo completo como nulo/ausente, mas rejeita string
    // vazia. Normalizamos para null para manter um payload canônico.
    narrationSummary: normalizedField('narrationSummary', value.narrationSummary) || null,
    sourceProjectId: normalizedField('sourceProjectId', value.sourceProjectId, { required: true }),
    sourceProjectTitle: normalizedField('sourceProjectTitle', value.sourceProjectTitle, { required: true }),
});

export const buildOpsUploadIntentPayload = ({
    folderId,
    fileName,
    sizeBytes,
    checksum,
    metadata,
}) => {
    const normalizedMetadata = normalizeOpsExportMetadata(metadata);
    const rawFileName = compactOpsExportText(fileName);
    if (!rawFileName) throw contractError('fileName é obrigatório para exportar ao Mileto Ops.');
    // O Ops valida o nome junto com o MIME. Preserve a extensão ao aplicar o
    // limite para que um nome técnico longo continue sendo um MP4 válido.
    const fileStem = rawFileName.replace(/\.mp4$/i, '').trim().slice(0, 176).trim() || 'video';
    const normalizedFileName = `${fileStem}.mp4`;
    if (!Number.isSafeInteger(Number(sizeBytes)) || Number(sizeBytes) <= 0) {
        throw contractError('sizeBytes é inválido para exportar ao Mileto Ops.');
    }
    if (!/^[a-f0-9]{64}$/i.test(String(checksum || ''))) {
        throw contractError('O checksum SHA-256 do vídeo é inválido.');
    }

    return {
        folderId: compactOpsExportText(folderId) || null,
        fileName: normalizedFileName,
        mimeType: 'video/mp4',
        sizeBytes: Number(sizeBytes),
        checksum: { algorithm: 'sha256', value: String(checksum).toLowerCase() },
        origin: 'mileto_ai_video',
        ...normalizedMetadata,
    };
};

/**
 * O hash cobre o contrato editorial e binário completo. Assim, repetir o mesmo
 * envio é idempotente, enquanto qualquer revisão cria uma chave nova.
 */
export const createOpsExportIdempotencyKey = (intentPayload, companyId = '') => {
    const canonical = JSON.stringify({
        companyId: compactOpsExportText(companyId),
        folderId: intentPayload.folderId ?? null,
        fileName: intentPayload.fileName,
        mimeType: intentPayload.mimeType,
        sizeBytes: intentPayload.sizeBytes,
        checksum: intentPayload.checksum,
        origin: intentPayload.origin,
        title: intentPayload.title,
        description: intentPayload.description,
        narrationSummary: intentPayload.narrationSummary,
        sourceProjectId: intentPayload.sourceProjectId,
        sourceProjectTitle: intentPayload.sourceProjectTitle,
    });
    const digest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    // O Ops valida Idempotency-Key como UUID. A chave continua determinística:
    // o mesmo arquivo, pasta e metadados gera o mesmo UUID.
    const hex = `${digest.slice(0, 12)}5${digest.slice(13, 16)}${((parseInt(digest[16], 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 32)}`;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
