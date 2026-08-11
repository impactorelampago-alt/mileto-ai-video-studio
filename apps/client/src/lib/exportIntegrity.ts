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
    issues: Array<{ code: string; message: string }>;
}

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
