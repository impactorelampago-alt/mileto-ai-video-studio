import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAudioDuration } from './fishAudio';
import { gatewayTts } from './gatewayClient';
import { VoiceSettings, clamp, isFishModel, DEFAULT_FISH_MODEL } from './ttsTypes';

/**
 * Narração via GATEWAY, preservando o cache em disco.
 *
 * A síntese de áudio agora acontece no gateway (que tem as chaves e mede o
 * consumo). Aqui fica o que é local e não faz sentido subir: a chave de cache
 * MD5 (mesmo texto+voz+ajustes = mesmo arquivo, sem regerar nem cobrar de novo),
 * o atalho da narração-padrão de demonstração e a medição de duração via ffprobe.
 */

const BASE_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const NARRATION_DIR = path.join(BASE_DATA_PATH, 'narrations');
// Incrementar quando a preparação do texto enviado ao provedor mudar. Sem isso,
// um MP3 sintetizado antes da correção de números continuaria sendo devolvido do
// cache local mesmo com o gateway já corrigido.
const NARRATION_CACHE_VERSION = 'spoken-numbers-v4-ptbr-pronunciation';

if (!fs.existsSync(NARRATION_DIR)) fs.mkdirSync(NARRATION_DIR, { recursive: true });

const buildProsody = (settings?: VoiceSettings) => {
    const speed = clamp(settings?.speed ?? 1, 0.5, 2);
    const volume = clamp(settings?.volume ?? 0, -20, 20);
    if (speed === 1 && volume === 0) return null;
    return { speed, volume };
};

export interface GatewayNarrationResult {
    url: string;
    path: string;
    duration: number;
    demo: boolean;
    balance: number | null;
}

export const synthesizeViaGateway = async (
    token: string,
    provider: string,
    voiceId: string,
    text: string,
    settings?: VoiceSettings
): Promise<GatewayNarrationResult> => {
    const finalText = text.trim();
    const prosody = buildProsody(settings);
    const model = isFishModel(settings?.fishModel) ? (settings!.fishModel as string) : DEFAULT_FISH_MODEL;

    // Provedor ENTRA na chave: Fish e ElevenLabs geram áudios diferentes para o
    // mesmo id de voz, então não podem compartilhar cache.
    const cacheSuffix = `${prosody ? `-s${prosody.speed}-v${prosody.volume}` : ''}-m${model}`;
    const hash = crypto
        .createHash('md5')
        .update(`${NARRATION_CACHE_VERSION}-${provider}-${voiceId}-${finalText}${cacheSuffix}`)
        .digest('hex');
    const fileName = `narration-${hash}.mp3`;
    let filePath = path.join(NARRATION_DIR, fileName);

    // Narração-padrão de demonstração: não gasta crédito nem chama o gateway.
    // Normaliza REMOVENDO ACENTOS (NFD): sem isso `\W` comia o ç/ã/ó e os termos
    // comparados (que tinham acento) nunca casavam — o atalho não disparava e a
    // narração-padrão ia pro gateway cobrando crédito a cada render.
    const normalizedText = text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '');
    const isDefault = normalizedText.includes('atencaoatencao') && normalizedText.includes('oticavivaz');
    if (isDefault && !prosody && voiceId === '3cd37df623144626b4c9d12e22dbe898') {
        const defaultFilePath = path.join(NARRATION_DIR, 'default-narration.mp3');
        if (!fs.existsSync(defaultFilePath)) {
            const bundledProd = path.join(__dirname, 'public', 'narrations', 'default-narration.mp3');
            const bundledDev = path.join(__dirname, '..', 'public', 'narrations', 'default-narration.mp3');
            const bundled = fs.existsSync(bundledProd) ? bundledProd : bundledDev;
            if (fs.existsSync(bundled)) fs.copyFileSync(bundled, defaultFilePath);
        }
        if (fs.existsSync(defaultFilePath)) {
            const duration = await getAudioDuration(defaultFilePath);
            return { url: '/narrations/default-narration.mp3', path: defaultFilePath, duration, demo: false, balance: null };
        }
        filePath = defaultFilePath;
    }

    let demo = false;
    let balance: number | null = null;
    if (!fs.existsSync(filePath)) {
        console.log(`[TTS→Gateway] Sintetizando (${provider}/${model}): "${finalText.substring(0, 30)}..."`);
        const result = await gatewayTts(token, { text: finalText, voiceId, provider, voiceSettings: settings });
        fs.writeFileSync(filePath, result.audio);
        demo = result.demo;
        balance = result.balance;
    }

    const duration = await getAudioDuration(filePath);
    return { url: `/narrations/${fileName}`, path: filePath, duration, demo, balance };
};
