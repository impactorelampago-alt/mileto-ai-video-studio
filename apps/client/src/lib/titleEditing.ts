import type { TitleHook } from '../types';

const hasOwn = (value: object, key: keyof TitleHook) => Object.prototype.hasOwnProperty.call(value, key);

/**
 * Aplica uma alteração feita pela pessoa no editor. O limite maxWords pertence
 * exclusivamente à geração automática e nunca deve truncar esta atualização.
 */
export const applyManualTitleUpdate = (title: TitleHook, updates: Partial<TitleHook>): TitleHook => {
    const colorEdited = hasOwn(updates, 'primaryColor') || hasOwn(updates, 'secondaryColor');
    const textChanged = hasOwn(updates, 'text') || hasOwn(updates, 'sourceText');
    const startChanged = hasOwn(updates, 'startSec');

    return {
        ...title,
        ...updates,
        ...(textChanged ? {
            sourceText: undefined,
            triggerId: undefined,
            semanticRoles: undefined,
        } : (startChanged && title.semanticRoles?.includes('hook') ? {
            semanticRoles: title.semanticRoles.filter((role) => role !== 'hook'),
        } : {})),
        ...(colorEdited && !hasOwn(updates, 'colorBinding') ? { colorBinding: undefined } : {}),
    };
};

export interface DuplicateTitleResult {
    titles: TitleHook[];
    duplicate: TitleHook;
}

/** Cria uma cópia independente e a insere logo depois do título de origem. */
export const duplicateTitleAfter = (
    titles: TitleHook[],
    sourceId: string,
    duplicateId: string
): DuplicateTitleResult | null => {
    const sourceIndex = titles.findIndex((title) => title.id === sourceId);
    if (sourceIndex < 0) return null;

    const source = titles[sourceIndex];
    const duplicate: TitleHook = {
        ...source,
        id: duplicateId,
        semanticRoles: source.semanticRoles ? [...source.semanticRoles] : undefined,
        colorBinding: source.colorBinding ? { ...source.colorBinding } : undefined,
    };
    const nextTitles = [...titles];
    nextTitles.splice(sourceIndex + 1, 0, duplicate);

    return { titles: nextTitles, duplicate };
};
