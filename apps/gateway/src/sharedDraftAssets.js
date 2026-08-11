const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeAssetId = (value) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return UUID_PATTERN.test(normalized) ? normalized : null;
};

/**
 * Retorna somente IDs estaveis de itens compartilhados usados pelo rascunho.
 * A tabela shared_draft_assets usa esta lista para impedir que o purge remova
 * midias que ainda participam do projeto, inclusive transicoes.
 */
export const collectSharedDraftAssetIds = (data) => {
    const referencedIds = new Set();
    const add = (value) => {
        const id = normalizeAssetId(value);
        if (id) referencedIds.add(id);
    };

    for (const take of Array.isArray(data?.mediaTakes) ? data.mediaTakes : []) {
        add(take?.sharedAssetId);
        add(take?.transition?.asset?.sharedAssetId);
    }

    const adData = data?.adData;
    for (const key of ['sharedNarrationAssetId', 'sharedMusicAssetId', 'sharedMasterAssetId']) {
        add(adData?.[key]);
    }
    add(adData?.globalTransition?.sharedAssetId);
    add(adData?.frameOverlay?.transition?.asset?.sharedAssetId);

    return [...referencedIds];
};
