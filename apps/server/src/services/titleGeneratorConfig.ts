import { gatewayJson, GatewayHttpError } from './gatewayClient';

export type VideoFormat = '9:16' | '16:9' | '4:5' | '1:1';

export type TitleColorRule = {
    mode: 'brand' | 'fixed';
    paletteSlot: 'rotate' | 'primary' | 'secondary' | 'tertiary';
    primary: string;
    secondary: string;
};
export type TitleLayout = {
    posX: number;
    posY: number;
    scale: number;
    scaleX?: number;
    scaleY?: number;
    textBoxWidthPct: number;
};

export type TitleTypeRule = {
    id: string;
    name: string;
    styleId: string;
    fontFamily: string;
    durationSec: number;
    animationId: 'pop' | 'fade' | 'slide' | 'blink' | 'none';
    color: TitleColorRule | null;
    layouts: Record<VideoFormat, TitleLayout>;
};

export type TitleTriggerRule = {
    id: string;
    name: string;
    enabled: boolean;
    maxOccurrences: number;
    instructions: string;
    examples: string[];
    sample: string;
    color: TitleColorRule;
    titleTypes: TitleTypeRule[];
};

export type TitleGeneratorConfig = {
    version: number;
    extractionPrompt: string;
    maxTitles: number;
    triggers: TitleTriggerRule[];
};

