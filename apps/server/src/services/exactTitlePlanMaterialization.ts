import type {
    TitleGeneratorConfig,
    VideoFormat,
} from './titleGeneratorConfig';
import {
    MIN_GENERATED_TITLE_DURATION_SEC,
    TITLE_TIMELINE_GAP_SEC,
    normalizeTriggerKey,
    resolveTitleColors,
    semanticRolesForTitle,
    triggerMapWithAliases,
    type BrandPaletteInput,
    type SpokenTitleWord,
} from './titleGenerationRules';
import { normalizePlanningText } from './titlePlanningSafety';

export type ExactTitlePlanItemDiagnostic = {
    index: number;
    itemId?: string;
    text?: string;
    sourceText?: string;
    triggerId?: string;
    code:
        | 'title_plan_field_invalid'
        | 'title_plan_duplicate_id'
        | 'title_plan_trigger_unavailable'
        | 'title_plan_source_not_in_captions'
        | 'title_plan_timeline_unavailable'
        | 'title_plan_timeline_overlap';
    message: string;
    retryable: false;
};

export type ExactMaterializedTitle = {
    id: string;
    text: string;
    sourceText: string;
    triggerId: string;
    semanticRoles: Array<'hook' | 'offer_or_benefit' | 'cta'>;
    startSec: number;
    durationSec: number;
    isActive: true;
    posX: number;
    posY: number;
    scale: number;
    scaleX?: number;
    scaleY?: number;
    textBoxWidthPct: number;
    maxWords: number;
    styleId: string;
    fontFamily: string;
    animationId: string;
    primaryColor: string;
    secondaryColor: string;
    colorBinding?: ReturnType<typeof resolveTitleColors>['colorBinding'];
};

export type ExactTitlePlanMaterializationResult = {
    titles: ExactMaterializedTitle[];
    requestedCount: number;
    materializedCount: number;
    diagnostics: ExactTitlePlanItemDiagnostic[];
};

type RawPlanTitle = {
    id?: unknown;
    text?: unknown;
    sourceText?: unknown;
    triggerId?: unknown;
    selected?: unknown;
};

const exactPlanField = (value: unknown, maxLength: number) => {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) return null;
    return value;
};

const normalizedCaptionTokens = (spokenWords: SpokenTitleWord[]) => spokenWords.flatMap((word) =>
    normalizePlanningText(word.text)
        .split(' ')
        .filter(Boolean)
        .map((text) => ({ text, start: word.start })),
);

/**
 * Finds the exact, contiguous spoken evidence used by a confirmed plan. Each
 * caption word may expand into more than one normalized token (notably `R$ 199`),
 * so the first token retains the real word timing without changing sourceText.
 */
const exactSourceStartSec = (spokenWords: SpokenTitleWord[], sourceText: string) => {
    const sourceTokens = normalizePlanningText(sourceText).split(' ').filter(Boolean);
    if (!sourceTokens.length) return null;
    const captionTokens = normalizedCaptionTokens(spokenWords);
    for (let index = 0; index <= captionTokens.length - sourceTokens.length; index += 1) {
        if (sourceTokens.every((token, offset) => captionTokens[index + offset]?.text === token)) {
            return captionTokens[index].start;
        }
    }
    return null;
};

const roundedSecond = (value: number) => Math.round(value * 1_000) / 1_000;

/**
 * Materializes a confirmed plan without asking an AI to reinterpret it. The
 * output has one title for every possible selected item, in the same order and
 * with text/source/trigger byte-for-byte unchanged. Impossible items are never
 * silently dropped: each one receives a stable, user-safe diagnostic.
 */
