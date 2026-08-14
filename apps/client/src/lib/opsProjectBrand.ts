import { normalizeBrandPalette } from './brandPalette';
import {
    gatewayApi,
    type OpsCompany,
    type OpsIntegrationStatus,
    type OpsViewContext,
} from './gateway';
import type { AdData, BrandPalette, OpsProjectCompany } from '../types';

export const OPS_BRAND_DIRECTORY_CACHE_TTL_MS = 30_000;
export const OPS_BRAND_RESOLUTION_DEADLINE_MS = 10_000;

export interface ResolveOpsProjectBrandOptions {
    signal?: AbortSignal;
    deadlineMs?: number;
}

type TimedCacheEntry<T> = {
    value: T;
    expiresAt: number;
};

type OpsBrandAccess = Omit<OpsBrandDirectory, 'companies'>;

const accessCache = new Map<string, TimedCacheEntry<OpsBrandAccess>>();
const accessRequests = new Map<string, Promise<OpsBrandAccess>>();
const directoryCache = new Map<string, TimedCacheEntry<OpsBrandDirectory>>();
const directoryRequests = new Map<string, Promise<OpsBrandDirectory>>();
const resolvedBrandCache = new Map<string, TimedCacheEntry<ResolvedOpsProjectBrand>>();
const resolvedBrandRequests = new Map<string, Promise<ResolvedOpsProjectBrand>>();
let cacheEpoch = 0;

const selectionCacheKey = (selection?: OpsProjectCompany | null) => [
    String(selection?.id || 'none').trim(),
    String(selection?.viewContextIdentity || 'default').trim().toLocaleLowerCase('pt-BR'),
].map(encodeURIComponent).join(':');

const cachedValue = <T,>(cache: Map<string, TimedCacheEntry<T>>, key: string): T | undefined => {
    const cached = cache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
        cache.delete(key);
        return undefined;
    }
    return cached.value;
};

const brandAbortError = (message = 'Consulta da marca cancelada.') => {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
};

const waitForSharedRequest = <T,>(request: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (!signal) return request;
    if (signal.aborted) return Promise.reject(brandAbortError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            cleanup();
            reject(brandAbortError());
        };
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        signal.addEventListener('abort', onAbort, { once: true });
        request.then(
            (value) => { cleanup(); resolve(value); },
            (error) => { cleanup(); reject(error); },
        );
    });
};

const runWithBrandDeadline = <T,>(
    operation: (signal: AbortSignal) => Promise<T>,
    deadlineMs: number,
): Promise<T> => {
    const controller = new AbortController();
    const safeDeadline = Number.isFinite(deadlineMs) && deadlineMs > 0
        ? Math.round(deadlineMs)
        : OPS_BRAND_RESOLUTION_DEADLINE_MS;
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            globalThis.clearTimeout(timeout);
            callback();
        };
        const timeout = globalThis.setTimeout(() => {
            controller.abort();
            finish(() => reject(new Error('O Mileto Ops excedeu o prazo seguro ao confirmar a marca.')));
        }, safeDeadline);
        operation(controller.signal).then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error)),
        );
    });
};

/**
 * Limpa status, contextos, empresas e paletas mantidos apenas em memória.
 * Deve ser chamada quando a sessão ou a conexão do Ops mudar.
 */
export const invalidateOpsBrandDirectoryCache = () => {
    cacheEpoch += 1;
    accessCache.clear();
    accessRequests.clear();
    directoryCache.clear();
    directoryRequests.clear();
    resolvedBrandCache.clear();
    resolvedBrandRequests.clear();
};

export const opsViewContextIdentity = (context: Pick<OpsViewContext, 'mode' | 'label' | 'subtitle'>) =>
    `${context.mode}:${context.label.trim().toLocaleLowerCase('pt-BR')}:${context.subtitle.trim().toLocaleLowerCase('pt-BR')}`;

export const opsProjectCompanyName = (company: Pick<OpsCompany, 'name' | 'nome'>) =>
    company.name || company.nome || 'Empresa sem nome';

export const isRealOpsCompany = (company: OpsCompany) => company.kind !== 'archive';

export const opsConnectionRequiresCompany = (status: OpsIntegrationStatus) =>
    status.connection?.status === 'active';

export interface OpsBrandDirectory {
    status: OpsIntegrationStatus;
    required: boolean;
    linked: boolean;
    contexts: OpsViewContext[];
    context: OpsViewContext | null;
    companies: OpsCompany[];
}

