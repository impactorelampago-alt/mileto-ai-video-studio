import type { AdData, TitleHook } from '../types';
import type { AutomaticTitleGenerationOutcome } from './videoAgentWorkflow';
import { applyManualTitleUpdate } from './titleEditing.ts';

export interface TitleAssistantProposal {
    sourceKey: string;
    source: AutomaticTitleGenerationOutcome['source'];
    warning?: string;
    titles: TitleHook[];
    brandPalette: AdData['brandPalette'];
    brandPaletteUpdatedAt: AdData['brandPaletteUpdatedAt'];
    titleGenerationSummary: AdData['titleGenerationSummary'];
}

export type TitleAssistantSnapshot = Pick<
    AdData,
    | 'brandPalette'
    | 'brandPaletteUpdatedAt'
    | 'dynamicTitles'
    | 'dynamicTitlesSourceKey'
    | 'titleGenerationSummary'
>;

export const cloneTitleAssistantTitles = (titles: TitleHook[]): TitleHook[] =>
    titles.map((title) => ({
        ...title,
        semanticRoles: title.semanticRoles ? [...title.semanticRoles] : undefined,
        colorBinding: title.colorBinding ? { ...title.colorBinding } : undefined,
    }));

export const createTitleAssistantProposal = (
    result: AutomaticTitleGenerationOutcome,
    requestedSourceKey: string,
): TitleAssistantProposal => ({
    sourceKey: result.adData.dynamicTitlesSourceKey || requestedSourceKey,
    source: result.source,
    warning: result.warning,
    titles: cloneTitleAssistantTitles(result.adData.dynamicTitles || []),
    brandPalette: result.adData.brandPalette,
    brandPaletteUpdatedAt: result.adData.brandPaletteUpdatedAt,
    titleGenerationSummary: result.adData.titleGenerationSummary,
});

export const updateTitleAssistantDraft = (
    titles: TitleHook[],
    id: string,
    updates: Partial<TitleHook>,
): TitleHook[] => titles.map((title) =>
    title.id === id ? applyManualTitleUpdate(title, updates) : title
);

export const titleAssistantCommitPatch = (
    proposal: TitleAssistantProposal,
    draftTitles: TitleHook[],
): Partial<AdData> => ({
    brandPalette: proposal.brandPalette,
    brandPaletteUpdatedAt: proposal.brandPaletteUpdatedAt,
    dynamicTitles: cloneTitleAssistantTitles(draftTitles),
    dynamicTitlesSourceKey: proposal.sourceKey,
    titleGenerationSummary: proposal.titleGenerationSummary
        ? {
            ...proposal.titleGenerationSummary,
            titleCount: draftTitles.filter((title) => title.isActive).length,
        }
        : undefined,
});

export const captureTitleAssistantSnapshot = (adData: AdData): TitleAssistantSnapshot => ({
    brandPalette: adData.brandPalette,
    brandPaletteUpdatedAt: adData.brandPaletteUpdatedAt,
    dynamicTitles: adData.dynamicTitles ? cloneTitleAssistantTitles(adData.dynamicTitles) : undefined,
    dynamicTitlesSourceKey: adData.dynamicTitlesSourceKey,
    titleGenerationSummary: adData.titleGenerationSummary,
});

export const restoreTitleAssistantSnapshot = (snapshot: TitleAssistantSnapshot): Partial<AdData> => ({
    ...snapshot,
    dynamicTitles: snapshot.dynamicTitles ? cloneTitleAssistantTitles(snapshot.dynamicTitles) : undefined,
});

export const isTitleAssistantProposalStale = (
    proposalSourceKey: string,
    currentSourceKey: string,
) => proposalSourceKey !== currentSourceKey;
