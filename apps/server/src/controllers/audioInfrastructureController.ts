import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import ffmpeg from 'fluent-ffmpeg';
import { bearerFrom, GatewayHttpError } from '../services/gatewayClient';
import {
    TAKE_AUDIO_MIX_PIPELINE_VERSION,
    downloadTrustedIsolationSource,
    isolateAudioSource,
    normalizeIsolationSourceType,
    probeAudioFile,
    resolveAudioSourceReference,
    sha256File,
    type AudioSourceReference,
    type ResolvedAudioSource,
} from '../services/audioInfrastructure';
import {
    ensureValidAudioCacheFile,
    isUsableAudioCacheFile,
} from './audioController';

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const TAKE_MIX_ROOT = path.join(BASE_DATA_PATH, 'public', 'mixes', 'take-audio');
const TAKE_MIX_WORK_ROOT = path.join(BASE_DATA_PATH, 'temp', 'audio-infrastructure');
const MAX_TAKES = 200;
const MAX_FINAL_AUDIO_SECONDS = 6 * 60 * 60;
const MIX_DURATION_TOLERANCE_SECONDS = 0.15;

for (const directory of [TAKE_MIX_ROOT, TAKE_MIX_WORK_ROOT]) {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

type TakeAudioMode = 'original' | 'isolated';

export interface NormalizedTakeAudioRequest {
    id: string;
    audioMode: TakeAudioMode | null;
    source: AudioSourceReference | null;
    trimStart: number;
    trimEnd: number;
    playbackDuration: number;
    timelineStartSec: number;
    speed: number;
    volume: number;
}

interface PreparedTakeAudio extends NormalizedTakeAudioRequest {
    sourcePath: string;
    sourceSha256: string;
    inputIndex: number | null;
    hasAudio: boolean;
    sourceAudioDuration: number;
}

interface TakeAudioFilterPlan {
    masterInputIndex: number | null;
    takes: PreparedTakeAudio[];
    duration: number;
}

const numberOrNull = (value: unknown): number | null => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const safeId = (value: unknown, index: number): string => {
    const normalized = String(value || `take-${index + 1}`).trim().slice(0, 160);
    return normalized || `take-${index + 1}`;
};

const normalizeSpeed = (value: unknown, optIn: boolean, takeId: string): number => {
    if (value == null || value === '' || value === 'normal') return 1;
    if (typeof value === 'string') {
        if (optIn) {
            throw new Error(
                `take_audio_non_linear_speed_unsupported: O take ${takeId} usa remapeamento não linear; `
                + 'o áudio foi recusado para não perder lip-sync.',
            );
        }
        // As curvas visuais atuais preservam a duração total. Como o take não
        // optou por áudio, basta manter o cursor visual para posicionar os demais.
        return 1;
    }
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
        throw new Error(`Velocidade de áudio inválida no take ${takeId}; use um valor entre 0.5 e 2.`);
    }
    return speed;
};

const sourceReferenceForTake = (
    take: Record<string, unknown>,
    mode: TakeAudioMode,
): AudioSourceReference => {
    if (mode === 'isolated') {
        return {
            sourceUrl: String(take.isolatedAudioUrl || take.isolatedSourceUrl || '').trim() || null,
            sourcePath: String(take.isolatedAudioPath || take.isolatedSourcePath || '').trim() || null,
        };
    }
    return {
        sourceUrl: String(take.sourceUrl || take.fileUrl || '').trim() || null,
        sourcePath: String(take.sourcePath || take.file_path || take.backendPath || '').trim() || null,
    };
};

/**
 * Normaliza toda a timeline, inclusive takes sem opt-in, para que a posição
 * cumulativa dos próximos clipes continue igual à timeline visual antiga.
 */
