export interface OpsExportMetadata {
    title: string;
    description: string;
    narrationSummary: string;
    sourceProjectId: string;
    sourceProjectTitle: string;
}

export interface OpsExportMetadataInput {
    projectId: string;
    projectTitle: string;
    narrationText?: string | null;
    mediaTakeCount?: number;
    title?: string | null;
    description?: string | null;
}

const LIMITS = {
    title: 200,
    description: 2_000,
    narrationSummary: 4_000,
    sourceProjectId: 200,
    sourceProjectTitle: 200,
} as const;

export const compactOpsText = (value: unknown): string =>
    String(value ?? '')
        .normalize('NFC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

export const cleanFinalNarration = (value: unknown): string =>
    compactOpsText(
        String(value ?? '')
            // Marcações de interpretação do Fish Audio e tags internas não fazem
            // parte da mensagem editorial entregue ao Gestor de Tráfego.
            .replace(/\[(?:[a-z][\w -]{0,40})(?::[^\]]*)?\]/gi, ' ')
            .replace(/<\/?[a-z][^>]*>/gi, ' ')
            .replace(/(?:^|\s)[#>*_-]+(?=\s)/g, ' ')
    );

const sentences = (text: string): string[] =>
    (text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [])
        .map(compactOpsText)
        .filter(Boolean);

const editorialScore = (sentence: string, index: number): number => {
    const normalized = sentence.toLocaleLowerCase('pt-BR');
    let score = index === 0 ? 5 : 0;
    if (/r\$|\bpre[çc]o\b|\bgr[aá]tis\b|\bdesconto\b|\bparcela|\bpromo[çc][aã]o\b|\boferta\b|\bcondi[çc][aã]o/.test(normalized)) score += 5;
    if (/\bclique\b|\bchame\b|whats ?app|\bcompre\b|\bagende\b|\bacesse\b|\bgaranta\b|\baproveite\b|\breserve\b/.test(normalized)) score += 6;
    if (/\bat[eé]\b|\bs[oó] hoje\b|\bs[oó] at[eé]\b|\bestoque\b|\bvagas?\b|\bunidades?\b/.test(normalized)) score += 3;
    return score;
};
const clipAtWordBoundary = (value: string, max: number): string => {
    if (value.length <= max) return value;
    const clipped = value.slice(0, max + 1);
    const boundary = clipped.lastIndexOf(' ');
    return compactOpsText(clipped.slice(0, boundary > max * 0.7 ? boundary : max));
};

export const summarizeFinalNarration = (narrationText: unknown, maxSentences = 3): string => {
    const clean = cleanFinalNarration(narrationText);
    if (!clean) return '';
    const parts = sentences(clean);
    if (parts.length <= maxSentences) return clipAtWordBoundary(parts.join(' '), LIMITS.description);

    const selectedIndexes = new Set<number>([0]);
    parts
        .map((sentence, index) => ({ index, score: editorialScore(sentence, index) }))
        .filter((candidate) => candidate.index > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, Math.max(0, maxSentences - 1))
        .forEach((candidate) => selectedIndexes.add(candidate.index));

    return clipAtWordBoundary(
        [...selectedIndexes].sort((left, right) => left - right).map((index) => parts[index]).join(' '),
        LIMITS.description
    );
};

export const detailedNarrationSummary = (narrationText: unknown): string =>
    clipAtWordBoundary(cleanFinalNarration(narrationText), LIMITS.narrationSummary);

const fallbackDescription = (projectTitle: string, mediaTakeCount = 0): string => {
    const takeText = mediaTakeCount === 1 ? '1 take visual' : `${Math.max(0, mediaTakeCount)} takes visuais`;
    return compactOpsText(`Vídeo do projeto “${projectTitle}”, composto por ${takeText} e sem narração.`);
};

const assertRequired = (field: string, value: string) => {
    if (!value) throw new Error(`${field} é obrigatório para exportar ao Mileto Ops.`);
};

const assertLimit = (field: string, value: string, max: number) => {
    if (value.length > max) throw new Error(`${field} excede o limite de ${max} caracteres do Mileto Ops.`);
};

export const validateOpsExportMetadata = (metadata: OpsExportMetadata): OpsExportMetadata => {
    const normalized: OpsExportMetadata = {
        title: compactOpsText(metadata.title),
        description: compactOpsText(metadata.description),
        narrationSummary: compactOpsText(metadata.narrationSummary),
        sourceProjectId: compactOpsText(metadata.sourceProjectId),
        sourceProjectTitle: compactOpsText(metadata.sourceProjectTitle),
    };
    assertRequired('title', normalized.title);
    assertRequired('description', normalized.description);
    assertRequired('sourceProjectId', normalized.sourceProjectId);
    assertRequired('sourceProjectTitle', normalized.sourceProjectTitle);
    assertLimit('title', normalized.title, LIMITS.title);
    assertLimit('description', normalized.description, LIMITS.description);
    assertLimit('narrationSummary', normalized.narrationSummary, LIMITS.narrationSummary);
    assertLimit('sourceProjectId', normalized.sourceProjectId, LIMITS.sourceProjectId);
    assertLimit('sourceProjectTitle', normalized.sourceProjectTitle, LIMITS.sourceProjectTitle);
    return normalized;
};

/**
 * Cria o snapshot editorial usado pela revisão e pelo upload. `title` e
 * `description`, quando informados, representam a revisão explícita do usuário;
 * a origem do projeto continua imutável em sourceProject*.
 */
export const prepareOpsExportMetadata = (input: OpsExportMetadataInput): OpsExportMetadata => {
    const projectTitle = compactOpsText(input.projectTitle);
    const projectId = compactOpsText(input.projectId);
    const narrationSummary = detailedNarrationSummary(input.narrationText);
    const generatedDescription = narrationSummary
        ? summarizeFinalNarration(input.narrationText)
        : fallbackDescription(projectTitle, Number(input.mediaTakeCount) || 0);

    return validateOpsExportMetadata({
        title: input.title == null ? projectTitle : compactOpsText(input.title),
        description: input.description == null ? generatedDescription : compactOpsText(input.description),
        narrationSummary: narrationSummary || generatedDescription,
        sourceProjectId: projectId,
        sourceProjectTitle: projectTitle,
    });
};
