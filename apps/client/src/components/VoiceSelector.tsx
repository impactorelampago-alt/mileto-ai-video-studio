import React, { useState } from 'react';
import { useWizard } from '../context/WizardContext';
import { ArrowLeft, Play, Plus, Loader2, KeyRound, Pencil, Check, X, Copy } from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { TTS_PROVIDERS, type TtsProvider } from '../types';
import { SYSTEM_VOICES, SYSTEM_VOICE_IDS } from '../lib/systemVoices';
import { localAuthHeaders } from '../lib/serverAuth';

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
    const { adData, updateAdData, customVoices, addCustomVoice, removeCustomVoice, renameCustomVoice } = useWizard();
    const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

    // Custom Voice State
    const [addMode, setAddMode] = useState<AddMode>('none');
    const [newVoiceName, setNewVoiceName] = useState('');
    const [newVoiceId, setNewVoiceId] = useState('');
    const [newVoiceProvider, setNewVoiceProvider] = useState<TtsProvider>('fishAudio');

    const [editingVoiceId, setEditingVoiceId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    const apiBase = (window as unknown as { API_BASE_URL?: string }).API_BASE_URL || 'http://localhost:3301';

    const selectVoice = (id: string, provider: TtsProvider) =>
        updateAdData({ selectedVoiceId: id, selectedVoiceProvider: provider });

    const resetAddForm = () => {
        setNewVoiceName('');
        setNewVoiceId('');
        setAddMode('none');
    };

    const handleStartEdit = (e: React.SyntheticEvent, id: string, name: string) => {
        e.stopPropagation();
        setEditingVoiceId(id);
        setEditingName(name);
    };

    const handleSaveEdit = (e: React.SyntheticEvent, id: string) => {
        e.stopPropagation();
        if (editingName.trim()) {
            renameCustomVoice(id, editingName.trim());
        }
        setEditingVoiceId(null);
    };

    const handleCancelEdit = (e: React.SyntheticEvent) => {
        e.stopPropagation();
        setEditingVoiceId(null);
    };

    const handleSaveCustomVoice = () => {
        if (!newVoiceId || !newVoiceName) return;
        addCustomVoice({
            id: newVoiceId,
            name: newVoiceName,
            description: 'Voz Personalizada',
            provider: newVoiceProvider,
        });
        resetAddForm();
    };

    const handlePlayPreview = async (voiceId: string, provider: TtsProvider, e: React.MouseEvent) => {
        e.stopPropagation();
        if (playingVoiceId === voiceId) return; // Already playing

        setPlayingVoiceId(voiceId);

        try {
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
                    voiceSettings: adData.voiceSettings,
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Vozes do sistema — acompanham o produto */}
                {SYSTEM_VOICES.map((voice) => (
                    <div
                        key={voice.id}
                        onClick={() => selectVoice(voice.id, voice.provider)}
                        className={cn(
                            'relative group p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 min-h-[124px] hover:border-brand-accent/50 hover:bg-black/5 dark:hover:bg-white/5',
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
                            <PlayButton voiceId={voice.id} provider={voice.provider} />
                        </div>

                        <div className="flex items-center gap-1.5">
                            <ProviderBadge provider={voice.provider} />
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
                ))}

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
                                    'relative group p-4 rounded-2xl border transition-all cursor-pointer hover:border-brand-accent/50 hover:bg-black/5 dark:hover:bg-white/5 flex flex-col justify-between gap-3 min-h-[124px]',
                                    adData.selectedVoiceId === voice.id
                                        ? 'border-brand-accent/50 bg-brand-accent/10 shadow-[0_0_15px_rgba(0,230,118,0.05)]'
                                        : 'border-black/5 dark:border-white/5 bg-background'
                                )}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        {editingVoiceId === voice.id ? (
                                            <div
                                                className="flex items-center gap-1 w-full"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    type="text"
                                                    value={editingName}
                                                    onChange={(e) => setEditingName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleSaveEdit(e, voice.id);
                                                        if (e.key === 'Escape') handleCancelEdit(e);
                                                    }}
                                                    className="bg-transparent border-b border-brand-accent/50 focus:border-brand-accent text-sm text-foreground outline-none px-1 py-0.5 w-full mr-1"
                                                    autoFocus
                                                />
                                                <button
                                                    onClick={(e) => handleSaveEdit(e, voice.id)}
                                                    className="p-1 hover:text-brand-accent transition-colors"
                                                >
                                                    <Check className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={handleCancelEdit}
                                                    className="p-1 hover:text-destructive transition-colors"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 max-w-full">
                                                <div
                                                    className="font-semibold text-foreground truncate tracking-wide"
                                                    title={voice.name}
                                                >
                                                    {voice.name}
                                                </div>
                                                <button
                                                    onClick={(e) => handleStartEdit(e, voice.id, voice.name)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 text-brand-muted hover:text-brand-accent transition-all shrink-0"
                                                    title="Renomear voz"
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
                                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                            <ProviderBadge provider={provider} />
                                            <span className="inline-block px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest font-bold bg-brand-accent/10 text-brand-accent border border-brand-accent/20">
                                                Personalizada
                                            </span>
                                        </div>
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

                {/* The "Nova Voz" Logic Block */}
                {addMode === 'none' && (
                    <button
                        onClick={() => setAddMode('menu')}
                        className="p-4 rounded-2xl border-2 border-dashed border-black/10 dark:border-white/10 hover:border-brand-accent/40 bg-background hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-3 text-brand-muted hover:text-foreground min-h-[124px]"
                    >
                        <div className="w-10 h-10 rounded-xl bg-black/5 dark:bg-white/5 flex items-center justify-center">
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
                        <input
                            type="text"
                            placeholder={
                                newVoiceProvider === 'elevenLabs' ? 'Voice ID (ElevenLabs)' : 'Reference ID (Fish Audio)'
                            }
                            className="w-full bg-background border border-black/10 dark:border-white/10 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent rounded-lg px-3 py-2 text-xs font-mono text-brand-muted focus:outline-none transition-all placeholder:text-foreground/40"
                            value={newVoiceId}
                            onChange={(e) => setNewVoiceId(e.target.value)}
                        />
                        <button
                            onClick={handleSaveCustomVoice}
                            disabled={!newVoiceId || !newVoiceName}
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
