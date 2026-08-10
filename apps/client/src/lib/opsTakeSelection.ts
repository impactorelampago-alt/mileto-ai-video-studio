import type { OpsAsset, OpsVideoJob } from './gateway';

const DEFAULT_TARGET_SECONDS = 2.5;
const DEFAULT_MIN_SECONDS = 2;
const DEFAULT_MAX_SECONDS = 3;
const MAX_AUTOMATIC_CUTS = 200;

type UnknownRecord = Record<string, unknown>;

export interface OpsTakeSelectionResult {
    takes: OpsAsset[];
    mode: 'automatic' | 'explicit';
    targetCount: number;
    targetSeconds: number;
    uniqueAssetCount: number;
    reusedCount: number;
}

const record = (value: unknown): UnknownRecord => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : {}
);

const finiteNumber = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const boundedNumber = (value: unknown, fallback: number, minimum: number, maximum: number) => (
    Math.max(minimum, Math.min(maximum, finiteNumber(value, fallback)))
);

const integer = (value: unknown, fallback: number, minimum: number, maximum: number) => (
    Math.max(minimum, Math.min(maximum, Math.floor(finiteNumber(value, fallback))))
);

export const deterministicShuffle = <T>(items: T[], seed: string): T[] => {
    let state = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        state ^= seed.charCodeAt(index);
        state = Math.imul(state, 16777619);
    }
    const nextRandom = () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const target = Math.floor(nextRandom() * (index + 1));
        [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    return shuffled;
};

export const narrationTakeCount = (
    narrationDuration: number,
    options: { targetSeconds?: number; minSeconds?: number; maxSeconds?: number } = {},
) => {
    if (!Number.isFinite(narrationDuration) || narrationDuration <= 0) {
        throw new Error('agent_narration_duration_invalid: A narracao precisa ter duracao valida para selecionar os takes.');
    }
    const minimum = boundedNumber(options.minSeconds, DEFAULT_MIN_SECONDS, 0.5, 10);
    const maximum = boundedNumber(options.maxSeconds, DEFAULT_MAX_SECONDS, minimum, 15);
    const target = boundedNumber(options.targetSeconds, DEFAULT_TARGET_SECONDS, minimum, maximum);
    const desired = Math.max(1, Math.round(narrationDuration / target));
    const minimumForMaximumCut = Math.max(1, Math.ceil(narrationDuration / maximum));
    let count = Math.max(desired, minimumForMaximumCut);

    // Evita criar um corte extra muito curto quando o corte anterior ainda cabe
    // dentro da janela aceita de dois a tres segundos.
    while (count > 1 && narrationDuration / count < minimum && narrationDuration / (count - 1) <= maximum) {
        count -= 1;
    }
    return Math.min(MAX_AUTOMATIC_CUTS, count);
};

const uniqueById = (items: OpsAsset[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
};

const repeatUntil = (items: OpsAsset[], count: number) => {
    const selected: OpsAsset[] = [];
    for (let index = 0; index < count; index += 1) selected.push(items[index % items.length]);
    return selected;
};

export const selectOpsTakesForNarration = (
    eligibleAssets: OpsAsset[],
    narrationDuration: number,
    job: Pick<OpsVideoJob, 'id' | 'projectId' | 'shuffleTakes' | 'settings'>,
): OpsTakeSelectionResult => {
    const pool = uniqueById(eligibleAssets);
    if (!pool.length) {
        throw new Error('ops_take_pool_empty: A pasta TAKES nao possui videos disponiveis para este trabalho.');
    }

    const settings = record(job.settings);
    const takeSettings = record(settings.takeSelection);
    const batchSettings = record(settings.batch);
    const mode = takeSettings.mode === 'explicit' ? 'explicit' : 'automatic';
    const minSeconds = boundedNumber(takeSettings.minSeconds, DEFAULT_MIN_SECONDS, 0.5, 10);
    const maxSeconds = boundedNumber(takeSettings.maxSeconds, DEFAULT_MAX_SECONDS, minSeconds, 15);
    const targetSeconds = boundedNumber(
        takeSettings.targetSeconds,
        DEFAULT_TARGET_SECONDS,
        minSeconds,
        maxSeconds,
    );
    const batchSize = integer(batchSettings.size, 1, 1, 10);
    const batchIndex = integer(batchSettings.index, 0, 0, batchSize - 1);
    const batchId = typeof batchSettings.id === 'string' && batchSettings.id.trim()
        ? batchSettings.id.trim()
        : job.id;

    if (mode === 'explicit') {
        const takes = job.shuffleTakes
            ? deterministicShuffle(pool, `${batchId}:${batchIndex}:${job.id}:${job.projectId}:explicit`)
            : pool;
        return {
            takes,
            mode,
            targetCount: takes.length,
            targetSeconds,
            uniqueAssetCount: takes.length,
            reusedCount: 0,
        };
    }

    const targetCount = narrationTakeCount(narrationDuration, {
        targetSeconds,
        minSeconds,
        maxSeconds,
    });

    let orderedPool = pool;
    if (batchSize > 1) {
        const shuffled = deterministicShuffle(pool, `${batchId}:automatic-pool`);
        const primary = shuffled.filter((_asset, index) => index % batchSize === batchIndex);
        const offset = batchIndex % shuffled.length;
        const fallback = [...shuffled.slice(offset), ...shuffled.slice(0, offset)];
        orderedPool = uniqueById([...primary, ...fallback]);
    } else if (job.shuffleTakes) {
        orderedPool = deterministicShuffle(pool, `${job.id}:${job.projectId}:automatic`);
    }

    const takes = repeatUntil(orderedPool, targetCount);
    const uniqueAssetCount = new Set(takes.map((asset) => asset.id)).size;
    return {
        takes,
        mode,
        targetCount,
        targetSeconds,
        uniqueAssetCount,
        reusedCount: takes.length - uniqueAssetCount,
    };
};
