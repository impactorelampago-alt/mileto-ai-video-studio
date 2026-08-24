import { query, pool } from './db.js';
import { getMultiplier } from './settings.js';
import { ttsProviderCostUsd } from './ttsModels.js';

/**
 * Custo no fornecedor, em US$. Estes numeros sao o CUSTO (o que a plataforma paga).
 * O cliente paga isto x multiplicador de revenda, convertido em creditos Mileto.
 *
 * TTS cobra por unidade de texto: Fish por BYTE UTF-8, ElevenLabs por caractere.
 */
/**
 * Custo de CHAT por MODELO real (US$ por 1M tokens, aproximacao input+output).
 * ⚠️ O tier Mileto resolve para um modelo real; cobrar todos a um preco unico
 * (bug antigo) fazia o Ultra=gpt-4.1 ser cobrado a preco de nano = prejuizo.
 * Refine com os precos oficiais quando quiser separar input/output.
 */
const MODEL_COST = {
    // Luna: entrada US$ 0,20 / saída US$ 1,20 por MTok. Como o ledger
    // histórico guarda tokens totais, usamos o teto de saída para nunca
    // subcobrar; a reserva e a conciliação permanecem conservadoras.
    'gpt-5.6-luna': 1.2,
    'gpt-5': 8.0,
    'gpt-5-mini': 1.6,
    'gpt-5-nano': 0.4,
    'gpt-4.1-nano': 0.4,
    'gpt-4.1-mini': 1.6,
    'gpt-4.1': 8.0,
    'gpt-4o-mini': 0.6,
    'gpt-4o': 7.5,
    'o4-mini': 4.0,
    'o3-mini': 4.0,
    'gemini-2.0-flash': 0.4,
    'gemini-2.5-flash': 0.6,
    'gemini-2.5-pro': 5.0,
};
/** Modelo de chat desconhecido: assume um preco alto pra NAO subcobrar por engano. */
const CHAT_DEFAULT_USD_PER_M = 8.0;

/** Whisper-1: US$ 0,006/min = US$ 0,0001/segundo. */
const STT_USD_PER_SECOND = 0.0001;

