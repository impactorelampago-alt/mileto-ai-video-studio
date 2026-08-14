import type { OpsExecutorActivity, OpsExecutorActivityStatus } from './opsExecutorActivity';
import type { OpsVideoJobStage, OpsVideoWorkerExecutionMode } from './gateway';
import type { OpsVideoExecutionDisposition } from './opsVideoWorkerState';

export const OPS_JOB_HISTORY_STORAGE_KEY = 'mileto:ops-job-history:v1';
export const OPS_JOB_HISTORY_MAX_RECORDS = 200;
export const OPS_JOB_HISTORY_MAX_EVENTS = 32;

export type OpsJobHistoryStatus = 'requested' | 'running' | 'paused' | 'completed' | 'failed';
export type OpsJobHistoryEventKind =
    | 'requested'
    | 'claimed'
    | 'started'
    | 'progress'
    | 'resumed'
    | 'paused'
    | 'completed'
    | 'failed';

export type OpsJobHistoryEvent = {
    id: string;
    kind: OpsJobHistoryEventKind;
    stage: OpsVideoJobStage;
    percent: number;
    message: string;
    errorCode?: string;
    errorStage?: OpsVideoJobStage;
    errorPhase?: string;
    errorRequestId?: string;
    retryable?: boolean;
    createdAt: number;
};

export type OpsJobHistoryRecord = {
    jobId: string;
    scopeKey: string;
    projectId?: string;
    companyId?: string;
    revision?: number;
    companyName?: string;
    projectTitle: string;
    status: OpsJobHistoryStatus;
    stage: OpsVideoJobStage;
    percent: number;
    message: string;
    errorCode?: string;
    errorStage?: OpsVideoJobStage;
    errorPhase?: string;
    errorRequestId?: string;
    errorRetryable?: boolean;
    executionDisposition?: OpsVideoExecutionDisposition;
    assetId?: string;
    mode: OpsVideoWorkerExecutionMode;
    requestedAt: number;
    startedAt?: number;
    completedAt?: number;
    updatedAt: number;
    events: OpsJobHistoryEvent[];
};

export type OpsJobHistorySnapshot = {
    version: 1;
    records: OpsJobHistoryRecord[];
};

export type OpsJobHistoryContext = {
    scopeKey?: string;
    projectId?: string;
    companyId?: string;
    revision?: number;
};

export const opsJobHistoryRecordKey = (
    record: Pick<OpsJobHistoryRecord, 'scopeKey' | 'jobId' | 'revision'>,
) => `${record.scopeKey}:${record.jobId}:r${record.revision || 1}`;

type HistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const EMPTY_SNAPSHOT: OpsJobHistorySnapshot = Object.freeze({
    version: 1,
    records: Object.freeze([]) as unknown as OpsJobHistoryRecord[],
});

const sanitizeDiagnosticText = (value: unknown, max: number) => String(value || '')
    // Mensagens remotas podem conter credenciais tanto em texto simples quanto
    // serializadas como JSON. O historico local nunca deve preservar o valor.
    .replace(
        /\b(?:authorization|api(?:-|_)?key|access(?:-|_)?token|refresh(?:-|_)?token|claim(?:-|_)?token|view(?:-|_)?context(?:-|_)?id|idempotency(?:-|_)?key|token|secret|password)\b["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:bearer\s+)?[^\s,;}\]]+)/gi,
        'credencial=[removido]',
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
        try {
            const parsed = new URL(url);
            return `${parsed.origin}${parsed.pathname}`;
        } catch {
            return '[url removida]';
        }
    })
    .trim()
    .slice(0, max);

const text = (value: unknown, max: number) => sanitizeDiagnosticText(value, max);
const percent = (value: unknown) => Math.max(0, Math.min(100, Number(value || 0)));
const VALID_STAGES = new Set<OpsVideoJobStage>([
    'queued', 'narration', 'takes', 'quick_edit', 'captions', 'titles', 'export', 'completed', 'failed',
]);
const stage = (value: unknown, fallback: OpsVideoJobStage = 'queued'): OpsVideoJobStage =>
    VALID_STAGES.has(value as OpsVideoJobStage) ? value as OpsVideoJobStage : fallback;
const VALID_DISPOSITIONS = new Set<OpsVideoExecutionDisposition>([
    'revision_possible', 'new_execution', 'project_original_missing', 'new_execution_required', 'temporarily_unavailable',
]);
const disposition = (value: unknown): OpsVideoExecutionDisposition | undefined =>
    VALID_DISPOSITIONS.has(value as OpsVideoExecutionDisposition) ? value as OpsVideoExecutionDisposition : undefined;
