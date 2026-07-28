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
        seedance: process.env.SEEDANCE_KEY || '',
    },
    resellMultiplier: safeMultiplier,
    r2: {
        accountId: process.env.R2_ACCOUNT_ID || '',
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        bucket: process.env.R2_BUCKET || '',
        downloadUrlTtl: Math.max(60, Number(process.env.R2_DOWNLOAD_URL_TTL || 3600)),
    },
    // Integração first-party com o Mileto Ops. É opcional: deploys existentes
    // continuam funcionando sem estas variáveis e a UI recebe enabled=false.
    ops: {
        baseUrl: String(process.env.OPS_BASE_URL || '').replace(/\/+$/, ''),
        clientId: process.env.OPS_CLIENT_ID || '',
        clientSecret: process.env.OPS_CLIENT_SECRET || '',
        redirectUri: process.env.OPS_REDIRECT_URI || '',
        tokenEncryptionKey: process.env.OPS_TOKEN_ENCRYPTION_KEY || '',
        scopes: String(
            process.env.OPS_SCOPES ||
                'account.read users.read user_links.write companies.read assets.read assets.stream assets.download'
        )
            .split(/\s+/)
            .filter(Boolean),
    },
};

config.r2.enabled = Boolean(
    config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket
);

config.ops.enabled = Boolean(
    config.ops.baseUrl &&
        config.ops.clientId &&
        config.ops.clientSecret &&
        config.ops.redirectUri &&
        config.ops.tokenEncryptionKey
);

/** Sem chave configurada, o gateway opera em modo demo (não gasta dinheiro). */
export const isDemoMode = (provider) => !config.keys[provider];
