import React, { useState } from 'react';
import { useWizard } from '../context/WizardContext';
import { ArrowLeft, Play, Plus, Loader2, KeyRound, Pencil, X, Copy, ExternalLink, Save } from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { DEFAULT_VOICE_SETTINGS, TTS_PROVIDERS, type CustomVoice, type TtsProvider, type VoicePreset } from '../types';
import { effectiveSystemVoicePreset, saveSystemVoicePreset, SYSTEM_VOICES, SYSTEM_VOICE_IDS } from '../lib/systemVoices';
import { DEFAULT_PRESET_AUDIO_CONFIG, SYSTEM_MUSIC_TRACKS } from '../lib/systemMusic';
import { localAuthHeaders } from '../lib/serverAuth';
import { invalidatedNarrationDerivatives } from '../lib/narrationState';
import {
    createCustomVoiceCatalogKey,
    isRecommendableVoiceDescription,
} from '../lib/narratorVoiceContext';

// No v1, o catálogo da ElevenLabs e a clonagem por gravação ficam ocultos: a IA
// é fornecida pelo Mileto (sem BYOK) e essas duas voltam numa versão futura.
type AddMode = 'none' | 'menu' | 'id';

const PROVIDER_LABEL: Record<TtsProvider, string> = {
    fishAudio: 'Fish Audio',
    elevenLabs: 'ElevenLabs',
};
/** Selo discreto que identifica de qual serviço a voz vem. */
const ProviderBadge = ({ provider }: { provider: TtsProvider }) => (
    <span
        className={cn(
            'inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-bold border',
            provider === 'elevenLabs'
                ? 'bg-violet-500/10 text-violet-400 border-violet-500/25'
                : 'bg-sky-500/10 text-sky-400 border-sky-500/25'
        )}
    >
        {PROVIDER_LABEL[provider]}
    </span>
);

