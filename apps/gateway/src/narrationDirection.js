const FINAL_NARRATION_PATTERN = /(===\s*ROTEIRO\s*===\s*)([\s\S]*?)(\s*===\s*FIM\s*===)/i;
const BRACKET_DIRECTION_PATTERN_GLOBAL = /\[[a-z][a-z '-]{0,63}\]/g;
const TRAILING_ORPHAN_DIRECTIONS_PATTERN = /(?:\s*\[[a-z][a-z '-]{0,63}\])+\s*([.!?,;:]*)\s*$/;
const CLEAN_NARRATION_REQUEST = /(?:sem\s+tags?|texto\s+limpo|fish\s*audio\s*s1|modelo\s*s1)/i;

const removeNaturalDirections = (narration) => narration
    .replace(BRACKET_DIRECTION_PATTERN_GLOBAL, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Uma direcao controla somente o texto que vem depois dela. Direcoes no fim
// do roteiro nao possuem alvo; move-las para tras mudaria o sentido criativo.
// Removemos apenas a sequencia terminal reconhecida como direcao natural,
// mantendo tags validas anteriores e colchetes editoriais intactos.
const removeTrailingOrphanDirections = (narration) => String(narration || '')
    .replace(TRAILING_ORPHAN_DIRECTIONS_PATTERN, (_match, punctuation) => punctuation || '')
    .trim();

// Pausas de locução também são fronteiras naturais de leitura. O modelo pode
// devolver tudo na mesma linha; esta proteção mantém o roteiro escaneável e
// recupera o visual em parágrafos sem alterar nenhuma palavra falada.
export const formatNarrationParagraphs = (narration) =>
    String(narration || '')
        .replace(/(\S)[ \t]*(\[(?:pause|long pause)\])[ \t]*/gi, '$1 $2\n\n')
        .replace(/^[ \t]*(\[(?:pause|long pause)\])[ \t]*/gim, '$1\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

export const userRequestedCleanNarration = (messages = []) => {
    const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
    return CLEAN_NARRATION_REQUEST.test(String(latestUserMessage?.content || ''));
};

// Compatibilidade de API: a função não cria direção de voz. Ela apenas
// higieniza o bloco técnico final, remove direções órfãs e honra texto limpo.
export const ensureNarrationSalesVoiceDirection = (text, { allowClean = false } = {}) => {
    if (typeof text !== 'string') return text;
    return text.replace(FINAL_NARRATION_PATTERN, (_match, opening, rawNarration, closing) => {
        const narration = removeTrailingOrphanDirections(formatNarrationParagraphs(
            allowClean ? removeNaturalDirections(rawNarration.trim()) : rawNarration.trim()
        ));
        return `${opening}${narration}${closing}`;
    });
};
