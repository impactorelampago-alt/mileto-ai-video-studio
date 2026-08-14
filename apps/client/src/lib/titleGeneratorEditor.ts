import type {
    AiTitleColorRule,
    AiTitleGeneratorConfig,
    AiTitleLayout,
    AiTitleTriggerRule,
    AiTitleTypeRule,
    TitleVideoFormat,
} from './gateway';
import { TITLE_MODEL_CATALOG, titleModelById } from './titleModelCatalog';
import { generateId } from './utils';

export type EditorColorMode = 'ops' | 'custom';

export interface TitleModelEditorSettings {
    enabled: boolean;
    colorMode: EditorColorMode;
    paletteSlot: AiTitleColorRule['paletteSlot'];
    primaryColor: string;
    secondaryColor: string;
    animationId: AiTitleTypeRule['animationId'];
    durationSec: number;
    layouts: Record<TitleVideoFormat, AiTitleLayout>;
}

export interface TitleTriggerEditor {
    id: string;
    name: string;
    hint: string;
    examples: string[];
    sample: string;
    enabled: boolean;
    maxWords: number;
    maxOccurrences: number;
    color: AiTitleColorRule;
    models: Record<string, TitleModelEditorSettings>;
}

export const EDITOR_FORMATS: TitleVideoFormat[] = ['9:16', '16:9', '4:5', '1:1'];

export const defaultLayouts = (): Record<TitleVideoFormat, AiTitleLayout> => ({
    '9:16': { posX: 50, posY: 55, scale: 0.62, scaleX: 1, scaleY: 1, textBoxWidthPct: 78 },
    '16:9': { posX: 50, posY: 50, scale: 0.58, scaleX: 1, scaleY: 1, textBoxWidthPct: 64 },
    '4:5': { posX: 50, posY: 55, scale: 0.6, scaleX: 1, scaleY: 1, textBoxWidthPct: 74 },
    '1:1': { posX: 50, posY: 52, scale: 0.58, scaleX: 1, scaleY: 1, textBoxWidthPct: 70 },
});

export const initialModelEditorSettings = (modelId: string): TitleModelEditorSettings => {
    const model = titleModelById(modelId) || TITLE_MODEL_CATALOG[0];
    return {
        enabled: true,
        colorMode: 'custom',
        paletteSlot: 'rotate',
        primaryColor: model.primaryColor,
        secondaryColor: model.secondaryColor,
        animationId: 'pop',
        durationSec: 2.5,
        layouts: defaultLayouts(),
    };
};

const editorSettingsFromType = (type: AiTitleTypeRule, trigger: AiTitleTriggerRule): TitleModelEditorSettings => {
    const model = titleModelById(type.styleId) || TITLE_MODEL_CATALOG[0];
    const color = type.color || trigger.color;
    return {
        enabled: true,
        colorMode: color.mode === 'brand' ? 'ops' : 'custom',
        paletteSlot: color.paletteSlot,
        primaryColor: color.primary || model.primaryColor,
        secondaryColor: color.secondary || model.secondaryColor,
        animationId: type.animationId || 'pop',
        durationSec: type.durationSec,
        layouts: Object.fromEntries(EDITOR_FORMATS.map((format) => [
            format,
            { ...defaultLayouts()[format], ...(type.layouts?.[format] || {}) },
        ])) as Record<TitleVideoFormat, AiTitleLayout>,
    };
};

export const titleGeneratorConfigToEditor = (config: AiTitleGeneratorConfig): TitleTriggerEditor[] =>
    config.triggers.map((trigger) => ({
        id: trigger.id,
        name: trigger.name,
        hint: trigger.instructions,
        examples: trigger.examples || [],
        sample: trigger.sample || trigger.name.toLocaleUpperCase('pt-BR'),
        enabled: trigger.enabled,
        maxWords: trigger.maxWords || Math.max(3, ...trigger.titleTypes.map((type) => type.maxWords || 3)),
        maxOccurrences: Number(config.version) < 5
            ? 3
            : Math.max(1, Math.min(3, Math.round(Number(trigger.maxOccurrences) || 3))),
        color: trigger.color,
        models: Object.fromEntries(trigger.titleTypes
            .filter((type) => !!titleModelById(type.styleId))
            .map((type) => [type.styleId, editorSettingsFromType(type, trigger)])),
    }));

const colorFromSettings = (settings: TitleModelEditorSettings): AiTitleColorRule => ({
    mode: settings.colorMode === 'ops' ? 'brand' : 'fixed',
    paletteSlot: settings.paletteSlot,
    primary: settings.primaryColor,
    secondary: settings.secondaryColor,
});

export const titleGeneratorEditorToConfig = (
    base: AiTitleGeneratorConfig,
    triggers: TitleTriggerEditor[]
): AiTitleGeneratorConfig => ({
    ...base,
    // Mantem pipeline/reviewer recebidos do gateway; o editor visual nao pode
    // desativar a revisao nem apagar o rollback remoto ao salvar os modelos.
    version: Math.max(5, Number(base.version) || 5),
    triggers: triggers.map((trigger) => ({
        id: trigger.id,
        name: trigger.name,
        enabled: trigger.enabled,
        maxWords: trigger.maxWords,
        maxOccurrences: Math.max(1, Math.min(3, Math.round(Number(trigger.maxOccurrences) || 3))),
        instructions: trigger.hint,
        examples: trigger.examples,
        sample: trigger.sample,
        color: trigger.color,
        titleTypes: TITLE_MODEL_CATALOG.flatMap((model) => {
            const settings = trigger.models[model.id];
            if (!settings?.enabled) return [];
            return [{
                id: model.id,
                name: model.name,
                styleId: model.id,
                fontFamily: model.fontFamily,
                durationSec: settings.durationSec,
                animationId: settings.animationId,
                color: colorFromSettings(settings),
                layouts: settings.layouts,
            } satisfies AiTitleTypeRule];
        }),
    })),
});

export const newCustomTriggerEditor = (name: string): TitleTriggerEditor => ({
    id: `custom-${generateId()}`,
    name,
    hint: 'Descreva quando este gatilho deve ser identificado na narração.',
    examples: [],
    sample: name.toLocaleUpperCase('pt-BR'),
    enabled: true,
    maxWords: 3,
    maxOccurrences: 3,
    color: { mode: 'brand', paletteSlot: 'rotate', primary: '#00e676', secondary: '#07110d' },
    models: {},
});