export const VoiceSelector = () => {
    const {
        adData,
        updateAdData,
        customVoices,
        addCustomVoice,
        updateCustomVoice,
        removeCustomVoice,
        musicLibrary,
        setSelectedMusicId,
    } = useWizard();
    const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

    // Custom Voice State
    const [addMode, setAddMode] = useState<AddMode>('none');
    const [newVoiceName, setNewVoiceName] = useState('');
    const [newVoiceDescription, setNewVoiceDescription] = useState('');
    const [newVoiceId, setNewVoiceId] = useState('');
    const [newVoiceProvider, setNewVoiceProvider] = useState<TtsProvider>('fishAudio');
    const [newVoiceSpeed, setNewVoiceSpeed] = useState(1);
    const [newVoiceVolume, setNewVoiceVolume] = useState(0);
    const [newVoiceMusicId, setNewVoiceMusicId] = useState<string | null>(null);
    const [newVoiceMusicVolume, setNewVoiceMusicVolume] = useState(0.3);

    const [presetRevision, setPresetRevision] = useState(0);
    const [presetEditor, setPresetEditor] = useState<{
        originalId: string;
        id: string;
        name: string;
        description: string;
        catalogKey?: string;
        provider: TtsProvider;
        isSystem: boolean;
        preset: VoicePreset;
    } | null>(null);

    const openFishDiscovery = () => {
        const url = 'https://fish.audio/app/discovery/';
        const electron = (window as unknown as {
            require?: (moduleName: string) => { shell?: { openExternal: (target: string) => Promise<void> } };
        }).require?.('electron');

        if (electron?.shell) {
            void electron.shell.openExternal(url);
        } else {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    const apiBase = (window as unknown as { API_BASE_URL?: string }).API_BASE_URL || 'http://localhost:3301';
    const presetMusicName = (id?: string | null) =>
        [...SYSTEM_MUSIC_TRACKS, ...musicLibrary].find((track) => track.id === id)?.displayName;

    const selectVoice = (id: string, provider: TtsProvider) => {
        const systemVoice = SYSTEM_VOICES.find((voice) => voice.id === id);
        const customVoice = customVoices.find((voice) => voice.id === id);
        const preset: VoicePreset = (systemVoice ? effectiveSystemVoicePreset(id) : customVoice?.preset) || {
            voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
            musicTrackId: null,
            audioConfig: {
                narration: { ...DEFAULT_PRESET_AUDIO_CONFIG.narration },
                background: { ...DEFAULT_PRESET_AUDIO_CONFIG.background },
            },
        };
        if (adData.selectedVoiceId === id && (adData.selectedVoiceProvider ?? 'fishAudio') === provider) {
            updateAdData({
                masterAudioUrl: undefined,
                sharedMasterAssetId: undefined,
                voiceSettings: { ...preset.voiceSettings },
                audioConfig: {
                    narration: { ...preset.audioConfig.narration },
                    background: { ...preset.audioConfig.background },
                },
                audioTimeline: undefined,
            });
            setSelectedMusicId(preset.musicTrackId);
            return;
        }
        // Trocar a voz também invalida tudo que foi produzido a partir do áudio anterior.
        updateAdData({
            ...invalidatedNarrationDerivatives(),
            selectedVoiceId: id,
            selectedVoiceProvider: provider,
            isNarrationGenerated: false,
            narrationAudioUrl: null,
            narrationAudioPath: null,
            sharedNarrationAssetId: undefined,
            narrationDuration: 0,
            voiceSettings: { ...preset.voiceSettings },
            audioConfig: {
                narration: { ...preset.audioConfig.narration },
                background: { ...preset.audioConfig.background },
            },
            audioTimeline: undefined,
        });
        const presetTrackExists =
            !preset.musicTrackId ||
            musicLibrary.some((track) => track.id === preset.musicTrackId) ||
            SYSTEM_MUSIC_TRACKS.some((track) => track.id === preset.musicTrackId);
        setSelectedMusicId(presetTrackExists ? preset.musicTrackId : null);
        if (preset.musicTrackId && !presetTrackExists) {
            toast.warning('A música vinculada a esta voz não está disponível neste dispositivo.');
        }
    };

    const resetAddForm = () => {
        setNewVoiceName('');
        setNewVoiceDescription('');
        setNewVoiceId('');
        setNewVoiceSpeed(1);
        setNewVoiceVolume(0);
        setNewVoiceMusicId(null);
        setNewVoiceMusicVolume(0.3);
        setAddMode('none');
    };

    const openPresetEditor = (e: React.SyntheticEvent, voice: {
        id: string;
        name: string;
        desc?: string;
        description?: string;
        catalogKey?: string;
        provider?: TtsProvider;
        preset?: VoicePreset;
    }, isSystem: boolean) => {
        e.stopPropagation();
        const source = (isSystem ? effectiveSystemVoicePreset(voice.id) : voice.preset) || {
            voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
            musicTrackId: null,
            audioConfig: {
                narration: { ...DEFAULT_PRESET_AUDIO_CONFIG.narration },
                background: { ...DEFAULT_PRESET_AUDIO_CONFIG.background },
            },
        };
        setPresetEditor({
            originalId: voice.id,
            id: voice.id,
            name: voice.name,
            description: isSystem ? (voice.desc || '') : (voice.description || ''),
            catalogKey: isSystem ? undefined : voice.catalogKey,
            provider: voice.provider ?? 'fishAudio',
            isSystem,
            preset: {
                voiceSettings: { ...source.voiceSettings },
                musicTrackId: source.musicTrackId,
                audioConfig: {
                    narration: { ...source.audioConfig.narration },
                    background: { ...source.audioConfig.background },
                },
            },
        });
    };

    const savePresetEditor = () => {
        if (!presetEditor) return;
        const id = presetEditor.id.trim();
        const name = presetEditor.name.trim();
        const description = presetEditor.description.trim();
        if (!id || !name) {
            toast.error('Informe o nome e o ID da voz.');
            return;
        }
        if (!presetEditor.isSystem && !isRecommendableVoiceDescription(description)) {
            toast.error('Descreva em pelo menos 8 caracteres como essa voz soa ou quando deve ser usada.');
            return;
        }
        if (!presetEditor.isSystem && id !== presetEditor.originalId && (
            SYSTEM_VOICE_IDS.has(id) || customVoices.some((voice) => voice.id === id)
        )) {
            toast.error('Já existe uma voz com este ID.');
            return;
        }
        if (presetEditor.isSystem) {
            saveSystemVoicePreset(presetEditor.originalId, presetEditor.preset);
            setPresetRevision((value) => value + 1);
        } else {
            const nextVoice: CustomVoice = {
                id,
                name,
                description,
                catalogKey: presetEditor.catalogKey || createCustomVoiceCatalogKey(),
                recommendationStatus: 'ready',
                provider: presetEditor.provider,
                preset: presetEditor.preset,
            };
            updateCustomVoice(presetEditor.originalId, nextVoice);
        }
        if (adData.selectedVoiceId === presetEditor.originalId) {
            updateAdData({
                ...invalidatedNarrationDerivatives(),
                selectedVoiceId: presetEditor.isSystem ? presetEditor.originalId : id,
                selectedVoiceProvider: presetEditor.provider,
                isNarrationGenerated: false,
                narrationAudioUrl: null,
                narrationAudioPath: null,
                narrationDuration: 0,
                voiceSettings: { ...presetEditor.preset.voiceSettings },
                audioConfig: {
                    narration: { ...presetEditor.preset.audioConfig.narration },
                    background: { ...presetEditor.preset.audioConfig.background },
                },
            });
            setSelectedMusicId(presetEditor.preset.musicTrackId);
        }
        toast.success('Padrão da voz salvo.');
        setPresetEditor(null);
    };

    const handleSaveCustomVoice = () => {
        if (!newVoiceId || !newVoiceName) return;
        if (!isRecommendableVoiceDescription(newVoiceDescription)) {
            toast.error('Descreva em pelo menos 8 caracteres como essa voz soa ou quando deve ser usada.');
            return;
        }
        addCustomVoice({
            id: newVoiceId,
            name: newVoiceName,
            description: newVoiceDescription.trim(),
            catalogKey: createCustomVoiceCatalogKey(),
            recommendationStatus: 'ready',
            provider: newVoiceProvider,
            preset: {
                voiceSettings: {
                    ...DEFAULT_VOICE_SETTINGS,
                    speed: newVoiceSpeed,
                    volume: newVoiceProvider === 'fishAudio' ? newVoiceVolume : 0,
                },
                musicTrackId: newVoiceMusicId,
                audioConfig: {
                    narration: { ...DEFAULT_PRESET_AUDIO_CONFIG.narration },
                    background: {
                        ...DEFAULT_PRESET_AUDIO_CONFIG.background,
                        volume: newVoiceMusicVolume,
                    },
                },
            },
        });
        resetAddForm();
    };

    const handlePlayPreview = async (voiceId: string, provider: TtsProvider, e: React.MouseEvent) => {
        e.stopPropagation();
        if (playingVoiceId === voiceId) return; // Already playing

        setPlayingVoiceId(voiceId);

        try {
            const previewVoiceSettings =
                effectiveSystemVoicePreset(voiceId)?.voiceSettings ||
                customVoices.find((voice) => voice.id === voiceId)?.preset?.voiceSettings ||
                adData.voiceSettings;
            // Frase de anúncio de verdade — julgar uma voz de vendas por ela é
            // mais útil que por uma frase neutra de demonstração.
            const previewText = 'Promoção imperdível! Só até domingo, com condições especiais pra você.';

            const response = await fetch(`${apiBase}/api/tts/preview-voice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await localAuthHeaders()) },
                body: JSON.stringify({
                    text: previewText,
                    voiceId,
                    provider,
                    voiceSettings: previewVoiceSettings,
                }),
            });
            const data = await response.json();

            if (data.ok && data.url) {
                const audio = new Audio(`${apiBase}${data.url}`);
                audio.onended = () => setPlayingVoiceId(null);

                audio.play().catch((playErr: Error) => {
                    console.error('audio.play() error:', playErr);
                    toast.error('Não foi possível reproduzir o áudio. Tente novamente.');
                    setPlayingVoiceId(null);
                });
            } else {
                const msg = data.message || 'Erro ao gerar preview';
                if (msg.includes('créditos') || msg.includes('insuficiente')) {
                    toast.error('Seus créditos Mileto acabaram. Recarregue em "Minha Conta" para ouvir prévias.');
                } else if (msg.includes('Sessão') || msg.includes('401')) {
                    toast.error('Sua sessão expirou. Entre novamente para continuar.');
                } else {
                    toast.error('Erro no preview: ' + msg);
                }
                setPlayingVoiceId(null);
            }
        } catch (error: unknown) {
            console.error('Preview error', error);
            const errMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            toast.error('Erro no preview: ' + errMsg);
            setPlayingVoiceId(null);
        }
    };

    const PlayButton = ({ voiceId, provider }: { voiceId: string; provider: TtsProvider }) => (
        <button
            onClick={(e) => handlePlayPreview(voiceId, provider, e)}
            className="p-2.5 rounded-xl bg-background border border-black/5 dark:border-white/5 text-brand-muted hover:bg-brand-accent hover:text-[#0a0f12] hover:border-brand-accent transition-colors shadow-sm shrink-0"
            title={`Ouvir prévia (${PROVIDER_LABEL[provider]})`}
        >
            {playingVoiceId === voiceId ? (
                <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
                <Play className="w-4 h-4 ml-0.5" />
            )}
        </button>
    );

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {/* Vozes do sistema — acompanham o produto */}
                {SYSTEM_VOICES.map((voice) => {
                    const effectivePreset = effectiveSystemVoicePreset(voice.id) || voice.preset;
                    void presetRevision;
                    return (
                    <div
                        key={voice.id}
                        onClick={() => selectVoice(voice.id, voice.provider)}
                        className={cn(
                            'group relative flex min-h-[96px] cursor-pointer flex-col justify-between gap-2 rounded-xl border p-3 transition-all hover:border-brand-accent/50 hover:bg-black/5 dark:hover:bg-white/5',
                            adData.selectedVoiceId === voice.id
                                ? 'border-brand-accent/50 bg-brand-accent/10 shadow-[0_0_15px_rgba(0,230,118,0.05)]'
                                : 'border-black/5 dark:border-white/5 bg-background'
                        )}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold text-foreground tracking-wide leading-snug">
                                    {voice.name}
                                </div>
                                <div className="text-[11px] uppercase tracking-wider font-semibold text-brand-muted/80 mt-1 leading-snug">
                                    {voice.desc}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={(event) => openPresetEditor(event, voice, true)}
                                    className="rounded-xl border border-white/5 bg-background p-2.5 text-brand-muted transition hover:border-brand-accent/40 hover:text-brand-accent"
                                    title="Editar velocidade, volume e música"
                                >
                                    <Pencil className="h-4 w-4" />
                                </button>
                                <PlayButton voiceId={voice.id} provider={voice.provider} />
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                            <ProviderBadge provider={voice.provider} />
                            {presetMusicName(effectivePreset.musicTrackId) && (
                                <span className="truncate text-[9px] font-semibold text-brand-accent/80">
                                    + {presetMusicName(effectivePreset.musicTrackId)}
                                </span>
                            )}
                        </div>

                        {adData.selectedVoiceId === voice.id && (
                            <div className="absolute bottom-4 right-4 pointer-events-none">
                                <span className="flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent shadow-[0_0_5px_rgba(0,230,118,0.8)]"></span>
                                </span>
                            </div>
                        )}
                    </div>
                    );
                })}

                {/* Vozes personalizadas do usuário.
                    Filtra as que já viraram voz do sistema (ex.: Rodeio, Locutor Rádio
                    que ainda estão no localStorage desta máquina) para não duplicar. */}
                {customVoices
                    .filter((voice) => !SYSTEM_VOICE_IDS.has(voice.id))
                    .map((voice) => {
                        const provider: TtsProvider = voice.provider ?? 'fishAudio';
                        return (
                            <div
                                key={voice.id}
                                onClick={() => selectVoice(voice.id, provider)}
                                className={cn(
                                    'group relative flex min-h-[96px] cursor-pointer flex-col justify-between gap-2 rounded-xl border p-3 transition-all hover:border-brand-accent/50 hover:bg-black/5 dark:hover:bg-white/5',
                                    adData.selectedVoiceId === voice.id
                                        ? 'border-brand-accent/50 bg-brand-accent/10 shadow-[0_0_15px_rgba(0,230,118,0.05)]'
                                        : 'border-black/5 dark:border-white/5 bg-background'
                                )}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 max-w-full">
                                                <div
                                                    className="font-semibold text-foreground truncate tracking-wide"
                                                    title={voice.name}
                                                >
                                                    {voice.name}
                                                </div>
                                                <button
                                                    onClick={(e) => openPresetEditor(e, voice, false)}
                                                    className="p-1 text-brand-muted hover:text-brand-accent transition-all shrink-0"
                                                    title="Editar voz e padrão automático"
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </button>
                                            </div>
                                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                            <ProviderBadge provider={provider} />
                                            <span className="inline-block px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest font-bold bg-brand-accent/10 text-brand-accent border border-brand-accent/20">
                                                Personalizada
                                            </span>
                                            {voice.recommendationStatus === 'description_required' && (
                                                <span className="inline-block rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                                                    Descrição pendente
                                                </span>
                                            )}
                                            {presetMusicName(voice.preset?.musicTrackId) && (
                                                <span className="text-[9px] font-semibold text-brand-accent/80">
                                                    + {presetMusicName(voice.preset?.musicTrackId)}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-brand-muted">
                                            {voice.recommendationStatus === 'description_required'
                                                ? 'Edite esta voz e descreva seu estilo para o Narrador poder recomendá-la.'
                                                : voice.description}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mt-4">
                                    <div className="flex items-center gap-1">
                                        <div className="text-[10px] text-brand-muted font-mono truncate max-w-[80px] opacity-40">
                                            {voice.id.slice(0, 8)}...
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                navigator.clipboard.writeText(voice.id);
                                                toast.success('ID da voz copiado!');
                                            }}
                                            className="p-1 opacity-0 group-hover:opacity-100 hover:text-brand-accent transition-all text-brand-muted"
                                            title="Copiar ID completo"
                                        >
                                            <Copy className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <PlayButton voiceId={voice.id} provider={provider} />
                                </div>

                                {/* Remove Button (Top Right) */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeCustomVoice(voice.id);
                                    }}
                                    className="absolute -top-2 -right-2 p-1 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:scale-110"
                                    title="Remover voz"
                                >
                                    <X className="w-3 h-3" />
                                </button>

                                {/* Selection Indicator (Bottom Right if Selected) */}
                                {adData.selectedVoiceId === voice.id && (
                                    <div className="absolute bottom-3 right-3 pointer-events-none">
                                        <span className="flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent shadow-[0_0_5px_rgba(0,230,118,0.8)]"></span>
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                {presetEditor && (
                    <div
                        className="col-span-1 space-y-4 rounded-2xl border border-brand-accent/35 bg-brand-accent/[0.055] p-4 shadow-[0_18px_50px_rgba(0,0,0,.22)] sm:col-span-2"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-accent">
                                    Editar padrão da voz
                                </p>
                                <p className="mt-1 text-[10px] text-brand-muted">
                                    {presetEditor.isSystem
                                        ? 'A voz acompanha o Mileto. O ID fica protegido, mas os ajustes continuam personalizáveis.'
                                        : 'Nome, ID, velocidade, volume e trilha ficarão salvos para os próximos projetos.'}
                                </p>
                            </div>
                            <button type="button" onClick={() => setPresetEditor(null)} className="rounded-lg p-2 text-brand-muted hover:bg-white/5 hover:text-foreground">
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1.5 text-[9px] font-bold uppercase tracking-wider text-brand-muted">
                                <span>Nome</span>
                                <input
                                    value={presetEditor.name}
                                    disabled={presetEditor.isSystem}
                                    onChange={(event) => setPresetEditor((current) => current ? { ...current, name: event.target.value } : current)}
                                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs normal-case text-foreground outline-none focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                />
                            </label>
                            <label className="space-y-1.5 text-[9px] font-bold uppercase tracking-wider text-brand-muted">
                                <span>ID da voz {presetEditor.isSystem && '· protegido'}</span>
                                <input
                                    value={presetEditor.id}
                                    disabled={presetEditor.isSystem}
                                    onChange={(event) => setPresetEditor((current) => current ? { ...current, id: event.target.value } : current)}
                                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-[10px] normal-case text-foreground outline-none focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-45"
                                />
                            </label>
                            {!presetEditor.isSystem && (
                                <label className="space-y-1.5 text-[9px] font-bold uppercase tracking-wider text-brand-muted sm:col-span-2">
                                    <span className="flex items-center justify-between gap-3">
                                        <span>Descrição para recomendações</span>
                                        <span className="normal-case tracking-normal text-brand-muted/70">obrigatória</span>
                                    </span>
                                    <textarea
                                        value={presetEditor.description}
                                        maxLength={240}
                                        rows={2}
                                        placeholder="Ex.: voz jovem, descontraída e enérgica para vídeos promocionais."
                                        onChange={(event) => setPresetEditor((current) => current ? { ...current, description: event.target.value } : current)}
                                        className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs font-normal normal-case text-foreground outline-none focus:border-brand-accent/60"
                                    />
                                </label>
                            )}
                            <label className="space-y-1.5 text-[9px] font-bold uppercase tracking-wider text-brand-muted">
                                <span className="flex justify-between"><span>Velocidade</span><b className="text-foreground">{presetEditor.preset.voiceSettings.speed.toFixed(2)}x</b></span>
                                <input
                                    type="range" min={0.5} max={2} step={0.05}
                                    value={presetEditor.preset.voiceSettings.speed}
                                    onChange={(event) => setPresetEditor((current) => current ? { ...current, preset: { ...current.preset, voiceSettings: { ...current.preset.voiceSettings, speed: Number(event.target.value) } } } : current)}
                                    className="w-full accent-brand-accent"
                                />
                            </label>
                            <label className="space-y-1.5 text-[9px] font-bold uppercase tracking-wider text-brand-muted">
                                <span className="flex justify-between"><span>Volume da voz</span><b className="text-foreground">{presetEditor.preset.voiceSettings.volume > 0 ? '+' : ''}{presetEditor.preset.voiceSettings.volume} dB</b></span>
                                <input
                                    type="range" min={-5} max={5} step={1}
                                    value={presetEditor.preset.voiceSettings.volume}
                                    onChange={(event) => setPresetEditor((current) => current ? { ...current, preset: { ...current.preset, voiceSettings: { ...current.preset.voiceSettings, volume: Number(event.target.value) } } } : current)}
                                    className="w-full accent-brand-accent"
                                />
                            </label>
                        </div>

                        <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                            <p className="mb-2 text-[9px] font-bold uppercase tracking-wider text-brand-muted">Música vinculada</p>
                            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                                <button type="button" onClick={() => setPresetEditor((current) => current ? { ...current, preset: { ...current.preset, musicTrackId: null } } : current)} className={cn('rounded-lg border px-2.5 py-1.5 text-[9px] font-bold', presetEditor.preset.musicTrackId === null ? 'border-brand-accent bg-brand-accent/15 text-brand-accent' : 'border-white/10 text-brand-muted')}>Sem música</button>
                                {musicLibrary.map((track) => (
                                    <button key={track.id} type="button" onClick={() => setPresetEditor((current) => current ? { ...current, preset: { ...current.preset, musicTrackId: track.id } } : current)} className={cn('rounded-lg border px-2.5 py-1.5 text-[9px] font-bold', presetEditor.preset.musicTrackId === track.id ? 'border-brand-accent bg-brand-accent/15 text-brand-accent' : 'border-white/10 text-brand-muted hover:border-brand-accent/35')}>
                                        {track.displayName}{track.source === 'system' ? ' · Sistema' : ''}
                                    </button>
                                ))}
                            </div>
                            {presetEditor.preset.musicTrackId && (
                                <label className="mt-3 block space-y-1 text-[9px] font-bold uppercase tracking-wider text-brand-muted">
                                    <span className="flex justify-between"><span>Volume da música</span><b className="text-foreground">{Math.round(presetEditor.preset.audioConfig.background.volume * 100)}%</b></span>
                                    <input type="range" min={0.05} max={0.6} step={0.05} value={presetEditor.preset.audioConfig.background.volume} onChange={(event) => setPresetEditor((current) => current ? { ...current, preset: { ...current.preset, audioConfig: { ...current.preset.audioConfig, background: { ...current.preset.audioConfig.background, volume: Number(event.target.value) } } } } : current)} className="w-full accent-brand-accent" />
                                </label>
                            )}
                        </div>

                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => setPresetEditor(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-brand-muted hover:text-foreground">Cancelar</button>
                            <button type="button" onClick={savePresetEditor} className="flex items-center gap-2 rounded-xl bg-brand-accent px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-[#07110d]">
                                <Save className="h-3.5 w-3.5" /> Salvar padrão
                            </button>
                        </div>
                    </div>
                )}

                {/* The "Nova Voz" Logic Block */}
                {addMode === 'none' && (
                    <button
                        onClick={() => setAddMode('menu')}
                        className="flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/10 bg-background p-3 text-center text-brand-muted transition-all hover:border-brand-accent/40 hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
                    >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
                            <Plus className="w-5 h-5" />
                        </div>
                        <div className="text-xs font-bold uppercase tracking-wider">Nova Voz</div>
                    </button>
                )}

                {addMode === 'menu' && (
                    <div className="col-span-1 md:col-span-2 p-4 rounded-2xl border-2 border-brand-accent/40 bg-brand-accent/5 flex flex-col justify-center gap-3 shadow-inner min-h-[110px] animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-brand-accent">
                                Nova Voz
                            </div>
                            <button
                                onClick={() => setAddMode('none')}
                                className="text-brand-muted hover:text-foreground"
                                title="Fechar"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <button
                            onClick={openFishDiscovery}
                            className="flex flex-col items-center justify-center text-center gap-1.5 p-3 rounded-xl bg-background border border-black/10 dark:border-white/10 hover:border-sky-400/50 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                        >
                            <ExternalLink className="w-5 h-5 text-sky-400" />
                            <span className="text-[10px] uppercase font-bold text-foreground">Descobrir vozes</span>
                            <span className="text-[9px] text-brand-muted leading-tight">Abrir biblioteca do Fish Audio</span>
                        </button>
                        <button
                            onClick={() => setAddMode('id')}
                            className="flex flex-col items-center justify-center text-center gap-1.5 p-3 rounded-xl bg-background border border-black/10 dark:border-white/10 hover:border-brand-accent/50 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                        >
                            <KeyRound className="w-5 h-5 text-brand-muted" />
                            <span className="text-[10px] uppercase font-bold text-foreground">Adicionar por ID</span>
                            <span className="text-[9px] text-brand-muted leading-tight">Fish Audio ou ElevenLabs</span>
                        </button>
                    </div>
                )}

                {addMode === 'id' && (
                    <div className="col-span-1 md:col-span-2 p-4 rounded-2xl border-2 border-brand-accent/40 bg-brand-accent/5 flex flex-col gap-3 shadow-inner animate-in slide-in-from-right-2 duration-200">
                        <div className="flex items-center gap-2 text-brand-accent">
                            <button
                                onClick={() => setAddMode('menu')}
                                className="hover:text-foreground transition-colors shrink-0"
                                title="Voltar"
                            >
                                <ArrowLeft className="w-4 h-4" />
                            </button>
                            <div className="text-[11px] font-bold uppercase tracking-wider">Adicionar por ID</div>
                        </div>

                        {/* Escolha do provedor — define para qual serviço o ID será enviado */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">
                                Provedor
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                {TTS_PROVIDERS.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => setNewVoiceProvider(p.id)}
                                        className={cn(
                                            'px-3 py-2 rounded-lg border text-xs font-bold transition-all flex flex-col items-center gap-0.5',
                                            newVoiceProvider === p.id
                                                ? 'border-brand-accent bg-brand-accent/15 text-foreground'
                                                : 'border-black/10 dark:border-white/10 bg-background text-brand-muted hover:border-brand-accent/40'
                                        )}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <input
                            autoFocus
                            type="text"
                            placeholder="Nome da Voz"
                            className="w-full bg-background border border-black/10 dark:border-white/10 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none transition-all placeholder:text-foreground/40"
                            value={newVoiceName}
                            onChange={(e) => setNewVoiceName(e.target.value)}
                        />
                        <textarea
                            placeholder="Descreva como a voz soa e quando usá-la (obrigatório)"
                            className="w-full resize-none rounded-lg border border-black/10 bg-background px-3 py-2 text-xs text-foreground outline-none transition-all placeholder:text-foreground/40 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent dark:border-white/10"
                            value={newVoiceDescription}
                            maxLength={240}
                            rows={2}
                            onChange={(e) => setNewVoiceDescription(e.target.value)}
                        />
                        <input
                            type="text"
                            placeholder={
                                newVoiceProvider === 'elevenLabs' ? 'Voice ID (ElevenLabs)' : 'Reference ID (Fish Audio)'
                            }
                            className="w-full bg-background border border-black/10 dark:border-white/10 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent rounded-lg px-3 py-2 text-xs font-mono text-brand-muted focus:outline-none transition-all placeholder:text-foreground/40"
                            value={newVoiceId}
                            onChange={(e) => setNewVoiceId(e.target.value)}
                        />
                        <div className="rounded-xl border border-black/10 bg-background/60 p-3 dark:border-white/10 space-y-3">
                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-accent">
                                    Padrão automático da voz
                                </div>
                                <p className="mt-1 text-[9px] leading-relaxed text-brand-muted">
                                    Estes valores entram selecionados em todo novo projeto e continuam ajustáveis.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <label className="space-y-1 text-[9px] font-bold uppercase tracking-wider text-brand-muted">
                                    <span className="flex justify-between"><span>Velocidade</span><b className="text-foreground">{newVoiceSpeed.toFixed(2)}x</b></span>
                                    <input
                                        type="range"
                                        min={0.5}
                                        max={2}
                                        step={0.05}
                                        value={newVoiceSpeed}
                                        onChange={(event) => setNewVoiceSpeed(Number(event.target.value))}
                                        className="w-full accent-brand-accent"
                                    />
                                </label>
                                <label className="space-y-1 text-[9px] font-bold uppercase tracking-wider text-brand-muted">
                                    <span className="flex justify-between"><span>Volume da voz</span><b className="text-foreground">{newVoiceProvider === 'fishAudio' ? `${newVoiceVolume > 0 ? '+' : ''}${newVoiceVolume} dB` : 'Padrão'}</b></span>
                                    <input
                                        type="range"
                                        min={-5}
                                        max={5}
                                        step={1}
                                        value={newVoiceVolume}
                                        disabled={newVoiceProvider !== 'fishAudio'}
                                        onChange={(event) => setNewVoiceVolume(Number(event.target.value))}
                                        className="w-full accent-brand-accent disabled:opacity-30"
                                    />
                                </label>
                            </div>

                            <div className="space-y-2">
                                <div className="text-[9px] font-bold uppercase tracking-wider text-brand-muted">Música vinculada</div>
                                <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                                    <button
                                        type="button"
                                        onClick={() => setNewVoiceMusicId(null)}
                                        className={cn(
                                            'rounded-lg border px-2.5 py-1.5 text-[9px] font-bold transition-all',
                                            newVoiceMusicId === null
                                                ? 'border-brand-accent bg-brand-accent/15 text-brand-accent'
                                                : 'border-black/10 text-brand-muted hover:border-brand-accent/40 dark:border-white/10',
                                        )}
                                    >
                                        Sem música
                                    </button>
                                    {musicLibrary.map((track) => (
                                        <button
                                            key={track.id}
                                            type="button"
                                            onClick={() => setNewVoiceMusicId(track.id)}
                                            className={cn(
                                                'rounded-lg border px-2.5 py-1.5 text-[9px] font-bold transition-all',
                                                newVoiceMusicId === track.id
                                                    ? 'border-brand-accent bg-brand-accent/15 text-brand-accent'
                                                    : 'border-black/10 text-brand-muted hover:border-brand-accent/40 dark:border-white/10',
                                            )}
                                        >
                                            {track.displayName}{track.source === 'system' ? ' · Sistema' : ''}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {newVoiceMusicId && (
                                <label className="block space-y-1 text-[9px] font-bold uppercase tracking-wider text-brand-muted">
                                    <span className="flex justify-between"><span>Volume da música</span><b className="text-foreground">{Math.round(newVoiceMusicVolume * 100)}%</b></span>
                                    <input
                                        type="range"
                                        min={0.05}
                                        max={0.6}
                                        step={0.05}
                                        value={newVoiceMusicVolume}
                                        onChange={(event) => setNewVoiceMusicVolume(Number(event.target.value))}
                                        className="w-full accent-brand-accent"
                                    />
                                </label>
                            )}
                        </div>
                        <button
                            onClick={handleSaveCustomVoice}
                            disabled={!newVoiceId || !newVoiceName || !isRecommendableVoiceDescription(newVoiceDescription)}
                            className="w-full py-2 text-[11px] font-bold uppercase tracking-wider rounded-lg bg-brand-accent text-[#0a0f12] hover:bg-brand-accent/90 disabled:opacity-50 transition-all shadow-sm"
                        >
                            Salvar Voz
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
