import { PREMIUM_TITLE_MODELS, type PremiumTitleModel } from './premiumTitleModels';
import type { TitleHook } from '../types';

export type TitleModelLibrary = 'Call to Action (CTA)' | 'Biblioteca Premium' | 'Localização';

export interface TitleStylePreset {
    id: string;
    name: string;
    primaryColor: string;
    secondaryColor: string;
    fontFamily: string;
    animationId?: string;
}

export interface TitleModelDefinition extends TitleStylePreset {
    library: TitleModelLibrary;
    group: string;
    description: string;
    sample: string;
}

const premiumModel = (model: PremiumTitleModel): TitleModelDefinition => ({
    ...model,
    library: 'Biblioteca Premium',
    animationId: 'none',
});

// Estes presets pertencem apenas ao editor. Mantê-los fora de
// TITLE_MODEL_CATALOG evita ampliar silenciosamente o catálogo da IA.
export const SIMPLE_TITLE_MODELS: TitleStylePreset[] = [
    { id: 'neo-pop', name: 'Neo Pop', primaryColor: '#FF4FD8', secondaryColor: '#FFF8E7', fontFamily: 'Montserrat' },
    { id: 'solid-ribbon', name: 'Faixa Sólida', primaryColor: '#00E6A8', secondaryColor: '#07110D', fontFamily: 'Oswald' },
    { id: 'gradient-glow', name: 'Brilho Gradiente', primaryColor: '#7C5CFF', secondaryColor: '#14E6FF', fontFamily: 'Inter' },
    { id: 'framed-box', name: 'Caixa Emoldurada', primaryColor: '#FFD43B', secondaryColor: '#FFFFFF', fontFamily: 'Inter' },
    { id: 'minimal-underline', name: 'Minimalista', primaryColor: '#32F5C5', secondaryColor: '#FFFFFF', fontFamily: 'Poppins' },
    { id: 'neon-cyber', name: 'Cyberpunk Neon', primaryColor: '#00F5FF', secondaryColor: '#FFFFFF', fontFamily: 'Impact' },
    { id: 'glassmorphism', name: 'Vidro Fosco (Glass)', primaryColor: '#8B5CFF', secondaryColor: '#FFFFFF', fontFamily: 'Inter' },
    { id: 'cinema-wide', name: 'Cinema Wide', primaryColor: '#111318', secondaryColor: '#E7C27D', fontFamily: 'Montserrat' },
    { id: 'default', name: 'Padrão', primaryColor: '#00E676', secondaryColor: '#FFFFFF', fontFamily: 'Montserrat' },
];

export const CTA_TITLE_MODELS: TitleModelDefinition[] = [
    { id: 'cta-search', name: 'Barra de Busca', library: 'Call to Action (CTA)', group: 'CTA', description: 'Chamada em formato de busca.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#0077B6', secondaryColor: '#FFFFFF', fontFamily: 'Inter', animationId: 'none' },
    { id: 'cta-tap', name: 'Botão de Clique', library: 'Call to Action (CTA)', group: 'CTA', description: 'Botão animado para ação imediata.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#D91B45', secondaryColor: '#FFFFFF', fontFamily: 'Poppins', animationId: 'none' },
    { id: 'cta-whatsapp', name: 'Balão WhatsApp', library: 'Call to Action (CTA)', group: 'CTA', description: 'Convite direto para conversar.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#0B7A3E', secondaryColor: '#FFFFFF', fontFamily: 'Inter', animationId: 'none' },
    { id: 'cta-shop', name: 'Sacola (Comprar)', library: 'Call to Action (CTA)', group: 'CTA', description: 'Ação visual para oferta e produto.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#FFB800', secondaryColor: '#111318', fontFamily: 'Montserrat', animationId: 'none' },
    { id: 'cta-minimal', name: 'Seta Minimalista', library: 'Call to Action (CTA)', group: 'CTA', description: 'CTA discreto com seta direcional.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#7C5CFF', secondaryColor: '#FFFFFF', fontFamily: 'Anton', animationId: 'none' },
];

