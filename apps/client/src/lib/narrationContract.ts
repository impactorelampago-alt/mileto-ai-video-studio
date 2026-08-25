import type {
    AdData,
    FishModel,
    NarrationDirectionMode,
    TtsProvider,
    VoiceSettings,
} from '../types';
import {
    hasOpsNarrationDirections,
    OPS_NARRATION_DIALECT,
    stripOpsNarrationDirections,
} from './opsNarrationContract.ts';

export const NARRATION_DIRECTION_VERSION = 'fish-s2.1-natural-v1';
export const DEFAULT_TTS_MODEL: FishModel = 's2.1-pro';

// Direcoes do Fish sao descricoes naturais curtas em ingles. Nao tratamos
// qualquer conteudo entre colchetes como tag (por exemplo, [2026]).
const DIRECTION_TOKEN_SOURCE = String.raw`\[[a-z][a-z '\-]{0,63}\]`;
const DIRECTION_PATTERN = new RegExp(DIRECTION_TOKEN_SOURCE, 'g');
const ORPHAN_DIRECTION_TAIL = new RegExp(
    String.raw`(?:\s*${DIRECTION_TOKEN_SOURCE})+\s*([.!?,;:]*)\s*$`,
);
const SUPPORTED_FISH_MODELS = new Set<FishModel>([
    's2.1-pro',
    's2.1-pro-free',
    's2-pro',
    's1',
]);
const DEFAULT_TTS_VOICE_SETTINGS = {
    speed: 1,
    volume: 0,
    stability: 0.4,
    similarityBoost: 0.75,
};

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const stripNarrationDirections = (value: string): string => value
    .replace(DIRECTION_PATTERN, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const hasNarrationDirections = (value: string): boolean => {
    DIRECTION_PATTERN.lastIndex = 0;
    return DIRECTION_PATTERN.test(value);
};

const directionHasImmediateTarget = (value: string, end: number): boolean => {
    let following = value.slice(end);
    const nextDirection = new RegExp(String.raw`^\s*${DIRECTION_TOKEN_SOURCE}`);
    while (nextDirection.test(following)) following = following.replace(nextDirection, '');
    return /^[\s"'“”‘’(\-—]*[\p{L}\p{N}]/u.test(following);
};

/**
 * Respostas automáticas do Narrador podem ocasionalmente colocar uma tag antes
 * da pontuação (`cento e quarenta e nove reais [emphasis].`). A tag não possui
 * alvo falável e o contrato corretamente a rejeitaria. Como o usuário não
 * escreveu essa direção, removemos somente as tags órfãs; tags válidas e todo o
 * conteúdo falado permanecem intactos. O modo manual continua estrito.
 */
const repairAutomaticDirectionsWithoutTarget = (value: string): string => {
    const source = String(value || '');
    // Conteúdo só com tags continua inválido e deve conservar o diagnóstico
    // específico, em vez de virar uma síntese vazia durante a recuperação.
    if (!/[\p{L}\p{N}]/u.test(source.replace(new RegExp(DIRECTION_TOKEN_SOURCE, 'g'), ''))) {
        return source;
    }
    const directions = [...source.matchAll(new RegExp(DIRECTION_TOKEN_SOURCE, 'g'))];
    const invalid = directions.filter((match) => !directionHasImmediateTarget(
        source,
        (match.index || 0) + match[0].length,
    ));
    if (!invalid.length) return source;

    return invalid
        .sort((left, right) => (right.index || 0) - (left.index || 0))
        .reduce((result, match) => {
            const start = match.index || 0;
            return result.slice(0, start) + result.slice(start + match[0].length);
        }, source);
};

/**
 * Recupera rascunhos produzidos por versões anteriores do Chat que podiam
 * terminar com uma direção sem texto (ex.: `Frase final. [soft]`). A direção
 * órfã não tem alvo semântico seguro para onde ser movida, portanto é removida;
 * todas as direções que realmente precedem fala permanecem intactas.
 */
export const removeOrphanNarrationDirections = (value: string): string => String(value || '')
    .replace(ORPHAN_DIRECTION_TAIL, (_match, punctuation: string) => punctuation || '')
    .trim();

/**
 * Prepara a mesma direcao deterministica usada como rede de seguranca no
 * servidor e no gateway. Isso permite mostrar, antes da sintese, exatamente
 * as tags que o S2.1 Pro recebera quando o roteiro ainda estiver limpo.
 * Direcoes criativas vindas do Chat sao preservadas sem qualquer reescrita.
 */
export const prepareAutomaticNarrationDirections = (
    value: string,
    narrationDialect?: string,
): string => {
    const source = text(value);
    const alreadyDirected = narrationDialect === OPS_NARRATION_DIALECT
        ? hasOpsNarrationDirections(source)
        : hasNarrationDirections(source);
    if (!source || alreadyDirected) return source;

    const sentences = source.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [source];
    const content = sentences
        .map((sentence, index) => sentence.trim() ? index : -1)
        .filter((index) => index >= 0);
    if (!content.length) return source;

    const vocabulary = [
        'curious and inviting',
        'clear and informative',
        'confident',
        'warm and reassuring',
        'confident and inviting',
    ];
    const targetCount = Math.min(vocabulary.length, content.length);
    const selected = targetCount === 1
        ? [content[0]]
        : Array.from({ length: targetCount }, (_, slot) =>
            content[Math.round((slot * (content.length - 1)) / (targetCount - 1))]
        );

    selected.forEach((sentenceIndex, slot) => {
        const leading = sentences[sentenceIndex].match(/^\s*/)?.[0] || '';
        sentences[sentenceIndex] = `${leading}[${vocabulary[slot]}] ${sentences[sentenceIndex].slice(leading.length)}`;
    });
    return sentences.join('');
};

const normalizeTaglessS21Mode = (
    model: string,
    mode: NarrationDirectionMode,
    synthesisText: string,
    hasDirections = hasNarrationDirections(synthesisText),
): NarrationDirectionMode => model === DEFAULT_TTS_MODEL
    && mode === 'manual'
    && !hasDirections
    ? 'automatic'
    : mode;

export interface NarrationContractFields {
    narrationPlainText: string;
    narrationSynthesisText: string;
    narrationText: string;
    ttsModel: string;
    voiceId: string | null;
    directionMode: NarrationDirectionMode;
    directionVersion: string;
}

/**
 * Migra drafts anteriores sem apagar escolhas explicitas. `narrationText`
 * continua sendo o alias limpo usado pelas legendas e pelos titulos.
 */
export const normalizeNarrationContract = (
    data?: Partial<AdData>,
): NarrationContractFields => {
    const opsDialect = data?.narrationDialect === OPS_NARRATION_DIALECT;
    const legacy = text(data?.narrationText);
    const storedSynthesis = removeOrphanNarrationDirections(text(data?.narrationSynthesisText));
    const synthesis = storedSynthesis || removeOrphanNarrationDirections(legacy);
    const plain = text(data?.narrationPlainText) || (opsDialect
        ? stripOpsNarrationDirections(synthesis)
        : stripNarrationDirections(synthesis));
    const explicitModel = text(data?.ttsModel) || text(data?.voiceSettings?.fishModel);
    const hasExplicitMode = data?.directionMode === 'manual'
        || data?.directionMode === 'clean'
        || data?.directionMode === 'automatic';
    const requestedMode: NarrationDirectionMode = hasExplicitMode
        ? data!.directionMode!
        : (!explicitModel || explicitModel === DEFAULT_TTS_MODEL)
          ? 'automatic'
          : hasNarrationDirections(synthesis) ? 'manual' : 'clean';
    // Drafts antigos podiam salvar S2.1 Pro como `manual` mesmo sem nenhuma
    // direcao manual. Esse estado deve voltar para automatico; uma escolha
    // explicita por `clean` continua sendo respeitada.
    const mode = normalizeTaglessS21Mode(
        explicitModel || DEFAULT_TTS_MODEL,
        requestedMode,
        synthesis,
        opsDialect ? hasOpsNarrationDirections(synthesis) : hasNarrationDirections(synthesis),
    );

    const preparedSynthesis = mode === 'clean'
        ? plain
        : mode === 'automatic'
          ? prepareAutomaticNarrationDirections(
              opsDialect
                  ? (synthesis || plain)
                  : repairAutomaticDirectionsWithoutTarget(synthesis || plain),
              data?.narrationDialect,
          )
          : (synthesis || plain);

    return {
        narrationPlainText: plain,
        narrationSynthesisText: preparedSynthesis,
        narrationText: plain,
        // Ausencia usa o novo padrao. Valor explicito, inclusive desconhecido,
        // permanece intacto para falhar de forma clara no preflight.
        ttsModel: explicitModel || DEFAULT_TTS_MODEL,
        voiceId: text(data?.voiceId) || text(data?.selectedVoiceId) || null,
        directionMode: mode,
        directionVersion: text(data?.directionVersion) || NARRATION_DIRECTION_VERSION,
    };
};

export const narrationContractFromPlainText = (
    current: Pick<AdData, 'directionMode' | 'ttsModel' | 'voiceId' | 'directionVersion'>,
    value: string,
): NarrationContractFields => {
    const plain = value;
    const mode = normalizeTaglessS21Mode(current.ttsModel, current.directionMode, plain);
    return {
        narrationPlainText: plain,
        narrationSynthesisText: plain,
        narrationText: plain,
        ttsModel: current.ttsModel,
        voiceId: current.voiceId,
        directionMode: mode,
        directionVersion: current.directionVersion || NARRATION_DIRECTION_VERSION,
    };
};

export const narrationContractFromLegacyText = (
    current: Pick<AdData, 'directionMode' | 'ttsModel' | 'voiceId' | 'directionVersion'>,
    value: string,
): NarrationContractFields => {
    const safeSynthesis = removeOrphanNarrationDirections(value);
    const mode = normalizeTaglessS21Mode(current.ttsModel, current.directionMode, safeSynthesis);
    return {
        narrationPlainText: stripNarrationDirections(safeSynthesis),
        narrationSynthesisText: safeSynthesis,
        narrationText: stripNarrationDirections(safeSynthesis),
        ttsModel: current.ttsModel,
        voiceId: current.voiceId,
        directionMode: mode,
        directionVersion: current.directionVersion || NARRATION_DIRECTION_VERSION,
    };
};

/**
 * Converte o roteiro retornado pelo Chat sem consultar o texto visivel da
 * conversa para decidir o modo. A decisao vem exclusivamente da metadata
 * estruturada da mensagem; mensagens antigas preservam o modo do projeto.
 */
export const narrationContractFromChatScript = (
    current: Pick<AdData, 'directionMode' | 'ttsModel' | 'voiceId' | 'directionVersion'>,
    value: string,
    metadataMode?: NarrationDirectionMode | null,
): NarrationContractFields => {
    const base = narrationContractFromLegacyText(current, value);
    return metadataMode ? narrationContractForMode(base, metadataMode) : base;
};

export const narrationContractForMode = (
    current: NarrationContractFields,
    mode: NarrationDirectionMode,
): NarrationContractFields => {
    const effectiveMode = normalizeTaglessS21Mode(
        current.ttsModel,
        mode,
        current.narrationSynthesisText || current.narrationPlainText,
    );
    return {
        ...current,
        directionMode: effectiveMode,
        narrationSynthesisText: effectiveMode === 'manual'
            ? (current.narrationSynthesisText || current.narrationPlainText)
            : current.narrationPlainText,
    };
};

const assertBalancedBrackets = (value: string) => {
    let depth = 0;
    for (const character of value) {
        if (character === '[') depth += 1;
        if (character === ']') depth -= 1;
        if (depth < 0 || depth > 1) {
            throw new Error('narration_directions_invalid: As direcoes de voz possuem colchetes desbalanceados.');
        }
    }
    if (depth !== 0) {
        throw new Error('narration_directions_invalid: As direcoes de voz possuem colchetes desbalanceados.');
    }
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const assertDirectionsOutsideProtectedValues = (value: string, protectedTerms: string[]) => {
    const directionInsideNumericValue = new RegExp(
        String.raw`(?:R\$\s*${DIRECTION_TOKEN_SOURCE}\s*\d|\d\s*${DIRECTION_TOKEN_SOURCE}\s*[\d.,-])`,
        'i',
    );
    if (directionInsideNumericValue.test(value)) {
        throw new Error('narration_direction_placement_invalid: Uma direcao de voz foi colocada dentro de um preco ou numero.');
    }
    for (const term of protectedTerms) {
        const words = term.trim().split(/\s+/).filter(Boolean);
        if (words.length < 2) continue;
        const interruptedTerm = new RegExp(
            words.map(escapeRegExp).join(String.raw`(?:\s+|\s*${DIRECTION_TOKEN_SOURCE}\s*)+`),
            'i',
        );
        const match = value.match(interruptedTerm)?.[0] || '';
        if (hasNarrationDirections(match)) {
            throw new Error('narration_direction_placement_invalid: Uma direcao de voz foi colocada dentro de um nome protegido.');
        }
    }
};

export interface NarrationTtsRequest {
    text: string;
    narrationPlainText: string;
    narrationSynthesisText: string;
    ttsModel: string;
    voiceId: string | null;
    provider: TtsProvider;
    voiceSettings: Omit<VoiceSettings, 'fishModel'> & { fishModel?: FishModel };
    directionMode: NarrationDirectionMode;
    directionVersion: string;
    narrationDialect?: 'mileto-ops-bracket-v1';
    protectedTerms?: string[];
}

export const buildNarrationTtsRequest = (
    input: AdData,
    protectedTerms: string[] = [],
): NarrationTtsRequest => {
    const contract = normalizeNarrationContract(input);
    const provider = input.selectedVoiceProvider || 'fishAudio';
    const voiceId = contract.voiceId || input.selectedVoiceId;
    const effectiveDirectionMode: NarrationDirectionMode = provider === 'fishAudio'
        ? contract.directionMode
        : 'clean';
    const synthesis = effectiveDirectionMode === 'clean'
        ? contract.narrationPlainText
        : contract.narrationSynthesisText;
    const effectiveModel = provider === 'fishAudio'
        ? contract.ttsModel
        : 'eleven_multilingual_v2';
    const opsDialect = input.narrationDialect === OPS_NARRATION_DIALECT;
    const spokenContent = opsDialect
        ? stripOpsNarrationDirections(synthesis)
        : stripNarrationDirections(synthesis);

    if (!contract.narrationPlainText) {
        throw new Error('narration_missing: Digite o texto da narracao antes de gerar.');
    }
    if (!synthesis || !spokenContent) {
        throw new Error('narration_tags_only: A narracao nao pode ser composta apenas por direcoes de voz.');
    }
    assertBalancedBrackets(synthesis);
    if (provider === 'fishAudio' && !SUPPORTED_FISH_MODELS.has(effectiveModel as FishModel)) {
        throw new Error(`tts_model_unavailable: O modelo solicitado (${effectiveModel}) nao esta disponivel. Nenhum fallback foi aplicado.`);
    }

    const uniqueProtectedTerms = [...new Set(protectedTerms.map(text).filter(Boolean))];
    assertDirectionsOutsideProtectedValues(synthesis, uniqueProtectedTerms);
    const voiceSettings = {
        speed: input.voiceSettings?.speed ?? DEFAULT_TTS_VOICE_SETTINGS.speed,
        volume: input.voiceSettings?.volume ?? DEFAULT_TTS_VOICE_SETTINGS.volume,
        stability: input.voiceSettings?.stability ?? DEFAULT_TTS_VOICE_SETTINGS.stability,
        similarityBoost: input.voiceSettings?.similarityBoost ?? DEFAULT_TTS_VOICE_SETTINGS.similarityBoost,
        ...(provider === 'fishAudio' ? { fishModel: effectiveModel as FishModel } : {}),
    };
    return {
        text: synthesis,
        narrationPlainText: contract.narrationPlainText,
        narrationSynthesisText: synthesis,
        ttsModel: effectiveModel,
        voiceId,
        provider,
        voiceSettings,
        directionMode: effectiveDirectionMode,
        directionVersion: contract.directionVersion,
        ...(opsDialect ? { narrationDialect: OPS_NARRATION_DIALECT } : {}),
        ...(uniqueProtectedTerms.length ? { protectedTerms: uniqueProtectedTerms } : {}),
    };
};

export const contractFromTtsResponse = (
    input: AdData,
    response: Record<string, unknown>,
): NarrationContractFields => {
    const nested = response.contract && typeof response.contract === 'object'
        ? response.contract as Record<string, unknown>
        : {};
    const value = { ...response, ...nested };
    return normalizeNarrationContract({
        ...input,
        narrationPlainText: text(value.narrationPlainText) || input.narrationPlainText,
        narrationSynthesisText: text(value.narrationSynthesisText) || input.narrationSynthesisText,
        ttsModel: text(value.ttsModel) || input.ttsModel,
        voiceId: text(value.voiceId) || input.voiceId,
        directionMode: value.directionMode === 'automatic'
            || value.directionMode === 'manual'
            || value.directionMode === 'clean'
            ? value.directionMode
            : input.directionMode,
        directionVersion: text(value.directionVersion) || input.directionVersion,
    });
};
