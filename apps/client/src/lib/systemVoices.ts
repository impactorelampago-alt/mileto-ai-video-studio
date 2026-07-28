import type { TtsProvider } from '../types';

export interface SystemVoice {
    id: string;
    name: string;
    desc: string;
    provider: TtsProvider;
}

/**
 * Vozes que ACOMPANHAM o produto — iguais para todo cliente.
 *
 * Fonte única de verdade. Ficam aqui, no código, e não no localStorage de uma
 * máquina, justamente porque são o catálogo curado que você vende. Quando o
 * gateway existir, esta lista passa a vir do servidor (o servidor sobrescreve),
 * mas a forma do objeto continua a mesma.
 *
 * Os IDs de Rodeio e Locutor Rádio são reference_ids da SUA conta Fish Audio —
 * funcionam para todos os clientes assim que as chamadas passarem pelo gateway,
 * porque o gateway usa a sua chave.
 */
export const SYSTEM_VOICES: SystemVoice[] = [
    { id: 'd7cdad0d54464bcfade4be58791c6f3d', name: 'Thales Impacto', desc: 'Voz original, marcante', provider: 'fishAudio' },
    { id: '15c9660604bc4c5585838456a48e4eee', name: 'Padrão Masculina', desc: 'Voz imposta, vendas', provider: 'fishAudio' },
    { id: '64ea557cd80c4fb99a96b209763f4ec9', name: 'Padrão Feminina', desc: 'Voz clara, explicativa', provider: 'fishAudio' },
    { id: 'fffaeef680cf41cdaff2c65d8cdd8650', name: 'Rodeio', desc: 'Locução animada, eventos', provider: 'fishAudio' },
    { id: '5c7c62ef7fc545908c8de8feab76a272', name: 'Locutor Rádio', desc: 'Locução de rádio, impacto', provider: 'fishAudio' },
];

/** IDs das vozes do sistema, para deduplicar contra as vozes personalizadas do usuário. */
export const SYSTEM_VOICE_IDS = new Set(SYSTEM_VOICES.map((v) => v.id));