export const LOCATION_TITLE_MODELS: TitleModelDefinition[] = [
    { id: 'loc-pin-viagem', name: 'Pin de Viagem', library: 'Localização', group: 'Localização', description: 'Pin visual para cidade ou endereço.', sample: 'SÃO PAULO, SP', primaryColor: '#D83A28', secondaryColor: '#FFFFFF', fontFamily: 'Inter' },
    { id: 'loc-minimal-urbano', name: 'Minimalista', library: 'Localização', group: 'Localização', description: 'Localização limpa e editorial.', sample: 'SÃO PAULO, SP', primaryColor: '#32F5C5', secondaryColor: '#FFFFFF', fontFamily: 'Inter' },
    { id: 'loc-tag-geo', name: 'Tag Geográfica', library: 'Localização', group: 'Localização', description: 'Etiqueta compacta com referência geográfica.', sample: 'SÃO PAULO, SP', primaryColor: '#7C5CFF', secondaryColor: '#FFFFFF', fontFamily: 'Oswald' },
    { id: 'loc-boarding-pass', name: 'Cartão de Embarque', library: 'Localização', group: 'Localização', description: 'Cartão premium com canhoto picotado e código de barras.', sample: 'SÃO PAULO, SP', primaryColor: '#0E7C66', secondaryColor: '#111318', fontFamily: 'Space Grotesk' },
    { id: 'loc-glass-radar', name: 'Radar de Vidro', library: 'Localização', group: 'Localização', description: 'Pílula de vidro com radar pulsante de cobertura.', sample: 'SÃO PAULO, SP', primaryColor: '#14E6FF', secondaryColor: '#FFFFFF', fontFamily: 'Sora' },
    { id: 'loc-editorial-atlas', name: 'Atlas Editorial', library: 'Localização', group: 'Localização', description: 'Serifa elegante com filetes, para marcas sofisticadas.', sample: 'SÃO PAULO, SP', primaryColor: '#E7C27D', secondaryColor: '#FFFFFF', fontFamily: 'Fraunces' },
    { id: 'loc-neon-marker', name: 'Marcador Neon', library: 'Localização', group: 'Localização', description: 'Chip urbano com pin em halo neon.', sample: 'SÃO PAULO, SP', primaryColor: '#FF4FD8', secondaryColor: '#FFFFFF', fontFamily: 'Bebas Neue' },
];

export const IMAGE_TITLE_MODEL: TitleStylePreset = {
    id: 'image-overlay',
    name: 'Imagem personalizada',
    primaryColor: '#FFFFFF',
    secondaryColor: '#000000',
    fontFamily: 'Inter',
};

export const TITLE_MODEL_CATALOG: TitleModelDefinition[] = [
    ...PREMIUM_TITLE_MODELS.map(premiumModel),
    ...CTA_TITLE_MODELS,
    ...LOCATION_TITLE_MODELS,
];

export const TITLE_MODEL_LIBRARIES: TitleModelLibrary[] = [
    'Call to Action (CTA)',
    'Biblioteca Premium',
    'Localização',
];

export const TITLE_MODEL_LIBRARY_NOTES: Record<TitleModelLibrary, string> = {
    'Call to Action (CTA)': '5 chamadas visuais para conversão',
    'Biblioteca Premium': `${PREMIUM_TITLE_MODELS.length} modelos curados para uso real`,
    Localização: `${LOCATION_TITLE_MODELS.length} modelos para cidade, estado ou país`,
};

export const titleModelById = (id?: string | null) => TITLE_MODEL_CATALOG.find((model) => model.id === id);

export const TITLE_STYLE_PRESETS: TitleStylePreset[] = [
    ...SIMPLE_TITLE_MODELS,
    ...TITLE_MODEL_CATALOG,
    IMAGE_TITLE_MODEL,
];

export const titleStylePresetById = (id?: string | null) =>
    TITLE_STYLE_PRESETS.find((model) => model.id === (id || 'default'));

/**
 * Uma troca de modelo é uma escolha visual explícita: layout, paleta e fonte
 * passam a pertencer ao novo preset. Um segundo clique no modelo já ativo não
 * apaga cores personalizadas nem o vínculo com a paleta da marca.
 */
export const titleStyleSelectionPatch = (
    title: Pick<TitleHook, 'styleId'>,
    model: TitleStylePreset
): Partial<TitleHook> => {
    if ((title.styleId || 'default') === model.id) return {};

    return {
        styleId: model.id,
        primaryColor: model.primaryColor,
        secondaryColor: model.secondaryColor,
        fontFamily: model.fontFamily,
        ...(model.animationId ? { animationId: model.animationId } : {}),
        colorBinding: undefined,
    };
};
