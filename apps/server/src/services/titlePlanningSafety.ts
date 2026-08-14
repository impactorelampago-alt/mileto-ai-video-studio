/**
 * Normalizacao compartilhada pelas validacoes do planejamento de titulos.
 * A pontuacao e os acentos nao alteram a comparacao, mas a ordem das palavras
 * continua relevante para impedir que fatos distantes sejam recombinados.
 */
export const normalizePlanningText = (value: unknown) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9%$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Aceita somente um trecho normalizado continuo da fonte autorizada. */
export const planningLiteralExists = (source: string, candidate: unknown) => {
    const sourceKey = normalizePlanningText(source);
    const candidateKey = normalizePlanningText(candidate);
    return candidateKey.length > 1 && (` ${sourceKey} `).includes(` ${candidateKey} `);
};

/**
 * O texto visual sugerido pela IA precisa preservar uma unica frase/fato da
 * evidencia. Palavras soltas presentes em pontos diferentes nao bastam.
 */
export const planningDisplaySupported = (sourceText: string, displayText: string) =>
    planningLiteralExists(sourceText, displayText);

export type TitlePlanningSuggestionState = {
    id: string;
    text: string;
    sourceText: string;
    triggerId: string;
    triggerName: string;
    selected: boolean;
};

export type TitlePlanningTriggerState = {
    id: string;
    name: string;
    maxOccurrences: number;
};

export type TitlePlanningOperation =
    | { op: 'edit_text'; id: string; text: string }
    | { op: 'set_selected'; id: string; selected: boolean }
    | { op: 'remove'; id: string }
    | {
        op: 'add';
        sourceText: string;
        text: string;
        triggerId: string;
        selected?: boolean;
    };

export type TitlePlanningOperationRejection = {
    index: number;
    code: 'invalid_operation' | 'unknown_id' | 'unsafe_text' | 'unknown_trigger' | 'limit_reached';
    id?: string;
};

