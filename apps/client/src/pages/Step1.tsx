import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { VoiceSelector } from '../components/VoiceSelector';
import { cn } from '../lib/utils';
import { ArrowRight, Wand2, Loader2, Music2, Check, Pencil } from 'lucide-react';
import { TimelineEditor } from '../components/timeline/TimelineEditor';
import { toast } from 'sonner';
import { AudioPlayer } from '../components/AudioPlayer';
import { MusicLibrary } from '../components/MusicLibrary';

export const Step1 = () => {
    const { adData, updateAdData, apiKeys } = useWizard();
    const navigate = useNavigate();
    const [isGenerating, setIsGenerating] = useState(false);
    const [isMixing, setIsMixing] = useState(false);
    const [isAudioEditorOpen, setIsAudioEditorOpen] = useState(false);

    const isTitleValid = !!adData.title?.trim();
    const isTextValid = !!adData.narrationText?.trim();
    const isAudioReady = adData.isNarrationGenerated || !!adData.narrationAudioUrl;
    const canProceed = isTextValid && isAudioReady;

    const handleNext = async () => {
        if (!canProceed) {
            toast.error('Preencha os campos obrigatórios e gere a narração.');
            return;
        }

        setIsMixing(true);
        const toastId = toast.loading('Mixando áudio e preparando preview...');

        try {
            const res = await fetch(`${(window as any).API_BASE_URL || 'http://localhost:3301'}/api/audio/mix`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    narrationUrl: adData.narrationAudioUrl,
                    musicUrl: adData.musicAudioUrl,
                    audioConfig: adData.audioConfig,
                }),
            });

            const data = await res.json();
            if (!data.ok) throw new Error(data.message);

            if (data.masterAudioUrl) {
                updateAdData({
                    masterAudioUrl: `${(window as any).API_BASE_URL || 'http://localhost:3301'}${data.masterAudioUrl}`,
                });
            } else {
                updateAdData({ masterAudioUrl: undefined }); // Fallback clear
            }

            toast.dismiss(toastId);
            navigate('/step/2');
        } catch (error: unknown) {
            console.error('Audio mix error:', error);
            const errMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            toast.error('Erro ao mixar áudio: ' + errMsg, { id: toastId });
        } finally {
            setIsMixing(false);
        }
    };

    const handleGenerateNarration = async (auto = false) => {
        if (!adData.narrationText) {
            toast.error('Digite o texto da narração');
            return;
        }
        if (!apiKeys.fishAudio) {
            if (!auto) toast.error('Configure a chave da Fish Audio primeiro');
            return;
        }

        setIsGenerating(true);
        try {
            const response = await fetch(
                `${(window as any).API_BASE_URL || 'http://localhost:3301'}/api/tts/generate-narration`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: adData.narrationText,
                        voiceId: adData.selectedVoiceId || '3cd37df623144626b4c9d12e22dbe898',
                        apiKey: apiKeys.fishAudio,
                    }),
                }
            );

            const data = await response.json();
            if (!data.ok) throw new Error(data.message);

            updateAdData({
                isNarrationGenerated: true,
                narrationAudioUrl: `${(window as any).API_BASE_URL || 'http://localhost:3301'}${data.url}`,
                narrationDuration: data.duration,
            });
            if (!auto) toast.success('Narração gerada com sucesso!');
        } catch (error: unknown) {
            console.error(error);
            const errMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            if (!auto) toast.error('Erro ao gerar narração: ' + errMsg);
        } finally {
            setIsGenerating(false);
        }
    };

    // Auto-generation on mount removed per user request to start from scratch.

    return (
        <div className="max-w-6xl mx-auto pb-32 pt-8 px-4">
            <header className="mb-12 text-center">
                <h2 className="text-4xl font-extrabold text-foreground tracking-tight">
                    Crie sua{' '}
                    <span className="bg-linear-to-r from-brand-lime to-brand-accent bg-clip-text text-transparent">
                        Narração
                    </span>
                </h2>
                <p className="text-brand-muted mt-3 max-w-2xl mx-auto text-sm font-medium">
                    Defina o título do projeto, o formato de tela do vídeo e escreva o seu roteiro inteligente.
                </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Form */}
                <div className="space-y-8 bg-brand-card rounded-3xl p-8 border border-black/5 dark:border-white/5 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[2px] bg-linear-to-r from-brand-lime/40 to-brand-accent/10"></div>

                    {/* Title */}
                    <div className="space-y-2">
                        <label className="text-[13px] font-semibold tracking-wide uppercase text-brand-muted ml-1">
                            Título do Projeto
                        </label>
                        <input
                            type="text"
                            value={adData.title}
                            onChange={(e) => updateAdData({ title: e.target.value })}
                            placeholder="Ex: Lançamento Tênis Runner"
                            className={cn(
                                'w-full bg-background border border-black/5 dark:border-white/5 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-1 transition-all placeholder:text-foreground/20 text-foreground shadow-inner',
                                !isTitleValid
                                    ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20'
                                    : 'focus:ring-brand-accent focus:border-brand-accent/40 hover:border-black/10 dark:border-white/10'
                            )}
                        />
                    </div>

                    {/* Format */}
                    <div className="space-y-2">
                        <label className="text-[13px] font-semibold tracking-wide uppercase text-brand-muted ml-1">
                            Formato da Tela
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            {['9:16', '1:1'].map((fmt) => (
                                <button
                                    key={fmt}
                                    onClick={() => updateAdData({ format: fmt as '9:16' | '16:9' | '4:5' | '1:1' })}
                                    className={cn(
                                        'py-3 px-3 rounded-xl text-xs font-bold border transition-all duration-300',
                                        adData.format === fmt
                                            ? 'bg-brand-accent/10 border-brand-accent/50 text-brand-accent shadow-[0_0_15px_rgba(0,230,118,0.15)] ring-1 ring-brand-accent/20'
                                            : 'bg-background border-black/5 dark:border-white/5 text-foreground/40 hover:bg-black/5 dark:bg-white/5 hover:text-foreground'
                                    )}
                                >
                                    {fmt}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Narration Text */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center ml-1">
                            <label className="text-[13px] font-semibold tracking-wide uppercase text-brand-muted">
                                Texto da Narração
                            </label>
                            <span className="text-xs text-brand-muted/70 font-mono">
                                {adData.narrationText.length} CARACTERES
                            </span>
                        </div>
                        <textarea
                            value={adData.narrationText}
                            onChange={(e) => updateAdData({ narrationText: e.target.value })}
                            placeholder="Escreva aqui o seu roteiro matador para o anúncio..."
                            className={cn(
                                'w-full h-44 bg-background border border-black/5 dark:border-white/5 rounded-xl px-5 py-4 text-sm focus:outline-none focus:ring-1 transition-all placeholder:text-foreground/20 text-foreground resize-none leading-relaxed shadow-inner',
                                !isTextValid
                                    ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20'
                                    : 'focus:ring-brand-accent focus:border-brand-accent/40 hover:border-black/10 dark:border-white/10'
                            )}
                        />

                        {/* Mood Selector (Semantic Rewrite) */}
                        <div className="pt-2 animate-in fade-in duration-300">
                            <div className="flex items-center gap-2 flex-wrap">
                                {[
                                    { id: 'engraçado', label: '🤣 Engraçado' },
                                    { id: 'dramático', label: '😢 Dramático' },
                                    { id: 'enérgico', label: '🚀 Enérgico' },
                                    { id: 'sério', label: '🤔 Sério' },
                                ].map((mood) => (
                                    <button
                                        key={mood.id}
                                        onClick={async () => {
                                            if (!adData.narrationText) {
                                                toast.error('Escreva um texto primeiro para poder mudar o humor.');
                                                return;
                                            }
                                            if (!apiKeys.openai && !apiKeys.gemini) {
                                                toast.error(
                                                    'Configure uma chave de IA (OpenAI ou Gemini) para usar o Humor.'
                                                );
                                                return;
                                            }

                                            // Optional: Add some inner active state
                                            const toastId = toast.loading(`Adaptando texto para humor ${mood.id}...`);
                                            try {
                                                const res = await fetch(
                                                    `${(window as any).API_BASE_URL || 'http://localhost:3301'}/api/ai/rewrite`,
                                                    {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                            text: adData.narrationText,
                                                            mood: mood.id,
                                                            openaiKey: apiKeys.openai,
                                                            geminiKey: apiKeys.gemini,
                                                        }),
                                                    }
                                                );
                                                const data = await res.json();
                                                if (!data.ok) throw new Error(data.message);

                                                updateAdData({ narrationText: data.text });
                                                toast.success('Texto adaptado com sucesso!', { id: toastId });
                                            } catch (error: any) {
                                                toast.error(`Erro ao reescrever: ${error.message}`, { id: toastId });
                                            }
                                        }}
                                        disabled={!adData.narrationText || (!apiKeys.openai && !apiKeys.gemini)}
                                        className={cn(
                                            'px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide border transition-all duration-200',
                                            !adData.narrationText
                                                ? 'bg-black/5 dark:bg-white/5 border-transparent text-foreground/30 cursor-not-allowed'
                                                : 'bg-brand-card hover:bg-brand-accent/10 border-black/5 dark:border-white/5 hover:border-brand-accent/30 text-brand-muted hover:text-brand-accent shadow-sm'
                                        )}
                                        title={`Reescrever o texto em tom ${mood.id}`}
                                    >
                                        {mood.label}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-brand-muted/60 mt-2 ml-1">
                                Usa IA para reescrever o texto com pontuação e termos que forçam a emoção na voz.
                            </p>
                        </div>
                    </div>

                    {/* Music Library */}
                    <MusicLibrary />
                </div>

                {/* Right Column: Voice & Preview */}
                <div className="space-y-6">
                    <div className="bg-brand-card border border-black/5 dark:border-white/5 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-full h-[2px] bg-linear-to-l from-brand-lime/40 to-brand-accent/10"></div>
                        <h3 className="text-[13px] tracking-wide uppercase font-semibold text-brand-muted mb-5 flex items-center gap-2">
                            <Music2 className="w-4 h-4 text-brand-lime" />
                            Voz da Inteligência Artificial
                        </h3>
                        <VoiceSelector />
                    </div>

                    {/* Generated Output Preview */}
                    <div
                        className={cn(
                            'rounded-3xl border p-8 transition-all relative overflow-hidden',
                            adData.isNarrationGenerated
                                ? 'bg-brand-accent/5 border-brand-accent/20'
                                : 'bg-brand-card border-black/5 dark:border-white/5'
                        )}
                    >
                        {!adData.isNarrationGenerated ? (
                            <div className="text-center py-8">
                                <div className="w-16 h-16 rounded-2xl bg-background border border-black/5 dark:border-white/5 mx-auto flex items-center justify-center mb-5 shadow-inner">
                                    <Wand2 className="w-6 h-6 text-brand-muted" />
                                </div>
                                <h4 className="text-base font-bold text-foreground">Sintetizar Áudio Master</h4>
                                <p className="text-sm text-brand-muted mt-2 max-w-[260px] mx-auto leading-relaxed">
                                    Preencha o roteiro e defina a voz para gerar a locução profissional.
                                </p>
                                <button
                                    onClick={() => handleGenerateNarration()}
                                    disabled={!adData.narrationText || !adData.selectedVoiceId || isGenerating}
                                    className="mt-6 px-8 py-3 bg-brand-accent/10 hover:bg-brand-accent/20 border border-brand-accent/30 disabled:border-black/5 dark:border-white/5 disabled:bg-black/5 dark:bg-white/5 disabled:text-foreground/30 text-brand-accent font-bold rounded-xl text-sm transition-all flex items-center gap-2 mx-auto"
                                >
                                    {isGenerating ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Wand2 className="w-4 h-4" />
                                    )}
                                    Tornar Roteiro em Áudio
                                </button>
                            </div>
                        ) : (
                            <div className="text-center py-4">
                                <div className="flex items-center justify-center gap-2 text-brand-accent mb-4">
                                    <div className="w-8 h-8 rounded-full bg-brand-accent/20 flex items-center justify-center">
                                        <Check className="w-5 h-5 drop-shadow-[0_0_8px_rgba(0,230,118,0.8)]" />
                                    </div>
                                    <span className="font-bold text-sm tracking-wide">Narração Finalizada</span>
                                </div>
                                <div className="bg-background rounded-2xl p-4 border border-black/5 dark:border-white/5 shadow-inner">
                                    <AudioPlayer src={adData.narrationAudioUrl || ''} />
                                </div>
                                <button
                                    onClick={() => updateAdData({ isNarrationGenerated: false })}
                                    className="mt-5 text-xs text-brand-muted hover:text-foreground transition-colors uppercase tracking-widest font-semibold"
                                >
                                    Refazer Sintetização
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer Navigation */}
            <div className="fixed bottom-0 right-0 left-0 bg-brand-dark/90 backdrop-blur-xl border-t border-black/5 dark:border-white/5 p-5 z-50">
                <div className="max-w-[1600px] mx-auto flex justify-end gap-4 px-6">
                    <button
                        onClick={() => setIsAudioEditorOpen(true)}
                        className="px-6 py-3.5 font-bold rounded-xl text-sm transition-all flex items-center gap-2 border border-black/5 dark:border-white/5 bg-brand-card hover:bg-black/5 dark:bg-white/5 hover:border-black/10 dark:hover:border-white/10 text-foreground"
                    >
                        <Pencil className="w-4 h-4 text-brand-muted" />
                        Ajuste Fino de Trilhas
                    </button>
                    <button
                        onClick={handleNext}
                        disabled={!canProceed || isMixing}
                        className={cn(
                            'px-8 py-3.5 font-black rounded-xl text-sm transition-all flex items-center gap-2 uppercase tracking-wide',
                            canProceed && !isMixing
                                ? 'bg-linear-to-r from-brand-lime to-brand-accent text-[#0a0f12] shadow-[0_0_20px_rgba(0,230,118,0.3)] hover:shadow-[0_0_30px_rgba(0,230,118,0.6)] transform hover:scale-[1.02]'
                                : 'bg-black/5 dark:bg-white/5 text-foreground/30 cursor-not-allowed border border-black/5 dark:border-white/5'
                        )}
                    >
                        {isMixing ? 'Preparando Motor...' : 'Próximo Passo'}
                        {isMixing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            <TimelineEditor isOpen={isAudioEditorOpen} onClose={() => setIsAudioEditorOpen(false)} />
        </div>
    );
};
