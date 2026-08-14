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
    /** Campo legado: o limite atual pertence ao gatilho. */
    maxWords?: number;
    durationSec: number;
    animationId: 'pop' | 'fade' | 'slide' | 'blink' | 'none';
    color: TitleColorRule | null;
    layouts: Record<VideoFormat, TitleLayout>;
};

export type TitleTriggerRule = {
    id: string;
    name: string;
    enabled: boolean;
    maxWords: number;
    maxOccurrences: number;
    instructions: string;
    examples: string[];
    sample: string;
    color: TitleColorRule;
    titleTypes: TitleTypeRule[];
};

export type TitleGeneratorConfig = {
    version: number;
    /** Rollback remoto: legacy-v4 executa exatamente o pipeline anterior. */
    pipeline: 'legacy-v4' | 'reviewed-v1';
    ai: {
        provider: 'openai' | 'gemini';
        model: string;
        reasoning: 'rapido' | 'equilibrado' | 'profundo';
        maxOutputTokens: number;
    };
    reviewer: {
        model: 'gpt-4.1-nano';
        maxOutputTokens: number;
        timeoutMs: number;
    };
    extractionPrompt: string;
    maxTitles: number;
    triggers: TitleTriggerRule[];
};

export const MIN_USABLE_TITLE_TRIGGERS = 4;
export const MAX_TITLES_PER_TRIGGER = 3;

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

/**
 * Compatibilidade local para instalações cujo gateway ainda não publicou a rota
 * efetiva da organização. A configuração salva no gateway sempre tem prioridade.
 */
