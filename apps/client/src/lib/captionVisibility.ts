import type { CaptionTrack } from '../types';

/**
 * Projetos antigos não persistiam `enabled`. Por compatibilidade, somente o
 * valor explicitamente falso oculta a faixa.
 */
export const captionTrackIsEnabled = (captions: CaptionTrack | undefined): boolean =>
    Boolean(captions) && captions?.enabled !== false;

/** Preserva transcrição, tempos e revisão ao alternar apenas a visibilidade. */
export const withCaptionTrackEnabled = (captions: CaptionTrack, enabled: boolean): CaptionTrack =>
    captions.enabled === enabled ? captions : { ...captions, enabled };
