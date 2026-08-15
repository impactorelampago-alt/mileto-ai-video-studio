import type { TitlePlanningSuggestion } from '../types';

const MAX_PLANNED_TITLES = 8;
const MAX_PER_TRIGGER = 3;

const cleanField = (value: unknown, maxLength: number): string | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.normalize('NFKC').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > maxLength) return null;
    return normalized;
};

/**
 * Converte `settings.plannedTitles` de um job do Mileto Ops (títulos confirmados
 * no chat do Filmmaker) para o formato interno do plano de títulos. Defensiva
 * item a item: entradas malformadas ou fora dos limites do contrato
 * (CONTRATO-TITULOS-CHAT-FILMMAKER-v0.2 §1.5) são descartadas individualmente,
 * nunca derrubam o job. Excedentes de 8 itens ou de 3 por gatilho são cortados
 * na ordem de chegada.
 */
export const plannedTitlesFromOpsJob = (settings: unknown): TitlePlanningSuggestion[] => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
    const raw = (settings as Record<string, unknown>).plannedTitles;
    if (!Array.isArray(raw)) return [];

    const suggestions: TitlePlanningSuggestion[] = [];
    const perTrigger = new Map<string, number>();
    for (const item of raw) {
        if (suggestions.length >= MAX_PLANNED_TITLES) break;
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const candidate = item as Record<string, unknown>;
        const text = cleanField(candidate.text, 90);
        const sourceText = cleanField(candidate.sourceText, 240);
        const triggerId = cleanField(candidate.triggerId, 80);
        if (!text || !sourceText || !triggerId) continue;
        const triggerKey = triggerId.toLocaleLowerCase('pt-BR');
        const occurrences = perTrigger.get(triggerKey) || 0;
        if (occurrences >= MAX_PER_TRIGGER) continue;
        perTrigger.set(triggerKey, occurrences + 1);
        suggestions.push({
            id: `ops-planned-title-${suggestions.length + 1}`,
            text,
            sourceText,
            triggerId,
            triggerName: cleanField(candidate.triggerName, 80) || triggerId,
            selected: true,
        });
    }
    return suggestions;
};
