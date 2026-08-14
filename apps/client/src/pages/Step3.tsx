import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWizard } from '../context/WizardContext';
import { cn } from '../lib/utils';
import { Play, Sparkles, AlertCircle, CheckCircle2, Type } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { VideoSequencePreview } from '../components/VideoSequencePreview';
import { CaptionStudio } from '../components/CaptionStudio';
import { localAuthHeaders } from '../lib/serverAuth';
import { missingBeforeStep, pendingWarningText } from '../lib/workflowWarnings';
import { narrationSourceKey } from '../lib/narrationState';
import { repairCaptionCurrencySegments } from '../lib/captionCurrency';
import { materializeSharedAudioForCaptions } from '../lib/sharedMediaRecovery';
import {
    materializeCurrentTitlePlan,
    titlePlanMaterializationDecision,
} from '../lib/titlePlanMaterialization';
import {
    captureTitleWorkflowAsyncFingerprint,
    isTitleWorkflowAsyncFingerprintCurrent,
    titleWorkflowAsyncFingerprintKey,
    type TitleWorkflowAsyncFingerprint,
} from '../lib/titleWorkflowAsyncGuard';

export const Step3 = () => {
    const { adData, updateAdData, mediaTakes, setMediaTakes, captionStyle, setCaptionStyle } = useWizard();
    const navigate = useNavigate();
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationStatus, setGenerationStatus] = useState('');
    const latestAdDataRef = useRef(adData);
    latestAdDataRef.current = adData;
    const captionGenerationRef = useRef<{
        controller: AbortController;
        fingerprint: TitleWorkflowAsyncFingerprint;
    } | null>(null);
    const currentSourceKey = narrationSourceKey(adData);
    const currentCaptions = adData.captions?.sourceKey === currentSourceKey ? adData.captions : undefined;
    const currentWorkflowFingerprintKey = titleWorkflowAsyncFingerprintKey(
        captureTitleWorkflowAsyncFingerprint(adData),
    );

    useEffect(() => {
        const active = captionGenerationRef.current;
        if (active && !isTitleWorkflowAsyncFingerprintCurrent(active.fingerprint, latestAdDataRef.current)) {
            active.controller.abort();
        }
    }, [currentWorkflowFingerprintKey]);

    useEffect(() => () => {
        const active = captionGenerationRef.current;
        captionGenerationRef.current = null;
        active?.controller.abort();
    }, []);

    // Projetos que já haviam sido transcritos com `R`, `199`, `00` podem ser
    // corrigidos localmente, preservando todos os tempos e sem consumir outra
    // chamada de STT. O helper é idempotente e devolve a mesma referência
    // quando não há nada a migrar.
    useEffect(() => {
        if (!currentCaptions?.segments?.length) return;
        const repairedSegments = repairCaptionCurrencySegments(currentCaptions.segments);
        if (repairedSegments === currentCaptions.segments) return;
        updateAdData({
            captions: {
                ...currentCaptions,
                segments: repairedSegments,
                review: {
                    sourceApplied: currentCaptions.review?.sourceApplied ?? true,
                    correctedWords: currentCaptions.review?.correctedWords ?? 0,
                    formattedValues: (currentCaptions.review?.formattedValues ?? 0) + 1,
                },
            },
        });
    }, [currentCaptions, updateAdData]);

    // Preview 9:16: mede o espaço vertical REAL disponível (topo do preview → base menos a
    // barra fixa "Próximo" de 64px) e limita a largura pra a altura caber sempre na tela,
    // adaptando a qualquer tamanho de janela. Via style inline p/ não depender do JIT do Tailwind.
    const gridRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [previewMaxW, setPreviewMaxW] = useState<number>();
    useLayoutEffect(() => {
        const grid = gridRef.current;
        if (!grid) return;
        const scroller = grid.closest('main');
        const BOTTOM_BAR = 64; // barra fixa "Próximo: Títulos" (h-16)
        const BREATH = 20; // respiro
        const compute = () => {
            const rectTop = grid.getBoundingClientRect().top;
            const scrollTop = scroller ? scroller.scrollTop : 0;
            const restTop = rectTop + scrollTop; // topo do card (invariante ao scroll)
            const budget = window.innerHeight - restTop - BOTTOM_BAR - BREATH; // espaço p/ o card inteiro
            const card = cardRef.current;
            const inner = innerRef.current;
            // "chrome" = tudo que NÃO é o vídeo (padding do card + barra de controles do player).
            // Medido de verdade: altura do card − altura do vídeo (largura do inner × 16/9).
            // Assim o vídeo encolhe só o suficiente p/ vídeo + controles caberem juntos, sem hardcode.
            let mw: number;
            if (card && inner) {
                const videoH = inner.getBoundingClientRect().width * (16 / 9);
                const chrome = card.getBoundingClientRect().height - videoH;
                mw = Math.round(((budget - chrome) * 9) / 16);
            } else {
                mw = Math.round(((budget - 150) * 9) / 16); // fallback aproximado
            }
            setPreviewMaxW(Math.max(240, mw));
        };
        compute();
        const raf = requestAnimationFrame(compute);
        const ro = new ResizeObserver(compute);
        ro.observe(document.documentElement);
        window.addEventListener('resize', compute);
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            window.removeEventListener('resize', compute);
        };
    }, []);

    const handleGenerateCaptions = async () => {
        if (captionGenerationRef.current) return;

        const operationAdData = latestAdDataRef.current;
        if (!operationAdData.masterAudioUrl && !operationAdData.narrationAudioUrl) {
            toast.error('Nenhum áudio encontrado. Volte ao Step 1 e gere a narração.');
            return;
        }

        const controller = new AbortController();
        const operationFingerprint = captureTitleWorkflowAsyncFingerprint(operationAdData);
        const operation = { controller, fingerprint: operationFingerprint };
        captionGenerationRef.current = operation;
        const operationSourceKey = narrationSourceKey(operationAdData);
        const operationIsCurrent = () => (
            captionGenerationRef.current === operation
            && !controller.signal.aborted
            && isTitleWorkflowAsyncFingerprintCurrent(operationFingerprint, latestAdDataRef.current)
        );
        const assertOperationIsCurrent = () => {
            if (operationIsCurrent()) return;
            const staleError = new Error('O projeto mudou durante a geração.');
            staleError.name = 'AbortError';
            throw staleError;
        };

        setIsGenerating(true);
        setGenerationStatus('Sincronizando legendas...');
        const toastId = toast.loading('Analisando áudio e sincronizando palavras...');

        try {
            // Pick the best available audio for transcription:
            // Preferably narration-only (cleaner for STT), fallback to master if needed
            let audioToTranscribe = operationAdData.narrationAudioUrl || operationAdData.masterAudioUrl;
            const sharedAudioAssetId = operationAdData.narrationAudioUrl
                ? operationAdData.sharedNarrationAssetId
                : operationAdData.sharedMasterAssetId;
            if (sharedAudioAssetId) {
                audioToTranscribe = await materializeSharedAudioForCaptions(sharedAudioAssetId);
                assertOperationIsCurrent();
            }

            const apiBaseUrl = (window as Window & { API_BASE_URL?: string }).API_BASE_URL || 'http://localhost:3301';
            const response = await fetch(`${apiBaseUrl}/api/stt/generate-captions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await localAuthHeaders()) },
                signal: controller.signal,
                body: JSON.stringify({
                    audioUrl: audioToTranscribe,
                    narrationText: operationAdData.narrationText,
                }),
            });

            const data = await response.json();
            assertOperationIsCurrent();

            if (!data.ok) {
                throw new Error(data.message || 'Erro na geração de legendas');
            }

            const captions = {
                enabled: true,
                language: 'pt-BR' as const,
                presetId: 'karaoke-yellow', // Internal identifier for the backend rendering
                segments: repairCaptionCurrencySegments(data.segments),
                sourceKey: operationSourceKey,
                review: data.review,
            };
            const captionsOnlyPatch = {
                captions,
                dynamicTitles: [],
                dynamicTitlesSourceKey: undefined,
                titleGenerationSummary: undefined,
            };

            const reviewBits = [
                data.review?.correctedWords
                    ? `${data.review.correctedWords} grafia${data.review.correctedWords === 1 ? '' : 's'} revisada${data.review.correctedWords === 1 ? '' : 's'}`
                    : '',
                data.review?.formattedValues
                    ? `${data.review.formattedValues} valor${data.review.formattedValues === 1 ? '' : 'es'} formatado${data.review.formattedValues === 1 ? '' : 's'}`
                    : '',
            ].filter(Boolean);
            const reviewSummary = reviewBits.length
                ? `Legendas sincronizadas e revisadas: ${reviewBits.join(' · ')}`
                : 'Legendas perfeitamente sincronizadas! ✓';
            const titlePlan = titlePlanMaterializationDecision(operationAdData);

            if (!titlePlan.shouldMaterialize) {
                assertOperationIsCurrent();
                updateAdData(captionsOnlyPatch);
                toast.success(reviewSummary, { id: toastId });
                return;
            }

            setGenerationStatus('Criando títulos confirmados...');
            toast.loading(
                `${reviewSummary} Criando ${titlePlan.plannedTitles.length} título${titlePlan.plannedTitles.length === 1 ? '' : 's'} confirmado${titlePlan.plannedTitles.length === 1 ? '' : 's'} no chat...`,
                { id: toastId },
            );

            try {
                const result = await materializeCurrentTitlePlan({
                    ...operationAdData,
                    ...captionsOnlyPatch,
                }, {
                    signal: controller.signal,
                    onProgress: (progress) => {
                        if (!operationIsCurrent()) return;
                        setGenerationStatus(progress.message);
                        toast.loading(`Legendas prontas. ${progress.message}`, { id: toastId });
                    },
                });
                assertOperationIsCurrent();
                const titleCount = result.adData.dynamicTitles?.length || 0;
                updateAdData({
                    captions: result.adData.captions,
                    dynamicTitles: result.adData.dynamicTitles,
                    dynamicTitlesSourceKey: result.adData.dynamicTitlesSourceKey,
                    titleGenerationSummary: result.adData.titleGenerationSummary,
                    brandPalette: result.adData.brandPalette,
                    brandPaletteUpdatedAt: result.adData.brandPaletteUpdatedAt,
                });

                if (!titleCount) {
                    const firstIssue = result.adData.titleGenerationSummary?.materialization?.diagnostics[0];
                    toast.warning(
                        'As legendas foram criadas, mas nenhum dos títulos confirmados pôde ser posicionado. '
                        + `${firstIssue?.message ? `Motivo: ${firstIssue.message} ` : ''}`
                        + 'O plano continua salvo para revisão ou nova tentativa.',
                        { id: toastId, duration: 8_000 },
                    );
                    return;
                }

                const materialization = result.adData.titleGenerationSummary?.materialization;
                const requestedTitleCount = materialization?.requestedCount || result.plannedTitleCount;
                if (titleCount < requestedTitleCount) {
                    const firstIssue = materialization?.diagnostics[0];
                    toast.warning(
                        `${reviewSummary} ${titleCount} de ${requestedTitleCount} títulos confirmados foram posicionados. `
                        + `${firstIssue?.message ? `Motivo do primeiro pendente: ${firstIssue.message} ` : ''}`
                        + 'O plano completo continua salvo.',
                        { id: toastId, duration: 10_000 },
                    );
                    return;
                }

                toast.success(
                    result.source === 'local'
                        ? `${reviewSummary} ${titleCount} título${titleCount === 1 ? '' : 's'} criado${titleCount === 1 ? '' : 's'} com a geração local.`
                        : `${reviewSummary} ${titleCount} título${titleCount === 1 ? '' : 's'} criado${titleCount === 1 ? '' : 's'} a partir do plano do chat.`,
                    { id: toastId, duration: 7_000 },
                );
            } catch (titleError: unknown) {
                // Captions are already valid and must not be discarded just because
                // title materialization failed. Omitting plannedTitles from this patch
                // deliberately preserves the confirmed chat plan for a retry.
                assertOperationIsCurrent();
                updateAdData(captionsOnlyPatch);
                console.error('[title-materialization]', titleError);
                toast.warning(
                    'As legendas foram criadas, mas os títulos confirmados não puderam ser gerados agora. O plano continua salvo para uma nova tentativa.',
                    { id: toastId, duration: 8_000 },
                );
            }
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') {
                if (captionGenerationRef.current === operation) {
                    toast.warning(
                        'A narração, o plano de títulos ou as legendas mudaram durante o processamento. O resultado antigo foi descartado; gere novamente para usar a versão atual.',
                        { id: toastId, duration: 8_000 },
                    );
                } else {
                    // A operação foi abortada ao sair da etapa (unmount) ou por uma
                    // operação mais nova, e o ref já foi limpo. Sem isto, o
                    // toast.loading nunca seria resolvido e ficaria preso na tela.
                    toast.dismiss(toastId);
                }
                return;
            }
            console.error('STT Error:', error);
            const errMsg = error instanceof Error ? error.message : 'Erro';
            toast.error(`Erro: ${errMsg}`, { id: toastId });
        } finally {
            if (captionGenerationRef.current === operation) {
                captionGenerationRef.current = null;
                setIsGenerating(false);
                setGenerationStatus('');
            }
        }
    };

    const handleNext = () => {
        const missing = missingBeforeStep(4, adData, mediaTakes);
        if (missing.length) toast.warning(pendingWarningText(missing), { duration: 7000 });
        navigate('/wizard/step/4');
    };

    return (
        <div className="mx-auto flex min-h-0 w-full max-w-[1320px] flex-1 flex-col pb-20">
            <header className="mb-4 shrink-0 text-center">
                <h2 className="inline-flex items-center gap-2 text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
                    <span className="bg-linear-to-r from-brand-lime to-brand-accent bg-clip-text text-transparent">
                        Legendas Dinâmicas
                    </span>
                </h2>
                <p className="mx-auto mt-1.5 max-w-2xl text-xs font-medium text-brand-muted">
                    Gere legendas automáticas perfeitamente sincronizadas com a sua voz para aumentar o engajamento do
                    seu vídeo.
                </p>
            </header>

            <div ref={gridRef} className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(300px,440px)_300px_minmax(360px,1fr)]">
                {/* Visual Preview Box — fixo (sticky) enquanto as legendas rolam */}
                <div
                    ref={cardRef}
                    className="sticky top-2 flex w-full items-center justify-center self-start rounded-2xl border border-white/7 bg-brand-card/40 p-3 shadow-xl"
                >
                    <div
                        ref={innerRef}
                        style={{ maxWidth: previewMaxW ? `${previewMaxW}px` : undefined }}
                        className="relative w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10"
                    >
                        {mediaTakes && mediaTakes.length > 0 ? (
                            <VideoSequencePreview
                                takes={mediaTakes}
                                masterAudioUrl={adData.masterAudioUrl || adData.narrationAudioUrl || undefined}
                                captions={currentCaptions}
                                captionEditingEnabled={Boolean(currentCaptions?.segments?.length)}
                                onCaptionStyleChange={(updates) => {
                                    if (captionStyle) setCaptionStyle({ ...captionStyle, ...updates });
                                }}
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

                {/* Controls — também fixo no topo */}
                <div className="sticky top-2 w-full self-start">
                    <div className="relative overflow-hidden rounded-2xl border border-black/5 bg-brand-card p-5 shadow-xl dark:border-white/5">
                        <div className="absolute top-0 left-0 w-full h-[2px] bg-linear-to-r from-brand-accent/40 to-brand-lime/10"></div>
                        <div className="mb-4 space-y-1.5">
                            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                                <Sparkles className="w-5 h-5 text-brand-accent" />
                                Criação de Legendas
                            </h3>
                            <p className="text-xs leading-relaxed text-brand-muted">
                                O sistema escutará sua narração e marcará os tempos exatos para criar legendas
                                automáticas perfeitamente alinhadas com o vídeo.
                            </p>
                        </div>

                        <button
                            onClick={handleGenerateCaptions}
                            disabled={isGenerating}
                            className={cn(
                                'flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-bold uppercase tracking-wider shadow-lg transition-all',
                                isGenerating
                                    ? 'bg-brand-accent/20 text-brand-accent cursor-wait border border-brand-accent/20'
                                    : 'bg-linear-to-r from-brand-lime to-brand-accent text-[#0a0f12] hover:shadow-[0_0_20px_rgba(0,230,118,0.4)] hover:scale-[1.02] active:scale-[0.98]'
                            )}
                        >
                            {isGenerating ? (generationStatus || 'Processando Áudio...') : 'Gerar Legendas Automáticas'}
                        </button>

                        <div className="mt-5 space-y-3 border-t border-black/5 pt-5 dark:border-white/5">
                            <h4 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                                <Sparkles className="w-4 h-4 text-brand-accent" />
                                Estilo da Legenda
                            </h4>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {/* Option 1: Karaoke (Red Highlight) */}
                                <button className="group relative flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border-2 border-brand-accent bg-background shadow-[0_0_20px_rgba(0,230,118,0.15)] transition-all hover:bg-black/5 dark:bg-white/5">
                                    {/* Subtitle Visual Preview */}
                                    <div
                                        className="flex scale-110 items-center justify-center text-3xl font-black tracking-wide drop-shadow-xl"
                                        style={{
                                            fontFamily: captionStyle?.fontFamily || 'Poppins',
                                            WebkitTextStroke: `${captionStyle?.strokeWidth ?? 1}px ${captionStyle?.strokeColor || 'black'}`,
                                            paintOrder: 'stroke fill',
                                            textShadow: '0px 8px 16px rgba(0,0,0,0.8)',
                                            textTransform: captionStyle?.textCase === 'lowercase' ? 'lowercase' : 'uppercase',
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

                        <div className="mt-5 space-y-3 border-t border-black/5 pt-5 dark:border-white/5">
                            <div className="flex items-start gap-4">
                                {currentCaptions?.segments && currentCaptions.segments.length > 0 ? (
                                    <>
                                        <div className="p-2 bg-brand-lime/10 rounded-xl shadow-inner mt-0.5 shrink-0">
                                            <CheckCircle2 className="w-5 h-5 text-brand-lime drop-shadow-[0_0_5px_rgba(163,230,53,0.5)]" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold uppercase tracking-wider text-brand-lime">
                                                Pronto para renderizar
                                            </p>
                                            <p className="text-xs text-brand-muted mt-1 font-medium">
                                                Foram gerados {currentCaptions.segments.length} blocos de legenda.
                                            </p>
                                            {currentCaptions.review?.sourceApplied && (
                                                <p className="text-xs text-brand-lime mt-2 font-semibold">
                                                    Roteiro da etapa 1 revisado antes de exibir as legendas
                                                    {currentCaptions.review.correctedWords > 0
                                                        ? ` · ${currentCaptions.review.correctedWords} correção(ões) de grafia`
                                                        : ''}
                                                    {currentCaptions.review.formattedValues > 0
                                                        ? ` · ${currentCaptions.review.formattedValues} valor(es) formatado(s)`
                                                        : ''}
                                                    .
                                                </p>
                                            )}
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
                                                {adData.captions?.segments?.length
                                                    ? 'A narração mudou. Gere novamente para não usar textos do áudio anterior.'
                                                    : 'As legendas ainda não foram extraídas do áudio.'}
                                            </p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Advanced Caption Studio Panel */}
                <div className="min-h-0 w-full transition-all duration-500 ease-in-out">
                    {currentCaptions?.segments && currentCaptions.segments.length > 0 ? (
                        <div className="h-full animate-in fade-in slide-in-from-right-4 duration-500">
                            <CaptionStudio />
                        </div>
                    ) : (
                        <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/10 bg-brand-card p-6 text-center opacity-70 dark:border-white/10">
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
            <div className="fixed bottom-0 right-0 left-0 z-40 flex h-16 items-center justify-end border-t border-black/5 bg-background/95 px-5 pr-24 backdrop-blur-xl dark:border-white/5">
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
