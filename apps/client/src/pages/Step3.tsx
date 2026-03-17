import { useState, useEffect } from 'react';
import { useWizard } from '../context/WizardContext';
import { cn } from '../lib/utils';
import { Play, Sparkles, AlertCircle, CheckCircle2, Type, Mic, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { VideoSequencePreview } from '../components/VideoSequencePreview';
import { CaptionStudio } from '../components/CaptionStudio';

export const Step3 = () => {
    const { adData, updateAdData, apiKeys, mediaTakes, setMediaTakes, captionStyle } = useWizard();
    const navigate = useNavigate();
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedSourceId, setSelectedSourceId] = useState<string>('');

    // Pre-calculate available audio sources
    const availableSources: { id: string; label: string; url: string; icon: any }[] = [];
    
    if (adData.masterAudioUrl || adData.narrationAudioUrl) {
        availableSources.push({
            id: 'master',
            label: 'Narração da IA',
            url: adData.masterAudioUrl || adData.narrationAudioUrl || '',
            icon: Mic
        });
    }
    
    const firstVideoWithAudio = mediaTakes.find((take) => take.type === 'video' && !take.muteOriginalAudio);
    if (firstVideoWithAudio) {
        availableSources.push({
            id: 'video',
            label: 'Áudio do Vídeo',
            url: firstVideoWithAudio.url,
            icon: Volume2
        });
    }

    useEffect(() => {
        if (!selectedSourceId && availableSources.length > 0) {
            setSelectedSourceId(availableSources[0].id);
        }
    }, [availableSources, selectedSourceId]);

    const handleGenerateCaptions = async () => {
        const selectedSource = availableSources.find(s => s.id === selectedSourceId);
        let audioToTranscribe = selectedSource?.url;

        // fallback if none selected but available
        if (!audioToTranscribe && availableSources.length > 0) {
            audioToTranscribe = availableSources[0].url;
        }

        if (!audioToTranscribe) {
            toast.error('Nenhum áudio ou vídeo selecionado/encontrado para gerar legendas.');
            return;
        }

        if (!apiKeys.openai) {
            toast.error('Chave da OpenAI ausente. Necessária para legendas precisas (Whisper).');
            return;
        }

        setIsGenerating(true);
        const toastId = toast.loading('Analisando áudio e sincronizando palavras...');

        try {
            const response = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/stt/generate-captions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audioUrl: audioToTranscribe,
                    apiKey: apiKeys.openai,
                }),
            });

            const data = await response.json();

            if (!data.ok) {
                throw new Error(data.message || 'Erro na geração de legendas');
            }

            // Save segments to state
            updateAdData({
                captions: {
                    enabled: true,
                    language: 'pt-BR',
                    presetId: 'karaoke-yellow', // Internal identifier for the backend rendering
                    segments: data.segments,
                },
            });

            toast.success('Legendas perfeitamente sincronizadas! ✓', { id: toastId });
        } catch (error: unknown) {
            console.error('STT Error:', error);
            const errMsg = error instanceof Error ? error.message : 'Erro';
            toast.error(`Erro: ${errMsg}`, { id: toastId });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleNext = () => {
        if (!adData.captions?.segments || adData.captions.segments.length === 0) {
            toast.warning('Você não gerou as legendas. O vídeo sairá sem texto.');
        }
        navigate('/step/4');
    };

    return (
        <div className="max-w-6xl mx-auto pb-24 px-6">
            <header className="mb-12 text-center mt-8">
                <h2 className="text-4xl font-extrabold text-foreground tracking-tight inline-flex items-center gap-2">
                    <span className="bg-linear-to-r from-brand-lime to-brand-accent bg-clip-text text-transparent">
                        Legendas Dinâmicas
                    </span>
                </h2>
                <p className="text-brand-muted mt-3 max-w-2xl mx-auto text-sm font-medium">
                    Gere legendas automáticas perfeitamente sincronizadas com a sua voz para aumentar o engajamento do
                    seu vídeo.
                </p>
            </header>

            <div className="flex flex-col md:flex-row items-start justify-center gap-8">
                {/* Visual Preview Box */}
                <div className="w-full md:w-[280px] shrink-0">
                    <div className="relative shadow-2xl rounded-3xl overflow-hidden ring-1 ring-white/10">
                        {mediaTakes && mediaTakes.length > 0 ? (
                            <VideoSequencePreview
                                takes={mediaTakes}
                                masterAudioUrl={adData.masterAudioUrl || adData.narrationAudioUrl || undefined}
                                captions={adData.captions}
                                hideControls={true}
                                onMuteToggle={(id) => {
                                    setMediaTakes(
                                        mediaTakes.map((t) =>
                                            t.id === id ? { ...t, muteOriginalAudio: !t.muteOriginalAudio } : t
                                        )
                                    );
                                }}
                                onMuteAll={(muted) => {
                                    setMediaTakes(mediaTakes.map((t) => ({ ...t, muteOriginalAudio: muted })));
                                }}
                            />
                        ) : (
                            <div className="aspect-9/16 bg-brand-dark flex items-center justify-center">
                                <p className="text-brand-muted/50 text-xs font-bold uppercase tracking-widest text-center px-4">
                                    Preview indisponível
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Controls */}
                <div className="w-full max-w-md flex flex-col space-y-6">
                    <div className="bg-brand-card border border-black/5 dark:border-white/5 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-[2px] bg-linear-to-r from-brand-accent/40 to-brand-lime/10"></div>
                        <div className="mb-6 space-y-2">
                            <h3 className="font-semibold text-lg flex items-center gap-2 text-foreground">
                                <Sparkles className="w-5 h-5 text-brand-accent" />
                                Criação de Legendas
                            </h3>
                            <p className="text-sm text-brand-muted leading-relaxed">
                                Escolha a fonte de áudio. O sistema extrairá o som e marcará os tempos exatos para criar legendas automáticas perfeitamente alinhadas.
                            </p>
                        </div>

                        {availableSources.length > 0 && (
                            <div className="mb-6 space-y-3">
                                <p className="text-xs font-bold text-brand-muted uppercase tracking-wider">Qual áudio vamos transcrever?</p>
                                <div className="space-y-2">
                                    {availableSources.map((source) => (
                                        <label 
                                            key={source.id} 
                                            className={cn(
                                                "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                                                selectedSourceId === source.id 
                                                    ? "bg-brand-accent/10 border-brand-accent/50 text-brand-accent shadow-[0_0_15px_rgba(0,230,118,0.1)] ring-1 ring-brand-accent/20" 
                                                    : "bg-brand-dark border-white/5 text-brand-muted hover:bg-white/5 hover:border-white/10 hover:text-foreground"
                                            )}
                                        >
                                            <input 
                                                type="radio" 
                                                name="audioSource" 
                                                value={source.id} 
                                                checked={selectedSourceId === source.id}
                                                onChange={() => setSelectedSourceId(source.id)} 
                                                className="hidden"
                                            />
                                            <source.icon className={cn("w-4 h-4 shrink-0 focus:outline-none", selectedSourceId === source.id ? "text-brand-accent" : "opacity-60")} />
                                            <span className="text-[13px] font-bold tracking-wide truncate">{source.label}</span>
                                            {selectedSourceId === source.id && <CheckCircle2 className="w-4 h-4 ml-auto shrink-0 animate-in fade-in zoom-in duration-200" />}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleGenerateCaptions}
                            disabled={isGenerating}
                            className={cn(
                                'w-full py-4 text-[13px] uppercase tracking-wider font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all',
                                isGenerating
                                    ? 'bg-brand-accent/20 text-brand-accent cursor-wait border border-brand-accent/20'
                                    : 'bg-linear-to-r from-brand-lime to-brand-accent text-[#0a0f12] hover:shadow-[0_0_20px_rgba(0,230,118,0.4)] hover:scale-[1.02] active:scale-[0.98]'
                            )}
                        >
                            {isGenerating ? 'Processando Áudio...' : 'Gerar Legendas Automáticas'}
                        </button>

                        <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/5 space-y-4">
                            <h4 className="text-[13px] uppercase tracking-wider font-semibold text-brand-muted flex items-center gap-2 mb-4">
                                <Sparkles className="w-4 h-4 text-brand-accent" />
                                Estilo da Legenda
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                {/* Option 1: Karaoke (Red Highlight) */}
                                <button className="relative w-full aspect-square bg-background rounded-2xl border-2 border-brand-accent flex items-center justify-center transition-all hover:bg-black/5 dark:bg-white/5 overflow-hidden shadow-[0_0_20px_rgba(0,230,118,0.15)] group">
                                    {/* Subtitle Visual Preview */}
                                    <div
                                        className="font-black text-3xl md:text-5xl tracking-wide flex items-center justify-center uppercase scale-110 drop-shadow-xl"
                                        style={{
                                            fontFamily: captionStyle?.fontFamily || 'Poppins',
                                            WebkitTextStroke: `${captionStyle?.strokeWidth || 3}px ${captionStyle?.strokeColor || 'black'}`,
                                            paintOrder: 'stroke fill',
                                            textShadow: '0px 8px 16px rgba(0,0,0,0.8)',
                                        }}
                                    >
                                        <span style={{ color: captionStyle?.baseColor || '#FFFFFF' }}>A</span>
                                        <span
                                            className="mx-1.5 scale-125 translate-y-[-4px] inline-block transition-transform group-hover:scale-130 drop-shadow-[0_0_15px_rgba(255,234,0,0.5)]"
                                            style={{ color: captionStyle?.activeColor || '#FFEA00' }}
                                        >
                                            B
                                        </span>
                                        <span style={{ color: captionStyle?.baseColor || '#FFFFFF' }}>C</span>
                                    </div>

                                    {/* Selection Checkmark */}
                                    <div className="absolute top-2 right-2 bg-brand-dark rounded-full shadow-lg">
                                        <CheckCircle2 className="w-5 h-5 text-brand-accent" />
                                    </div>
                                </button>
                                {/* Future styles will be mapped here as grid items */}
                            </div>
                        </div>

                        <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/5 space-y-4">
                            <div className="flex items-start gap-4">
                                {adData.captions?.segments && adData.captions.segments.length > 0 ? (
                                    <>
                                        <div className="p-2 bg-brand-lime/10 rounded-xl shadow-inner mt-0.5 shrink-0">
                                            <CheckCircle2 className="w-5 h-5 text-brand-lime drop-shadow-[0_0_5px_rgba(163,230,53,0.5)]" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold uppercase tracking-wider text-brand-lime">
                                                Pronto para renderizar
                                            </p>
                                            <p className="text-xs text-brand-muted mt-1 font-medium">
                                                Foram gerados {adData.captions.segments.length} blocos de legenda.
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="p-2 bg-brand-accent/10 rounded-xl shadow-inner mt-0.5 shrink-0">
                                            <AlertCircle className="w-5 h-5 text-brand-accent drop-shadow-[0_0_5px_rgba(0,230,118,0.5)]" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold uppercase tracking-wider text-brand-accent">
                                                Aguardando geração
                                            </p>
                                            <p className="text-xs text-brand-muted mt-1 font-medium">
                                                As legendas ainda não foram extraídas do áudio.
                                            </p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Advanced Caption Studio Panel */}
                <div className="w-full md:w-[350px] shrink-0 transition-all duration-500 ease-in-out">
                    {adData.captions?.segments && adData.captions.segments.length > 0 ? (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-500 h-full">
                            <CaptionStudio />
                        </div>
                    ) : (
                        <div className="bg-brand-card border-2 border-dashed border-black/10 dark:border-white/10 rounded-3xl p-8 h-[600px] flex flex-col items-center justify-center text-center opacity-70">
                            <div className="w-16 h-16 bg-black/5 dark:bg-white/5 rounded-2xl flex items-center justify-center mb-4">
                                <Type className="w-8 h-8 text-brand-muted opacity-80" />
                            </div>
                            <p className="text-[13px] font-bold uppercase tracking-wider text-brand-muted">
                                Estúdio de Legendas
                            </p>
                            <p className="text-xs text-brand-muted mt-3 font-medium max-w-[200px] leading-relaxed">
                                Gere as legendas para liberar os controles de edição de texto, cores e fontes.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Navigation */}
            <div className="fixed bottom-0 right-0 left-0 bg-background/80 backdrop-blur-xl border-t border-black/5 dark:border-white/5 p-4 z-40 flex justify-end">
                <button
                    onClick={handleNext}
                    className="px-8 py-3 bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:bg-white/20 text-foreground font-bold uppercase tracking-wider rounded-xl text-xs transition-all flex items-center gap-3 shadow-lg hover:shadow-xl hover:scale-105"
                >
                    Próximo: Títulos
                    <div className="w-6 h-6 rounded-full bg-brand-accent flex items-center justify-center">
                        <Play className="w-3 h-3 text-[#0a0f12] fill-current ml-0.5" />
                    </div>
                </button>
            </div>
        </div>
    );
};