const safeOperationText = (value: unknown, maxLength: number) => String(value || '')
    .normalize('NFKC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

/**
 * Uma revisao disparada pelas caixas por titulo concede ao modelo permissao
 * apenas para editar o texto dos IDs explicitamente pedidos. Qualquer tentativa
 * de selecionar, remover, adicionar ou tocar outro item e descartada antes da
 * aplicacao das operacoes.
 */
export const constrainTitlePlanningOperationsToRequestedEdits = (input: {
    operations: unknown;
    requestedEdits: Array<{ id: string; desiredText: string }>;
}) => {
    const requestedTextById = new Map(input.requestedEdits.slice(0, 40).flatMap((edit) => {
        const id = safeOperationText(edit?.id, 120);
        const desiredText = safeOperationText(edit?.desiredText, 90);
        return id && desiredText ? [[id, desiredText] as const] : [];
    }));
    const seenIds = new Set<string>();
    let rejectedOperationCount = 0;
    const operations = (Array.isArray(input.operations) ? input.operations : [])
        .slice(0, 80)
        .flatMap((rawOperation: any) => {
            const op = safeOperationText(rawOperation?.op, 40);
            const id = safeOperationText(rawOperation?.id, 120);
            const desiredText = requestedTextById.get(id);
            const modelText = safeOperationText(rawOperation?.text, 90);
            if (
                op !== 'edit_text'
                || !desiredText
                || modelText !== desiredText
                || seenIds.has(id)
            ) {
                rejectedOperationCount += 1;
                return [];
            }
            seenIds.add(id);
            return [{
                op: 'edit_text' as const,
                id,
                text: desiredText,
            }];
        });
    return { operations, rejectedOperationCount };
};

const normalizedTitleKey = (value: unknown) => normalizePlanningText(value);

/**
 * Aplica apenas as operacoes explicitamente devolvidas pela IA. A lista-base
 * nao e regenerada: itens omitidos permanecem byte a byte equivalentes, salvo
 * quando um edit/add cria duplicata e a selecao precisa ser fundida.
 */
export const applyTitlePlanningOperations = (input: {
    script: string;
    previousTitles: TitlePlanningSuggestionState[];
    operations: unknown;
    resolveTrigger: (triggerId: string) => TitlePlanningTriggerState | null;
    createId: () => string;
    maxItems?: number;
    strictTargetIsolation?: boolean;
    authorialRequestedEdits?: Array<{ id: string; desiredText: string }>;
}) => {
    const maxItems = Math.max(1, Math.min(40, Number(input.maxItems) || 40));
    const seenIds = new Set<string>();
    const suggestions = input.previousTitles.slice(0, maxItems).flatMap((item) => {
        const id = safeOperationText(item?.id, 120);
        if (!id || seenIds.has(id)) return [];
        seenIds.add(id);
        return [{ ...item, id }];
    });
    const operations = Array.isArray(input.operations) ? input.operations.slice(0, 80) : [];
    const authorialTextById = new Map((input.authorialRequestedEdits || []).slice(0, 40).flatMap((edit) => {
        const id = safeOperationText(edit?.id, 120);
        const desiredText = safeOperationText(edit?.desiredText, 90);
        return id && desiredText ? [[id, desiredText] as const] : [];
    }));
    const rejections: TitlePlanningOperationRejection[] = [];
    const aliases = new Map<string, string>();
    let appliedOperationCount = 0;

    const canonicalId = (rawId: unknown) => {
        let id = safeOperationText(rawId, 120);
        const visited = new Set<string>();
        while (aliases.has(id) && !visited.has(id)) {
            visited.add(id);
            id = aliases.get(id) || id;
        }
        return id;
    };

    const mergeDuplicate = (targetId: string) => {
        const targetIndex = suggestions.findIndex((item) => item.id === targetId);
        if (targetIndex < 0) return targetId;
        const target = suggestions[targetIndex];
        const targetKey = normalizedTitleKey(target.text);
        if (!targetKey) return targetId;
        const duplicateIndex = suggestions.findIndex((item, index) =>
            index !== targetIndex && normalizedTitleKey(item.text) === targetKey
        );
        if (duplicateIndex < 0) return targetId;

        const duplicate = suggestions[duplicateIndex];
        if (target.selected && !duplicate.selected) {
            suggestions[duplicateIndex] = { ...duplicate, selected: true };
        }
        suggestions.splice(targetIndex, 1);
        aliases.set(targetId, duplicate.id);
        return duplicate.id;
    };

    operations.forEach((rawOperation: any, index) => {
        const op = safeOperationText(rawOperation?.op, 40) as TitlePlanningOperation['op'];
        if (op === 'edit_text') {
            const id = canonicalId(rawOperation?.id);
            const itemIndex = suggestions.findIndex((item) => item.id === id);
            if (itemIndex < 0) {
                rejections.push({ index, code: 'unknown_id', ...(id ? { id } : {}) });
                return;
            }
            const text = safeOperationText(rawOperation?.text, 90);
            const current = suggestions[itemIndex];
            const authorialText = authorialTextById.get(id);
            if (
                (authorialText && text !== authorialText)
                || (!authorialText && !planningDisplaySupported(current.sourceText, text))
            ) {
                rejections.push({ index, code: 'unsafe_text', id });
                return;
            }
            if (current.text === text) return;
            if (
                input.strictTargetIsolation
                && suggestions.some((item, candidateIndex) => (
                    candidateIndex !== itemIndex
                    && normalizedTitleKey(item.text) === normalizedTitleKey(text)
                ))
            ) {
                rejections.push({ index, code: 'invalid_operation', id });
                return;
            }
            suggestions[itemIndex] = { ...current, text };
            if (!input.strictTargetIsolation) mergeDuplicate(id);
            appliedOperationCount += 1;
            return;
        }

        if (op === 'set_selected') {
            const id = canonicalId(rawOperation?.id);
            const itemIndex = suggestions.findIndex((item) => item.id === id);
            if (itemIndex < 0) {
                rejections.push({ index, code: 'unknown_id', ...(id ? { id } : {}) });
                return;
            }
            if (typeof rawOperation?.selected !== 'boolean') {
                rejections.push({ index, code: 'invalid_operation', id });
                return;
            }
            if (suggestions[itemIndex].selected === rawOperation.selected) return;
            suggestions[itemIndex] = { ...suggestions[itemIndex], selected: rawOperation.selected };
            appliedOperationCount += 1;
            return;
        }

        if (op === 'remove') {
            const id = canonicalId(rawOperation?.id);
            const itemIndex = suggestions.findIndex((item) => item.id === id);
            if (itemIndex < 0) {
                rejections.push({ index, code: 'unknown_id', ...(id ? { id } : {}) });
                return;
            }
            suggestions.splice(itemIndex, 1);
            appliedOperationCount += 1;
            return;
        }

        if (op === 'add') {
            const sourceText = safeOperationText(rawOperation?.sourceText, 240);
            const text = safeOperationText(rawOperation?.text, 90);
            const requestedTriggerId = safeOperationText(rawOperation?.triggerId, 80);
            const trigger = input.resolveTrigger(requestedTriggerId);
            if (!trigger) {
                rejections.push({ index, code: 'unknown_trigger' });
                return;
            }
            if (
                !planningLiteralExists(input.script, sourceText)
                || !planningDisplaySupported(sourceText, text)
            ) {
                rejections.push({ index, code: 'unsafe_text' });
                return;
            }

            const duplicateIndex = suggestions.findIndex((item) => normalizedTitleKey(item.text) === normalizedTitleKey(text));
            if (duplicateIndex >= 0) {
                if (rawOperation?.selected === true && !suggestions[duplicateIndex].selected) {
                    suggestions[duplicateIndex] = { ...suggestions[duplicateIndex], selected: true };
                    appliedOperationCount += 1;
                }
                return;
            }
            const triggerCount = suggestions.filter((item) =>
                normalizePlanningText(item.triggerId) === normalizePlanningText(trigger.id)
            ).length;
            if (
                suggestions.length >= maxItems
                || triggerCount >= Math.min(3, Math.max(1, trigger.maxOccurrences))
            ) {
                rejections.push({ index, code: 'limit_reached' });
                return;
            }
            suggestions.push({
                id: input.createId(),
                text,
                sourceText,
                triggerId: trigger.id,
                triggerName: trigger.name,
                selected: rawOperation?.selected === true,
            });
            appliedOperationCount += 1;
            return;
        }

        rejections.push({ index, code: 'invalid_operation' });
    });

    return {
        suggestions,
        appliedOperationCount,
        rejectedOperationCount: rejections.length,
        rejections,
    };
};
