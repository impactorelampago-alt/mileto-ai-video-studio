import type { AudioConfig, MusicTrack } from '../types';

export const SYSTEM_MUSIC_IDS = {
    batida: 'system-music:batida-1',
    blogueira: 'system-music:blogueira-1',
} as const;

export const SYSTEM_MUSIC_PATHS = {
    [SYSTEM_MUSIC_IDS.batida]: '/system-music/batida-1.mp3',
    [SYSTEM_MUSIC_IDS.blogueira]: '/system-music/blogueira-1.mp3',
} as const;

export const SYSTEM_MUSIC_TRACKS: MusicTrack[] = [
    {
        id: SYSTEM_MUSIC_IDS.batida,
        originalName: 'Batida 1.mp3',
        displayName: 'Batida 1',
        filePath: 'system-music/batida-1.mp3',
        publicUrl: SYSTEM_MUSIC_PATHS[SYSTEM_MUSIC_IDS.batida],
        durationSec: 76.584,
        createdAt: '2026-08-05T00:00:00.000Z',
        source: 'system',
        systemKey: 'batida-1',
        locked: true,
    },
    {
        id: SYSTEM_MUSIC_IDS.blogueira,
        originalName: 'Blogueira 1.mp3',
        displayName: 'Blogueira 1',
        filePath: 'system-music/blogueira-1.mp3',
        publicUrl: SYSTEM_MUSIC_PATHS[SYSTEM_MUSIC_IDS.blogueira],
        durationSec: 94.272,
        createdAt: '2026-08-05T00:00:00.000Z',
        source: 'system',
        systemKey: 'blogueira-1',
        locked: true,
    },
];

export const DEFAULT_PRESET_AUDIO_CONFIG: AudioConfig = {
    narration: {
        enabled: true,
        volume: 1,
        offsetSec: 0,
        trimStart: 0,
        fadeInSec: 0,
        fadeOutSec: 1,
    },
    background: {
        enabled: true,
        volume: 0.3,
        offsetSec: 0,
        trimStart: 0,
        fadeInSec: 2,
        fadeOutSec: 2,
    },
};

export const isSystemMusicId = (id?: string | null): boolean =>
    Boolean(id && id.startsWith('system-music:'));

const normalizedSystemMusicIdentity = (value: string): string => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

export const systemMusicTrackFor = (value?: string | Partial<MusicTrack> | null): MusicTrack | null => {
    if (!value) return null;
    if (typeof value === 'string') {
        return SYSTEM_MUSIC_TRACKS.find((track) =>
            track.id === value ||
            track.systemKey === value ||
            normalizedSystemMusicIdentity(track.displayName) === normalizedSystemMusicIdentity(value) ||
            normalizedSystemMusicIdentity(track.originalName) === normalizedSystemMusicIdentity(value)
        ) || null;
    }

    const identities = [value.id, value.systemKey, value.displayName, value.originalName]
        .filter((identity): identity is string => Boolean(identity));
    return SYSTEM_MUSIC_TRACKS.find((track) => identities.some((identity) =>
        track.id === identity ||
        track.systemKey === identity ||
        normalizedSystemMusicIdentity(track.displayName) === normalizedSystemMusicIdentity(identity) ||
        normalizedSystemMusicIdentity(track.originalName) === normalizedSystemMusicIdentity(identity)
    )) || null;
};

export const isSystemMusicTrack = (track?: Partial<MusicTrack> | null): boolean =>
    Boolean(track && (track.source === 'system' || track.locked || systemMusicTrackFor(track)));

/**
 * Mantém as faixas embarcadas como a fonte canônica mesmo quando uma instalação
 * antiga ainda possui cópias locais com UUID. A URL local já funcional é
 * preservada até o servidor reiniciar e passar a servir /system-music.
 */
export const withSystemMusicTracks = (tracks: MusicTrack[]): MusicTrack[] => {
    const canonicalTracks = SYSTEM_MUSIC_TRACKS.map((systemTrack) => {
        const installedCopy = tracks.find((track) => systemMusicTrackFor(track)?.id === systemTrack.id);
        if (!installedCopy) return { ...systemTrack };
        return {
            ...installedCopy,
            ...systemTrack,
            publicUrl: installedCopy.publicUrl || systemTrack.publicUrl,
            filePath: installedCopy.filePath || systemTrack.filePath,
            durationSec: installedCopy.durationSec || systemTrack.durationSec,
        };
    });
    return [
        ...canonicalTracks,
        ...tracks.filter((track) => !systemMusicTrackFor(track)),
    ];
};