const timestamp = (value: unknown, fallback = Date.now()) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const browserStorage = (): HistoryStorage | null => {
    try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    } catch {
        return null;
    }
};

const historyStatus = (status: OpsExecutorActivityStatus): OpsJobHistoryStatus | null => {
    if (status === 'queued') return 'requested';
    if (status === 'claimed' || status === 'running') return 'running';
    if (status === 'paused' || status === 'completed' || status === 'failed') return status;
    return null;
};

const eventKind = (
    activity: OpsExecutorActivity,
    previous?: OpsJobHistoryRecord,
): OpsJobHistoryEventKind => {
    if (activity.status === 'queued') return 'requested';
    if (activity.status === 'claimed') return 'claimed';
    if (activity.status === 'paused') return 'paused';
    if (activity.status === 'completed') return 'completed';
    if (activity.status === 'failed') return 'failed';
    if (!previous?.startedAt) return 'started';
    if (previous.status === 'paused') return 'resumed';
    return 'progress';
};

const normalizeEvent = (value: unknown): OpsJobHistoryEvent | null => {
    if (!value || typeof value !== 'object') return null;
    const source = value as Partial<OpsJobHistoryEvent>;
    const kind = source.kind;
    const validKinds: OpsJobHistoryEventKind[] = [
        'requested', 'claimed', 'started', 'progress', 'resumed', 'paused', 'completed', 'failed',
    ];
    if (!kind || !validKinds.includes(kind)) return null;
    return {
        id: text(source.id, 180) || `${timestamp(source.createdAt)}:${kind}`,
        kind,
        stage: stage(source.stage),
        percent: percent(source.percent),
        message: text(source.message, 2_000),
        errorCode: text(source.errorCode, 160) || undefined,
        errorStage: source.errorStage ? stage(source.errorStage) : undefined,
        errorPhase: text(source.errorPhase, 120) || undefined,
        errorRequestId: text(source.errorRequestId, 160) || undefined,
        retryable: source.retryable === true,
        createdAt: timestamp(source.createdAt),
    };
};

const normalizeRecord = (value: unknown): OpsJobHistoryRecord | null => {
    if (!value || typeof value !== 'object') return null;
    const source = value as Partial<OpsJobHistoryRecord>;
    const jobId = text(source.jobId, 180);
    if (!jobId) return null;
    const validStatuses: OpsJobHistoryStatus[] = ['requested', 'running', 'paused', 'completed', 'failed'];
    const status = source.status && validStatuses.includes(source.status) ? source.status : 'requested';
    const requestedAt = timestamp(source.requestedAt);
    return {
        jobId,
        scopeKey: text(source.scopeKey, 220) || 'legacy',
        projectId: text(source.projectId, 180) || undefined,
        companyId: text(source.companyId, 180) || undefined,
        revision: Number.isFinite(Number(source.revision)) && Number(source.revision) > 0
            ? Math.floor(Number(source.revision))
            : undefined,
        companyName: text(source.companyName, 240) || undefined,
        projectTitle: text(source.projectTitle, 300) || 'Trabalho do Mileto Ops',
        status,
        stage: stage(source.stage),
        percent: percent(source.percent),
        message: text(source.message, 2_000),
        errorCode: text(source.errorCode, 160) || undefined,
        errorStage: source.errorStage ? stage(source.errorStage) : undefined,
        errorPhase: text(source.errorPhase, 120) || undefined,
        errorRequestId: text(source.errorRequestId, 160) || undefined,
        errorRetryable: source.errorRetryable === true,
        executionDisposition: disposition(source.executionDisposition),
        assetId: text(source.assetId, 180) || undefined,
        mode: source.mode === 'background' ? 'background' : 'foreground',
        requestedAt,
        startedAt: source.startedAt ? timestamp(source.startedAt) : undefined,
        completedAt: source.completedAt ? timestamp(source.completedAt) : undefined,
        updatedAt: timestamp(source.updatedAt, requestedAt),
        events: Array.isArray(source.events)
            ? source.events.map(normalizeEvent).filter((item): item is OpsJobHistoryEvent => Boolean(item)).slice(-OPS_JOB_HISTORY_MAX_EVENTS)
            : [],
    };
};

