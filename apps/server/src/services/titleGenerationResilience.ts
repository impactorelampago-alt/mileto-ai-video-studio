export const AUTOMATIC_TITLES_UNAVAILABLE_WARNING =
    'Títulos automáticos indisponíveis; vídeo concluído sem títulos';
export const AUTOMATIC_TITLES_FALLBACK_WARNING =
    'Títulos gerados pelo fallback local após indisponibilidade da IA.';

export type TitleGenerationSource = 'ai' | 'local' | 'none';

export type TitleGenerationDiagnostic = {
    phase: string;
    code: string;
    status: number;
    retryable: boolean;
    message: string;
    requestId?: string;
};

type ErrorLike = {
    status?: unknown;
    code?: unknown;
};

const TRANSIENT_STATUSES = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

const finiteStatus = (error: unknown): number => {
    const value = Number((error as ErrorLike | null)?.status);
    return Number.isInteger(value) && value >= 0 && value <= 599 ? value : 0;
};

export const isTransientTitleGenerationError = (error: unknown): boolean =>
    TRANSIENT_STATUSES.has(finiteStatus(error));

const safeCode = (error: unknown, status: number) => {
    const candidate = String((error as ErrorLike | null)?.code || '').trim();
    if (/^[a-z0-9_.-]{1,80}$/i.test(candidate)) return candidate;
    if (status === 401) return 'title_auth_expired';
    if (status === 402) return 'title_credits_exhausted';
    if (status === 403) return 'title_scope_denied';
    if (status === 404) return 'title_resource_not_found';
    if (status === 408 || status === 504) return 'title_generation_timeout';
    if (status === 429) return 'title_generation_rate_limited';
    if (status >= 500) return 'title_provider_unavailable';
    return 'title_generation_failed';
};

const safeMessage = (status: number) => {
    if (status === 401) return 'A sessão expirou durante a geração de títulos.';
    if (status === 402) return 'Os créditos de IA não são suficientes para gerar títulos.';
    if (status === 403) return 'O contexto atual não permite gerar títulos para esta empresa.';
    if (status === 404) return 'Um recurso necessário para gerar títulos não foi encontrado.';
    if (status === 408 || status === 504) return 'A geração de títulos excedeu o tempo limite.';
    if (status === 429) return 'O serviço de títulos está temporariamente sobrecarregado.';
    if (status >= 500 || status === 0) return 'O serviço de títulos está temporariamente indisponível.';
    return 'Não foi possível concluir a geração automática de títulos.';
};

export const titleGenerationDiagnostic = (
    error: unknown,
    phase: string,
    requestId?: string,
): TitleGenerationDiagnostic => {
    const status = finiteStatus(error);
    return {
        phase,
        code: safeCode(error, status),
        status,
        retryable: isTransientTitleGenerationError(error),
        message: safeMessage(status),
        ...(requestId ? { requestId } : {}),
    };
};

export const logTitleGenerationDiagnostic = (
    event: string,
    diagnostic: TitleGenerationDiagnostic,
) => {
    // O diagnóstico é deliberadamente limitado a campos seguros. Nunca serializamos
    // o erro original, headers, body do provedor, token, stack ou resposta upstream.
    console.warn('[title-generation]', JSON.stringify({ event, ...diagnostic }));
};

type ResilientGenerationOptions<T> = {
    primary?: () => Promise<T[]>;
    fallback: () => Promise<T[]>;
    maxAttempts?: number;
    skipPrimary?: boolean;
    phase?: string;
    requestId?: string;
    wait?: (milliseconds: number) => Promise<void>;
};

export type ResilientGenerationResult<T> = {
    items: T[];
    source: TitleGenerationSource;
    attempts: number;
    warning?: string;
    diagnostic?: TitleGenerationDiagnostic;
};

const defaultWait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const runResilientTitleGeneration = async <T>({
    primary,
    fallback,
    maxAttempts = 1,
    skipPrimary = false,
    phase = 'ai',
    requestId,
    wait = defaultWait,
}: ResilientGenerationOptions<T>): Promise<ResilientGenerationResult<T>> => {
    let attempts = 0;
    let diagnostic: TitleGenerationDiagnostic | undefined;

    if (!skipPrimary && primary) {
        // A retry real pertence ao gateway. O padrão de uma chamada evita
        // amplificação e duplicação de cobrança; o teto de duas existe apenas
        // para chamadores legados que o solicitarem explicitamente.
        const cappedAttempts = Math.max(1, Math.min(2, Math.floor(maxAttempts)));
        while (attempts < cappedAttempts) {
            attempts += 1;
            try {
                const items = await primary();
                if (Array.isArray(items) && items.length > 0) {
                    return { items, source: 'ai', attempts };
                }
                break;
            } catch (error) {
                diagnostic = titleGenerationDiagnostic(error, phase, requestId);
                if (!diagnostic.retryable || attempts >= cappedAttempts) break;
                await wait(200 * (2 ** (attempts - 1)));
            }
        }
    }

    try {
        const items = await fallback();
        if (Array.isArray(items) && items.length > 0) {
            return { items, source: 'local', attempts, diagnostic };
        }
    } catch (error) {
        diagnostic = titleGenerationDiagnostic(error, 'local_fallback', requestId);
    }

    return {
        items: [],
        source: 'none',
        attempts,
        warning: AUTOMATIC_TITLES_UNAVAILABLE_WARNING,
        diagnostic,
    };
};
