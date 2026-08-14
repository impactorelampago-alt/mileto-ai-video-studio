import assert from 'node:assert/strict';
import test from 'node:test';
import {
    captureTitleAssistantSnapshot,
    createTitleAssistantProposal,
    isTitleAssistantProposalStale,
    restoreTitleAssistantSnapshot,
    titleAssistantCommitPatch,
    updateTitleAssistantDraft,
} from '../src/lib/titleAssistantTransaction.ts';

const title = (id, text, active = true) => ({
    id,
    text,
    sourceText: text,
    triggerId: 'offer',
    startSec: 0,
    durationSec: 2,
    isActive: active,
    posY: 30,
});

test('proposta e edições permanecem isoladas até o commit explícito', () => {
    const generated = {
        brandPalette: { primary: '#00e676', secondary: '#ffffff', tertiary: '#000000', all: ['#00e676'] },
        brandPaletteUpdatedAt: '2026-08-14T12:00:00.000Z',
        dynamicTitles: [title('one', 'Oferta real')],
        dynamicTitlesSourceKey: 'source-new',
        titleGenerationSummary: {
            requested: true,
            outcome: 'ai',
            titleCount: 1,
            generatedAt: '2026-08-14T12:00:00.000Z',
        },
    };
    const proposal = createTitleAssistantProposal({ adData: generated, source: 'ai' }, 'source-new');
    const draft = updateTitleAssistantDraft(proposal.titles, 'one', { text: 'Oferta ajustada' });

    assert.equal(generated.dynamicTitles[0].text, 'Oferta real');
    assert.equal(proposal.titles[0].text, 'Oferta real');
    assert.equal(draft[0].text, 'Oferta ajustada');

    const patch = titleAssistantCommitPatch(proposal, draft);
    assert.equal(patch.dynamicTitles[0].text, 'Oferta ajustada');
    assert.equal(patch.dynamicTitlesSourceKey, 'source-new');
});

test('cancelamento restaura o snapshot e proposta obsoleta não pode ser aplicada', () => {
    const current = {
        brandPalette: undefined,
        brandPaletteUpdatedAt: undefined,
        dynamicTitles: [title('old', 'Título anterior')],
        dynamicTitlesSourceKey: 'source-old',
        titleGenerationSummary: undefined,
    };
    const snapshot = captureTitleAssistantSnapshot(current);
    const restored = restoreTitleAssistantSnapshot(snapshot);

    assert.equal(restored.dynamicTitles[0].id, current.dynamicTitles[0].id);
    assert.equal(restored.dynamicTitles[0].text, current.dynamicTitles[0].text);
    assert.equal(restored.dynamicTitles[0].sourceText, current.dynamicTitles[0].sourceText);
    assert.notEqual(restored.dynamicTitles, current.dynamicTitles);
    assert.equal(isTitleAssistantProposalStale('source-old', 'source-old'), false);
    assert.equal(isTitleAssistantProposalStale('source-old', 'source-new'), true);
});