export const normalizeTakeAudioRequests = (value: unknown): {
    takes: NormalizedTakeAudioRequest[];
    visualEnd: number;
} => {
    if (!Array.isArray(value)) throw new Error('takes deve ser uma lista.');
    if (value.length > MAX_TAKES) throw new Error(`A mixagem aceita no máximo ${MAX_TAKES} takes.`);

    let cursor = 0;
    const takes = value.map((raw, index): NormalizedTakeAudioRequest => {
        if (!raw || typeof raw !== 'object') throw new Error(`Take ${index + 1} inválido.`);
        const take = raw as Record<string, unknown>;
        const id = safeId(take.id, index);
        const rawMode = take.audioMode == null ? '' : String(take.audioMode).trim();
        if (rawMode && rawMode !== 'original' && rawMode !== 'isolated') {
            throw new Error(`audioMode inválido no take ${id}.`);
        }
        const audioMode = (rawMode || null) as TakeAudioMode | null;
        const optIn = audioMode !== null;
        const trim = take.trim && typeof take.trim === 'object'
            ? take.trim as Record<string, unknown>
            : {};
        const trimStart = numberOrNull(trim.start ?? take.start) ?? 0;
        const suppliedEnd = numberOrNull(trim.end ?? take.end);
        const suppliedDuration = numberOrNull(take.duration ?? take.originalDurationSeconds);
        const trimEnd = suppliedEnd ?? (suppliedDuration != null ? trimStart + suppliedDuration : trimStart);
        if (trimStart < 0 || trimEnd <= trimStart) {
            if (optIn) throw new Error(`O corte de áudio do take ${id} é inválido.`);
        }
        const rawDuration = Math.max(0, trimEnd - trimStart);
        const speed = normalizeSpeed(take.speed ?? take.speedPresetId, optIn, id);
        const playbackDuration = rawDuration / speed;
        const explicitStart = numberOrNull(take.timelineStartSec ?? take.positionSec);
        if (explicitStart != null && explicitStart < 0) {
            throw new Error(`A posição de áudio do take ${id} é inválida.`);
        }
        const timelineStartSec = explicitStart ?? cursor;
        cursor = Math.max(cursor, timelineStartSec + playbackDuration);
        const rawVolume = numberOrNull(take.volume) ?? 1;
        const volume = Math.min(2, Math.max(0, rawVolume));
        const source = audioMode ? sourceReferenceForTake(take, audioMode) : null;
        if (audioMode && !source?.sourcePath && !source?.sourceUrl) {
            throw new Error(
                audioMode === 'isolated'
                    ? `O take ${id} optou por áudio isolado, mas não informou isolatedAudioUrl/isolatedAudioPath.`
                    : `O take ${id} optou pelo áudio original, mas não informou a fonte.`,
            );
        }
        return {
            id,
            audioMode,
            source,
            trimStart,
            trimEnd,
            playbackDuration,
            timelineStartSec,
            speed,
            volume,
        };
    });
    return { takes, visualEnd: cursor };
};

const ffNumber = (value: number): string => Number(value.toFixed(6)).toString();

export const buildTakeAudioFilterGraph = (plan: TakeAudioFilterPlan): string => {
    if (!Number.isFinite(plan.duration) || plan.duration <= 0) {
        throw new Error('A duração final da mixagem é inválida.');
    }
    const duration = ffNumber(plan.duration);
    const filters: string[] = [];
    const labels: string[] = [];
    const normalizedFormat = 'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

    if (plan.masterInputIndex != null) {
        filters.push(
            `[${plan.masterInputIndex}:a]${normalizedFormat},apad,atrim=duration=${duration},`
            + 'asetpts=PTS-STARTPTS[masterAudio]',
        );
    } else {
        filters.push(
            `anullsrc=r=48000:cl=stereo,atrim=duration=${duration},`
            + 'asetpts=PTS-STARTPTS[masterAudio]',
        );
    }
    labels.push('[masterAudio]');

    plan.takes.forEach((take, index) => {
        const label = `takeAudio${index}`;
        const positionMs = Math.max(0, Math.round(take.timelineStartSec * 1000));
        const clipDuration = ffNumber(Math.max(0.001, take.playbackDuration));
        const finalPad = `adelay=${positionMs}:all=1,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS`;
        const availableEnd = Math.min(take.trimEnd, take.sourceAudioDuration);
        if (!take.hasAudio || take.inputIndex == null) {
            throw new Error(
                `take_audio_stream_missing: O take ${take.id} optou por áudio, mas a fonte não contém faixa de áudio.`,
            );
        }
        if (availableEnd <= take.trimStart + 0.001) {
            throw new Error(`take_audio_trim_outside_source: O corte de áudio do take ${take.id} está fora da faixa.`);
        }
        const speedFilter = take.speed === 1 ? '' : `,atempo=${ffNumber(take.speed)}`;
        filters.push(
            `[${take.inputIndex}:a]atrim=start=${ffNumber(take.trimStart)}:end=${ffNumber(availableEnd)},`
            + `asetpts=PTS-STARTPTS${speedFilter},volume=${ffNumber(take.volume)},${normalizedFormat},`
            + `apad,atrim=duration=${clipDuration},${finalPad}[${label}]`,
        );
        labels.push(`[${label}]`);
    });

    filters.push(
        `${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,`
        + `alimiter=limit=0.95:level=0,atrim=duration=${duration},asetpts=PTS-STARTPTS[aout]`,
    );
    return filters.join(';');
};

