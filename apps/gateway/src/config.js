import 'dotenv/config';

const required = (name) => {
    const v = process.env[name];
    if (!v) throw new Error(`Variável de ambiente ausente: ${name}. Copie .env.example para .env.`);
    return v;
};

// RESELL_MULTIPLIER pode vir com vírgula ('1,5') ou vazio — nunca deixe virar NaN,
// senão a primeira cobrança quebra o saldo da org para NaN permanentemente.
const rawMultiplier = Number(process.env.RESELL_MULTIPLIER || 1.5);
const safeMultiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1.5;

export const config = {
    port: Number(process.env.PORT || 4000),
    databaseUrl: required('DATABASE_URL'),
    tokenSecret: required('TOKEN_SECRET'),
    admin: {
        email: process.env.ADMIN_EMAIL || 'admin@mileto.local',
        // Obrigatória: sem default 'admin'. Um deploy que esqueça a variável cria o
        // dono da plataforma com senha trivial — controle total nas mãos de qualquer um.
        password: required('ADMIN_PASSWORD'),
    },
    // Primeiro cliente real, criado pelo seed (opcional).
    seedOwner: {
        email: process.env.SEED_OWNER_EMAIL || '',
        password: process.env.SEED_OWNER_PASSWORD || '',
        org: process.env.SEED_OWNER_ORG || 'Impacto Relâmpago',
        plan: process.env.SEED_OWNER_PLAN || 'enterprise',
    },
    keys: {
        fishAudio: process.env.FISH_AUDIO_KEY || '',
        elevenLabs: process.env.ELEVENLABS_KEY || '',
        openai: process.env.OPENAI_KEY || '',
        gemini: process.env.GEMINI_KEY || '',
    },
    resellMultiplier: safeMultiplier,
};

/** Sem chave configurada, o gateway opera em modo demo (não gasta dinheiro). */
export const isDemoMode = (provider) => !config.keys[provider];