const preferredContext = (contexts: OpsViewContext[], defaultContextId: string, company?: OpsProjectCompany | null) => {
    const identity = company?.viewContextIdentity;
    return (identity ? contexts.find((context) => opsViewContextIdentity(context) === identity) : null)
        || contexts.find((context) => context.contextId === defaultContextId)
        || contexts.find((context) => context.mode === 'self')
        || contexts[0]
        || null;
};

const fetchOpsBrandAccess = async (
    company?: OpsProjectCompany | null,
    signal?: AbortSignal,
): Promise<OpsBrandAccess> => {
    const status = await gatewayApi.opsConnection(signal);
    const required = opsConnectionRequiresCompany(status);
    const linked = status.userLink?.status === 'confirmed';
    if (!required || !linked) {
        return { status, required, linked, contexts: [], context: null };
    }

    const response = await gatewayApi.opsViewContexts(signal);
    const contexts = Array.isArray(response.data?.contexts) ? response.data.contexts : [];
    const context = preferredContext(contexts, response.data.defaultContextId, company);
    return { status, required, linked, contexts, context };
};

const loadOpsBrandAccess = async (
    company?: OpsProjectCompany | null,
    signal?: AbortSignal,
): Promise<OpsBrandAccess> => {
    const key = selectionCacheKey(company);
    const cached = cachedValue(accessCache, key);
    if (cached) return cached;
    const pending = accessRequests.get(key);
    if (pending) return pending;

    const requestEpoch = cacheEpoch;
    const request = fetchOpsBrandAccess(company, signal).then((access) => {
        if (requestEpoch === cacheEpoch) {
            accessCache.set(key, {
                value: access,
                expiresAt: Date.now() + OPS_BRAND_DIRECTORY_CACHE_TTL_MS,
            });
        }
        return access;
    }).finally(() => {
        if (accessRequests.get(key) === request) accessRequests.delete(key);
    });
    accessRequests.set(key, request);
    return request;
};

const fetchOpsBrandDirectory = async (company?: OpsProjectCompany | null): Promise<OpsBrandDirectory> => {
    const access = await loadOpsBrandAccess(company);
    const { context } = access;
    const companies = context
        ? (await gatewayApi.opsCompanies('', context.contextId)).data.filter(isRealOpsCompany)
        : [];
    return { ...access, companies };
};

export const loadOpsBrandDirectory = async (company?: OpsProjectCompany | null): Promise<OpsBrandDirectory> => {
    const key = selectionCacheKey(company);
    const cached = cachedValue(directoryCache, key);
    if (cached) return cached;

    const pending = directoryRequests.get(key);
    if (pending) return pending;

    const requestEpoch = cacheEpoch;
    const request = fetchOpsBrandDirectory(company).then((directory) => {
        if (requestEpoch === cacheEpoch) {
            directoryCache.set(key, {
                value: directory,
                expiresAt: Date.now() + OPS_BRAND_DIRECTORY_CACHE_TTL_MS,
            });
        }
        return directory;
    }).finally(() => {
        if (directoryRequests.get(key) === request) directoryRequests.delete(key);
    });
    directoryRequests.set(key, request);
    return request;
};

export interface ResolvedOpsProjectBrand {
    required: boolean;
    company: OpsCompany | null;
    context: OpsViewContext | null;
    palette: BrandPalette | null;
    paletteUpdatedAt: string | null;
}

