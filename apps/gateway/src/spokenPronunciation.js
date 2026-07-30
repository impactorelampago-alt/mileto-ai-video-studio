// Dicionário fonético aplicado somente ao texto enviado ao TTS. A grafia
// exibida no roteiro, salva no projeto e usada nas legendas permanece intacta.
//
// A Fish Audio ainda não oferece controle fonético documentado para pt-BR.
// Mantemos aqui apenas exceções verificadas na mesma voz e velocidade usadas
// no produto, evitando transformar o roteiro do usuário em grafia artificial.
const PT_BR_PRONUNCIATION_RULES = [
    { pattern: /\bAraçariguama\b/giu, replacement: 'Araçari-guama' },
];

export const normalizeSpokenPronunciationPtBr = (value) => {
    if (typeof value !== 'string' || !value.trim()) return value;
    return PT_BR_PRONUNCIATION_RULES.reduce(
        (text, rule) => text.replace(rule.pattern, rule.replacement),
        value
    );
};

