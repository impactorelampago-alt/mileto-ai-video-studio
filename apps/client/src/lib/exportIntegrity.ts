import type {
    TitleGenerationSummary,
    TitleHook,
    TitleSemanticCoverage,
    TitleSemanticRole,
} from '../types';

export const MIN_VISIBLE_EXPORT_TITLE_SEC = 0.75;

export interface StructuredExportWarning {
    code: string;
    message: string;
    stage: 'titles' | 'render';
    titleId?: string;
    missingRoles?: TitleSemanticRole[];
}

export interface ServerRenderDiagnostics {
    status: 'passed' | 'failed';
    stage: 'preflight' | 'output';
    expectedDurationSec: number;
    plannedVideoDurationSec?: number;
    actualVideoDurationSec?: number;
    actualAudioDurationSec?: number;
    containerDurationSec?: number;
    expectedFps: number;
    actualVideoFps?: number;
    expectedVideoFrameCount?: number;
    actualVideoFrameCount?: number;
    durationToleranceSec: number;
    videoDurationToleranceSec: number;
    frameTolerance: number;
    issues: Array<{
        code: string;
        message: string;
        stream?: 'timeline' | 'video' | 'audio' | 'container';
        takeIndex?: number;
        takeId?: string;
        expected?: number;
        actual?: number;
        delta?: number;
        tolerance?: number;
    }>;
}

export interface PersistedRenderFailure {
    projectId: string;
    exportJobId: string;
    sourceJobId?: string;
    code: string;
    message: string;
    diagnostics: ServerRenderDiagnostics;
    failedAt: string;
}

const safeDiagnosticText = (value: unknown, maxLength: number): string =>
    (typeof value === 'string' ? value.trim() : '').slice(0, maxLength);

const safeDiagnosticNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
};

/**
 * O relatório vem de uma resposta HTTP. Persiste somente o contrato conhecido,
 * descartando caminhos locais, comandos do FFmpeg e qualquer campo inesperado.
 */
export const sanitizeServerRenderDiagnostics = (value: unknown): ServerRenderDiagnostics | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const input = value as Record<string, unknown>;
    if (input.status !== 'passed' && input.status !== 'failed') return undefined;
    if (input.stage !== 'preflight' && input.stage !== 'output') return undefined;

    const expectedDurationSec = safeDiagnosticNumber(input.expectedDurationSec);
    const expectedFps = safeDiagnosticNumber(input.expectedFps);
    const durationToleranceSec = safeDiagnosticNumber(input.durationToleranceSec);
    const videoDurationToleranceSec = safeDiagnosticNumber(input.videoDurationToleranceSec);
    const frameTolerance = safeDiagnosticNumber(input.frameTolerance);
    if (
        expectedDurationSec === undefined
        || expectedFps === undefined
        || durationToleranceSec === undefined
        || videoDurationToleranceSec === undefined
        || frameTolerance === undefined
    ) return undefined;

    const optionalNumbers = [
        'plannedVideoDurationSec',
        'actualVideoDurationSec',
        'actualAudioDurationSec',
        'containerDurationSec',
        'actualVideoFps',
        'expectedVideoFrameCount',
        'actualVideoFrameCount',
    ] as const;
    const sanitized: ServerRenderDiagnostics = {
        status: input.status,
        stage: input.stage,
        expectedDurationSec,
        expectedFps,
        durationToleranceSec,
        videoDurationToleranceSec,
        frameTolerance,
        issues: [],
    };
    for (const key of optionalNumbers) {
        const numeric = safeDiagnosticNumber(input[key]);
        if (numeric !== undefined) sanitized[key] = numeric;
    }

    const allowedStreams = new Set(['timeline', 'video', 'audio', 'container']);
    sanitized.issues = (Array.isArray(input.issues) ? input.issues : [])
        .slice(0, 20)
        .flatMap((rawIssue) => {
            if (!rawIssue || typeof rawIssue !== 'object') return [];
            const issue = rawIssue as Record<string, unknown>;
            const code = safeDiagnosticText(issue.code, 120);
            const message = safeDiagnosticText(issue.message, 800);
            if (!code && !message) return [];
            const safeIssue: ServerRenderDiagnostics['issues'][number] = {
                code: code || 'render_integrity_failed',
                message: message || 'A validação de integridade do render falhou.',
            };
            if (allowedStreams.has(String(issue.stream))) {
                safeIssue.stream = issue.stream as ServerRenderDiagnostics['issues'][number]['stream'];
            }
            const takeIndex = safeDiagnosticNumber(issue.takeIndex);
            if (takeIndex !== undefined && takeIndex >= 0) safeIssue.takeIndex = Math.floor(takeIndex);
            const takeId = safeDiagnosticText(issue.takeId, 160);
            if (takeId) safeIssue.takeId = takeId;
            for (const key of ['expected', 'actual', 'delta', 'tolerance'] as const) {
                const numeric = safeDiagnosticNumber(issue[key]);
                if (numeric !== undefined) safeIssue[key] = numeric;
            }
            return [safeIssue];
        });
    return sanitized;
};