/** ElevenLabs Audio Isolation: US$ 0,12 por minuto de áudio de entrada. */
export const AUDIO_ISOLATION_USD_PER_MINUTE = 0.12;
export const audioIsolationProviderCostUsd = (durationSeconds) => {
    const seconds = Number(durationSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return (seconds / 60) * AUDIO_ISOLATION_USD_PER_MINUTE;
};

/** 1 credito Mileto = US$ 0,001 de custo de fornecedor. Escala so de exibicao. */
const CREDITS_PER_USD = 1000;

/** Cotação para recursos cobrados por saída (imagem/vídeo), configurada no agente. */
export const quoteFixedProviderCost = async (providerCostUsd, kind) => {
    const providerCost = Number(providerCostUsd);
    if (!Number.isFinite(providerCost) || providerCost <= 0) {
        throw new Error('Custo do fornecedor não configurado para esta geração.');
    }
    const rawMult = await getMultiplier(kind);
    const multiplier = Number.isFinite(rawMult) && rawMult > 0 ? rawMult : 1.5;
    return {
        providerCost,
        charged: providerCost * multiplier * CREDITS_PER_USD,
    };
};

export const estimateUnits = (provider, kind, text) => {
    if (kind === 'tts' && provider === 'fishAudio') return Buffer.byteLength(text, 'utf8');
    if (kind === 'tts') return text.length; // ElevenLabs cobra por caractere
    return Math.ceil(text.length / 4); // chat: ~4 chars/token
};

/** Custo bruto no fornecedor (US$), por tipo. Sempre retorna numero finito. */
const providerCostUsd = (provider, model, units, kind) => {
    let usd = 0;
    if (kind === 'stt') usd = units * STT_USD_PER_SECOND;
    else if (kind === 'audio_isolation') usd = audioIsolationProviderCostUsd(units);
    else if (kind === 'chat') usd = (units / 1_000_000) * (MODEL_COST[model] ?? CHAT_DEFAULT_USD_PER_M);
    else if (kind === 'tts') usd = ttsProviderCostUsd(provider, model, units);
    return Number.isFinite(usd) ? usd : 0;
};

/** Preco em creditos Mileto. Blindado contra multiplicador/custo nao-finito (evita NaN no saldo). */
export const priceOf = async (provider, model, units, kind) => {
    const providerCost = providerCostUsd(provider, model, units, kind);
    const rawMult = await getMultiplier(kind);
    const multiplier = Number.isFinite(rawMult) && rawMult > 0 ? rawMult : 1.5;
    const charged = providerCost * multiplier * CREDITS_PER_USD;
    return { providerCost, charged: Number.isFinite(charged) ? charged : 0 };
};

export const getBalance = async (orgId) => {
    const { rows } = await query('SELECT balance FROM credits WHERE org_id = $1', [orgId]);
    return rows[0] ? Number(rows[0].balance) : 0;
};

class BillingError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/**
 * RESERVA (reserve-then-confirm): ANTES de chamar o fornecedor pago, verifica numa
 * transacao que a org esta ativa e tem saldo >= estimativa, e DEBITA a estimativa.
 * Isso impede o vetor critico "org com saldo 0 dispara N chamadas e gasta dinheiro
 * real da plataforma" e o gasto duplo por concorrencia (FOR UPDATE serializa).
 * Em modo demo nao cobra. Devolve o valor reservado para o settle/release.
 */
export const reserve = async ({ orgId, estCharge, demo }) => {
    const est = Number.isFinite(estCharge) && estCharge > 0 ? estCharge : 0;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const org = (await client.query('SELECT status FROM organizations WHERE id = $1', [orgId])).rows[0];
        if (!org) {
            await client.query('ROLLBACK');
            throw new BillingError('ORG_NOT_FOUND', 'Organização não encontrada.');
        }
        if (org.status !== 'active') {
            await client.query('ROLLBACK');
            throw new BillingError('ORG_SUSPENDED', 'Conta suspensa. Regularize para voltar a usar.');
        }
        const { rows } = await client.query('SELECT balance FROM credits WHERE org_id = $1 FOR UPDATE', [orgId]);
        const balance = rows[0] ? Number(rows[0].balance) : 0;
        if (!demo && balance < est) {
            await client.query('ROLLBACK');
            throw new BillingError('INSUFFICIENT_CREDIT', 'Saldo de créditos insuficiente.');
        }
        if (!demo && est > 0) {
            await client.query('UPDATE credits SET balance = balance - $2, updated_at = now() WHERE org_id = $1', [
                orgId,
                est,
            ]);
        }
        await client.query('COMMIT');
        return est;
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
};

/**
 * CONFIRMA o consumo real depois que o fornecedor respondeu: calcula o custo real
 * (agora sabendo as unidades de verdade), ajusta o saldo pela diferenca contra a
 * reserva (devolve o que reservou a mais, cobra o que faltou) e registra no ledger.
 */
export const settle = async ({ orgId, userId, provider, model, kind, units, demo, reserved }) => {
    const { providerCost, charged } = await priceOf(provider, model, units, kind);
    const finalCharge = demo ? 0 : charged;
    const adjust = (reserved || 0) - finalCharge; // >0 devolve, <0 cobra a mais
    // O custo pode ser proporcional a uma duração fracionária, mas o ledger
    // histórico usa INTEGER. Arredondamos somente a unidade de auditoria; preço e
    // conciliação continuam usando a duração real recebida acima.
    const ledgerUnits = Math.max(0, Math.ceil(Number(units) || 0));
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (!demo && adjust !== 0) {
            await client.query('UPDATE credits SET balance = balance + $2, updated_at = now() WHERE org_id = $1', [
                orgId,
                adjust,
            ]);
        }
        await client.query(
            `INSERT INTO usage_ledger (org_id, user_id, provider, model, kind, units, provider_cost, charged, demo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [orgId, userId, provider, model || null, kind, ledgerUnits, providerCost.toFixed(6), finalCharge.toFixed(4), demo]
        );
        const { rows } = await client.query('SELECT balance FROM credits WHERE org_id = $1', [orgId]);
        await client.query('COMMIT');
        return { providerCost, charged: finalCharge, balanceAfter: rows[0] ? Number(rows[0].balance) : 0 };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
};

/** Conciliação de uma geração síncrona cujo custo máximo foi configurado no agente. */
export const settleFixed = async ({ orgId, userId, provider, model = null, kind, providerCost, charged, demo, reserved }) => {
    const finalCharge = demo ? 0 : charged;
    const adjust = (reserved || 0) - finalCharge;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (!demo && adjust !== 0) {
            await client.query('UPDATE credits SET balance = balance + $2, updated_at = now() WHERE org_id = $1', [
                orgId,
                adjust,
            ]);
        }
        await client.query(
            `INSERT INTO usage_ledger (org_id, user_id, provider, model, kind, units, provider_cost, charged, demo)
             VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)`,
            [orgId, userId, provider, model, kind, Number(providerCost).toFixed(6), Number(finalCharge).toFixed(4), demo]
        );
        const { rows } = await client.query('SELECT balance FROM credits WHERE org_id = $1', [orgId]);
        await client.query('COMMIT');
        return { providerCost, charged: finalCharge, balanceAfter: rows[0] ? Number(rows[0].balance) : 0 };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
};

/** DEVOLVE a reserva quando a chamada ao fornecedor falha (nada foi consumido). */
export const release = async ({ orgId, reserved, demo }) => {
    if (demo || !reserved) return;
    await query('UPDATE credits SET balance = balance + $2, updated_at = now() WHERE org_id = $1', [orgId, reserved]);
};