// Padrão de fábrica gravado a partir da configuração real da agência
// (2026-08-14). Regenerar via captura do gerador; não editar na mão.
export const DEFAULT_TITLE_GENERATOR_CONFIG: TitleGeneratorConfig = {
    "version": 5,
    "pipeline": "reviewed-v1",
    "ai": {
        "provider": "openai",
        "model": "gpt-5-mini",
        "reasoning": "rapido",
        "maxOutputTokens": 1400
    },
    "reviewer": {
        "model": "gpt-4.1-nano",
        "maxOutputTokens": 512,
        "timeoutMs": 8000
    },
    "extractionPrompt": "Selecione apenas trechos literais da narração que aumentem retenção, clareza ou conversão. Nunca invente texto, oferta, prova, urgência ou localização.",
    "maxTitles": 8,
    "triggers": [
        {
            "id": "scarcity",
            "name": "Escassez e urgência",
            "enabled": true,
            "maxWords": 3,
            "maxOccurrences": 3,
            "instructions": "Prazo, quantidade, vagas, lote ou estoque limitado.",
            "examples": [
                "Somente até sábado",
                "Últimas 8 unidades",
                "3 vagas"
            ],
            "sample": "SOMENTE ATÉ SÁBADO",
            "color": {
                "mode": "brand",
                "paletteSlot": "primary",
                "primary": "#00e676",
                "secondary": "#07110d"
            },
            "titleTypes": [
                {
                    "id": "premium-sale-spotlight",
                    "name": "Sale Spotlight",
                    "styleId": "premium-sale-spotlight",
                    "fontFamily": "Archivo Black",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#1de6d2",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50.98039215686275,
                            "posY": 52.93441413430607,
                            "scale": 0.62,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 99.08370229812354
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                },
                {
                    "id": "premium-urgency-pulse",
                    "name": "Urgency Pulse",
                    "styleId": "premium-urgency-pulse",
                    "fontFamily": "Anton",
                    "durationSec": 2.5,
                    "animationId": "slide",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#ff3b30",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 52.47888808566699,
                            "posY": 58.775142261535855,
                            "scale": 0.6037742372951541,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 141.21884686492245
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                },
                {
                    "id": "premium-swiss-modern",
                    "name": "Swiss Modern",
                    "styleId": "premium-swiss-modern",
                    "fontFamily": "DM Sans",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#ff4d36",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50.534150562795475,
                            "posY": 55.81249102424173,
                            "scale": 0.664590240385214,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 88.54185114906177
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                }
            ]
        },
        {
            "id": "region",
            "name": "Região",
            "enabled": true,
            "maxWords": 3,
            "maxOccurrences": 3,
            "instructions": "Cidade, bairro, região ou endereço. Nunca invente e não repita a localização.",
            "examples": [
                "Casimiro de Abreu",
                "Rio de Janeiro",
                "Todo o Brasil"
            ],
            "sample": "CASIMIRO DE ABREU",
            "color": {
                "mode": "brand",
                "paletteSlot": "primary",
                "primary": "#00e676",
                "secondary": "#07110d"
            },
            "titleTypes": [
                {
                    "id": "loc-pin-viagem",
                    "name": "Pin de Viagem",
                    "styleId": "loc-pin-viagem",
                    "fontFamily": "Inter",
                    "durationSec": 2,
                    "animationId": "fade",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "primary",
                        "primary": "#00e676",
                        "secondary": "#07110d"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50,
                            "posY": 62,
                            "scale": 0.4053595161837049,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 209.14742242749654
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 68,
                            "scale": 0.7020000000000001,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 62
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 62,
                            "scale": 0.741,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 62
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 68,
                            "scale": 0.7176,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 62
                        }
                    }
                },
                {
                    "id": "loc-minimal-urbano",
                    "name": "Minimalista",
                    "styleId": "loc-minimal-urbano",
                    "fontFamily": "Inter",
                    "durationSec": 2.5,
                    "animationId": "fade",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#00e676",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50.811757896343984,
                            "posY": 60.84627577837776,
                            "scale": 0.4385280868955116,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 217.1215292574055
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                }
            ]
        },
        {
            "id": "cta",
            "name": "CTA",
            "enabled": true,
            "maxWords": 3,
            "maxOccurrences": 3,
            "instructions": "Clique, chame, agende, compre, visite ou outra ação explicitamente pronunciada.",
            "examples": [
                "Clique no botão",
                "Chame no WhatsApp",
                "Saiba mais"
            ],
            "sample": "CLIQUE NO BOTÃO",
            "color": {
                "mode": "fixed",
                "paletteSlot": "primary",
                "primary": "#54a812",
                "secondary": "#ffffff"
            },
            "titleTypes": [
                {
                    "id": "cta-search",
                    "name": "Barra de Busca",
                    "styleId": "cta-search",
                    "fontFamily": "Inter",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "fixed",
                        "paletteSlot": "rotate",
                        "primary": "#a3e635",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50.08513525192631,
                            "posY": 60.372415347343505,
                            "scale": 0.5560661992005274,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 188.15426636902976
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                },
                {
                    "id": "cta-whatsapp",
                    "name": "Balão WhatsApp",
                    "styleId": "cta-whatsapp",
                    "fontFamily": "Inter",
                    "durationSec": 2,
                    "animationId": "pop",
                    "color": {
                        "mode": "fixed",
                        "paletteSlot": "primary",
                        "primary": "#54a812",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 48.66402847944558,
                            "posY": 60.34424474618289,
                            "scale": 0.5760709613455434,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 154.98317094618716
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 62,
                            "scale": 0.648,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 50
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6839999999999999,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 50
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 62,
                            "scale": 0.6624,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 50
                        }
                    }
                }
            ]
        },
        {
            "id": "price",
            "name": "Preço",
            "enabled": true,
            "maxWords": 3,
            "maxOccurrences": 3,
            "instructions": "Preço, condição, bônus, prazo ou urgência somente quando forem ditos explicitamente.",
            "examples": [
                "R$ 199",
                "12x sem juros",
                "50% OFF"
            ],
            "sample": "R$ 199",
            "color": {
                "mode": "brand",
                "paletteSlot": "secondary",
                "primary": "#00e676",
                "secondary": "#07110d"
            },
            "titleTypes": [
                {
                    "id": "premium-price-tag",
                    "name": "Price Tag Pro",
                    "styleId": "premium-price-tag",
                    "fontFamily": "League Spartan",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#ffb800",
                        "secondary": "#111318"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 86.16871384650499,
                            "posY": 52.98928653492647,
                            "scale": 0.8802814746958338,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 78.51838423309633
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                },
                {
                    "id": "premium-coupon-ticket",
                    "name": "Coupon Ticket",
                    "styleId": "premium-coupon-ticket",
                    "fontFamily": "Space Grotesk",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#7cff6b",
                        "secondary": "#101510"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 48.45154934217438,
                            "posY": 53.90726238097921,
                            "scale": 0.8578738447442549,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 78
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                },
                {
                    "id": "premium-benefit-badge",
                    "name": "Benefit Badge",
                    "styleId": "premium-benefit-badge",
                    "fontFamily": "DM Sans",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#00d084",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 48.73033384094682,
                            "posY": 57.684939996619526,
                            "scale": 0.7225521699762051,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 90.00287011726232
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                }
            ]
        },
        {
            "id": "benefit",
            "name": "Benefício / bônus",
            "enabled": true,
            "maxWords": 4,
            "maxOccurrences": 3,
            "instructions": "Benefício concreto, transformação, diferenciador ou prova realmente pronunciada.",
            "examples": [
                "Exame por nossa conta",
                "Bônus incluso",
                "Entrega grátis"
            ],
            "sample": "EXAME POR NOSSA CONTA",
            "color": {
                "mode": "brand",
                "paletteSlot": "rotate",
                "primary": "#00e676",
                "secondary": "#07110d"
            },
            "titleTypes": [
                {
                    "id": "premium-urgency-pulse",
                    "name": "Urgency Pulse",
                    "styleId": "premium-urgency-pulse",
                    "fontFamily": "Anton",
                    "durationSec": 2.5,
                    "animationId": "fade",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#ff3b30",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 35.98660737081291,
                            "posY": 10.016381990567673,
                            "scale": 0.4743447340979309,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 141.39948458953492
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                },
                {
                    "id": "premium-coupon-ticket",
                    "name": "Coupon Ticket",
                    "styleId": "premium-coupon-ticket",
                    "fontFamily": "Space Grotesk",
                    "durationSec": 2.5,
                    "animationId": "slide",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#7cff6b",
                        "secondary": "#101510"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50,
                            "posY": 55.18029184742802,
                            "scale": 0.62,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 100
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                }
            ]
        },
        {
            "id": "product",
            "name": "Produto / oferta central",
            "enabled": true,
            "maxWords": 5,
            "maxOccurrences": 3,
            "instructions": "Produto, serviço ou oferta central explicitamente apresentados, sem confundir com preço ou urgência.",
            "examples": [
                "Óculos completo",
                "Armação mais lentes",
                "Consultoria personalizada"
            ],
            "sample": "ÓCULOS COMPLETO",
            "color": {
                "mode": "brand",
                "paletteSlot": "primary",
                "primary": "#00e676",
                "secondary": "#07110d"
            },
            "titleTypes": [
                {
                    "id": "premium-creator-caption",
                    "name": "Creator Caption",
                    "styleId": "premium-creator-caption",
                    "fontFamily": "DM Sans",
                    "durationSec": 2.5,
                    "animationId": "fade",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "primary",
                        "primary": "#00c2ff",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50.93608356104471,
                            "posY": 55.07427978515625,
                            "scale": 0.6872157725532092,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 120.99436820201296
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 32,
                            "scale": 0.81,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 36,
                            "scale": 0.855,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 32,
                            "scale": 0.8280000000000001,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                },
                {
                    "id": "premium-product-launch",
                    "name": "Product Launch",
                    "styleId": "premium-product-launch",
                    "fontFamily": "Space Grotesk",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#32f5c5",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50.816993464052274,
                            "posY": 50.447377373190484,
                            "scale": 0.62,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 92.26250449578946
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                }
            ]
        },
        {
            "id": "differentiator",
            "name": "Diferencial / prova",
            "enabled": true,
            "maxWords": 5,
            "maxOccurrences": 3,
            "instructions": "Qualidade, mecanismo, personalização, garantia ou prova concreta realmente pronunciada.",
            "examples": [
                "Do seu jeito",
                "Atendimento personalizado",
                "Qualidade comprovada"
            ],
            "sample": "DO SEU JEITO",
            "color": {
                "mode": "brand",
                "paletteSlot": "rotate",
                "primary": "#00e676",
                "secondary": "#07110d"
            },
            "titleTypes": [
                {
                    "id": "premium-benefit-badge",
                    "name": "Benefit Badge",
                    "styleId": "premium-benefit-badge",
                    "fontFamily": "DM Sans",
                    "durationSec": 2.5,
                    "animationId": "fade",
                    "color": {
                        "mode": "fixed",
                        "paletteSlot": "primary",
                        "primary": "#00d084",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 49.545878694015244,
                            "posY": 61.06196324965533,
                            "scale": 0.430581593096737,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 147.41935566102174
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 28,
                            "scale": 0.8280000000000001,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 32,
                            "scale": 0.874,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 28,
                            "scale": 0.8464,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                }
            ]
        },
        {
            "id": "audience",
            "name": "Público / necessidade",
            "enabled": true,
            "maxWords": 5,
            "maxOccurrences": 3,
            "instructions": "Público, necessidade ou problema explícito ao qual a oferta responde. Não deduza perfis não mencionados.",
            "examples": [
                "Para quem precisa",
                "Seu segundo óculos",
                "Quem busca economia"
            ],
            "sample": "PARA QUEM PRECISA",
            "color": {
                "mode": "brand",
                "paletteSlot": "secondary",
                "primary": "#00e676",
                "secondary": "#07110d"
            },
            "titleTypes": [
                {
                    "id": "premium-kinetic-punch",
                    "name": "Kinetic Punch",
                    "styleId": "premium-kinetic-punch",
                    "fontFamily": "Archivo Black",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "primary",
                        "primary": "#c8ff26",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 48.85963988459967,
                            "posY": 52.2708475449506,
                            "scale": 0.6509019058088261,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 120.30161620696266
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 30,
                            "scale": 0.8280000000000001,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 34,
                            "scale": 0.874,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 30,
                            "scale": 0.8464,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                },
                {
                    "id": "premium-split-block",
                    "name": "Split Block",
                    "styleId": "premium-split-block",
                    "fontFamily": "Anton",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "brand",
                        "paletteSlot": "rotate",
                        "primary": "#d7a7ff",
                        "secondary": "#fff9f0"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.62,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 78
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                },
                {
                    "id": "premium-magazine-stack",
                    "name": "Magazine Stack",
                    "styleId": "premium-magazine-stack",
                    "fontFamily": "Bebas Neue",
                    "durationSec": 2.5,
                    "animationId": "pop",
                    "color": {
                        "mode": "fixed",
                        "paletteSlot": "rotate",
                        "primary": "#ff5a6f",
                        "secondary": "#ffffff"
                    },
                    "layouts": {
                        "9:16": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.62,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 78
                        },
                        "16:9": {
                            "posX": 50,
                            "posY": 50,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 64
                        },
                        "4:5": {
                            "posX": 50,
                            "posY": 55,
                            "scale": 0.6,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 74
                        },
                        "1:1": {
                            "posX": 50,
                            "posY": 52,
                            "scale": 0.58,
                            "scaleX": 1,
                            "scaleY": 1,
                            "textBoxWidthPct": 70
                        }
                    }
                }
            ]
        }
    ]
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

