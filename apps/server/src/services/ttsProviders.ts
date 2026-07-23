import * as fishAudio from './fishAudio';
import * as elevenLabs from './elevenlabs';
import { TtsProvider, VoiceSettings, NarrationResult } from './ttsTypes';

export { isTtsProvider } from './ttsTypes';
export type { TtsProvider, VoiceSettings, NarrationResult } from './ttsTypes';

/**
 * Assinatura que todo provedor precisa cumprir. Manter idêntica é o que torna o
 * teste A/B cego possível — trocar de provedor vira trocar uma string.
 */
type GenerateNarration = (
    voiceId: string,
    text: string,
    apiKey: string,
    settings?: VoiceSettings
) => Promise<NarrationResult>;

const REGISTRY: Record<TtsProvider, { label: string; generateNarration: GenerateNarration }> = {
    fishAudio: { label: 'Fish Audio', generateNarration: fishAudio.generateNarration },
    elevenLabs: { label: 'ElevenLabs', generateNarration: elevenLabs.generateNarration },
};

export const getProviderLabel = (provider: TtsProvider) => REGISTRY[provider].label;

export const generateNarration = (
    provider: TtsProvider,
    voiceId: string,
    text: string,
    apiKey: string,
    settings?: VoiceSettings
): Promise<NarrationResult> => REGISTRY[provider].generateNarration(voiceId, text, apiKey, settings);
