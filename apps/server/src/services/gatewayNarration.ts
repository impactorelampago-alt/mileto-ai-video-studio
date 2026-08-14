import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAudioDuration } from './fishAudio';
import { gatewayTts } from './gatewayClient';
import { VoiceSettings, clamp, isFishModel, DEFAULT_FISH_MODEL } from './ttsTypes';
import type { NarrationDialect, NarrationDirectionMode } from './fishNarrationContract';

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
// A v4 podia calcular a chave da Fish como s2-pro, mas enviar ao gateway um
// payload legado sem fishModel; o gateway entao sintetizava no gratuito. A
// versao adicional vale apenas para a Fish, sem invalidar caches ElevenLabs.
// O sufixo S2.1 tambem separa o novo padrao pago de caches da geracao anterior.
const FISH_NARRATION_CACHE_VERSION = 'paid-fish-s2.1-default-v1';

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
    model: string;
    directionVersion?: string;
}

export interface GatewayNarrationContractMetadata {
    narrationPlainText: string;
    narrationSynthesisText: string;
    ttsModel: string;
    directionMode: NarrationDirectionMode;
    directionVersion: string;
    narrationDialect: NarrationDialect;
    protectedTerms: string[];
}

export const synthesizeViaGateway = async (
    token: string,
    provider: string,
    voiceId: string,
    text: string,
    settings?: VoiceSettings,
    contract?: GatewayNarrationContractMetadata,
): Promise<GatewayNarrationResult> => {
    const finalText = text.trim();
    const prosody = buildProsody(settings);
    const model = contract?.ttsModel || (provider === 'fishAudio'
        ? (isFishModel(settings?.fishModel) ? (settings!.fishModel as string) : DEFAULT_FISH_MODEL)
        : 'eleven_multilingual_v2');
    const normalizedSettings = provider === 'fishAudio'
        ? { ...(settings || {}), fishModel: model }
        : settings;
    const cacheVersion = provider === 'fishAudio'
        ? `${NARRATION_CACHE_VERSION}-${FISH_NARRATION_CACHE_VERSION}`
        : NARRATION_CACHE_VERSION;

    // Provedor ENTRA na chave: Fish e ElevenLabs geram áudios diferentes para o
    // mesmo id de voz, então não podem compartilhar cache.
    const contractSuffix = contract?.directionVersion ? `-d${contract.directionVersion}` : '';
    const cacheSuffix = `${prosody ? `-s${prosody.speed}-v${prosody.volume}` : ''}-m${model}${contractSuffix}`;
    const hash = crypto
        .createHash('md5')
        .update(`${cacheVersion}-${provider}-${voiceId}-${finalText}${cacheSuffix}`)
        .digest('hex');
    let fileName = `narration-${hash}.mp3`;
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
    if (!contract && isDefault && !prosody && voiceId === '3cd37df623144626b4c9d12e22dbe898') {
        const defaultFilePath = path.join(NARRATION_DIR, 'default-narration.mp3');
        if (!fs.existsSync(defaultFilePath)) {
            const bundledProd = path.join(__dirname, 'public', 'narrations', 'default-narration.mp3');
            const bundledDev = path.join(__dirname, '..', 'public', 'narrations', 'default-narration.mp3');
            const bundled = fs.existsSync(bundledProd) ? bundledProd : bundledDev;
            if (fs.existsSync(bundled)) fs.copyFileSync(bundled, defaultFilePath);
        }
        if (fs.existsSync(defaultFilePath)) {
            const duration = await getAudioDuration(defaultFilePath);
            return {
                url: '/narrations/default-narration.mp3',
                path: defaultFilePath,
                duration,
                demo: false,
                balance: null,
                model,
            };
        }
        filePath = defaultFilePath;
    }

    let demo = false;
    let balance: number | null = null;
    if (!fs.existsSync(filePath)) {
        console.log(`[TTS→Gateway] Sintetizando (${provider}/${model}): "${finalText.substring(0, 30)}..."`);
        const result = await gatewayTts(token, {
            text: finalText,
            voiceId,
            provider,
            voiceSettings: normalizedSettings,
            ...(contract || {}),
        });
        if (result.model !== model) {
            throw new Error(`O gateway resolveu o modelo ${result.model || 'desconhecido'} em vez de ${model}. Nenhum áudio foi salvo.`);
        }
        // O gateway sem chave devolve um MP3 silencioso de demonstracao. Ele
        // precisa continuar tocavel no app, mas nunca pode ocupar o namespace
        // do modelo pago e ser reutilizado depois que a chave for configurada.
        if (result.demo) {
            fileName = `demo-${fileName}`;
            filePath = path.join(NARRATION_DIR, fileName);
        }
        fs.writeFileSync(filePath, result.audio);
        demo = result.demo;
        balance = result.balance;
    }

    const duration = await getAudioDuration(filePath);
    return {
        url: `/narrations/${fileName}`,
        path: filePath,
        duration,
        demo,
        balance,
        model,
        directionVersion: contract?.directionVersion,
    };
};