const sourceTriggerIsUsable = (trigger: Partial<TitleTriggerRule> | undefined) => Boolean(
    trigger
    && trigger.enabled !== false
    && Array.isArray(trigger.titleTypes)
    && trigger.titleTypes.length
);

export const normalizeTitleGeneratorConfig = (input: unknown): TitleGeneratorConfig => {
    const source = input && typeof input === 'object' ? input as Partial<TitleGeneratorConfig> : {};
    const sourceVersion = Number(source.version || 2);
    const sourceTriggers = Array.isArray(source.triggers)
        ? structuredClone(source.triggers.slice(0, 30))
        : [];
    if (!sourceTriggers.length) return structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG);

    if (sourceVersion < 3) {
        const presentIds = new Set(sourceTriggers.map((trigger) => String(trigger?.id || '')));
        for (const fallback of DEFAULT_TITLE_GENERATOR_CONFIG.triggers) {
            if (!presentIds.has(fallback.id)) sourceTriggers.push(structuredClone(fallback));
        }
    }

    if (sourceVersion < 5) {
        sourceTriggers.forEach((trigger) => {
            trigger.maxOccurrences = MAX_TITLES_PER_TRIGGER;
            if (trigger.enabled !== false && (!Array.isArray(trigger.titleTypes) || !trigger.titleTypes.length)) {
                const fallback = DEFAULT_TITLE_GENERATOR_CONFIG.triggers.find((candidate) => candidate.id === trigger.id);
                if (fallback) trigger.titleTypes = structuredClone(fallback.titleTypes);
                else trigger.enabled = false;
            }
        });
        for (const fallback of DEFAULT_TITLE_GENERATOR_CONFIG.triggers) {
            if (sourceTriggers.filter(sourceTriggerIsUsable).length >= MIN_USABLE_TITLE_TRIGGERS) break;
            const existing = sourceTriggers.find((trigger) => trigger.id === fallback.id);
            if (existing) {
                existing.enabled = true;
                existing.maxOccurrences = MAX_TITLES_PER_TRIGGER;
                if (!Array.isArray(existing.titleTypes) || !existing.titleTypes.length) {
                    existing.titleTypes = structuredClone(fallback.titleTypes);
                }
            } else {
                sourceTriggers.push(structuredClone(fallback));
            }
        }
    }

    const triggers = sourceTriggers.map((rawTrigger, triggerIndex) => {
        const fallback = DEFAULT_TITLE_GENERATOR_CONFIG.triggers.find((item) => item.id === rawTrigger?.id)
            || DEFAULT_TITLE_GENERATOR_CONFIG.triggers[triggerIndex % DEFAULT_TITLE_GENERATOR_CONFIG.triggers.length];
        const trigger = rawTrigger && typeof rawTrigger === 'object' ? rawTrigger as Partial<TitleTriggerRule> : {};
        const rawTypes = Array.isArray(trigger.titleTypes) ? trigger.titleTypes.slice(0, 20) : [];
        const legacyMaxWords = rawTypes.reduce((highest, rawType) => Math.max(
            highest,
            Number((rawType as TitleTypeRule | undefined)?.maxWords) || 0
        ), 0);
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
            maxWords: Math.round(numberInRange(trigger.maxWords, legacyMaxWords || fallback.maxWords || 3, 1, 12)),
            maxOccurrences: Math.round(numberInRange(
                trigger.maxOccurrences,
                fallback.maxOccurrences,
                1,
                MAX_TITLES_PER_TRIGGER,
            )),
            instructions: text(trigger.instructions, fallback.instructions, 3000),
            examples: (Array.isArray(trigger.examples) ? trigger.examples : fallback.examples)
                .map((example) => text(example, '', 120)).filter(Boolean).slice(0, 8),
            sample: text(trigger.sample, fallback.sample, 120),
            color: normalizeColorRule(trigger.color, fallback.color),
            titleTypes,
        } satisfies TitleTriggerRule;
    });

    const usable = triggers.filter((trigger) => trigger.enabled && trigger.titleTypes.length);
    if (usable.length < MIN_USABLE_TITLE_TRIGGERS) {
        throw new Error(`Mantenha pelo menos ${MIN_USABLE_TITLE_TRIGGERS} gatilhos ativos, cada um com ao menos um modelo de título.`);
    }
    const usesLegacyAiPreset = sourceVersion < 4
        && String(source.ai?.provider || 'openai') === 'openai'
        && String(source.ai?.model || 'gpt-5-mini') === 'gpt-5-mini'
        && String(source.ai?.reasoning || 'equilibrado') === 'equilibrado'
        && Number(source.ai?.maxOutputTokens ?? 4096) === 4096;
    const ai = usesLegacyAiPreset ? DEFAULT_TITLE_GENERATOR_CONFIG.ai : source.ai;
    const reviewer = source.reviewer || DEFAULT_TITLE_GENERATOR_CONFIG.reviewer;
    return {
        version: Math.max(5, Math.round(numberInRange(source.version, 5, 2, 100))),
        pipeline: source.pipeline === 'legacy-v4' ? 'legacy-v4' : 'reviewed-v1',
        ai: {
            provider: ['openai', 'gemini'].includes(String(ai?.provider))
                ? ai?.provider as 'openai' | 'gemini'
                : DEFAULT_TITLE_GENERATOR_CONFIG.ai.provider,
            model: text(ai?.model, DEFAULT_TITLE_GENERATOR_CONFIG.ai.model, 160),
            reasoning: ['rapido', 'equilibrado', 'profundo'].includes(String(ai?.reasoning))
                ? ai?.reasoning as 'rapido' | 'equilibrado' | 'profundo'
                : DEFAULT_TITLE_GENERATOR_CONFIG.ai.reasoning,
            maxOutputTokens: Math.round(numberInRange(
                ai?.maxOutputTokens,
                DEFAULT_TITLE_GENERATOR_CONFIG.ai.maxOutputTokens,
                512,
                32768
            )),
        },
        reviewer: {
            // reviewed-v1 nao aceita escalada remota para modelos mais caros/lentos.
            model: DEFAULT_TITLE_GENERATOR_CONFIG.reviewer.model,
            maxOutputTokens: Math.round(numberInRange(
                reviewer?.maxOutputTokens,
                DEFAULT_TITLE_GENERATOR_CONFIG.reviewer.maxOutputTokens,
                512,
                1200,
            )),
            timeoutMs: Math.round(numberInRange(
                reviewer?.timeoutMs,
                DEFAULT_TITLE_GENERATOR_CONFIG.reviewer.timeoutMs,
                3000,
                15000,
            )),
        },
        extractionPrompt: text(source.extractionPrompt, DEFAULT_TITLE_GENERATOR_CONFIG.extractionPrompt, 12000),
        maxTitles: Math.round(numberInRange(source.maxTitles, DEFAULT_TITLE_GENERATOR_CONFIG.maxTitles, 1, 12)),
        triggers,
    };
};