export const resolveOpsProjectBrand = async (
    selection?: OpsProjectCompany | null,
    options: ResolveOpsProjectBrandOptions = {},
): Promise<ResolvedOpsProjectBrand> => {
    if (options.signal?.aborted) throw brandAbortError();
    const key = selectionCacheKey(selection);
    const cached = cachedValue(resolvedBrandCache, key);
    if (cached) return cached;

    const pending = resolvedBrandRequests.get(key);
    if (pending) return waitForSharedRequest(pending, options.signal);

    const requestEpoch = cacheEpoch;
    const request = runWithBrandDeadline(async (signal): Promise<ResolvedOpsProjectBrand> => {
        const access = await loadOpsBrandAccess(selection, signal);
        if (!access.required) {
            return { required: false, company: null, context: null, palette: null, paletteUpdatedAt: null };
        }
        if (!access.linked) throw new Error('Seu usuário precisa estar vinculado ao Mileto Ops antes de continuar.');
        if (!selection?.id) throw new Error('Selecione a empresa do Mileto Ops usada neste projeto.');
        if (!access.context) throw new Error('O contexto autorizado do Mileto Ops não está disponível.');
        const company = (await gatewayApi.opsCompany(selection.id, access.context.contextId, signal)).data;
        if (!company || !isRealOpsCompany(company)) {
            throw new Error('A empresa deste projeto não está disponível no contexto autorizado do Mileto Ops.');
        }
        const palette = normalizeBrandPalette(company.palette);
        return {
            required: true,
            company,
            context: access.context,
            palette,
            paletteUpdatedAt: palette ? company.paletteUpdatedAt ?? null : null,
        };
    }, options.deadlineMs ?? OPS_BRAND_RESOLUTION_DEADLINE_MS).then((resolved) => {
        if (requestEpoch === cacheEpoch) {
            resolvedBrandCache.set(key, {
                value: resolved,
                expiresAt: Date.now() + OPS_BRAND_DIRECTORY_CACHE_TTL_MS,
            });
        }
        return resolved;
    }).finally(() => {
        if (resolvedBrandRequests.get(key) === request) resolvedBrandRequests.delete(key);
    });
    resolvedBrandRequests.set(key, request);
    return waitForSharedRequest(request, options.signal);
};

const normalizeHex = (value: unknown) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim())
    ? String(value).toLowerCase()
    : null;

export const contrastColor = (background: string): '#000000' | '#ffffff' => {
    const color = normalizeHex(background);
    if (!color) return '#ffffff';
    const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
};

export const resolvePaletteSlot = (palette: BrandPalette | null | undefined, slot: 'rotate' | 'primary' | 'secondary' | 'tertiary', index = 0) => {
    if (!palette) return null;
    if (slot !== 'rotate') return normalizeHex(palette[slot]);
    // Mesma base do servidor (distinctPaletteColors): inclui palette.all e
    // deduplica, senão o mesmo rotationIndex aponta cores diferentes nos dois lados.
    const colors = Array.from(new Set(
        [palette.primary, palette.secondary, palette.tertiary, ...(Array.isArray(palette.all) ? palette.all : [])]
            .map(normalizeHex)
            .filter((value): value is string => !!value)
    ));
    return colors.length ? colors[index % colors.length] : null;
};

/**
 * Resolve o par de cores de um título modo "paleta da empresa" exatamente como o
 * servidor fará na geração (slot + ocorrência). Usado pelos previews para nunca
 * divergirem do vídeo real.
 */
export const brandSlotPreviewColors = (
    palette: BrandPalette | null | undefined,
    slot: 'rotate' | 'primary' | 'secondary' | 'tertiary',
    index = 0,
): { primaryColor: string; secondaryColor: string } | null => {
    const primary = resolvePaletteSlot(palette, slot, index);
    if (!primary) return null;
    const secondarySlot = slot === 'primary'
        ? 'secondary'
        : slot === 'secondary' || slot === 'tertiary'
          ? 'primary'
          : 'rotate';
    const secondary = resolvePaletteSlot(palette, secondarySlot, secondarySlot === 'rotate' ? index + 1 : index);
    return {
        primaryColor: primary,
        secondaryColor: !secondary || secondary === primary ? contrastColor(primary) : secondary,
    };
};

export const bindTitlesToBrandPalette = (adData: Pick<AdData, 'dynamicTitles' | 'brandPalette'>) =>
    (adData.dynamicTitles || []).map((title, index) => {
        if (title.colorBinding?.mode !== 'brand') return title;
        const rotationIndex = title.colorBinding.rotationIndex ?? index;
        const primary = resolvePaletteSlot(adData.brandPalette, title.colorBinding.paletteSlot, rotationIndex)
            || normalizeHex(title.colorBinding.fallbackPrimary)
            || '#00e676';
        const fallbackSecondarySlot = title.colorBinding.paletteSlot === 'primary'
            ? 'secondary'
            : title.colorBinding.paletteSlot === 'secondary' || title.colorBinding.paletteSlot === 'tertiary'
              ? 'primary'
              : 'rotate';
        const secondarySlot = title.colorBinding.secondaryPaletteSlot || fallbackSecondarySlot;
        const secondary = resolvePaletteSlot(
            adData.brandPalette,
            secondarySlot,
            secondarySlot === 'rotate' ? rotationIndex + 1 : rotationIndex
        ) || normalizeHex(title.colorBinding.fallbackSecondary) || contrastColor(primary);
        return {
            ...title,
            primaryColor: primary,
            secondaryColor: secondary === primary ? contrastColor(primary) : secondary,
        };
    });
