import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { collectSharedDraftAssetIds } from '../src/sharedDraftAssets.js';

const TAKE_ID = '11111111-1111-4111-8111-111111111111';
const TAKE_TRANSITION_ID = '22222222-2222-4222-8222-222222222222';
const NARRATION_ID = '33333333-3333-4333-8333-333333333333';
const MUSIC_ID = '44444444-4444-4444-8444-444444444444';
const MASTER_ID = '55555555-5555-4555-8555-555555555555';
const GLOBAL_TRANSITION_ID = '66666666-6666-4666-8666-666666666666';
const FRAME_TRANSITION_ID = '77777777-7777-4777-8777-777777777777';

test('rascunho compartilhado retém takes, áudios e transições compartilhadas', () => {
    const assetIds = collectSharedDraftAssetIds({
        mediaTakes: [
            {
                sharedAssetId: TAKE_ID,
                transition: { asset: { sharedAssetId: ` ${TAKE_TRANSITION_ID.toUpperCase()} ` } },
            },
            {
                // A repetição não pode gerar conflito na chave primária da tabela.
                sharedAssetId: TAKE_ID,
                transition: { asset: { sharedAssetId: TAKE_TRANSITION_ID } },
            },
        ],
        adData: {
            sharedNarrationAssetId: NARRATION_ID,
            sharedMusicAssetId: MUSIC_ID,
            sharedMasterAssetId: MASTER_ID,
            globalTransition: { sharedAssetId: GLOBAL_TRANSITION_ID },
            frameOverlay: { transition: { asset: { sharedAssetId: FRAME_TRANSITION_ID } } },
        },
    });

    assert.deepEqual(assetIds, [
        TAKE_ID,
        TAKE_TRANSITION_ID,
        NARRATION_ID,
        MUSIC_ID,
        MASTER_ID,
        GLOBAL_TRANSITION_ID,
        FRAME_TRANSITION_ID,
    ]);
});

test('IDs de assets são normalizados e validados antes do cast uuid[]', () => {
    const validUppercase = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    const assetIds = collectSharedDraftAssetIds({
        mediaTakes: [
            { sharedAssetId: '------------------------------------' },
            { sharedAssetId: '11111111-1111-0111-8111-111111111111' },
            { transition: { asset: { sharedAssetId: validUppercase } } },
        ],
        adData: {
            sharedMusicAssetId: 123,
            globalTransition: { sharedAssetId: 'not-a-uuid' },
        },
    });

    assert.deepEqual(assetIds, [validUppercase.toLowerCase()]);
});

test('saveDraft usa a lista completa ao registrar shared_draft_assets', () => {
    const source = fs.readFileSync(new URL('../src/shared.js', import.meta.url), 'utf8');
    const saveDraftStart = source.indexOf('export const saveDraft');
    const trashDraftStart = source.indexOf('export const trashDraft', saveDraftStart);
    const saveDraftSource = source.slice(saveDraftStart, trashDraftStart);

    assert.match(saveDraftSource, /const assetIds = collectSharedDraftAssetIds\(data\)/);
    assert.match(saveDraftSource, /INSERT INTO shared_draft_assets[\s\S]*?i\.id = ANY\(\$3::uuid\[\]\)/);
    assert.match(saveDraftSource, /SET purge_after = NULL[\s\S]*?i\.id = ANY\(\$2::uuid\[\]\)/);
});
