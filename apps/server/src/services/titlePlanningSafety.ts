/**
 * Normalizacao compartilhada pelas validacoes do planejamento de titulos.
 * A pontuacao e os acentos nao alteram a comparacao, mas a ordem das palavras
 * continua relevante para impedir que fatos distantes sejam recombinados.
 */
export const normalizePlanningText = (value: unknown) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9%$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Aceita somente um trecho normalizado continuo da fonte autorizada. */
export const planningLiteralExists = (source: string, candidate: unknown) => {
    const sourceKey = normalizePlanningText(source);
    const candidateKey = normalizePlanningText(candidate);
    return candidateKey.length > 1 && (` ${sourceKey} `).includes(` ${candidateKey} `);
};

/**
 * O texto visual sugerido pela IA precisa preservar uma unica frase/fato da
 * evidencia. Palavras soltas presentes em pontos diferentes nao bastam.
 */
export const planningDisplaySupported = (sourceText: string, displayText: string) =>
    planningLiteralExists(sourceText, displayText);
