export type ChatTitleModeIntent = 'refine_titles' | 'narrator' | 'exit_title_mode';

const normalizeIntentText = (value: unknown): string => String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const EXIT_TITLE_MODE_PATTERNS = [
    /\b(?:sai(?:a|r)?|encerr(?:a|e|ar|ando)\w*|cancel(?:a|e|ar|ando)\w*|fech(?:a|e|ar|ando)\w*)\b.{0,28}\b(?:titulo|titulos|ajuste de titulos)\b/,
    /\bvolt(?:a|e|ar|ando)\w*\b.{0,18}\b(?:narrador|conversa normal)\b/,
    /\bnao quero mais\b.{0,18}\btitulos\b/,
];

const NARRATION_TARGET = '(?:narracao|roteiro|locucao|texto falado)';
const NARRATION_ACTION = '(?:nova|novo|outra|outro|cri\\w*|fa(?:z|ca|zer)\\w*|ger\\w*|reescrev\\w*|refa\\w*|mud\\w*|alter\\w*|ajust\\w*|corrig\\w*|melhor\\w*)';
const NARRATION_ACTION_PATTERNS = [
    new RegExp(`\\b${NARRATION_ACTION}\\b.{0,36}\\b${NARRATION_TARGET}\\b`),
    new RegExp(`\\b${NARRATION_TARGET}\\b.{0,36}\\b${NARRATION_ACTION}\\b`),
    /\b(?:quero|vamos|preciso)\b.{0,24}\b(?:narracao|roteiro|locucao|texto falado)\b/,
];
const VOICE_OR_DIRECTION_ACTION_PATTERNS = [
    /\b(?:tro(?:c|qu)\w*|mud\w*|ajust\w*|colo(?:c|q)\w*|us\w*|selecion\w*|escolh\w*|deix\w*|remov\w*|tir\w*)\b.{0,24}\b(?:voz|locutor|locutora|locucao|pausa|tag|direcao de voz|fish audio)\b/,
    /\b(?:fa(?:z|ca|zer)\w*)\b.{0,20}\b(?:estilo\s+(?:de\s+)?locutor|estilo\s+(?:de\s+)?locutora|voz|locucao|pausa|tag|direcao de voz)\b/,
    /\b(?:quero|prefiro|vamos|preciso)\b.{0,24}\b(?:voz|locutor|locutora|locucao|pausa|tag|direcao de voz|fish audio)\b/,
    /\bsem\b.{0,12}\b(?:tag|tags|pausa|pausas|direcao|direcoes|fish audio)\b/,
];

const EXPLICIT_TITLE_PATTERN = /\b(?:titulo|titulos|gatilho|gatilhos|texto na tela|textos na tela)\b/;
const TITLE_OF_NARRATION_PATTERN = /\b(?:titulo|titulos|texto na tela|textos na tela)\b.{0,20}\b(?:da|dessa|desta)\b.{0,8}\bnarracao\b/;
const TITLE_ONLY_NEGATION_PATTERN = /\bnao\b.{0,36}\b(?:mud\w*|alter\w*|ajust\w*|refa\w*|reescrev\w*)\b.{0,24}\b(?:narracao|roteiro|locucao|texto falado)\b.{0,36}\b(?:so|somente|apenas)\b.{0,20}\b(?:titulo|titulos|gatilho|gatilhos|texto na tela|textos na tela)\b/;
const NO_NEW_NARRATION_TITLE_PATTERN = /\bnao\b.{0,24}\b(?:outra|nova|novo)\b.{0,12}\b(?:narracao|roteiro|locucao|texto falado)\b.{0,36}\b(?:titulo|titulos|gatilho|gatilhos|texto na tela|textos na tela)\b/;
const NARRATION_MENTION_PATTERN = /\b(?:narracao|roteiro|locucao|texto falado)\b/;

/**
 * Enquanto existe uma proposta ativa, a continuidade natural é ajustar os
 * títulos. Só saímos desse contexto quando o usuário declara que quer voltar
 * à conversa ou trabalhar na narração. Isso cobre instruções curtas como
 * “mantém estes e tira aquele”, sem exigir que a palavra “título” seja repetida.
 */
export const classifyChatTitleModeIntent = (value: unknown): ChatTitleModeIntent => {
    const text = normalizeIntentText(value);
    if (!text) return 'refine_titles';
    if (TITLE_ONLY_NEGATION_PATTERN.test(text) || NO_NEW_NARRATION_TITLE_PATTERN.test(text)) {
        return 'refine_titles';
    }
    if (TITLE_OF_NARRATION_PATTERN.test(text)) return 'refine_titles';
    const hasNarrationAction = NARRATION_ACTION_PATTERNS.some((pattern) => pattern.test(text));
    const hasVoiceAction = VOICE_OR_DIRECTION_ACTION_PATTERNS.some((pattern) => pattern.test(text));
    const hasExitCommand = EXIT_TITLE_MODE_PATTERNS.some((pattern) => pattern.test(text));
    if (hasNarrationAction) return 'narrator';
    if (hasExitCommand && hasVoiceAction) return 'narrator';
    if (hasExitCommand) return 'exit_title_mode';
    if (EXPLICIT_TITLE_PATTERN.test(text)) return 'refine_titles';
    if (hasVoiceAction) return 'narrator';
    if (NARRATION_MENTION_PATTERN.test(text)) return 'narrator';
    return 'refine_titles';
};