export const parseOpsJobHistory = (raw: string | null): OpsJobHistorySnapshot => {
    if (!raw) return EMPTY_SNAPSHOT;
    try {
        const parsed = JSON.parse(raw) as Partial<OpsJobHistorySnapshot>;
        if (parsed.version !== 1 || !Array.isArray(parsed.records)) return EMPTY_SNAPSHOT;
        return {
            version: 1,
            records: parsed.records
                .map(normalizeRecord)
                .filter((item): item is OpsJobHistoryRecord => Boolean(item))
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, OPS_JOB_HISTORY_MAX_RECORDS),
        };
    } catch {
        return EMPTY_SNAPSHOT;
    }
};

const sameProgressEvent = (left: OpsJobHistoryEvent, right: OpsJobHistoryEvent) =>
    left.kind === 'progress'
    && right.kind === 'progress'
    && left.stage === right.stage
    && left.message === right.message
    && left.errorCode === right.errorCode
    && left.errorStage === right.errorStage
    && left.errorPhase === right.errorPhase
    && left.errorRequestId === right.errorRequestId
    && left.retryable === right.retryable;

const sameEvent = (left: OpsJobHistoryEvent, right: OpsJobHistoryEvent) =>
    left.kind === right.kind
    && left.stage === right.stage
    && left.percent === right.percent
    && left.message === right.message
    && left.errorCode === right.errorCode
    && left.errorStage === right.errorStage
    && left.errorPhase === right.errorPhase
    && left.errorRequestId === right.errorRequestId
    && left.retryable === right.retryable;

export const reduceOpsJobHistory = (
    snapshot: OpsJobHistorySnapshot,
    activity: OpsExecutorActivity,
    now = Date.now(),
    context: OpsJobHistoryContext = {},
): OpsJobHistorySnapshot => {
    const jobId = text(activity.jobId, 180);
    const status = historyStatus(activity.status);
    if (!jobId || !status) return snapshot;

    const scopeKey = text(context.scopeKey, 220) || 'local';
    const requestedRevision = Number.isFinite(Number(context.revision)) && Number(context.revision) > 0
        ? Math.floor(Number(context.revision))
        : 1;
    const previous = snapshot.records.find((record) => (
        record.jobId === jobId
        && record.scopeKey === scopeKey
        && (record.revision || 1) === requestedRevision
    ));
    if (
        previous
        && previous.companyName === (text(activity.companyName, 240) || previous.companyName)
        && previous.projectTitle === (text(activity.projectTitle, 300) || previous.projectTitle)
        && previous.status === status
        && previous.stage === activity.stage
        && previous.percent === percent(activity.percent)
        && previous.message === text(activity.message, 2_000)
        && previous.errorCode === (text(activity.errorCode, 160) || undefined)
        && previous.errorStage === activity.errorStage
        && previous.errorPhase === (text(activity.errorPhase, 120) || undefined)
        && previous.errorRequestId === (text(activity.errorRequestId, 160) || undefined)
        && previous.errorRetryable === (activity.errorRetryable === true)
        && previous.executionDisposition === (activity.executionDisposition || previous.executionDisposition)
        && previous.assetId === (text(activity.assetId, 180) || previous.assetId)
        && previous.projectId === (text(context.projectId, 180) || previous.projectId)
        && previous.companyId === (text(context.companyId, 180) || previous.companyId)
        && previous.mode === activity.mode
    ) {
        return snapshot;
    }
    const kind = eventKind(activity, previous);
    const nextEvent: OpsJobHistoryEvent = {
        id: `${jobId}:${now}:${kind}`,
        kind,
        stage: activity.stage,
        percent: percent(activity.percent),
        message: text(activity.message, 2_000),
        errorCode: text(activity.errorCode, 160) || undefined,
        errorStage: activity.errorStage,
        errorPhase: text(activity.errorPhase, 120) || undefined,
        errorRequestId: text(activity.errorRequestId, 160) || undefined,
        retryable: activity.errorRetryable === true,
        createdAt: now,
    };
    const previousEvents = previous?.events || [];
    let events = previousEvents;
    if (!previous && kind !== 'requested') {
        events = [{
            id: `${jobId}:${now}:requested`,
            kind: 'requested',
            stage: 'queued',
            percent: 0,
            message: 'Solicitação recebida do Mileto Ops.',
            createdAt: now,
        }];
    }
    const currentLastEvent = events[events.length - 1];
    if (currentLastEvent && sameEvent(currentLastEvent, nextEvent)) {
        events = previousEvents;
    } else if (currentLastEvent && sameProgressEvent(currentLastEvent, nextEvent)) {
        events = [...events.slice(0, -1), nextEvent];
    } else if (
        !currentLastEvent
        || currentLastEvent.kind !== nextEvent.kind
        || currentLastEvent.stage !== nextEvent.stage
        || currentLastEvent.percent !== nextEvent.percent
        || currentLastEvent.message !== nextEvent.message
        || currentLastEvent.errorCode !== nextEvent.errorCode
    ) {
        events = [...events, nextEvent].slice(-OPS_JOB_HISTORY_MAX_EVENTS);
    }

    const startedAt = previous?.startedAt
        || (kind === 'claimed' || kind === 'started' || kind === 'progress' || kind === 'resumed' ? now : undefined);
    const terminal = status === 'completed' || status === 'failed';
    const companyName = text(activity.companyName, 240) || previous?.companyName;
    const projectTitle = text(activity.projectTitle, 300) || previous?.projectTitle || 'Trabalho do Mileto Ops';
    const nextPercent = percent(activity.percent);
    const message = text(activity.message, 2_000);
    const errorCode = text(activity.errorCode, 160) || undefined;
    const errorStage = activity.errorStage;
    const errorPhase = text(activity.errorPhase, 120) || undefined;
    const errorRequestId = text(activity.errorRequestId, 160) || undefined;
    const errorRetryable = activity.errorRetryable === true;
    const executionDisposition = activity.executionDisposition || previous?.executionDisposition;
    const assetId = text(activity.assetId, 180) || previous?.assetId;
    const projectId = text(context.projectId, 180) || previous?.projectId;
    const companyId = text(context.companyId, 180) || previous?.companyId;
    const revision = requestedRevision;
    if (
        previous
        && events === previousEvents
        && previous.companyName === companyName
        && previous.projectTitle === projectTitle
        && previous.status === status
        && previous.stage === activity.stage
        && previous.percent === nextPercent
        && previous.message === message
        && previous.errorCode === errorCode
        && previous.errorStage === errorStage
        && previous.errorPhase === errorPhase
        && previous.errorRequestId === errorRequestId
        && previous.errorRetryable === errorRetryable
        && previous.executionDisposition === executionDisposition
        && previous.assetId === assetId
        && previous.projectId === projectId
        && previous.companyId === companyId
        && previous.revision === revision
        && previous.mode === activity.mode
    ) {
        return snapshot;
    }
    const record: OpsJobHistoryRecord = {
        jobId,
        scopeKey,
        projectId,
        companyId,
        revision,
        companyName,
        projectTitle,
        status,
        stage: activity.stage,
        percent: nextPercent,
        message,
        errorCode,
        errorStage,
        errorPhase,
        errorRequestId,
        errorRetryable,
        executionDisposition,
        assetId,
        mode: activity.mode,
        requestedAt: previous?.requestedAt || now,
        startedAt,
        completedAt: terminal ? (previous?.completedAt || now) : undefined,
        updatedAt: now,
        events,
    };
    return {
        version: 1,
        records: [record, ...snapshot.records.filter((item) => !(
            item.jobId === jobId
            && item.scopeKey === scopeKey
            && (item.revision || 1) === revision
        ))]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, OPS_JOB_HISTORY_MAX_RECORDS),
    };
};