export const materializeExactTitlePlan = (input: {
    baseTitles: unknown;
    spokenWords: SpokenTitleWord[];
    titleConfig: TitleGeneratorConfig;
    format: VideoFormat;
    brandPalette: BrandPaletteInput;
    timelineDurationSec: number;
}): ExactTitlePlanMaterializationResult => {
    const selected = (Array.isArray(input.baseTitles) ? input.baseTitles : [])
        .slice(0, 40)
        .filter((title: RawPlanTitle) => title?.selected !== false);
    const diagnostics: ExactTitlePlanItemDiagnostic[] = [];
    const titles: ExactMaterializedTitle[] = [];
    const detailByTitleId = new Map<string, Omit<ExactTitlePlanItemDiagnostic, 'code' | 'message' | 'retryable'>>();
    const seenIds = new Set<string>();
    const occurrenceByTrigger = new Map<string, number>();
    // A trigger may have been disabled after the user confirmed the plan. Its
    // saved visual configuration remains valid; only a truly absent/unusable
    // trigger makes the individual item impossible.
    const triggerById = triggerMapWithAliases(
        input.titleConfig.triggers.filter((trigger) => trigger.titleTypes.length > 0),
    );

    selected.forEach((raw: RawPlanTitle, index: number) => {
        const id = exactPlanField(raw?.id, 120) || `planned-title-${index + 1}`;
        const text = exactPlanField(raw?.text, 90);
        const sourceText = exactPlanField(raw?.sourceText, 240);
        const triggerId = exactPlanField(raw?.triggerId, 80);
        const detail = {
            index,
            itemId: id,
            ...(text ? { text } : {}),
            ...(sourceText ? { sourceText } : {}),
            ...(triggerId ? { triggerId } : {}),
        };

        if (!text || !sourceText || !triggerId) {
            diagnostics.push({
                ...detail,
                code: 'title_plan_field_invalid',
                message: `O título confirmado na posição ${index + 1} possui texto, fonte ou gatilho inválido.`,
                retryable: false,
            });
            return;
        }
        if (seenIds.has(id)) {
            diagnostics.push({
                ...detail,
                code: 'title_plan_duplicate_id',
                message: `O título "${text}" repete o identificador de outro item confirmado.`,
                retryable: false,
            });
            return;
        }
        seenIds.add(id);

        const trigger = triggerById.get(normalizeTriggerKey(triggerId));
        if (!trigger?.titleTypes.length) {
            diagnostics.push({
                ...detail,
                code: 'title_plan_trigger_unavailable',
                message: `O gatilho "${triggerId}" do título "${text}" não possui um estilo disponível.`,
                retryable: false,
            });
            return;
        }
        const startSec = exactSourceStartSec(input.spokenWords, sourceText);
        if (startSec === null) {
            diagnostics.push({
                ...detail,
                code: 'title_plan_source_not_in_captions',
                message: `A fala de origem do título "${text}" não foi encontrada nas legendas sincronizadas.`,
                retryable: false,
            });
            return;
        }

        const triggerKey = normalizeTriggerKey(trigger.id);
        const occurrence = occurrenceByTrigger.get(triggerKey) || 0;
        const titleType = trigger.titleTypes[occurrence % trigger.titleTypes.length];
        const layout = titleType.layouts[input.format] || titleType.layouts['9:16'];
        const availableDuration = input.timelineDurationSec - startSec;
        const durationSec = Math.min(titleType.durationSec, availableDuration);
        if (!(startSec >= 0) || durationSec < MIN_GENERATED_TITLE_DURATION_SEC) {
            diagnostics.push({
                ...detail,
                code: 'title_plan_timeline_unavailable',
                message: `Não existe tempo visível suficiente para posicionar o título "${text}" na fala correspondente.`,
                retryable: false,
            });
            return;
        }

        occurrenceByTrigger.set(triggerKey, occurrence + 1);
        detailByTitleId.set(id, detail);
        titles.push({
            id,
            text,
            sourceText,
            triggerId,
            semanticRoles: semanticRolesForTitle(triggerId, startSec, input.timelineDurationSec),
            startSec: roundedSecond(startSec),
            durationSec: roundedSecond(durationSec),
            isActive: true,
            posX: layout.posX,
            posY: layout.posY,
            scale: layout.scale,
            scaleX: layout.scaleX,
            scaleY: layout.scaleY,
            textBoxWidthPct: layout.textBoxWidthPct,
            maxWords: trigger.maxWords,
            styleId: titleType.styleId,
            fontFamily: titleType.fontFamily,
            animationId: titleType.animationId,
            ...resolveTitleColors(titleType.color || trigger.color, input.brandPalette, occurrence),
        });
    });

    const chronologicalTitles = titles
        .map((title, index) => ({ title, index }))
        .sort((left, right) => left.title.startSec - right.title.startSec || left.index - right.index);
    const durationById = new Map<string, number>();
    chronologicalTitles.forEach(({ title }, index) => {
        const next = chronologicalTitles[index + 1]?.title;
        const availableUntilNext = next
            ? next.startSec - title.startSec - TITLE_TIMELINE_GAP_SEC
            : title.durationSec;
        const durationSec = Math.min(title.durationSec, availableUntilNext);
        if (durationSec < MIN_GENERATED_TITLE_DURATION_SEC) {
            const detail = detailByTitleId.get(title.id) || { index, itemId: title.id };
            diagnostics.push({
                ...detail,
                code: 'title_plan_timeline_overlap',
                message: `O título "${title.text}" ficou próximo demais do título seguinte para ter tempo visível.`,
                retryable: false,
            });
            return;
        }
        durationById.set(title.id, roundedSecond(durationSec));
    });

    const nonOverlappingTitles = titles.flatMap((title) => {
        const durationSec = durationById.get(title.id);
        return durationSec === undefined ? [] : [{ ...title, durationSec }];
    });

    return {
        titles: nonOverlappingTitles,
        requestedCount: selected.length,
        materializedCount: nonOverlappingTitles.length,
        diagnostics,
    };
};
