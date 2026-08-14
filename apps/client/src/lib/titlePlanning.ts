import { API_BASE_URL } from './apiBase';
import { localAuthHeaders } from './serverAuth';
import type { TitlePlanningSuggestion, TitlePlanningTrigger } from '../types';

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

/** Assinatura estável do texto; gerar/trocar o arquivo de áudio não invalida o planejamento. */
export const titlePlanningNarrationKey = (value: string): string => {
    const source = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `title-plan-v1-${(hash >>> 0).toString(16)}`;
};

const safePreviousTitles = (titles: TitlePlanningSuggestion[]) => titles.slice(0, 40).map((title) => ({
    id: String(title.id || '').slice(0, 120),
    text: String(title.text || '').slice(0, 90),
    sourceText: String(title.sourceText || '').slice(0, 240),
    triggerId: String(title.triggerId || '').slice(0, 80),
    triggerName: String(title.triggerName || '').slice(0, 80),
    selected: title.selected === true,
}));

export const planNarrationTitles = async (input: {
    script: string;
    instruction?: string;
    previousTitles?: TitlePlanningSuggestion[];
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
