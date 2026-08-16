import type { AdData, TitlePlanningSuggestion } from '../types';
import { titlePlanningNarrationKey } from './titlePlanningKey.ts';
import type {
    AutomaticTitleGenerationOptions,
    AutomaticTitleGenerationOutcome,
} from './videoAgentWorkflow';

type TitlePlanMaterializationSource = Pick<
    AdData,
    'narrationPlainText' | 'plannedTitles' | 'plannedTitlesNarrationKey'
>;

export interface TitlePlanMaterializationDecision {
    shouldMaterialize: boolean;
    plannedTitles: TitlePlanningSuggestion[];
}

/**
 * Only a plan confirmed for the exact current narration may become timed titles.
 * Keeping this decision outside the UI prevents a stale chat proposal from being
 * silently attached to a newer script.
 */
export const titlePlanMaterializationDecision = (
    adData: TitlePlanMaterializationSource,
): TitlePlanMaterializationDecision => {
    const narrationKey = titlePlanningNarrationKey(adData.narrationPlainText);
    if (adData.plannedTitlesNarrationKey !== narrationKey) {
        return { shouldMaterialize: false, plannedTitles: [] };
    }

    const plannedTitles = (adData.plannedTitles || []).filter((title) => (
        title.selected !== false && String(title.text || '').trim().length > 0
    ));
    return {
        shouldMaterialize: plannedTitles.length > 0,
        plannedTitles,
    };
};

export type CurrentTitlePlanMaterializationOutcome = AutomaticTitleGenerationOutcome & {
    attempted: boolean;
    plannedTitleCount: number;
};

const exactMaterializationError = (message: string) => {
    const error = new Error(message);
    error.name = 'ExactTitlePlanMaterializationError';
    return error;
};

/**
 * Fail closed when an older or regressed local server ignores `exact-plan`.
 * A valid response may omit an impossible item only when that same item has a
 * structured diagnostic; everything that is returned must be an ordered,
 * byte-for-byte subset of the confirmed plan.
 */
export const assertExactTitlePlanMaterialization = (
    expected: TitlePlanningSuggestion[],
    result: AutomaticTitleGenerationOutcome,
): void => {
    const summary = result.adData.titleGenerationSummary?.materialization;
    const titles = result.adData.dynamicTitles || [];
    if (summary?.mode !== 'exact-plan') {
        throw exactMaterializationError(
            'O servidor local não confirmou a materialização exata dos títulos. Atualize o aplicativo e tente novamente.',
        );
    }
    if (
        summary.requestedCount !== expected.length
        || summary.materializedCount !== titles.length
    ) {
        throw exactMaterializationError('A contagem devolvida não corresponde ao plano de títulos confirmado.');
    }

    const expectedById = new Map(expected.map((title, index) => [title.id, { title, index }]));
    const returnedIds = new Set<string>();
    let previousIndex = -1;
    for (const title of titles) {
        const match = expectedById.get(title.id);
        if (
            !match
            || returnedIds.has(title.id)
            || match.index <= previousIndex
            || title.text !== match.title.text
            || title.sourceText !== match.title.sourceText
            || title.triggerId !== match.title.triggerId
        ) {
            throw exactMaterializationError(
                'O servidor devolveu um título diferente do conjunto confirmado no Chat.',
            );
        }
        returnedIds.add(title.id);
        previousIndex = match.index;
    }

    const diagnosedIds = new Set(
        summary.diagnostics.map((diagnostic) => diagnostic.itemId).filter(Boolean),
    );
    const omittedIds = expected.filter((title) => !returnedIds.has(title.id)).map((title) => title.id);
    if (omittedIds.some((id) => !diagnosedIds.has(id))) {
        throw exactMaterializationError(
            'Um título confirmado foi omitido sem diagnóstico. O plano original foi preservado.',
        );
    }
};

/**
 * Turns the current confirmed chat plan into timed titles once captions exist.
 * The original plan is deliberately restored on the returned AdData so callers
 * can persist the whole outcome without losing the user's editorial choices.
 */
/**
 * `force` bypasses the narration-key gate. It is meant for the Ops executor,
 * where the plan and the narration arrive together in one immutable job payload
 * and are therefore bound by construction — the key check only guards the
 * interactive editor against a stale chat proposal attaching to a newer script.
 */
export const materializeCurrentTitlePlan = async (
    input: AdData,
    options: AutomaticTitleGenerationOptions = {},
    { force = false }: { force?: boolean } = {},
): Promise<CurrentTitlePlanMaterializationOutcome> => {
    const forcedPlannedTitles = (input.plannedTitles || []).filter((title) => (
        title.selected !== false && String(title.text || '').trim().length > 0
    ));
    const decision = force
        ? { shouldMaterialize: forcedPlannedTitles.length > 0, plannedTitles: forcedPlannedTitles }
        : titlePlanMaterializationDecision(input);
    if (!decision.shouldMaterialize) {
        return {
            attempted: false,
            plannedTitleCount: 0,
            adData: input,
            source: 'none',
        };
    }

    const { generateAutomaticTitlesResilient } = await import('./videoAgentWorkflow.ts');
    const result = await generateAutomaticTitlesResilient({
        ...input,
        plannedTitles: decision.plannedTitles,
    }, {
        ...options,
        baseTitles: decision.plannedTitles,
        materializationMode: 'exact-plan',
    });
    assertExactTitlePlanMaterialization(decision.plannedTitles, result);
    return {
        ...result,
        attempted: true,
        plannedTitleCount: decision.plannedTitles.length,
        adData: {
            ...result.adData,
            plannedTitles: input.plannedTitles,
            plannedTitlesNarrationKey: input.plannedTitlesNarrationKey,
        },
    };
};
