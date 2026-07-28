/**
 * Tipos compartilhados entre os provedores de TTS.
 *
 * Vive num módulo separado de ttsProviders.ts de propósito: o dispatcher importa
 * os serviços, e os serviços importam estes tipos. Sem essa separação o grafo
 * de imports fecharia um ciclo.
 */

export type TtsProvider = 'fishAudio' | 'elevenLabs';

/**
 * Ajustes de voz expostos na UI. Nem todo provedor suporta todos os campos —
 * cada serviço ignora o que não sabe usar.
 *
 * speed / volume         → Fish Audio (prosody) e ElevenLabs (voice_settings.speed)
 * stability / similarity → só ElevenLabs. stability é INVERTIDO: menor = mais emoção.
 */
export interface VoiceSettings {
    speed?: number; // 0.5 – 2.0 (Fish) · 0.25 – 4.0 (ElevenLabs)
    volume?: number; // dB, -20 a +20 (só Fish)
    stability?: number; // 0.0 – 1.0 (só ElevenLabs)
    similarityBoost?: number; // 0.0 – 1.0 (só ElevenLabs)
    fishModel?: FishModel; // qual modelo da Fish usar
}

/**
 * Modelos da Fish Audio. O modelo vai no HEADER `model`, não no corpo.
 *
 * Isso importa muito: o S2 é o que entende a sintaxe `[bracket]` para emoção
 * ([whisper], [laugh], [emphasis]...). Sem enviar o header, a API usa o padrão
 * legado e as tags viram texto falado.
 */
export type FishModel = 's2.1-pro-free' | 's2-pro' | 's1';

// Pro por padrão: melhor qualidade de voz. Era o grátis; trocado a pedido do founder.
export const DEFAULT_FISH_MODEL: FishModel = 's2-pro';

export const isFishModel = (v: unknown): v is FishModel =>
    v === 's2.1-pro-free' || v === 's2-pro' || v === 's1';

export interface NarrationResult {
    url: string;
    path: string;
    duration: number;
}

export const isTtsProvider = (value: unknown): value is TtsProvider =>
    value === 'fishAudio' || value === 'elevenLabs';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
