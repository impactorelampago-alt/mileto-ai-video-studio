import fs from 'node:fs';
import path from 'node:path';
import { isSafeRemoteUrl } from '../utils/safePath';

interface HybridTakeInput {
    id?: unknown;
    file_path?: unknown;
}

export interface MissingHybridInput {
    kind: 'take' | 'transition';
    reason: 'missing' | 'unsafe';
    index?: number;
    takeId?: string;
}

const safeTakeId = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    if (!normalized || normalized.length > 160 || !/^[a-z0-9._:-]+$/i.test(normalized)) return undefined;
    return normalized;
};

const isRemoteUrl = (value: string): boolean => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const isTrustedSharedMediaUrl = (value: string): boolean => {
    if (!isSafeRemoteUrl(value)) return false;
    try {
        const parsed = new URL(value);
        const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
        const r2Suffix = '.r2.cloudflarestorage.com';
        const r2Prefix = hostname.endsWith(r2Suffix)
            ? hostname.slice(0, -r2Suffix.length)
            : '';
        // Takes remotos do produto são links assinados emitidos pelo nosso
        // bucket privado R2. Restringir o FFmpeg a esse endpoint evita que uma
        // URL pública arbitrária redirecione para loopback/rede interna, algo
        // que o processo nativo não oferece como revalidar por hop.
        return parsed.protocol === 'https:'
            && (!parsed.port || parsed.port === '443')
            && Boolean(r2Prefix)
            && r2Prefix.split('.').every(
                (label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
            );
    } catch {
        return false;
    }
};

const inputAvailability = (value: unknown): 'available' | MissingHybridInput['reason'] => {
    if (typeof value !== 'string' || !value.trim()) return 'missing';
    const normalized = value.trim();
    // O FFmpeg também recebe URLs do Compartilhado. A disponibilidade remota
    // é verificada pela própria conexão; aqui recusamos destinos locais/privados
    // antes de entregar a URL ao processo, evitando SSRF pela entrada de vídeo.
    if (isRemoteUrl(normalized)) return isTrustedSharedMediaUrl(normalized) ? 'available' : 'unsafe';
    // UNC e caminhos de dispositivo acionam SMB/drivers antes mesmo do FFmpeg.
    // Eles nunca são produzidos pelos imports locais do Mileto.
    if (/^(?:\\\\|\/\/|\\\\[?.]\\)/.test(normalized) || !path.isAbsolute(normalized)) {
        return 'unsafe';
    }
    try {
        const stats = fs.statSync(normalized);
        return stats.isFile() && stats.size > 0 ? 'available' : 'missing';
    } catch {
        return 'missing';
    }
};

/** Identifica a primeira entrada ausente sem devolver o caminho privado. */
export const findMissingHybridInput = (
    takesValue: unknown,
    transitionPathValue?: unknown,
): MissingHybridInput | null => {
    const takes = Array.isArray(takesValue) ? takesValue as HybridTakeInput[] : [];
    for (let index = 0; index < takes.length; index += 1) {
        const reason = inputAvailability(takes[index]?.file_path);
        if (reason !== 'available') {
            const takeId = safeTakeId(takes[index]?.id);
            return { kind: 'take', reason, index, ...(takeId ? { takeId } : {}) };
        }
    }
    if (transitionPathValue) {
        const reason = inputAvailability(transitionPathValue);
        if (reason !== 'available') return { kind: 'transition', reason };
    }
    return null;
};

export const missingHybridInputHttpFailure = (input: MissingHybridInput) => {
    if (input.kind === 'take') {
        const takeNumber = Math.max(1, Number(input.index) + 1);
        if (input.reason === 'unsafe') {
            return {
                status: 422 as const,
                body: {
                    ok: false as const,
                    code: 'render_take_source_not_allowed',
                    message: `A origem remota do take ${takeNumber} não é permitida por segurança. Selecione uma mídia válida e tente novamente.`,
                    retryable: false,
                    input,
                },
            };
        }
        return {
            status: 422 as const,
            body: {
                ok: false as const,
                code: 'render_take_source_missing',
                message: `O arquivo do take ${takeNumber} não está disponível. Reabra o projeto ou adicione esse take novamente antes de exportar.`,
                retryable: true,
                input,
            },
        };
    }
    if (input.reason === 'unsafe') {
        return {
            status: 422 as const,
            body: {
                ok: false as const,
                code: 'render_transition_source_not_allowed',
                message: 'A origem remota da transição não é permitida por segurança. Selecione uma transição válida.',
                retryable: false,
                input,
            },
        };
    }
    return {
        status: 422 as const,
        body: {
            ok: false as const,
            code: 'render_transition_source_missing',
            message: 'A transição selecionada não está mais disponível neste computador. Selecione-a novamente.',
            retryable: true,
            input,
        },
    };
};
