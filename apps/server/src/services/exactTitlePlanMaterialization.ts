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
    /** Confirmed titles positioned by narration order because the spoken evidence
     * could not be located verbatim in the captions (STT noise). Reported for
     * transparency; these titles are never dropped. */
    approximatedCount: number;
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

const levenshteinDistance = (left: string, right: string): number => {
    if (left === right) return 0;
    if (!left) return right.length;
    if (!right) return left.length;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[right.length];
};

/**
 * A single spoken token counts as the same word as a plan token when it is
 * identical or close enough that only STT noise separates them. Short tokens
 * demand an exact hit so that fillers like "de"/"do" never match by accident.
 */
const spokenTokensMatch = (planToken: string, captionToken: string): boolean => {
    if (!planToken || !captionToken) return false;
    if (planToken === captionToken) return true;
    const shortest = Math.min(planToken.length, captionToken.length);
    if (shortest < 4) return false;
    const distance = levenshteinDistance(planToken, captionToken);
    const similarity = 1 - distance / Math.max(planToken.length, captionToken.length);
    const minSimilarity = shortest >= 8 ? 0.72 : 0.8;
    return similarity >= minSimilarity;
};

// How many unrelated caption tokens (STT inserts, a reformatted "R$ 199,00"
// splitting into "199"/"00", etc.) may sit between two plan tokens before the
// alignment gives up on that gap.
const CAPTION_GAP_TOLERANCE = 4;

/**
 * Finds where a confirmed plan's spoken evidence begins inside the captions,
 * tolerating the differences that always exist between a written script and its
 * STT transcription. Returns the real start time of the first matched word plus
 * a confidence score so the caller can fall back to narration order when the
 * phrase was mangled beyond recognition. Only the timing is inferred here; the
 * visible title text is never derived from the captions.
 */
const tolerantSourceAnchor = (
    spokenWords: SpokenTitleWord[],
    sourceText: string,
): { startSec: number; score: number } | null => {
    const planTokens = normalizePlanningText(sourceText).split(' ').filter(Boolean);
    if (!planTokens.length) return null;
    const captionTokens = normalizedCaptionTokens(spokenWords);
    if (!captionTokens.length) return null;

    let best: { startSec: number; score: number } | null = null;
    for (let start = 0; start < captionTokens.length; start += 1) {
        let cursor = start;
        let matched = 0;
        let firstMatchStart: number | null = null;
        for (const planToken of planTokens) {
            let hitIndex = -1;
            const searchEnd = Math.min(captionTokens.length, cursor + CAPTION_GAP_TOLERANCE + 1);
            for (let probe = cursor; probe < searchEnd; probe += 1) {
                if (spokenTokensMatch(planToken, captionTokens[probe].text)) {
                    hitIndex = probe;
                    break;
                }
            }
            if (hitIndex >= 0) {
                matched += 1;
                if (firstMatchStart === null) firstMatchStart = captionTokens[hitIndex].start;
                cursor = hitIndex + 1;
            }
            // A missing plan token keeps the caption cursor in place so later
            // tokens can still line up right after the gap.
        }
        if (firstMatchStart === null) continue;
        const score = matched / planTokens.length;
        if (!best || score > best.score || (score === best.score && firstMatchStart < best.startSec)) {
            best = { startSec: firstMatchStart, score };
        }
    }

    if (!best) return null;
    // Require a clear majority of the phrase to line up; a single distinctive
    // word (a city, a price) is enough on its own.
    const required = Math.max(1, Math.ceil(planTokens.length * 0.6));
    return best.score * planTokens.length >= required ? best : null;
};

const roundedSecond = (value: number) => Math.round(value * 1_000) / 1_000;

