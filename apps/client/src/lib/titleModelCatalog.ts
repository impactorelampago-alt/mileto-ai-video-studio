import { PREMIUM_TITLE_MODELS, type PremiumTitleModel } from './premiumTitleModels';

export type TitleModelLibrary = 'Call to Action (CTA)' | 'Biblioteca Premium' | 'Localização';

export interface TitleModelDefinition {
    id: string;
    name: string;
    library: TitleModelLibrary;
    group: string;
    description: string;
    sample: string;
    primaryColor: string;
    secondaryColor: string;
    fontFamily: string;
}

const premiumModel = (model: PremiumTitleModel): TitleModelDefinition => ({
    ...model,
    library: 'Biblioteca Premium',
});

export const CTA_TITLE_MODELS: TitleModelDefinition[] = [
    { id: 'cta-search', name: 'Barra de Busca', library: 'Call to Action (CTA)', group: 'CTA', description: 'Chamada em formato de busca.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#A3E635', secondaryColor: '#ffffff', fontFamily: 'Inter' },
    { id: 'cta-tap', name: 'Botão de Clique', library: 'Call to Action (CTA)', group: 'CTA', description: 'Botão animado para ação imediata.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#A3E635', secondaryColor: '#ffffff', fontFamily: 'Poppins' },
    { id: 'cta-whatsapp', name: 'Balão WhatsApp', library: 'Call to Action (CTA)', group: 'CTA', description: 'Convite direto para conversar.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#A3E635', secondaryColor: '#ffffff', fontFamily: 'Inter' },
    { id: 'cta-shop', name: 'Sacola (Comprar)', library: 'Call to Action (CTA)', group: 'CTA', description: 'Ação visual para oferta e produto.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#A3E635', secondaryColor: '#ffffff', fontFamily: 'Montserrat' },
    { id: 'cta-minimal', name: 'Seta Minimalista', library: 'Call to Action (CTA)', group: 'CTA', description: 'CTA discreto com seta direcional.', sample: 'CHAMADA PARA AÇÃO', primaryColor: '#A3E635', secondaryColor: '#ffffff', fontFamily: 'Anton' },
];

export const LOCATION_TITLE_MODELS: TitleModelDefinition[] = [
    { id: 'loc-pin-viagem', name: 'Pin de Viagem', library: 'Localização', group: 'Localização', description: 'Pin visual para cidade ou endereço.', sample: 'SÃO PAULO, SP', primaryColor: '#00E676', secondaryColor: '#ffffff', fontFamily: 'Inter' },
    { id: 'loc-minimal-urbano', name: 'Minimalista', library: 'Localização', group: 'Localização', description: 'Localização limpa e editorial.', sample: 'SÃO PAULO, SP', primaryColor: '#00E676', secondaryColor: '#ffffff', fontFamily: 'Inter' },
    { id: 'loc-tag-geo', name: 'Tag Geográfica', library: 'Localização', group: 'Localização', description: 'Etiqueta compacta com referência geográfica.', sample: 'SÃO PAULO, SP', primaryColor: '#00E676', secondaryColor: '#ffffff', fontFamily: 'Oswald' },
];

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
    Localização: '3 modelos para cidade, estado ou país',
};

export const titleModelById = (id?: string | null) => TITLE_MODEL_CATALOG.find((model) => model.id === id);