const runTakeAudioFfmpeg = (
    inputPaths: string[],
    filterGraph: string,
    targetPath: string,
): Promise<void> => new Promise((resolve, reject) => {
    const command = ffmpeg();
    inputPaths.forEach((inputPath) => command.input(inputPath));
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        try {
            command.kill('SIGKILL');
        } catch {
            // processo já encerrado
        }
    }, 12 * 60 * 1000);
    command
        .complexFilter(filterGraph)
        .outputOptions(['-map [aout]', '-vn', '-movflags +faststart'])
        .audioCodec('aac')
        .audioBitrate('192k')
        .format('ipod')
        .save(targetPath)
        .on('end', () => {
            clearTimeout(timeout);
            resolve();
        })
        .on('error', () => {
            clearTimeout(timeout);
            reject(new Error(
                timedOut
                    ? 'A mixagem dos takes excedeu o tempo limite.'
                    : 'O FFmpeg não conseguiu montar o áudio dos takes.',
            ));
        });
});

const materializeSource = async (
    source: AudioSourceReference,
    workDirectory: string,
    cache: Map<string, string>,
): Promise<string> => {
    const resolved: ResolvedAudioSource = resolveAudioSourceReference(source, BASE_DATA_PATH);
    if (resolved.kind === 'local') return resolved.value;
    const cached = cache.get(resolved.value);
    if (cached) return cached;
    const target = path.join(workDirectory, `remote-${cache.size}-${crypto.randomUUID()}.bin`);
    await downloadTrustedIsolationSource(resolved, target);
    cache.set(resolved.value, target);
    return target;
};

const removeWorkDirectory = async (workDirectory: string): Promise<void> => {
    const relative = path.relative(TAKE_MIX_WORK_ROOT, workDirectory);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        await fs.promises.rm(workDirectory, { recursive: true, force: true });
    }
};

export const isolateAudio = async (req: Request, res: Response) => {
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ ok: false, message: 'Sessão Mileto ausente ou expirada.' });
    try {
        const sourceType = normalizeIsolationSourceType(req.body?.sourceType);
        const result = await isolateAudioSource({
            sourceUrl: req.body?.sourceUrl,
            sourcePath: req.body?.sourcePath,
            sourceType,
            token,
        });
        return res.json({ ok: true, ...result });
    } catch (error: unknown) {
        if (error instanceof GatewayHttpError) {
            return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
        }
        const message = error instanceof Error ? error.message : 'Falha ao isolar a voz.';
        const status = /no máximo 10 minutos/i.test(message) ? 413 : 400;
        return res.status(status).json({ ok: false, message });
    }
};