let currentSnapshot: OpsJobHistorySnapshot | null = null;
const listeners = new Set<() => void>();

const ensureSnapshot = () => {
    if (!currentSnapshot) {
        const storage = browserStorage();
        currentSnapshot = parseOpsJobHistory(storage?.getItem(OPS_JOB_HISTORY_STORAGE_KEY) || null);
    }
    return currentSnapshot;
};

const persistSnapshot = (snapshot: OpsJobHistorySnapshot) => {
    const storage = browserStorage();
    if (!storage) return;
    try {
        storage.setItem(OPS_JOB_HISTORY_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
        // O histórico é auxiliar e nunca pode interromper o executor de vídeos.
    }
};

export const recordOpsJobHistoryActivity = (
    activity: OpsExecutorActivity,
    context: OpsJobHistoryContext = {},
    now = Date.now(),
) => {
    const current = ensureSnapshot();
    const next = reduceOpsJobHistory(current, activity, now, context);
    if (next === current) return;
    currentSnapshot = next;
    persistSnapshot(next);
    listeners.forEach((listener) => listener());
};

export const subscribeOpsJobHistory = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const getOpsJobHistory = () => ensureSnapshot();

export const opsJobHistoryScope = (orgId?: number | null, userId?: number | null) =>
    `${orgId == null ? 'sem-org' : orgId}:${userId == null ? 'sem-usuario' : userId}`;

export const opsJobHistoryForScope = (
    snapshot: OpsJobHistorySnapshot,
    scopeKey: string,
) => snapshot.records.filter((record) => record.scopeKey === scopeKey);

export const clearFinishedOpsJobHistory = (scopeKey?: string) => {
    const current = ensureSnapshot();
    const next: OpsJobHistorySnapshot = {
        version: 1,
        records: current.records.filter((record) => {
            if (scopeKey && record.scopeKey !== scopeKey) return true;
            return record.status === 'running' || record.status === 'requested' || record.status === 'paused';
        }),
    };
    currentSnapshot = next;
    persistSnapshot(next);
    listeners.forEach((listener) => listener());
};

export type OpsJobFailureExplanation = {
    title: string;
    detail: string;
    action?: string;
};

export const explainOpsJobFailure = (
    code?: string,
    fallbackMessage?: string,
): OpsJobFailureExplanation => {
    const normalized = text(code, 160).toLowerCase();
    if (normalized === 'project_original_missing' || normalized === 'fresh_render_project_unavailable') {
        return {
            title: 'Projeto original indisponível neste computador',
            detail: 'O Mileto Ops pediu uma revisão, mas este computador não encontrou o projeto completo nem uma renderização anterior compatível. Nenhum projeto substituto foi criado.',
            action: 'O Ops deve enviar uma nova execução completa ou disponibilizar o projeto original neste computador.',
        };
    }
    if (normalized === 'new_execution_required') {
        return {
            title: 'O Ops precisa solicitar uma execução nova',
            detail: fallbackMessage || 'A tentativa recebida não tem projeto local anterior nem payload integral suficiente para uma geração segura.',
            action: 'Solicite no Mileto Ops uma nova execução completa. Repetir esta mesma revisão não resolverá.',
        };
    }
    if (normalized === 'temporarily_unavailable') {
        return {
            title: 'O projeto não pôde ser consultado agora',
            detail: fallbackMessage || 'O executor encontrou uma indisponibilidade temporária antes de decidir se a revisão pode continuar.',
            action: 'Aguarde a tentativa automática. Não é necessário criar outro projeto.',
        };
    }
    if (normalized === 'ops_narration_text_mismatch') {
        return {
            title: 'A narração falada diverge do texto de referência',
            detail: fallbackMessage || 'Depois de remover as direções do Fish Audio, o conteúdo falado ainda ficou diferente do texto limpo enviado pelo Ops.',
            action: 'O diagnóstico mostra o primeiro trecho diferente e os hashes normalizados para o Ops corrigir o payload.',
        };
    }
    if (normalized === 'render_video_frame_count_mismatch') {
        return {
            title: 'A duração visual não fechou com a timeline',
            detail: fallbackMessage || 'O vídeo renderizado terminou com uma quantidade de quadros diferente da timeline planejada.',
            action: 'Tente novamente após atualizar o Mileto. Se persistir, copie o diagnóstico técnico para o suporte.',
        };
    }
    if (normalized === 'render_transition_source_missing') {
        return {
            title: 'A transição do projeto não está disponível',
            detail: fallbackMessage || 'A transição salva no projeto não pôde ser encontrada neste computador.',
            action: 'Abra o projeto e selecione novamente a transição antes de exportar.',
        };
    }
    if (normalized.includes('take_source_missing') || normalized === 'ops_export_take_unavailable') {
        return {
            title: 'Um take do projeto não está disponível',
            detail: fallbackMessage || 'O executor não conseguiu obter uma das mídias necessárias para montar o vídeo.',
            action: 'Abra o projeto, confirme o take indicado e tente novamente.',
        };
    }
    if (normalized === 'video_worker_upgrade_required') {
        return {
            title: 'Atualização do Mileto necessária',
            detail: fallbackMessage || 'Este trabalho exige uma versão mais recente do executor local.',
            action: 'Atualize o Mileto AI Video e tente novamente.',
        };
    }
    if (normalized === 'ops_token_failed' || normalized === 'ops_token_invalid') {
        return {
            title: 'O Ops recusou a autenticação',
            detail: fallbackMessage || 'O servidor não conseguiu renovar a autorização usada para falar com o Mileto Ops.',
            action: 'O executor tentará novamente. Se persistir, reconecte o Ops em Integrações.',
        };
    }
    return {
        title: normalized ? 'O trabalho não pôde ser concluído' : 'Detalhe do trabalho',
        detail: text(fallbackMessage, 2_000) || 'O Mileto não recebeu uma descrição adicional para este evento.',
        action: normalized ? 'Copie o diagnóstico técnico abaixo se precisar encaminhar o caso ao suporte.' : undefined,
    };
};
