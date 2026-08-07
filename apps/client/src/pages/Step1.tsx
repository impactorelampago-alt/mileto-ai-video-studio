import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { VoiceSelector } from '../components/VoiceSelector';
import { VoiceSettingsPanel } from '../components/VoiceSettingsPanel';
import type { TtsProvider } from '../types';
import { cn } from '../lib/utils';
import { localAuthHeaders } from '../lib/serverAuth';
import { ArrowRight, Wand2, Loader2, Music2, Check, Pencil, Mic, Pause, Play, Trash2 } from 'lucide-react';
import { TimelineEditor } from '../components/timeline/TimelineEditor';
import { toast } from 'sonner';
import { AudioPlayer } from '../components/AudioPlayer';
import { MusicLibrary } from '../components/MusicLibrary';
import { missingBeforeStep, pendingWarningText } from '../lib/workflowWarnings';
import { invalidatedNarrationDerivatives } from '../lib/narrationState';
import { OpsProjectCompanyPicker, type OpsCompanyRequirementState } from '../components/OpsProjectCompanyPicker';

export const Step1 = () => {
    const { adData, updateAdData } = useWizard();
    const navigate = useNavigate();
    const [isGenerating, setIsGenerating] = useState(false);
    const [isMixing, setIsMixing] = useState(false);
    const [isAudioEditorOpen, setIsAudioEditorOpen] = useState(false);
    const [opsCompanyState, setOpsCompanyState] = useState<OpsCompanyRequirementState>({
        loading: true,
        required: false,
        linked: false,
        selected: false,
        autoSelected: false,
    });
    const defaultCompanyNoticeRef = useRef(false);

    // Gravar a própria voz (alternativa à narração por IA).
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [isUploadingRec, setIsUploadingRec] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recTimerRef = useRef<number | null>(null);
    // Visualização da waveform ao vivo (reage ao microfone).
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const waveFrameRef = useRef<number>(0);
    const barsRef = useRef<(HTMLDivElement | null)[]>([]);
    const recStreamRef = useRef<MediaStream | null>(null);
    const WAVE_BARS = 28;

    // Mantidos somente para o feedback visual dos campos; eles não bloqueiam
    // mais a navegação entre as etapas.
    const isTitleValid = !!adData.title?.trim();
    const isTextValid = !!adData.narrationText?.trim();

    const handleNext = async () => {
        if (opsCompanyState.loading) {
            toast.info('Aguarde a validação da empresa no Mileto Ops.');
            return;
        }
        if (opsCompanyState.required && !opsCompanyState.linked) {
            toast.error('Vincule seu usuário ao Mileto Ops antes de continuar.');
            return;
        }
        if (opsCompanyState.required && !adData.opsCompany?.id) {
            toast.error('Não encontramos uma empresa autorizada no Mileto Ops para este projeto.');
            return;
        }
        if (opsCompanyState.required && opsCompanyState.autoSelected && !defaultCompanyNoticeRef.current) {
            toast.info(`Nenhuma empresa foi escolhida manualmente. Seguiremos com ${adData.opsCompany?.name || 'Impacto Relâmpago'}.`, {
                description: 'Você pode trocar a empresa no seletor de marca antes de avançar.',
                duration: 5500,
            });
            defaultCompanyNoticeRef.current = true;
        }
        const missing = missingBeforeStep(2, adData, []);
        if (missing.length) toast.warning(pendingWarningText(missing), { duration: 7000 });

        // Sem fonte de áudio não há o que mixar. Isso não bloqueia mais a
        // montagem visual: o usuário pode estruturar o restante primeiro.
        if (!adData.narrationAudioUrl && !adData.musicAudioUrl) {
            updateAdData({ masterAudioUrl: undefined });
            navigate('/wizard/step/2');
            return;
        }

        setIsMixing(true);
        const toastId = toast.loading('Mixando áudio e preparando preview...');

        try {
            const res = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/audio/mix`, {
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
                updateAdData({ masterAudioUrl: `${((window as any).API_BASE_URL || 'http://localhost:3301')}${data.masterAudioUrl}` });
            } else {
                updateAdData({ masterAudioUrl: undefined }); // Fallback clear
            }

            toast.success('Áudio preparado para o preview.', { id: toastId, duration: 1800 });
        } catch (error: unknown) {
            console.error('Audio mix error:', error);
            const errMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            toast.warning(`Você avançou, mas a mixagem ainda precisa ser preparada: ${errMsg}`, {
                id: toastId,
                duration: 8000,
            });
        } finally {
            setIsMixing(false);
        }
        navigate('/wizard/step/2');
    };

    const handleGenerateNarration = async (auto = false) => {
        if (!adData.narrationText) {
            toast.error('Digite o texto da narração');
            return;
        }

        // A voz escolhida define o provedor; a chave da IA fica no gateway.
        const provider: TtsProvider = adData.selectedVoiceProvider ?? 'fishAudio';

        setIsGenerating(true);
        try {
            const response = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/tts/generate-narration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await localAuthHeaders()) },
                body: JSON.stringify({
                    text: adData.narrationText,
                    voiceId: adData.selectedVoiceId || '3cd37df623144626b4c9d12e22dbe898',
                    provider,
                    voiceSettings: adData.voiceSettings,
                }),
            });

            const data = await response.json();
            if (!data.ok) throw new Error(data.message);

            const apiBase = (window as any).API_BASE_URL || 'http://localhost:3301';
            const narrationUrl = `${apiBase}${data.url}`;
            const narrationDuration = Number(data.duration || 0);
            const nextAudioConfig = {
                narration: {
                    ...adData.audioConfig.narration,
                    trimEnd: narrationDuration > 0 ? narrationDuration : undefined,
                },
                background: {
                    ...adData.audioConfig.background,
                    trimEnd: narrationDuration > 0 ? narrationDuration : undefined,
                },
            };

            updateAdData({
                ...invalidatedNarrationDerivatives(),
                isNarrationGenerated: true,
                narrationSource: 'tts',
                narrationAudioUrl: narrationUrl,
                narrationDuration,
                audioConfig: nextAudioConfig,
                audioTimeline: undefined,
                masterAudioUrl: undefined,
            });

            if (adData.musicAudioUrl) {
                try {
                    const mixResponse = await fetch(`${apiBase}/api/audio/mix`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            narrationUrl,
                            musicUrl: adData.musicAudioUrl,
                            audioConfig: nextAudioConfig,
                        }),
                    });
                    const mixData = await mixResponse.json();
                    if (!mixResponse.ok || !mixData.ok || !mixData.masterAudioUrl) {
                        throw new Error(mixData.message || 'A trilha não pôde ser preparada.');
                    }
                    updateAdData({ masterAudioUrl: `${apiBase}${mixData.masterAudioUrl}` });
                    if (!auto) toast.success('Narração e música preparadas no preset da voz!');
                } catch (mixError) {
                    console.error('Automatic audio mix error:', mixError);
                    if (!auto) {
                        toast.warning(
                            `A narração foi gerada, mas a trilha ainda precisa ser preparada: ${mixError instanceof Error ? mixError.message : 'erro desconhecido'}`,
                            { duration: 7000 },
                        );
                    }
                }
            } else if (!auto) {
                toast.success('Narração gerada com sucesso!');
            }
        } catch (error: unknown) {
            console.error(error);
            const errMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            if (!auto) {
                if (errMsg.includes('créditos') || errMsg.includes('insuficiente') || errMsg.includes('402')) {
                    toast.error(
                        'Seus créditos Mileto acabaram. Recarregue em "Minha Conta" para gerar mais narrações.',
                        { duration: 10000 }
                    );
                } else if (errMsg.includes('Sessão') || errMsg.includes('401')) {
                    toast.error('Sua sessão expirou. Entre novamente para continuar.');
                } else {
                    toast.error('Erro ao gerar narração: ' + errMsg);
                }
            }
        } finally {
            setIsGenerating(false);
        }
    };

    // ─── Gravar a própria voz ────────────────────────────────────────────────
    const uploadRecording = async (blob: Blob) => {
        setIsUploadingRec(true);
        const toastId = toast.loading('Salvando sua gravação...');
        try {
            const apiBase = (window as any).API_BASE_URL || 'http://localhost:3301';
            const fd = new FormData();
            fd.append('audio', blob, 'gravacao.webm');
            const response = await fetch(`${apiBase}/api/tts/upload-recording`, {
                method: 'POST',
                headers: await localAuthHeaders(),
                body: fd,
            });
            const data = await response.json();
            if (!data.ok) throw new Error(data.message);
            updateAdData({
                ...invalidatedNarrationDerivatives(),
                isNarrationGenerated: true,
                narrationSource: 'recording',
                narrationAudioUrl: `${apiBase}${data.url}`,
                narrationDuration: data.duration,
            });
            toast.success('Sua gravação virou a narração! 🎙️', { id: toastId });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Erro desconhecido';
            toast.error('Erro ao salvar a gravação: ' + msg, { id: toastId });
        } finally {
            setIsUploadingRec(false);
        }
    };

    const startRecTimer = () => {
        if (recTimerRef.current) window.clearInterval(recTimerRef.current);
        recTimerRef.current = window.setInterval(() => setRecordingTime((t) => t + 1), 1000);
    };
    const stopRecTimer = () => {
        if (recTimerRef.current) window.clearInterval(recTimerRef.current);
        recTimerRef.current = null;
    };

    // ─── Waveform ao vivo (barras reagindo ao microfone) ─────────────────────
    const flattenBars = () => {
        for (const b of barsRef.current) if (b) b.style.transform = 'scaleY(0.12)';
    };
    const drawWave = () => {
        const analyser = analyserRef.current;
        if (!analyser) return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const step = Math.max(1, Math.floor(data.length / WAVE_BARS));
        for (let i = 0; i < WAVE_BARS; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
            const v = sum / step / 255; // 0..1
            const h = Math.max(0.12, Math.min(1, v * 1.7)); // realça um pouco
            const b = barsRef.current[i];
            if (b) b.style.transform = `scaleY(${h})`;
        }
        waveFrameRef.current = requestAnimationFrame(drawWave);
    };
    const startWave = () => {
        if (waveFrameRef.current) cancelAnimationFrame(waveFrameRef.current);
        waveFrameRef.current = requestAnimationFrame(drawWave);
    };
    const stopWave = () => {
        if (waveFrameRef.current) cancelAnimationFrame(waveFrameRef.current);
        waveFrameRef.current = 0;
    };

    // Libera microfone e áudio ao desmontar (se sair no meio de uma gravação).
    useEffect(() => {
        return () => {
            if (waveFrameRef.current) cancelAnimationFrame(waveFrameRef.current);
            if (recTimerRef.current) window.clearInterval(recTimerRef.current);
            recStreamRef.current?.getTracks().forEach((t) => t.stop());
            audioCtxRef.current?.close().catch(() => {});
        };
    }, []);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            recStreamRef.current = stream;

            // Analisador para a waveform ao vivo (as barras reagem à voz).
            const AudioCtx =
                window.AudioContext ||
                (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const audioCtx = new AudioCtx();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 128;
            source.connect(analyser);
            audioCtxRef.current = audioCtx;
            analyserRef.current = analyser;

            const mr = new MediaRecorder(stream);
            mediaRecorderRef.current = mr;
            audioChunksRef.current = [];
            mr.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };
            mr.onstop = () => {
                stream.getTracks().forEach((t) => t.stop()); // libera o microfone
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                void uploadRecording(blob);
            };
            mr.start();
            setIsRecording(true);
            setIsPaused(false);
            setRecordingTime(0);
            startRecTimer();
            startWave();
        } catch {
            toast.error('Não foi possível acessar o microfone. Verifique a permissão.');
        }
    };

    const pauseRecording = () => {
        const mr = mediaRecorderRef.current;
        if (mr && mr.state === 'recording') {
            mr.pause();
            setIsPaused(true);
            stopRecTimer(); // o tempo pausado não conta
            stopWave();
            flattenBars(); // barras "achatadas" indicam pausa
        }
    };

    const resumeRecording = () => {
        const mr = mediaRecorderRef.current;
        if (mr && mr.state === 'paused') {
            mr.resume();
            setIsPaused(false);
            startRecTimer();
            startWave();
        }
    };

    // Finaliza: encerra a gravação e envia (o onstop dispara o upload).
    const stopRecording = () => {
        const mr = mediaRecorderRef.current;
        if (mr && (mr.state === 'recording' || mr.state === 'paused')) {
            mr.stop();
            setIsRecording(false);
            setIsPaused(false);
            stopRecTimer();
            stopWave();
            audioCtxRef.current?.close().catch(() => {});
            audioCtxRef.current = null;
            analyserRef.current = null;
            recStreamRef.current = null;
        }
    };

    // Apaga a narração gerada/gravada, voltando ao estado inicial.
    const handleDeleteNarration = () => {
        updateAdData({
            ...invalidatedNarrationDerivatives(),
            isNarrationGenerated: false,
            narrationAudioUrl: '',
            narrationAudioPath: null,
            sharedNarrationAssetId: undefined,
            narrationDuration: 0,
        });
        toast.success('Áudio apagado.');
    };

    const handleResynthesizeNarration = () => {
        updateAdData({
            ...invalidatedNarrationDerivatives(),
            isNarrationGenerated: false,
            narrationAudioUrl: null,
            narrationAudioPath: null,
            sharedNarrationAssetId: undefined,
            narrationDuration: 0,
        });
    };

    // Auto-generation on mount removed per user request to start from scratch.

    return (
        <div className="mx-auto flex min-h-0 w-full max-w-[1380px] flex-1 flex-col pb-20">
            <header className="mb-4 shrink-0 text-center">
                <h2 className="text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
                    Crie sua{' '}
                    <span className="bg-linear-to-r from-brand-lime to-brand-accent bg-clip-text text-transparent">
                        Narração
                    </span>
                </h2>
                <p className="mx-auto mt-1.5 max-w-2xl text-xs font-medium text-brand-muted">
                    Defina o título do projeto, o formato de tela do vídeo e escreva o seu roteiro inteligente.
                </p>
            </header>

            <div className="mb-4">
                <OpsProjectCompanyPicker onRequirementChange={setOpsCompanyState} />
            </div>

            {/* 5/7 em vez de 50/50: a coluna de voz tem grade de cards e precisa de mais largura. */}
            <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
                {/* Left Column: Form */}
                <div className="custom-scrollbar relative space-y-4 overflow-y-auto rounded-2xl border border-black/5 bg-brand-card p-4 shadow-xl dark:border-white/5 lg:col-span-5 lg:h-full">
                    <div className="absolute top-0 left-0 w-full h-[2px] bg-linear-to-r from-brand-lime/40 to-brand-accent/10"></div>

                    {/* Title */}
                    <div className="space-y-2">
                        <label className="ml-1 text-[11px] font-bold uppercase tracking-wide text-brand-muted">
                            Título do Projeto
                        </label>
                        <input
                            type="text"
                            value={adData.title}
                            onChange={(e) => updateAdData({ title: e.target.value })}
                            placeholder="Ex: Lançamento Tênis Runner"
                            className={cn(
                                'w-full rounded-xl border border-black/5 bg-background px-4 py-2.5 text-sm text-foreground shadow-inner transition-all placeholder:text-foreground/20 focus:outline-none focus:ring-1 dark:border-white/5',
                                !isTitleValid
                                    ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20'
                                    : 'focus:ring-brand-accent focus:border-brand-accent/40 hover:border-black/10 dark:border-white/10'
                            )}
                        />
                    </div>

                    {/* Format */}
                    <div className="space-y-2">
                        <label className="ml-1 text-[11px] font-bold uppercase tracking-wide text-brand-muted">
                            Formato da Tela
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            {['9:16', '1:1'].map((fmt) => (
                                <button
                                    key={fmt}
                                    onClick={() => updateAdData({ format: fmt as '9:16' | '16:9' | '4:5' | '1:1' })}
                                    className={cn(
                                        'rounded-xl border px-3 py-2 text-xs font-bold transition-all duration-300',
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
                            <label className="text-[11px] font-bold uppercase tracking-wide text-brand-muted">
                                Texto da Narração
                            </label>
                            <span className="text-xs text-brand-muted/70 font-mono">
                                {adData.narrationText.length} CARACTERES
                            </span>
                        </div>
                        <textarea
                            value={adData.narrationText}
                            onChange={(e) =>
                                // Mudou o texto → o áudio gerado ficou desatualizado. Invalida
                                // para forçar regerar (senão avança e o vídeo fala o texto antigo).
                                updateAdData({
                                    ...invalidatedNarrationDerivatives(),
                                    narrationText: e.target.value,
                                    isNarrationGenerated: false,
                                    narrationAudioUrl: null,
                                    narrationAudioPath: null,
                                    sharedNarrationAssetId: undefined,
                                    narrationDuration: 0,
                                })
                            }
                            placeholder="Escreva aqui o seu roteiro matador para o anúncio..."
                            className={cn(
                                'h-32 w-full resize-none rounded-xl border border-black/5 bg-background px-4 py-3 text-sm leading-relaxed text-foreground shadow-inner transition-all placeholder:text-foreground/20 focus:outline-none focus:ring-1 dark:border-white/5',
                                !isTextValid
                                    ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20'
                                    : 'focus:ring-brand-accent focus:border-brand-accent/40 hover:border-black/10 dark:border-white/10'
                            )}
                        />
                    </div>

                    {/* Síntese — logo abaixo do roteiro, que é o insumo dela */}
                    <div
                        className={cn(
                            'rounded-2xl border p-4 transition-all',
                            adData.isNarrationGenerated
                                ? 'bg-brand-accent/5 border-brand-accent/20'
                                : 'bg-background border-black/5 dark:border-white/5 shadow-inner'
                        )}
                    >
                        {!adData.isNarrationGenerated ? (
                            <div className="space-y-3">
                                <button
                                    onClick={() => handleGenerateNarration()}
                                    disabled={!adData.narrationText || !adData.selectedVoiceId || isGenerating}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-accent/30 bg-brand-accent/10 px-5 py-2.5 text-sm font-bold text-brand-accent transition-all hover:bg-brand-accent/20 disabled:border-black/5 disabled:bg-black/5 disabled:text-foreground/30 dark:disabled:border-white/5 dark:disabled:bg-white/5"
                                >
                                    {isGenerating ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Wand2 className="w-4 h-4" />
                                    )}
                                    Tornar Roteiro em Áudio
                                </button>
                                <p className="text-[11px] text-brand-muted text-center leading-snug">
                                    {!adData.narrationText
                                        ? 'Escreva o roteiro acima para liberar.'
                                        : !adData.selectedVoiceId
                                          ? 'Escolha uma voz ao lado para liberar.'
                                          : 'Pronto para gerar a locução.'}
                                </p>

                                {/* Alternativa: gravar a própria voz, para quem não quer IA */}
                                <div className="flex items-center gap-2 text-[10px] text-brand-muted/60 uppercase tracking-widest font-semibold">
                                    <div className="flex-1 h-px bg-black/5 dark:bg-white/5" />
                                    ou
                                    <div className="flex-1 h-px bg-black/5 dark:bg-white/5" />
                                </div>
                                {isUploadingRec ? (
                                    <button
                                        disabled
                                        className="w-full px-6 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 border bg-background border-black/5 dark:border-white/5 text-brand-muted opacity-60"
                                    >
                                        <Loader2 className="w-4 h-4 animate-spin" /> Salvando gravação…
                                    </button>
                                ) : !isRecording ? (
                                    <button
                                        onClick={startRecording}
                                        disabled={isGenerating}
                                        className="w-full px-6 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all border bg-background border-black/5 dark:border-white/5 text-brand-muted hover:text-foreground hover:border-brand-accent/30 disabled:opacity-50"
                                    >
                                        <Mic className="w-4 h-4" /> Gravar minha própria voz
                                    </button>
                                ) : (
                                    <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.06] p-3 space-y-3 animate-in fade-in duration-200">
                                        {/* Waveform ao vivo + tempo — visual de gravação de verdade */}
                                        <div className="flex items-center gap-3 px-1">
                                            <div className="flex items-center gap-1.5 shrink-0 text-red-400 text-xs font-bold tabular-nums">
                                                <span
                                                    className={cn(
                                                        'w-2 h-2 rounded-full bg-red-500',
                                                        !isPaused && 'animate-pulse'
                                                    )}
                                                />
                                                {`${Math.floor(recordingTime / 60)}:${String(recordingTime % 60).padStart(2, '0')}`}
                                            </div>
                                            <div className="flex-1 flex items-center justify-center gap-[3px] h-9 overflow-hidden">
                                                {Array.from({ length: WAVE_BARS }).map((_, i) => (
                                                    <div
                                                        key={i}
                                                        ref={(el) => {
                                                            barsRef.current[i] = el;
                                                        }}
                                                        className={cn(
                                                            'w-[3px] h-7 rounded-full origin-center will-change-transform',
                                                            isPaused ? 'bg-red-400/40' : 'bg-red-400'
                                                        )}
                                                        style={{ transform: 'scaleY(0.12)', transition: 'transform 60ms linear' }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                        {/* Controles */}
                                        <div className="flex gap-2">
                                            <button
                                                onClick={isPaused ? resumeRecording : pauseRecording}
                                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all border bg-background border-black/10 dark:border-white/10 text-foreground hover:border-brand-accent/40"
                                            >
                                                {isPaused ? (
                                                    <>
                                                        <Play className="w-4 h-4 fill-current" /> Continuar
                                                    </>
                                                ) : (
                                                    <>
                                                        <Pause className="w-4 h-4 fill-current" /> Pausar
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={stopRecording}
                                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all bg-brand-accent text-[#0a0f12] hover:bg-brand-accent/90 shadow-[0_0_15px_rgba(0,230,118,0.3)]"
                                            >
                                                <Check className="w-4 h-4" /> Finalizar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 text-brand-accent">
                                        <div className="w-7 h-7 rounded-full bg-brand-accent/20 flex items-center justify-center shrink-0">
                                            <Check className="w-4 h-4 drop-shadow-[0_0_8px_rgba(0,230,118,0.8)]" />
                                        </div>
                                        <span className="font-bold text-sm tracking-wide">Narração Finalizada</span>
                                    </div>
                                    <button
                                        onClick={handleDeleteNarration}
                                        title="Apagar áudio"
                                        className="p-2 rounded-lg text-brand-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="bg-background rounded-2xl p-4 border border-black/5 dark:border-white/5 shadow-inner">
                                    <AudioPlayer src={adData.masterAudioUrl || adData.narrationAudioUrl || ''} />
                                </div>
                                <button
                                    onClick={handleResynthesizeNarration}
                                    className="w-full text-xs text-brand-muted hover:text-foreground transition-colors uppercase tracking-widest font-semibold pt-1"
                                >
                                    Refazer Sintetização
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Music Library */}
                    <MusicLibrary />
                </div>

                {/* Right Column: Voice */}
                <div className="min-h-0 lg:col-span-7 lg:h-full">
                    <div className="custom-scrollbar relative h-full overflow-y-auto rounded-2xl border border-black/5 bg-brand-card p-4 shadow-xl dark:border-white/5">
                        <div className="absolute top-0 right-0 w-full h-[2px] bg-linear-to-l from-brand-lime/40 to-brand-accent/10"></div>
                        <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-muted">
                            <Music2 className="w-4 h-4 text-brand-lime" />
                            Voz da Inteligência Artificial
                        </h3>
                        <VoiceSelector />

                        {adData.selectedVoiceId && (
                            <div className="mt-3">
                                <VoiceSettingsPanel />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer Navigation */}
            <div className="fixed bottom-0 right-0 left-0 z-50 flex h-16 items-center border-t border-black/5 bg-brand-dark/95 px-5 pr-24 backdrop-blur-xl dark:border-white/5">
                <div className="mx-auto flex w-full max-w-[1500px] justify-end gap-3">
                    <button
                        onClick={() => setIsAudioEditorOpen(true)}
                        className="flex items-center gap-2 rounded-xl border border-black/5 bg-brand-card px-5 py-2.5 text-xs font-bold text-foreground transition-all hover:border-black/10 hover:bg-black/5 dark:border-white/5 dark:bg-white/5 dark:hover:border-white/10"
                    >
                        <Pencil className="w-4 h-4 text-brand-muted" />
                        Ajuste Fino de Trilhas
                    </button>
                    <button
                        onClick={handleNext}
                        disabled={isMixing}
                        className={cn(
                            'flex items-center gap-2 rounded-xl px-7 py-2.5 text-xs font-black uppercase tracking-wide transition-all',
                            !isMixing
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
