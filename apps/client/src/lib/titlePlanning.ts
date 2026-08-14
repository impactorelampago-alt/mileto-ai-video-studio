import { API_BASE_URL } from './apiBase';
import { localAuthHeaders } from './serverAuth';
import type { TitlePlanningSuggestion, TitlePlanningTrigger } from '../types';
export { titlePlanningNarrationKey } from './titlePlanningKey.ts';

export interface TitlePlanningProposal {
    proposalId: string;
    revision: number;
    source: 'ai' | 'local';
    configSource?: string;
    suggestions: TitlePlanningSuggestion[];
    triggers: TitlePlanningTrigger[];
    summary: string;
    warnings: Array<{ code: string; message?: string }>;
}

export class TitlePlanningError extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly retryable: boolean,
        readonly requestId?: string,
    ) {
        super(message);
        this.name = 'TitlePlanningError';
    }
}

const safePreviousTitles = (titles: TitlePlanningSuggestion[]) => titles.slice(0, 40).map((title) => ({
    id: String(title.id || '').slice(0, 120),
    text: String(title.text || '').slice(0, 90),
    sourceText: String(title.sourceText || '').slice(0, 240),
    triggerId: String(title.triggerId || '').slice(0, 80),
    triggerName: String(title.triggerName || '').slice(0, 80),
    selected: title.selected === true,
}));

export interface TitlePlanningRequestedEdit {
    id: string;
    desiredText: string;
}

const safeRequestedEdits = (edits: TitlePlanningRequestedEdit[]) => {
    const seenIds = new Set<string>();
    return edits.slice(0, 40).flatMap((edit) => {
        const id = String(edit?.id || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120);
        const desiredText = String(edit?.desiredText || '').normalize('NFKC').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
        if (!id || !desiredText || seenIds.has(id)) return [];
        seenIds.add(id);
        return [{ id, desiredText }];
    });
};

export const planNarrationTitles = async (input: {
    script: string;
    instruction?: string;
    previousTitles?: TitlePlanningSuggestion[];
    requestedEdits?: TitlePlanningRequestedEdit[];
    revision?: number;
    signal?: AbortSignal;
}): Promise<TitlePlanningProposal> => {
    const response = await fetch(`${API_BASE_URL}/api/video/plan-titles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await localAuthHeaders()) },
        body: JSON.stringify({
            script: input.script,
            instruction: String(input.instruction || '').slice(0, 1_000),
            previousTitles: safePreviousTitles(input.previousTitles || []),
            requestedEdits: safeRequestedEdits(input.requestedEdits || []),
            revision: input.revision || 0,
        }),
        signal: input.signal,
    });
    const data = await response.json().catch(() => ({})) as Partial<TitlePlanningProposal> & {
        ok?: boolean;
        code?: string;
        message?: string;
        retryable?: boolean;
        requestId?: string;
    };
    if (!response.ok || data.ok === false) {
        throw new TitlePlanningError(
            data.message || `Não foi possível criar os títulos (${response.status}).`,
            data.code || 'title_planning_failed',
            data.retryable === true,
            data.requestId,
        );
    }
    return {
        proposalId: String(data.proposalId || ''),
        revision: Math.max(1, Number(data.revision) || 1),
        source: data.source === 'local' ? 'local' : 'ai',
        configSource: data.configSource,
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        triggers: Array.isArray(data.triggers) ? data.triggers : [],
        summary: String(data.summary || ''),
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
    };
};
