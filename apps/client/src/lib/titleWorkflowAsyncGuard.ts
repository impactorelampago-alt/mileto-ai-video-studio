import type { AdData } from '../types';
import { narrationSourceKey } from './narrationState.ts';
import { titlePlanningNarrationKey } from './titlePlanningKey.ts';

type TitleWorkflowAsyncSource = Pick<
    AdData,
    | 'narrationPlainText'
    | 'narrationText'
    | 'narrationAudioUrl'
    | 'narrationAudioPath'
    | 'sharedNarrationAssetId'
    | 'plannedTitles'
    | 'plannedTitlesNarrationKey'
    | 'captions'
>;

export interface TitleWorkflowAsyncFingerprint {
    narrationKey: string;
    sourceKey: string;
    planKey: string;
    captionsKey: string;
}

const hashText = (value: string): string => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
};

const planKey = (adData: TitleWorkflowAsyncSource): string => hashText(JSON.stringify([
    adData.plannedTitlesNarrationKey || '',
    (adData.plannedTitles || []).map((title) => [
        title.id,
        title.text,
        title.sourceText,
        title.triggerId,
        title.triggerName,
        title.selected !== false,
    ]),
]));

const captionsKey = (adData: TitleWorkflowAsyncSource): string => {
    const captions = adData.captions;
    if (!captions) return 'none';
    return hashText(JSON.stringify([
        captions.sourceKey || '',
        captions.language,
        captions.presetId,
        captions.segments.map((segment) => [
            segment.id,
            segment.start,
            segment.end,
            segment.text,
            segment.words.map((word) => [word.text, word.start, word.end]),
        ]),
    ]));
};

/**
 * Captures every project field that can change the meaning or timing of a
 * generated title. Async STT/title responses may only commit while this exact
 * fingerprint is still current.
 */
export const captureTitleWorkflowAsyncFingerprint = (
    adData: TitleWorkflowAsyncSource,
): TitleWorkflowAsyncFingerprint => ({
    narrationKey: titlePlanningNarrationKey(adData.narrationPlainText),
    sourceKey: narrationSourceKey(adData),
    planKey: planKey(adData),
    captionsKey: captionsKey(adData),
});

export const titleWorkflowAsyncFingerprintKey = (
    fingerprint: TitleWorkflowAsyncFingerprint,
): string => [
    fingerprint.narrationKey,
    fingerprint.sourceKey,
    fingerprint.planKey,
    fingerprint.captionsKey,
].join('::');

export const isTitleWorkflowAsyncFingerprintCurrent = (
    expected: TitleWorkflowAsyncFingerprint,
    latest: TitleWorkflowAsyncSource,
): boolean => titleWorkflowAsyncFingerprintKey(expected)
    === titleWorkflowAsyncFingerprintKey(captureTitleWorkflowAsyncFingerprint(latest));