type ResolvedPlanTitle = {
    id: string;
    text: string;
    sourceText: string;
    triggerId: string;
    order: number;
    anchorStart: number | null;
    startSec: number;
    desiredDuration: number;
    layout: { posX: number; posY: number; scale: number; scaleX?: number; scaleY?: number; textBoxWidthPct: number };
    maxWords: number;
    styleId: string;
    fontFamily: string;
    animationId: string;
    colors: ReturnType<typeof resolveTitleColors>;
};

/**
 * Fills a start time for every confirmed title, in confirmed order. Titles whose
 * spoken evidence was located keep the real caption timing; the rest are spaced
 * between their located neighbours (or evenly across the timeline) so a confirmed
 * title is never lost just because STT rewrote its words.
 */
const assignFallbackStarts = (resolved: ResolvedPlanTitle[], timelineDurationSec: number) => {
    const usableTimeline = Math.max(MIN_GENERATED_TITLE_DURATION_SEC, timelineDurationSec);
    resolved.forEach((title, index) => {
        if (title.anchorStart !== null) {
            title.startSec = title.anchorStart;
            return;
        }
        let previousStart = 0;
        for (let back = index - 1; back >= 0; back -= 1) {
            if (resolved[back].anchorStart !== null) { previousStart = resolved[back].startSec; break; }
        }
        let nextStart: number | null = null;
        let nextGap = 1;
        for (let ahead = index + 1; ahead < resolved.length; ahead += 1, nextGap += 1) {
            if (resolved[ahead].anchorStart !== null) { nextStart = resolved[ahead].startSec; break; }
        }
        if (nextStart === null) {
            // No later anchor: continue past the last known point toward the end.
            const remaining = resolved.length - index;
            const span = Math.max(0, usableTimeline - previousStart);
            title.startSec = previousStart + (span * (1 / (remaining + 1)));
            return;
        }
        // Interpolate this gap between the surrounding anchors by position.
        const span = Math.max(0, nextStart - previousStart);
        title.startSec = previousStart + (span * (1 / (nextGap + 1)));
    });
};

/**
 * Schedules every confirmed title so they never overlap, guaranteeing each one
 * at least the minimum visible duration. Titles are pushed forward and, when the
 * front runs out of room, pulled back — a title is only dropped when the timeline
 * physically cannot hold this many at the minimum duration.
 */
const scheduleWithoutOverlap = (resolved: ResolvedPlanTitle[], timelineDurationSec: number) => {
    const minSlot = MIN_GENERATED_TITLE_DURATION_SEC + TITLE_TIMELINE_GAP_SEC;
    const ordered = resolved
        .map((title) => ({ title, startSec: Math.max(0, title.startSec) }))
        .sort((left, right) => left.startSec - right.startSec || left.title.order - right.title.order);

    // Forward: no title starts before the previous one has had its minimum slot.
    for (let index = 0; index < ordered.length; index += 1) {
        const floor = index > 0 ? ordered[index - 1].startSec + minSlot : 0;
        ordered[index].startSec = Math.max(ordered[index].startSec, floor);
    }
    // Backward: pull titles in so the last one still fits before the timeline ends.
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
        const ceiling = index < ordered.length - 1
            ? ordered[index + 1].startSec - minSlot
            : timelineDurationSec - MIN_GENERATED_TITLE_DURATION_SEC;
        if (ordered[index].startSec > ceiling) ordered[index].startSec = ceiling;
    }

    return ordered.map((entry, index) => {
        const next = ordered[index + 1];
        const startSec = entry.startSec;
        const availableUntilNext = next
            ? next.startSec - startSec - TITLE_TIMELINE_GAP_SEC
            : timelineDurationSec - startSec;
        const durationSec = Math.min(entry.title.desiredDuration, availableUntilNext);
        return { title: entry.title, startSec, durationSec };
    });
};

