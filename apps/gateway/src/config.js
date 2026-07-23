import 'dotenv/config';

const required = (name) => {
    const v = process.env[name];
    if (!v) throw new Error(`Variável de ambiente ausente: ${name}. Copie .env.example para .env.`);
    return v;
};

export const config = {
    port: Number(process.env.PORT || 4000),
    databaseUrl: required('DATABASE_URL'),
    tokenSecret: required('TOKEN_SECRET'),
    admin: {
        email: process.env.ADMIN_EMAIL || 'admin@mileto.local',
        password: process.env.ADMIN_PASSWORD || 'admin',
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
    resellMultiplier: Number(process.env.RESELL_MULTIPLIER || 1.5),
};

/** Sem chave configurada, o gateway opera em modo demo (não gasta dinheiro). */
export const isDemoMode = (provider) => !config.keys[provider];