export const loadEffectiveTitleGeneratorConfig = async (
    token: string,
    signal?: AbortSignal,
    timeoutMs?: number,
): Promise<{
    config: TitleGeneratorConfig;
    source: 'organization' | 'global' | 'compatibility-default';
}> => {
    const deadlineAt = Number.isFinite(timeoutMs) && Number(timeoutMs) > 0
        ? Date.now() + Number(timeoutMs)
        : null;
    const remainingTimeoutMs = () => {
        if (deadlineAt === null) return undefined;
        const remaining = Math.floor(deadlineAt - Date.now());
        if (remaining < 1000) {
            throw new GatewayHttpError(504, 'O carregamento da configuração de títulos excedeu o prazo.');
        }
        return remaining;
    };
    try {
        const effective = await gatewayJson<{ config?: unknown; source?: 'organization' | 'global' }>(
            token,
            '/v1/ai/title-generator',
            { signal },
            remainingTimeoutMs(),
        );
        return { config: normalizeTitleGeneratorConfig(effective.config), source: effective.source || 'organization' };
    } catch (error) {
        if (!(error instanceof GatewayHttpError) || error.status !== 404) throw error;
    }

    // Compatibilidade com gateways que já têm o editor da agência, mas ainda não
    // publicaram o endpoint efetivo /v1 usado pelo desktop.
    try {
        const account = await gatewayJson<{ config?: unknown; usesDefault?: boolean }>(
            token,
            '/account/ai/title-generator',
            { signal },
            remainingTimeoutMs(),
        );
        return {
            config: normalizeTitleGeneratorConfig(account.config),
            source: account.usesDefault ? 'global' : 'organization',
        };
    } catch (error) {
        if (!(error instanceof GatewayHttpError) || ![403, 404].includes(error.status)) throw error;
    }

    return { config: structuredClone(DEFAULT_TITLE_GENERATOR_CONFIG), source: 'compatibility-default' };
};