export const mixTakeAudio = async (req: Request, res: Response) => {
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ ok: false, message: 'Sessão Mileto ausente ou expirada.' });

    const workDirectory = await fs.promises.mkdtemp(path.join(TAKE_MIX_WORK_ROOT, 'take-mix-'));
    try {
        const normalized = normalizeTakeAudioRequests(req.body?.takes);
        const optedIn = normalized.takes.filter((take) => take.audioMode !== null);
        const masterReference: AudioSourceReference = {
            sourceUrl: String(req.body?.masterUrl || req.body?.masterAudioUrl || '').trim() || null,
            sourcePath: String(req.body?.masterPath || req.body?.masterAudioPath || '').trim() || null,
        };
        const hasMasterReference = Boolean(masterReference.sourceUrl || masterReference.sourcePath);

        // Retrocompatibilidade deliberada: sem audioMode nenhum take entra no
        // áudio. Se já há master, devolve exatamente o mesmo arquivo sem reencode.
        if (!optedIn.length) {
            if (!hasMasterReference) {
                return res.json({
                    ok: true,
                    masterAudioUrl: null,
                    masterAudioPath: null,
                    outputUrl: null,
                    outputPath: null,
                    duration: numberOrNull(req.body?.duration) || 0,
                    cacheHit: true,
                    passthrough: true,
                    includedTakeIds: [],
                    silentTakeIds: [],
                });
            }
            const masterPath = await materializeSource(masterReference, workDirectory, new Map());
            const masterProbe = await probeAudioFile(masterPath);
            if (!masterProbe.hasAudio || masterProbe.duration <= 0) {
                throw new Error('O áudio master não contém uma faixa utilizável.');
            }
            const workRelative = path.relative(workDirectory, masterPath);
            const masterIsTemporary = masterPath === workDirectory
                || (Boolean(workRelative) && !workRelative.startsWith('..') && !path.isAbsolute(workRelative));
            return res.json({
                ok: true,
                masterAudioUrl: masterReference.sourceUrl || null,
                masterAudioPath: masterIsTemporary ? null : masterPath,
                outputUrl: masterReference.sourceUrl || null,
                outputPath: masterIsTemporary ? null : masterPath,
                duration: masterProbe.duration,
                cacheHit: true,
                passthrough: true,
                includedTakeIds: [],
                silentTakeIds: [],
            });
        }

        const remoteCache = new Map<string, string>();
        let masterPath = '';
        let masterProbe = { duration: 0, hasAudio: false };
        if (hasMasterReference) {
            masterPath = await materializeSource(masterReference, workDirectory, remoteCache);
            masterProbe = await probeAudioFile(masterPath);
            if (!masterProbe.hasAudio || masterProbe.duration <= 0) {
                throw new Error('O áudio master não contém uma faixa utilizável.');
            }
        }

        const prepared: PreparedTakeAudio[] = [];
        const inputPaths: string[] = masterPath ? [masterPath] : [];
        for (const take of optedIn) {
            const sourcePath = await materializeSource(take.source!, workDirectory, remoteCache);
            const sourceProbe = await probeAudioFile(sourcePath);
            if (!sourceProbe.hasAudio || sourceProbe.duration <= 0) {
                throw new Error(
                    `take_audio_stream_missing: O take ${take.id} optou por áudio, mas a fonte não contém faixa de áudio.`,
                );
            }
            if (take.trimStart >= sourceProbe.duration - 0.001) {
                throw new Error(
                    `take_audio_trim_outside_source: O corte de áudio do take ${take.id} começa depois do fim da faixa.`,
                );
            }
            const inputIndex = inputPaths.length;
            inputPaths.push(sourcePath);
            prepared.push({
                ...take,
                sourcePath,
                sourceSha256: await sha256File(sourcePath),
                inputIndex,
                hasAudio: sourceProbe.hasAudio,
                sourceAudioDuration: sourceProbe.duration,
            });
        }

        const requestedDuration = numberOrNull(req.body?.duration);
        if (requestedDuration != null && (requestedDuration <= 0 || requestedDuration > MAX_FINAL_AUDIO_SECONDS)) {
            throw new Error('A duração final da mixagem é inválida.');
        }
        const duration = requestedDuration
            ?? Math.max(masterProbe.duration, normalized.visualEnd);
        if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_FINAL_AUDIO_SECONDS) {
            throw new Error('Não foi possível determinar a duração final da mixagem.');
        }

        const masterSha256 = masterPath ? await sha256File(masterPath) : null;
        const identity = JSON.stringify({
            version: TAKE_AUDIO_MIX_PIPELINE_VERSION,
            duration: Number(duration.toFixed(6)),
            masterSha256,
            takes: prepared.map((take) => ({
                id: take.id,
                audioMode: take.audioMode,
                sourceSha256: take.sourceSha256,
                trimStart: take.trimStart,
                trimEnd: take.trimEnd,
                timelineStartSec: take.timelineStartSec,
                speed: take.speed,
                volume: take.volume,
                hasAudio: take.hasAudio,
            })),
        });
        const cacheKey = crypto.createHash('sha256').update(identity).digest('hex');
        const fileName = `take-mix-${cacheKey}.m4a`;
        const outputPath = path.join(TAKE_MIX_ROOT, fileName);
        const outputUrl = `/mixes/take-audio/${encodeURIComponent(fileName)}`;
        for (const inputPath of inputPaths) {
            if (path.resolve(inputPath) === path.resolve(outputPath)) {
                throw new Error('A mixagem nunca pode sobrescrever uma fonte original.');
            }
        }
        const validator = async (filePath: string): Promise<boolean> => {
            try {
                const linkStat = await fs.promises.lstat(filePath);
                if (linkStat.isSymbolicLink() || !linkStat.isFile()) return false;
            } catch {
                return false;
            }
            if (!(await isUsableAudioCacheFile(filePath))) return false;
            const outputProbe = await probeAudioFile(filePath);
            return outputProbe.hasAudio
                && Math.abs(outputProbe.duration - duration) <= MIX_DURATION_TOLERANCE_SECONDS;
        };
        const cacheHit = await validator(outputPath);
        const filterGraph = buildTakeAudioFilterGraph({
            masterInputIndex: masterPath ? 0 : null,
            takes: prepared,
            duration,
        });
        await ensureValidAudioCacheFile(
            outputPath,
            (temporaryPath) => runTakeAudioFfmpeg(inputPaths, filterGraph, temporaryPath),
            validator,
        );
        const outputProbe = await probeAudioFile(outputPath);
        return res.json({
            ok: true,
            masterAudioUrl: outputUrl,
            masterAudioPath: outputPath,
            outputUrl,
            outputPath,
            duration: outputProbe.duration,
            cacheHit,
            passthrough: false,
            includedTakeIds: prepared.map((take) => take.id),
            silentTakeIds: [],
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Falha ao montar o áudio dos takes.';
        return res.status(400).json({ ok: false, message });
    } finally {
        await removeWorkDirectory(workDirectory);
    }
};
