import { normalizeBrandPalette } from './brandPalette';
import {
    gatewayApi,
    type OpsCompany,
    type OpsIntegrationStatus,
    type OpsViewContext,
} from './gateway';
import type { AdData, BrandPalette, OpsProjectCompany } from '../types';

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

export const loadOpsBrandDirectory = async (company?: OpsProjectCompany | null): Promise<OpsBrandDirectory> => {
    const status = await gatewayApi.opsConnection();
    const required = opsConnectionRequiresCompany(status);
    const linked = status.userLink?.status === 'confirmed';
    if (!required || !linked) {
        return { status, required, linked, contexts: [], context: null, companies: [] };
    }

    const response = await gatewayApi.opsViewContexts();
    const contexts = Array.isArray(response.data?.contexts) ? response.data.contexts : [];
    const context = preferredContext(contexts, response.data.defaultContextId, company);
    const companies = context
        ? (await gatewayApi.opsCompanies('', context.contextId)).data.filter(isRealOpsCompany)
        : [];
    return { status, required, linked, contexts, context, companies };
};

export interface ResolvedOpsProjectBrand {
    required: boolean;
    company: OpsCompany | null;
    context: OpsViewContext | null;
    palette: BrandPalette | null;
    paletteUpdatedAt: string | null;
}

export const resolveOpsProjectBrand = async (selection?: OpsProjectCompany | null): Promise<ResolvedOpsProjectBrand> => {
    const directory = await loadOpsBrandDirectory(selection);
    if (!directory.required) {
        return { required: false, company: null, context: null, palette: null, paletteUpdatedAt: null };
    }
    if (!directory.linked) throw new Error('Seu usuário precisa estar vinculado ao Mileto Ops antes de continuar.');
    if (!selection?.id) throw new Error('Selecione a empresa do Mileto Ops usada neste projeto.');
    const company = directory.companies.find((candidate) => candidate.id === selection.id);
    if (!company) throw new Error('A empresa deste projeto não está disponível no contexto autorizado do Mileto Ops.');
    const palette = normalizeBrandPalette(company.palette);
    return {
        required: true,
        company,
        context: directory.context,
        palette,
        paletteUpdatedAt: palette ? company.paletteUpdatedAt ?? null : null,
    };
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
    const colors = [palette.primary, palette.secondary, palette.tertiary].map(normalizeHex).filter((value): value is string => !!value);
    return colors.length ? colors[index % colors.length] : null;
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