const diagnosticValue = (value: number, unit: string) => {
    const rounded = Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return `${rounded}${unit}`;
};

/** Mensagem curta para a Activity, com o take e a medição que exigem ação. */
export const formatServerRenderFailure = (
    code: string | undefined,
    fallbackMessage: string | undefined,
    diagnostics: ServerRenderDiagnostics | undefined,
): string => {
    const issue = diagnostics?.issues[0];
    const safeCode = safeDiagnosticText(issue?.code || code, 120) || 'render_failed';
    const baseMessage = safeDiagnosticText(
        issue?.message || fallbackMessage || 'Falha ao montar o vídeo final.',
        800,
    );
    const takeLabel = issue?.takeIndex !== undefined
        ? `Take ${issue.takeIndex + 1}${issue.takeId ? ` (${issue.takeId})` : ''}: `
        : '';
    const unit = safeCode.includes('frame_count') ? ' quadros' : safeCode.includes('fps') ? ' fps' : 's';
    const measurement = issue?.expected !== undefined && issue.actual !== undefined
        ? ` Esperado ${diagnosticValue(issue.expected, unit)}; encontrado ${diagnosticValue(issue.actual, unit)}.`
        : '';
    const action = safeCode.includes('probe_failed')
        ? ' Tente exportar novamente. Se o erro persistir, selecione o arquivo original outra vez.'
        : safeCode.includes('take_')
        ? ' Ajuste o corte final desse take ou substitua o arquivo original e tente novamente.'
        : safeCode.includes('audio')
            ? ' Gere novamente o áudio mestre e tente exportar outra vez.'
            : safeCode.includes('frame_count') || safeCode.includes('video_duration')
                ? ' Revise o último take da timeline e tente exportar novamente.'
                : ' Revise a timeline e tente exportar novamente.';
    return `${safeCode}: ${takeLabel}${baseMessage}${measurement}${action}`.slice(0, 1_500);
};

export interface ExportResultDiagnostics {
    status: 'validated';
    exportJobId: string;
    sourceJobId?: string;
    projectId: string;
    expectedDurationSec: number;
    actualVideoDurationSec: number;
    actualAudioDurationSec: number;
    containerDurationSec?: number;
    outputFps: number;
    actualVideoFps?: number;
    videoFrameCount?: number;
    durationToleranceSec: number;
    videoDurationToleranceSec: number;
    titleCount: number;
    titleOrigin: 'ai' | 'fallback' | 'none' | 'manual';
    titleCoverage: TitleSemanticCoverage;
    warnings: StructuredExportWarning[];
    validatedAt: string;
}

const TITLE_ROLE_ORDER: TitleSemanticRole[] = ['hook', 'offer_or_benefit', 'cta'];
const TITLE_ROLE_LABELS: Record<TitleSemanticRole, string> = {
    hook: 'gancho',
    offer_or_benefit: 'oferta ou benefício',
    cta: 'CTA',
};