const formats: VideoFormat[] = ['9:16', '16:9', '4:5', '1:1'];
const animations = new Set<TitleTypeRule['animationId']>(['pop', 'fade', 'slide', 'blink', 'none']);
const colorModes = new Set<TitleColorRule['mode']>(['brand', 'fixed']);
const paletteSlots = new Set<TitleColorRule['paletteSlot']>(['rotate', 'primary', 'secondary', 'tertiary']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const numberInRange = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const text = (value: unknown, fallback: string, maxLength: number) => {
    const normalized = String(value ?? '').trim();
    return (normalized || fallback).slice(0, maxLength);
};

const color = (value: unknown, fallback: string) => {
    const normalized = String(value || '').trim();
    return HEX_COLOR.test(normalized) ? normalized.toLowerCase() : fallback;
};

const layouts = (portraitY: number, landscapeY: number, scale = 1, width = 78): Record<VideoFormat, TitleLayout> => ({
    '9:16': { posX: 50, posY: portraitY, scale, scaleX: 1, scaleY: 1, textBoxWidthPct: width },
    '16:9': { posX: 50, posY: landscapeY, scale: scale * 0.9, scaleX: 1, scaleY: 1, textBoxWidthPct: Math.min(width, 64) },
    '4:5': { posX: 50, posY: portraitY, scale: scale * 0.95, scaleX: 1, scaleY: 1, textBoxWidthPct: Math.min(width, 74) },
    '1:1': { posX: 50, posY: landscapeY, scale: scale * 0.92, scaleX: 1, scaleY: 1, textBoxWidthPct: Math.min(width, 70) },
});

const brandColor = (paletteSlot: TitleColorRule['paletteSlot'] = 'rotate'): TitleColorRule => ({
    mode: 'brand',
    paletteSlot,
    primary: '#00e676',
    secondary: '#07110d',
});

const fixedColor = (primary: string, secondary: string): TitleColorRule => ({
    mode: 'fixed',
    paletteSlot: 'primary',
    primary,
    secondary,
});

const titleType = (
    styleId: string,
    name: string,
    fontFamily: string,
    layout: Record<VideoFormat, TitleLayout>,
    animationId: TitleTypeRule['animationId'],
    titleColor: TitleColorRule
): TitleTypeRule => ({
    id: styleId,
    name,
    styleId,
    fontFamily,
    durationSec: 2.5,
    animationId,
    color: titleColor,
    layouts: layout,
});

/**
 * Compatibilidade local para instalações cujo gateway ainda não publicou a rota
 * efetiva da organização. A configuração salva no gateway sempre tem prioridade.
 */
export const DEFAULT_TITLE_GENERATOR_CONFIG: TitleGeneratorConfig = {
    version: 2,
    extractionPrompt: 'Selecione apenas trechos literais da narração que aumentem clareza ou conversão. Nunca invente texto, preço, benefício, bônus, urgência ou localização.',
    maxTitles: 8,
    triggers: [
        {
            id: 'scarcity',
            name: 'Escassez e urgência',
            enabled: true,
            maxOccurrences: 2,
            instructions: 'Prazo, quantidade, vagas, lote ou estoque limitado somente quando forem pronunciados explicitamente.',
            examples: ['Somente até sábado', 'Últimas 8 unidades', '3 vagas'],
            sample: 'SOMENTE ATÉ SÁBADO',
            color: brandColor('primary'),
            titleTypes: [
                titleType('premium-urgency-pulse', 'Urgency Pulse', 'Anton', layouts(34, 30, 0.95, 76), 'pop', fixedColor('#ff3b30', '#ffffff')),
                titleType('premium-coupon-ticket', 'Coupon Ticket', 'Space Grotesk', layouts(38, 34, 0.9, 74), 'slide', fixedColor('#7cff6b', '#101510')),
            ],
        },
        {
            id: 'region',
            name: 'Região',
            enabled: true,
            maxOccurrences: 1,
            instructions: 'Cidade, estado, país, bairro, região ou área atendida. Nunca invente nem repita a localização.',
            examples: ['Casimiro de Abreu', 'Rio de Janeiro', 'Todo o Brasil'],
            sample: 'CASIMIRO DE ABREU',
            color: brandColor('tertiary'),
            titleTypes: [
                titleType('loc-pin-viagem', 'Pin de Viagem', 'Inter', layouts(62, 68, 0.78, 62), 'fade', fixedColor('#00e676', '#ffffff')),
                titleType('loc-minimal-urbano', 'Localização Minimalista', 'Inter', layouts(68, 72, 0.72, 60), 'fade', fixedColor('#00e676', '#ffffff')),
            ],
        },
        {
            id: 'cta',
            name: 'CTA',
            enabled: true,
            maxOccurrences: 1,
            instructions: 'Clique, chame, agende, compre, visite ou outra ação explicitamente pronunciada.',
            examples: ['Clique aqui', 'Chame no WhatsApp', 'Saiba mais'],
            sample: 'CLIQUE AQUI',
            color: brandColor('primary'),
            titleTypes: [
                titleType('cta-whatsapp', 'Balão WhatsApp', 'Inter', layouts(58, 64, 0.72, 52), 'pop', fixedColor('#a3e635', '#ffffff')),
                titleType('cta-tap', 'Botão de Clique', 'Poppins', layouts(60, 66, 0.72, 52), 'pop', fixedColor('#a3e635', '#ffffff')),
            ],
        },
        {
            id: 'price',
            name: 'Preço',
            enabled: true,
            maxOccurrences: 2,
            instructions: 'Valor, desconto, parcela, condição de pagamento ou economia somente quando forem ditos.',
            examples: ['R$ 199', '12x sem juros', '50% OFF'],
            sample: 'R$ 199',
            color: brandColor('secondary'),
            titleTypes: [
                titleType('premium-price-tag', 'Price Tag Pro', 'League Spartan', layouts(40, 34, 0.95, 76), 'pop', fixedColor('#ffb800', '#111318')),
                titleType('premium-sale-spotlight', 'Sale Spotlight', 'Archivo Black', layouts(38, 32, 0.95, 76), 'pop', fixedColor('#ff2d55', '#ffffff')),
            ],
        },
        {
            id: 'benefit',
            name: 'Benefício / bônus',
            enabled: true,
            maxOccurrences: 2,
            instructions: 'Benefício concreto, bônus, transformação, diferenciador ou prova realmente pronunciada.',
            examples: ['Exame por nossa conta', 'Bônus incluso', 'Entrega grátis'],
            sample: 'EXAME POR NOSSA CONTA',
            color: brandColor('rotate'),
            titleTypes: [
                titleType('premium-benefit-badge', 'Benefit Badge', 'DM Sans', layouts(32, 28, 0.92, 76), 'fade', fixedColor('#00d084', '#ffffff')),
                titleType('premium-product-launch', 'Product Launch', 'Space Grotesk', layouts(34, 30, 0.92, 76), 'slide', fixedColor('#8b5cff', '#ffffff')),
            ],
        },
    ],
};

const normalizeColorRule = (input: unknown, fallback: TitleColorRule): TitleColorRule => {
    const source = input && typeof input === 'object' ? input as Partial<TitleColorRule> : {};
    return {
        mode: colorModes.has(source.mode as TitleColorRule['mode']) ? source.mode as TitleColorRule['mode'] : fallback.mode,
        paletteSlot: paletteSlots.has(source.paletteSlot as TitleColorRule['paletteSlot'])
            ? source.paletteSlot as TitleColorRule['paletteSlot']
            : fallback.paletteSlot,
        primary: color(source.primary, fallback.primary),
        secondary: color(source.secondary, fallback.secondary),
    };
};

const normalizeLayouts = (input: unknown, fallback: Record<VideoFormat, TitleLayout>): Record<VideoFormat, TitleLayout> => {
    const source = input && typeof input === 'object' ? input as Partial<Record<VideoFormat, Partial<TitleLayout>>> : {};
    return Object.fromEntries(formats.map((format) => {
        const current = source[format] || {};
        const base = fallback[format];
        return [format, {
            posX: numberInRange(current.posX, base.posX, 0, 100),
            posY: numberInRange(current.posY, base.posY, 0, 100),
            scale: numberInRange(current.scale, base.scale, 0.25, 4),
            scaleX: numberInRange(current.scaleX, base.scaleX || 1, 0.25, 3),
            scaleY: numberInRange(current.scaleY, base.scaleY || 1, 0.25, 3),
            textBoxWidthPct: numberInRange(current.textBoxWidthPct, base.textBoxWidthPct, 20, 300),
        }];
    })) as Record<VideoFormat, TitleLayout>;
};

const normalizeConfig = (input: unknown): TitleGeneratorConfig => {
    const source = input && typeof input === 'object' ? input as Partial<TitleGeneratorConfig> : {};
    const sourceTriggers = Array.isArray(source.triggers) ? source.triggers.slice(0, 30) : [];
    if (!sourceTriggers.length) return structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);

    const triggers = sourceTriggers.map((rawTrigger, triggerIndex) => {
        const fallback = DEFAULT_TITLE_GENERATOR_CONFIG.triggers.find((item) => item.id === rawTrigger?.id)
            || DEFAULT_TITLE_GENERATOR_CONFIG.triggers[triggerIndex % DEFAULT_TITLE_GENERATOR_CONFIG.triggers.length];
        const trigger = rawTrigger && typeof rawTrigger === 'object' ? rawTrigger as Partial<TitleTriggerRule> : {};
        const rawTypes = Array.isArray(trigger.titleTypes) ? trigger.titleTypes.slice(0, 20) : [];
        const titleTypes = rawTypes.map((rawType, typeIndex) => {
            const typeFallback = fallback.titleTypes[typeIndex % fallback.titleTypes.length];
            const type = rawType && typeof rawType === 'object' ? rawType as Partial<TitleTypeRule> : {};
            return {
                id: text(type.id, typeFallback.id, 80),
                name: text(type.name, typeFallback.name, 80),
                styleId: text(type.styleId, typeFallback.styleId, 120),
                fontFamily: text(type.fontFamily, typeFallback.fontFamily, 80),
                durationSec: numberInRange(type.durationSec, typeFallback.durationSec, 0.5, 10),
                animationId: animations.has(type.animationId as TitleTypeRule['animationId'])
                    ? type.animationId as TitleTypeRule['animationId']
                    : typeFallback.animationId,
                color: type.color == null ? null : normalizeColorRule(type.color, typeFallback.color || fallback.color),
                layouts: normalizeLayouts(type.layouts, typeFallback.layouts),
            } satisfies TitleTypeRule;
        });
        return {
            id: text(trigger.id, fallback.id, 80).toLocaleLowerCase('pt-BR'),
            name: text(trigger.name, fallback.name, 80),
            enabled: trigger.enabled === undefined ? fallback.enabled : Boolean(trigger.enabled),
            maxOccurrences: Math.round(numberInRange(trigger.maxOccurrences, fallback.maxOccurrences, 1, 6)),
            instructions: text(trigger.instructions, fallback.instructions, 3000),
            examples: (Array.isArray(trigger.examples) ? trigger.examples : fallback.examples)
                .map((example) => text(example, '', 120)).filter(Boolean).slice(0, 8),
            sample: text(trigger.sample, fallback.sample, 120),
            color: normalizeColorRule(trigger.color, fallback.color),
            titleTypes,
        } satisfies TitleTriggerRule;
    });

    const usable = triggers.filter((trigger) => trigger.enabled && trigger.titleTypes.length);
    if (!usable.length) return structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);
    return {
        version: Math.max(2, Math.round(numberInRange(source.version, 2, 2, 100))),
        extractionPrompt: text(source.extractionPrompt, DEFAULT_TITLE_GENERATOR_CONFIG.extractionPrompt, 12000),
        maxTitles: Math.round(numberInRange(source.maxTitles, DEFAULT_TITLE_GENERATOR_CONFIG.maxTitles, 1, 12)),
        triggers,
    };
};

export const loadEffectiveTitleGeneratorConfig = async (token: string): Promise<{
    config: TitleGeneratorConfig;
    source: 'organization' | 'global' | 'compatibility-default';
}> => {
    try {
        const effective = await gatewayJson<{ config?: unknown; source?: 'organization' | 'global' }>(token, '/v1/ai/title-generator');
        return { config: normalizeConfig(effective.config), source: effective.source || 'organization' };
    } catch (error) {
        if (!(error instanceof GatewayHttpError) || error.status !== 404) throw error;
    }

    // Compatibilidade com gateways que já têm o editor da agência, mas ainda não
    // publicaram o endpoint efetivo /v1 usado pelo desktop.
    try {
        const account = await gatewayJson<{ config?: unknown; usesDefault?: boolean }>(token, '/account/ai/title-generator');
        return {
            config: normalizeConfig(account.config),
            source: account.usesDefault ? 'global' : 'organization',
        };
    } catch (error) {
        if (!(error instanceof GatewayHttpError) || ![403, 404].includes(error.status)) throw error;
    }

    return { config: structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG), source: 'compatibility-default' };
};
