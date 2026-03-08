import React, { useState, useRef } from 'react';
import { useWizard } from '../context/WizardContext';
import { ArrowLeft, Play, Plus, Loader2, Mic, Upload, KeyRound, Pencil, Check, X, Copy } from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

// Fish Audio Voices
const STANDARD_VOICES = [
    { id: 'd7cdad0d54464bcfade4be58791c6f3d', name: 'Thales Impacto', desc: 'Voz Original' },
    { id: '15c9660604bc4c5585838456a48e4eee', name: 'Padrão Masculina', desc: 'Voz imposta, vendas' },
    { id: '37cfdf8963cd49c49e294e00c7f33543', name: 'Padrão Feminina', desc: 'Voz clara, explicativa' },
];

type AddMode = 'none' | 'menu' | 'id' | 'clone';

export const VoiceSelector = () => {
    const { adData, updateAdData, apiKeys, customVoices, addCustomVoice, removeCustomVoice, renameCustomVoice } =
        useWizard();
    const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

    // Custom Voice State
    const [addMode, setAddMode] = useState<AddMode>('none');
    const [newVoiceName, setNewVoiceName] = useState('');
    const [newVoiceId, setNewVoiceId] = useState('');

    // Recording & Upload States
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [isCloning, setIsCloning] = useState(false);
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const timerInterval = useRef<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [editingVoiceId, setEditingVoiceId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

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
        });
        setNewVoiceName('');
        setNewVoiceId('');
        setAddMode('none');
    };

    const cloneVoiceToBackend = async (blob: Blob, name: string, fileName = 'clone.mp3') => {
        if (!apiKeys.fishAudio) {
            toast.error('Configure a Fish Audio API Key para clonar vozes.');
            return;
        }

        setIsCloning(true);
        const toastId = toast.loading('Clonando voz na inteligência artificial...');

        try {
            const formData = new FormData();
            formData.append('voiceName', name);
            formData.append('apiKey', apiKeys.fishAudio);
            formData.append('audio', blob, fileName);

            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/tts/clone-voice`, {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!data.ok) throw new Error(data.message);

            addCustomVoice({
                id: data.modelId,
                name: data.modelTitle || name,
                description: 'Voz Clonada',
            });

            setNewVoiceName('');
            setAddMode('none');
            toast.success('Voz clonada com sucesso!', { id: toastId });
        } catch (error: any) {
            console.error('Clone error:', error);
            toast.error('Erro ao clonar voz: ' + (error.message || 'Desconhecido'), { id: toastId });
        } finally {
            setIsCloning(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Auto-name based on file name or prompt
        const defaultName = file.name.replace(/\.[^/.]+$/, '');
        const finalName = newVoiceName || defaultName;

        cloneVoiceToBackend(file, finalName, file.name);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder.current = new MediaRecorder(stream);

            mediaRecorder.current.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.current.push(e.data);
            };

            mediaRecorder.current.onstop = () => {
                const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
                audioChunks.current = [];
                const vName = newVoiceName || 'Voz Microfone ' + new Date().toLocaleTimeString();
                cloneVoiceToBackend(audioBlob, vName, 'voice.webm');
                stream.getTracks().forEach((track) => track.stop()); // release mic
            };

            audioChunks.current = [];
            mediaRecorder.current.start();
            setIsRecording(true);
            setRecordingTime(0);

            timerInterval.current = setInterval(() => {
                setRecordingTime((prev) => prev + 1);
            }, 1000);
        } catch (error) {
            console.error('Microphone error:', error);
            toast.error('Permissão de microfone negada ou erro ao iniciar.');
        }
    };

    const stopRecording = () => {
        if (mediaRecorder.current && isRecording) {
            mediaRecorder.current.stop();
            setIsRecording(false);
            if (timerInterval.current) window.clearInterval(timerInterval.current);
        }
    };

    const handlePlayPreview = async (voiceId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!apiKeys.fishAudio) {
            toast.error('Configure a Fish Audio API Key para ouvir prévias.');
            return;
        }

        if (playingVoiceId === voiceId) return; // Already playing

        setPlayingVoiceId(voiceId);

        try {
            // Use a short text for preview to save credits/latency
            const previewText = 'Esta é uma demonstração da voz Fish Audio.';

            const response = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/tts/preview-voice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: previewText,
                    voiceId,
                    apiKey: apiKeys.fishAudio,
                }),
            });
            const data = await response.json();

            if (data.ok && data.url) {
                const audioUrl = `${((window as any).API_BASE_URL || 'http://localhost:3301')}${data.url}`;
                const audio = new Audio(audioUrl);
                audio.onended = () => setPlayingVoiceId(null);

                // Play the audio, catching any DOMException separately to avoid duplicate toasts
                audio.play().catch((playErr: Error) => {
                    console.error('audio.play() error:', playErr);
                    toast.error('Não foi possível reproduzir o áudio. Tente novamente.');
                    setPlayingVoiceId(null);
                });
            } else {
                const msg = data.message || 'Erro ao gerar preview';
                // Friendly message for rate limit errors
                if (msg.includes('429') || msg.includes('Too many requests') || msg.includes('rate limit')) {
                    toast.error('Limite de créditos da Fish Audio atingido. Aguarde um momento e tente novamente.');
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

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Pre-defined Standard Voices */}
                {STANDARD_VOICES.map((voice) => (
                    <div
                        key={voice.id}
                        onClick={() => updateAdData({ selectedVoiceId: voice.id })}
                        className={cn(
                            'relative group p-4 rounded-2xl border transition-all cursor-pointer hover:border-brand-accent/50 hover:bg-black/5 dark:hover:bg-white/5',
                            adData.selectedVoiceId === voice.id
                                ? 'border-brand-accent/50 bg-brand-accent/10 shadow-[0_0_15px_rgba(0,230,118,0.05)]'
                                : 'border-black/5 dark:border-white/5 bg-background'
                        )}
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="font-semibold text-foreground tracking-wide">{voice.name}</div>
                                <div className="text-[11px] uppercase tracking-wider font-semibold text-brand-muted/80 mt-1">
                                    {voice.desc}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={(e) => handlePlayPreview(voice.id, e)}
                                    className="p-2.5 rounded-xl bg-background border border-black/5 dark:border-white/5 text-brand-muted hover:bg-brand-accent hover:text-[#0a0f12] hover:border-brand-accent transition-colors shadow-sm"
                                >
                                    {playingVoiceId === voice.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Play className="w-4 h-4 ml-0.5" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {adData.selectedVoiceId === voice.id && (
                            <div className="absolute top-3 right-3">
                                <span className="flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent shadow-[0_0_5px_rgba(0,230,118,0.8)]"></span>
                                </span>
                            </div>
                        )}
                    </div>
                ))}

                {/* Custom Voices (Added by User) */}
                {customVoices.map((voice) => (
                    <div
                        key={voice.id}
                        onClick={() => updateAdData({ selectedVoiceId: voice.id })}
                        className={cn(
                            'relative group p-4 rounded-2xl border transition-all cursor-pointer hover:border-brand-accent/50 hover:bg-black/5 dark:hover:bg-white/5 flex flex-col justify-between min-h-[110px]',
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
                                <div className="inline-block mt-2 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest font-bold bg-brand-accent/10 text-brand-accent border border-brand-accent/20">
                                    Personalizada
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
                            <button
                                onClick={(e) => handlePlayPreview(voice.id, e)}
                                className="p-2.5 rounded-xl bg-background border border-black/5 dark:border-white/5 text-brand-muted hover:bg-brand-accent hover:text-[#0a0f12] hover:border-brand-accent transition-colors shadow-sm shrink-0"
                            >
                                {playingVoiceId === voice.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Play className="w-4 h-4 ml-0.5" />
                                )}
                            </button>
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
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M18 6 6 18" />
                                <path d="m6 6 12 12" />
                            </svg>
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
                ))}

                {/* The "Nova Voz" Logic Block */}
                {addMode === 'none' && (
                    <button
                        onClick={() => setAddMode('menu')}
                        className="p-4 rounded-2xl border-2 border-dashed border-black/10 dark:border-white/10 hover:border-brand-accent/40 bg-background hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-3 text-brand-muted hover:text-foreground min-h-[110px]"
                    >
                        <div className="w-10 h-10 rounded-xl bg-black/5 dark:bg-white/5 flex items-center justify-center">
                            <Plus className="w-5 h-5 text-brand-muted group-hover:text-foreground" />
                        </div>
                        <div className="text-xs font-bold uppercase tracking-wider">Nova Voz</div>
                    </button>
                )}

                {addMode === 'menu' && (
                    <div className="p-4 rounded-2xl border-2 border-brand-accent/40 bg-brand-accent/5 flex flex-col justify-center gap-3 shadow-inner min-h-[110px] animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between mb-1">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-brand-accent">
                                Nova Voz da AI
                            </div>
                            <button
                                onClick={() => setAddMode('none')}
                                className="text-brand-muted hover:text-foreground"
                            >
                                <ArrowLeft className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setAddMode('id')}
                                className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-background border border-black/10 dark:border-white/10 hover:border-brand-accent/50 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                            >
                                <KeyRound className="w-5 h-5 text-brand-muted" />
                                <span className="text-[10px] uppercase font-bold text-foreground">Por ID</span>
                            </button>
                            <button
                                onClick={() => setAddMode('clone')}
                                className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-background border border-black/10 dark:border-white/10 hover:border-brand-accent/50 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                            >
                                <Mic className="w-5 h-5 text-brand-muted" />
                                <span className="text-[10px] uppercase font-bold text-foreground">Clonar</span>
                            </button>
                        </div>
                    </div>
                )}

                {addMode === 'id' && (
                    <div className="p-4 rounded-2xl border-2 border-brand-accent/40 bg-brand-accent/5 flex flex-col justify-center gap-2 shadow-inner min-h-[110px] animate-in slide-in-from-right-2 duration-200">
                        <div className="flex items-center gap-2 mb-1 text-brand-accent">
                            <button
                                onClick={() => setAddMode('menu')}
                                className="hover:text-foreground transition-colors shrink-0"
                            >
                                <ArrowLeft className="w-4 h-4" />
                            </button>
                            <div className="text-[11px] font-bold uppercase tracking-wider truncate">
                                Adicionar por ID
                            </div>
                        </div>
                        <input
                            autoFocus
                            type="text"
                            placeholder="Nome da Voz"
                            className="w-full bg-background border border-black/10 dark:border-white/10 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none transition-all placeholder:text-foreground/40"
                            value={newVoiceName}
                            onChange={(e) => setNewVoiceName(e.target.value)}
                        />
                        <input
                            type="text"
                            placeholder="ID (Fish Audio)"
                            className="w-full bg-background border border-black/10 dark:border-white/10 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent rounded-lg px-3 py-1.5 text-xs font-mono text-brand-muted focus:outline-none transition-all placeholder:text-foreground/40"
                            value={newVoiceId}
                            onChange={(e) => setNewVoiceId(e.target.value)}
                        />
                        <button
                            onClick={handleSaveCustomVoice}
                            disabled={!newVoiceId || !newVoiceName}
                            className="w-full py-1.5 mt-1 text-[11px] font-bold uppercase tracking-wider rounded-lg bg-brand-accent text-[#0a0f12] hover:bg-brand-accent/90 disabled:opacity-50 transition-all shadow-sm"
                        >
                            Salvar Voz
                        </button>
                    </div>
                )}

                {addMode === 'clone' && (
                    <div className="col-span-1 md:col-span-2 p-4 rounded-2xl border-2 border-brand-accent/40 bg-brand-accent/5 flex flex-col justify-center gap-3 shadow-inner min-h-[110px] animate-in slide-in-from-right-2 duration-200">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 text-brand-accent">
                                <button
                                    onClick={() => setAddMode('menu')}
                                    className="hover:text-foreground transition-colors shrink-0"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                </button>
                                <div className="text-[11px] font-bold uppercase tracking-wider truncate">Nova Voz</div>
                            </div>
                        </div>

                        <input
                            type="text"
                            placeholder="Nome para a Voz (Opcional)"
                            className="bg-background border border-black/10 dark:border-white/10 focus:border-brand-accent rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none mb-1 w-full"
                            value={newVoiceName}
                            onChange={(e) => setNewVoiceName(e.target.value)}
                            disabled={isCloning || isRecording}
                        />

                        <div className="grid grid-cols-2 gap-3 h-full">
                            {/* Microphone Option */}
                            <button
                                onClick={isRecording ? stopRecording : startRecording}
                                disabled={isCloning}
                                className={cn(
                                    'flex flex-col items-center justify-center p-3 border rounded-xl transition-all group shadow-sm disabled:opacity-50',
                                    isRecording
                                        ? 'bg-destructive/10 border-destructive hover:bg-destructive/20'
                                        : 'bg-background hover:bg-black/5 dark:hover:bg-white/5 border-black/10 dark:border-white/10 hover:border-brand-accent/40'
                                )}
                            >
                                <div
                                    className={cn(
                                        'p-2.5 rounded-full mb-2 transition-all',
                                        isRecording
                                            ? 'bg-destructive text-white animate-pulse'
                                            : 'bg-brand-accent/10 text-brand-accent group-hover:scale-110 shadow-[0_0_15px_rgba(0,230,118,0.1)]'
                                    )}
                                >
                                    <Mic className="w-5 h-5" />
                                </div>
                                <span
                                    className={cn(
                                        'text-[9px] font-bold uppercase tracking-wider block',
                                        isRecording ? 'text-destructive' : 'text-foreground'
                                    )}
                                >
                                    {isRecording ? `Parar Gravação (${recordingTime}s)` : 'Gravar Áudio'}
                                </span>
                            </button>

                            {/* Upload Option */}
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isCloning || isRecording}
                                className="flex flex-col items-center justify-center p-3 bg-background hover:bg-black/5 dark:hover:bg-white/5 border border-black/10 dark:border-white/10 hover:border-brand-accent/40 rounded-xl transition-all group shadow-sm disabled:opacity-50"
                            >
                                <div className="p-2.5 bg-brand-accent/10 rounded-full mb-2 group-hover:scale-110 transition-transform shadow-[0_0_15px_rgba(0,230,118,0.1)]">
                                    <Upload className="w-5 h-5 text-brand-accent" />
                                </div>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-foreground block">
                                    Upload MP3
                                </span>
                            </button>

                            {/* Hidden file input */}
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="audio/*"
                                onChange={handleFileUpload}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
