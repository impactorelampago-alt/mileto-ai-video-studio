import type { TitlePlanningSuggestion } from '../types';

export interface TitleProposalRevisionEdit {
    id: string;
    currentText: string;
    desiredText: string;
    triggerId: string;
    triggerName: string;
    selected: boolean;
}

const comparableTitleText = (value: unknown): string => String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

export interface PreparedTitleProposalRevision {
    displayInstruction: string;
    requestedEdits: Array<{
        id: string;
        desiredText: string;
    }>;
}

const cleanRevisionText = (value: unknown, maxLength: number) => String(value || '')
    .normalize('NFKC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const compactDisplayText = (value: string, maxLength: number) => (
    value.length <= maxLength
        ? value
        : `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
);

export const collectTitleProposalRevisionEdits = (
    suggestions: TitlePlanningSuggestion[],
    desiredTextBySuggestionId: Record<string, string>,
): TitleProposalRevisionEdit[] => suggestions.flatMap((suggestion) => {
    const rawDesiredText = Object.prototype.hasOwnProperty.call(
        desiredTextBySuggestionId,
        suggestion.id,
    )
        ? desiredTextBySuggestionId[suggestion.id]
        : '';
    const desiredText = String(rawDesiredText || '').trim();
    const currentText = String(suggestion.text || '').trim();
    if (!desiredText || comparableTitleText(desiredText) === comparableTitleText(currentText)) return [];

    return [{
        id: suggestion.id,
        currentText,
        desiredText,
        triggerId: suggestion.triggerId,
        triggerName: suggestion.triggerName,
        selected: suggestion.selected === true,
    }];
});

/**
 * Separa a mensagem humana, persistida na conversa, do contrato privado usado
 * pelo planejador. IDs nunca aparecem na bolha e os itens sem pedido ficam
 * explicitamente fora da revisão.
 */
export const prepareTitleProposalRevision = (
    edits: TitleProposalRevisionEdit[],
): PreparedTitleProposalRevision | null => {
    const seenIds = new Set<string>();
    const normalized = edits.slice(0, 40).flatMap((edit) => {
        const id = cleanRevisionText(edit?.id, 120);
        const currentText = cleanRevisionText(edit?.currentText, 90);
        const desiredText = cleanRevisionText(edit?.desiredText, 90);
        const triggerName = cleanRevisionText(edit?.triggerName, 80) || 'Gatilho';
        if (!id || !desiredText || seenIds.has(id) || desiredText === currentText) return [];
        seenIds.add(id);
        return [{ id, currentText, desiredText, triggerName }];
    });
    if (!normalized.length) return null;

    const prefix = 'Fazer estas mudanças nos títulos:';
    const suffix = 'O restante deve permanecer exatamente como está.';
    const lines: string[] = [];
    let omitted = 0;
    for (const edit of normalized) {
        const line = `• ${compactDisplayText(edit.triggerName, 32)}: “${compactDisplayText(edit.currentText, 54)}” → “${compactDisplayText(edit.desiredText, 72)}”`;
        const candidate = [prefix, ...lines, line, suffix].join('\n');
        if (candidate.length <= 960) {
            lines.push(line);
        } else {
            omitted += 1;
        }
    }
    if (omitted) {
        lines.push(`• Mais ${omitted} mudança${omitted === 1 ? '' : 's'} enviada${omitted === 1 ? '' : 's'} ao planejador.`);
    }

    return {
        displayInstruction: [prefix, ...lines, suffix].join('\n').slice(0, 1_000),
        requestedEdits: normalized.map(({ id, desiredText }) => ({ id, desiredText })),
    };
};