/**
 * Materializes a confirmed plan without asking an AI to reinterpret it. Every
 * selected item keeps its text/source/trigger byte-for-byte and, unless it is
 * structurally impossible (missing fields, duplicate id, a trigger that no longer
 * has any style), is positioned on the timeline. The spoken evidence is matched
 * tolerantly and, when STT rewrote it too heavily, the title falls back to its
 * narration order so a confirmed choice is never silently discarded.
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
    const detailByTitleId = new Map<string, Omit<ExactTitlePlanItemDiagnostic, 'code' | 'message' | 'retryable'>>();
    const seenIds = new Set<string>();
    const occurrenceByTrigger = new Map<string, number>();
    // A trigger may have been disabled after the user confirmed the plan. Its
    // saved visual configuration remains valid; only a truly absent/unusable
    // trigger makes the individual item impossible.
    const triggerById = triggerMapWithAliases(
        input.titleConfig.triggers.filter((trigger) => trigger.titleTypes.length > 0),
    );

    const resolved: ResolvedPlanTitle[] = [];
    let approximatedCount = 0;

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

        const triggerKey = normalizeTriggerKey(trigger.id);
        const occurrence = occurrenceByTrigger.get(triggerKey) || 0;
        occurrenceByTrigger.set(triggerKey, occurrence + 1);
        const titleType = trigger.titleTypes[occurrence % trigger.titleTypes.length];
        const layout = titleType.layouts[input.format] || titleType.layouts['9:16'];

        const anchor = tolerantSourceAnchor(input.spokenWords, sourceText);
        if (anchor === null) approximatedCount += 1;

        detailByTitleId.set(id, detail);
        resolved.push({
            id,
            text,
            sourceText,
            triggerId,
            order: index,
            anchorStart: anchor ? anchor.startSec : null,
            startSec: anchor ? anchor.startSec : 0,
            desiredDuration: titleType.durationSec,
            layout,
            maxWords: trigger.maxWords,
            styleId: titleType.styleId,
            fontFamily: titleType.fontFamily,
            animationId: titleType.animationId,
            colors: resolveTitleColors(titleType.color || trigger.color, input.brandPalette, occurrence),
        });
    });

    assignFallbackStarts(resolved, input.timelineDurationSec);
    const scheduled = scheduleWithoutOverlap(resolved, input.timelineDurationSec);

    const titles: ExactMaterializedTitle[] = [];
    for (const { title, startSec, durationSec } of scheduled) {
        if (!(startSec >= 0) || durationSec < MIN_GENERATED_TITLE_DURATION_SEC) {
            const detail = detailByTitleId.get(title.id) || { index: title.order, itemId: title.id };
            diagnostics.push({
                ...detail,
                code: 'title_plan_timeline_unavailable',
                message: `Não existe tempo visível suficiente para posicionar o título "${title.text}".`,
                retryable: false,
            });
            continue;
        }
        titles.push({
            id: title.id,
            text: title.text,
            sourceText: title.sourceText,
            triggerId: title.triggerId,
            semanticRoles: semanticRolesForTitle(title.triggerId, startSec, input.timelineDurationSec),
            startSec: roundedSecond(startSec),
            durationSec: roundedSecond(durationSec),
            isActive: true,
            posX: title.layout.posX,
            posY: title.layout.posY,
            scale: title.layout.scale,
            scaleX: title.layout.scaleX,
            scaleY: title.layout.scaleY,
            textBoxWidthPct: title.layout.textBoxWidthPct,
            maxWords: title.maxWords,
            styleId: title.styleId,
            fontFamily: title.fontFamily,
            animationId: title.animationId,
            primaryColor: title.colors.primaryColor,
            secondaryColor: title.colors.secondaryColor,
            colorBinding: title.colors.colorBinding,
        });
    }

    // Keep the confirmed order in the output even after chronological scheduling.
    const orderById = new Map(resolved.map((title) => [title.id, title.order]));
    titles.sort((left, right) => (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0));

    return {
        titles,
        requestedCount: selected.length,
        materializedCount: titles.length,
        diagnostics,
        approximatedCount,
    };
};