export const exportWarningSummary = (warnings: StructuredExportWarning[]): string | undefined => {
    if (!warnings.length) return undefined;
    const first = warnings[0].message.trim();
    const remainder = warnings.length - 1;
    return `${first}${remainder > 0 ? ` (+${remainder} advertência${remainder === 1 ? '' : 's'})` : ''}`.slice(0, 800);
};

const coverageAfterTimelineFit = (
    summary: TitleGenerationSummary | undefined,
    titles: TitleHook[],
): TitleSemanticCoverage => {
    const required = summary?.semanticCoverage?.required || TITLE_ROLE_ORDER.filter((role) =>
        titles.some((title) => title.semanticRoles?.includes(role))
    );
    const covered = required.filter((role) =>
        titles.some((title) => title.semanticRoles?.includes(role))
    );
    return {
        required,
        covered,
        missing: required.filter((role) => !covered.includes(role)),
    };
};

export const validateTitlesForExport = (
    inputTitles: TitleHook[] | undefined,
    expectedDurationSec: number,
    summary?: TitleGenerationSummary,
): { titles: TitleHook[]; coverage: TitleSemanticCoverage; warnings: StructuredExportWarning[] } => {
    const timelineDuration = Number(expectedDurationSec);
    const warnings: StructuredExportWarning[] = [];
    const titles = (inputTitles || []).filter((title) => title.isActive).flatMap((title) => {
        const startSec = Math.max(0, Number(title.startSec) || 0);
        if (!(timelineDuration > 0) || startSec >= timelineDuration) {
            warnings.push({
                code: 'title_outside_final_timeline',
                message: `O título “${title.text}” foi removido porque começava fora do vídeo.`,
                stage: 'titles',
                titleId: title.id,
            });
            return [];
        }
        const durationSec = Math.min(
            Math.max(0, Number(title.durationSec) || 0),
            timelineDuration - startSec,
        );
        if (durationSec < MIN_VISIBLE_EXPORT_TITLE_SEC) {
            warnings.push({
                code: 'title_visible_duration_too_short',
                message: `O título “${title.text}” foi removido porque ficaria visível por menos de ${MIN_VISIBLE_EXPORT_TITLE_SEC}s.`,
                stage: 'titles',
                titleId: title.id,
            });
            return [];
        }
        return [{
            ...title,
            startSec: Math.round(startSec * 1_000) / 1_000,
            durationSec: Math.round(durationSec * 1_000) / 1_000,
        }];
    });

    const coverage = coverageAfterTimelineFit(summary, titles);
    if (coverage.missing.length) {
        warnings.push({
            code: 'title_semantic_coverage_missing',
            message: `Cobertura de títulos incompleta: ${coverage.missing.map((role) => TITLE_ROLE_LABELS[role]).join(', ')}.`,
            stage: 'titles',
            missingRoles: coverage.missing,
        });
    }
    for (const warning of summary?.warnings || []) {
        // A cobertura semântica é recalculada acima depois de remover títulos
        // inativos/fora da timeline. Reaproveitar esse aviso histórico pode acusar
        // uma lacuna que o usuário já corrigiu manualmente.
        if (warning.code === 'title_semantic_coverage_missing') continue;
        if (!warning.code || warnings.some((current) => current.code === warning.code)) continue;
        warnings.push({
            code: warning.code,
            message: warning.message || summary?.warning || 'A geração de títulos concluiu com advertência.',
            stage: 'titles',
            missingRoles: warning.missingRoles,
        });
    }
    return { titles, coverage, warnings };
};

export const titleOriginForExport = (
    summary: TitleGenerationSummary | undefined,
    titleCount: number,
): ExportResultDiagnostics['titleOrigin'] => {
    if (!titleCount) return 'none';
    if (summary?.outcome === 'fallback') return 'fallback';
    if (summary?.outcome === 'ai') return 'ai';
    return 'manual';
};
