import { query } from './db.js';
import { getMultiplier } from './settings.js';

/**
 * Tabela de custo por fornecedor, em US$ por unidade.
 * Fonte: PESQUISA-NARRACAO-IA.md (conferido 22/07/2026). Fish cobra por BYTE UTF-8.
 * Estes números são o CUSTO no fornecedor — o que você paga. O que o cliente paga
 * é isto × RESELL_MULTIPLIER, convertido em créditos Mileto.
 *
 * ⚠️ Ainda falta somar o gross-up de importação (IOF/IRRF/ISS/IBS-CBS): o custo real
 * posto no Brasil é maior. Ajuste o multiplicador quando o contador der o número.
 */
const PROVIDER_COST = {
    fishAudio: { unit: 'bytes', usdPerMillion: 15.0 },
    elevenLabs: { unit: 'chars', usdPerMillion: 165.0 },
    openai: { unit: 'tokens', usdPerMillion: 0.6 }, // estimativa p/ modelo nano; refine por modelo
    gemini: { unit: 'tokens', usdPerMillion: 0.4 },
};

/** Whisper-1 cobra por tempo de áudio: US$ 0,006/min = US$ 0,0001/segundo. */
const STT_USD_PER_SECOND = 0.0001;

/** 1 crédito Mileto = US$ 0,001 de custo de fornecedor. Escala só de exibição. */
const CREDITS_PER_USD = 1000;

export const estimateUnits = (provider, kind, text) => {
    if (kind === 'tts' && provider === 'fishAudio') return Buffer.byteLength(text, 'utf8');
    if (kind === 'tts') return text.length; // ElevenLabs cobra por caractere
    // chat: aproximação grosseira de tokens (~4 chars/token). Refina com uso real do provedor.
    return Math.ceil(text.length / 4);
};

export const priceOf = async (provider, units, kind) => {
    let providerCost;
    if (kind === 'stt') {
        // Legendas: `units` são SEGUNDOS de áudio, não tokens/bytes.
        providerCost = units * STT_USD_PER_SECOND;
    } else {
        const table = PROVIDER_COST[provider];
        providerCost = table ? (units / 1_000_000) * table.usdPerMillion : 0;
    }
    const multiplier = await getMultiplier(kind); // multiplicador da feature (fallback global)
    const charged = providerCost * multiplier * CREDITS_PER_USD;
    return { providerCost, charged };
};

export const getBalance = async (orgId) => {
    const { rows } = await query('SELECT balance FROM credits WHERE org_id = $1', [orgId]);
    return rows[0] ? Number(rows[0].balance) : 0;
};

/**
 * Debita da ORGANIZAÇÃO e registra a chamada de forma atômica.
 * A equipe compartilha o saldo, por isso o débito é por org, não por usuário.
 * Lança se o saldo for insuficiente.
 */
export const debitAndLog = async ({ orgId, userId, provider, kind, units, demo }) => {
    const { providerCost, charged } = await priceOf(provider, units, kind);

    const client = await (await import('./db.js')).pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query('SELECT balance FROM credits WHERE org_id = $1 FOR UPDATE', [orgId]);
        const balance = rows[0] ? Number(rows[0].balance) : 0;

        // Em modo demo não cobra — deixa testar o fluxo sem esvaziar saldo.
        if (!demo && balance < charged) {
            await client.query('ROLLBACK');
            const err = new Error('Saldo de créditos insuficiente.');
            err.code = 'INSUFFICIENT_CREDIT';
            throw err;
        }

        if (!demo) {
            await client.query(
                'UPDATE credits SET balance = balance - $2, updated_at = now() WHERE org_id = $1',
                [orgId, charged]
            );
        }

        await client.query(
            `INSERT INTO usage_ledger (org_id, user_id, provider, kind, units, provider_cost, charged, demo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [orgId, userId, provider, kind, units, providerCost.toFixed(6), demo ? 0 : charged.toFixed(4), demo]
        );

        await client.query('COMMIT');
        return { providerCost, charged: demo ? 0 : charged, balanceAfter: demo ? balance : balance - charged };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
};
