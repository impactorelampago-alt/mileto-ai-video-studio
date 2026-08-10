import React, {
    useEffect,
    useLayoutEffect,
    useRef,
    useCallback,
    useState,
    useMemo,
    forwardRef,
    useImperativeHandle,
    useId,
} from 'react';
import { flushSync } from 'react-dom';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Loader2, Zap, VideoOff } from 'lucide-react';
import { AdData, CaptionStyle, MediaTake, TitleHook, CaptionTrack } from '../types';
import { cn } from '../lib/utils';
import { API_BASE_URL } from '../lib/apiBase';
import { useWizard } from '../context/WizardContext';
import { DynamicTitleRenderer } from './DynamicTitleRenderer';
import { getPlaybackRateForRemap } from '../lib/speedRemapping';
import { toCanvas } from 'html-to-image';
// Fontes premium auto-hospedadas como TEXTO (data-URI, mesma origem). Passamos direto ao
// toCanvas na exportação para garantir que o vídeo use SEMPRE as fontes certas — o embed
// automático do html-to-image buscava do Google (cross-origin) e falhava silenciosamente,
// fazendo o export cair em fonte fallback (mais larga) ≠ preview.
import selfHostedFontCss from '../fonts-selfhosted.css?raw';
import { toast } from 'sonner';
import { normalizedTakeProgress, takeMotionScale } from '../lib/takeMotion';
import { EditableTitleOverlay } from './EditableTitleOverlay';
import { EditableCaptionOverlay } from './EditableCaptionOverlay';
import { recoverOpsTakeSource } from '../lib/opsMediaRecovery';
import { captionSafeTopPercent } from '../lib/titleSafeArea';
import {
    enhancementPreviewCss,
    resolveTakeEnhancement,
    resolveTakeSharpness,
    sharpnessKernel,
} from '../lib/videoEnhancement';

const OVERLAY_DESIGN_WIDTH = 360;
const OVERLAY_DESIGN_HEIGHT_PORTRAIT = 640;

export interface VideoSequencePreviewRef {
    seekToTime: (globalTime: number) => void;
    seekToTake: (index: number) => void;
    getCurrentTime: () => number;
    previewRange: (startTime: number, endTime: number) => void;
    extractFrameSync: (
        globalTime: number,
        isAlphaExport?: boolean,
        targetW?: number,
        targetH?: number
    ) => Promise<HTMLCanvasElement | null>;
}

export interface VideoSequencePreviewProps {
    takes: MediaTake[];
    masterAudioUrl?: string;
    onMuteToggle: (takeId: string) => void;
    onMuteAll: (muted: boolean) => void;
    hideControls?: boolean;
    showTakeList?: boolean;
    showHeaderMute?: boolean;
    compactViewport?: boolean;
    compactViewportWidth?: string;
    captions?: CaptionTrack; // Add captions prop
    dynamicTitles?: TitleHook[];
    isHybridMode?: boolean; // Propaga a intenção Híbrida p/ o extrator
    selectedTitleId?: string | null;
    onTitleSelect?: (_id: string | null) => void;
    onTitleTransformChange?: (_id: string, _updates: Partial<TitleHook>) => void;
    onTitleDelete?: (_id: string) => void;
    adDataOverride?: AdData;
    captionStyleOverride?: CaptionStyle | null;
    captionEditingEnabled?: boolean;
    onCaptionStyleChange?: (_updates: Partial<CaptionStyle>) => void;
    debugModeOverride?: boolean;
}

export const VideoSequencePreview = forwardRef<VideoSequencePreviewRef, VideoSequencePreviewProps>(
    (
        {
            takes,
            masterAudioUrl,
            onMuteToggle,
            onMuteAll,
            hideControls = false,
            showTakeList = true,
            showHeaderMute = true,
            compactViewport = false,
            compactViewportWidth,
            captions, // Extract captions
            dynamicTitles = [],
            isHybridMode = false, // Modo Overlay-only
            selectedTitleId = null,
            onTitleSelect,
            onTitleTransformChange,
            onTitleDelete,
            adDataOverride,
            captionStyleOverride,
            captionEditingEnabled = false,
            onCaptionStyleChange,
            debugModeOverride,
        },
        ref
    ) => {
        const wizard = useWizard();
        const captionStyle = captionStyleOverride === undefined ? wizard.captionStyle : captionStyleOverride;
        const adData = adDataOverride || wizard.adData;
        const isDebugMode = debugModeOverride ?? wizard.isDebugMode;
        const enhancementFilterId = `mileto-sharpness-${useId().replace(/:/g, '')}`;

        // Refs
        const videoRef1 = useRef<HTMLVideoElement>(null);
        const videoRef2 = useRef<HTMLVideoElement>(null);
        const motionLayerRef1 = useRef<HTMLDivElement>(null);
        const motionLayerRef2 = useRef<HTMLDivElement>(null);
        const motionImageLayerRef = useRef<HTMLDivElement>(null);
        const motionCanvasRef1 = useRef<HTMLCanvasElement>(null);
        const motionCanvasRef2 = useRef<HTMLCanvasElement>(null);
        const transitionRef = useRef<HTMLVideoElement>(null);
        const audioMasterRef = useRef<HTMLAudioElement>(null);
        const progressIntervalRef = useRef<number>(0);
        const motionAnimationRef = useRef<Animation | null>(null);
        const advancingRef = useRef(false);
        const bufferingAudioPauseTimerRef = useRef<number | null>(null);
        const videoAreaRef = useRef<HTMLDivElement>(null);
        const overlayContainerRef = useRef<HTMLDivElement>(null);
        const overlayFontCssRef = useRef<string | null>(null);

        // State
        const [isPlaying, setIsPlaying] = useState(false);
        const [isExportingFrame, setIsExportingFrame] = useState(false);
        const [currentTakeIndex, setCurrentTakeIndex] = useState(0);
        const [currentTimeInTake, setCurrentTimeInTake] = useState(0);
        const [standaloneTakeIndex, setStandaloneTakeIndex] = useState<number | null>(null);
        const [audioTime, setAudioTime] = useState(0); // True audio time for subtitles
        const [isImageTake, setIsImageTake] = useState(false);
        const [isBuffering, setIsBuffering] = useState(false);
        const [showBufferingSpinner, setShowBufferingSpinner] = useState(false);
        const [activeVideo, setActiveVideo] = useState<1 | 2>(1);
        const [playbackSourceOverrides, setPlaybackSourceOverrides] = useState<Record<string, string>>({});
        const [activeTransitionUrl, setActiveTransitionUrl] = useState<string | null>(null);
        const [canvasReadyTakeId, setCanvasReadyTakeId] = useState<string | null>(null);
        const [canvasFallbackTakeId, setCanvasFallbackTakeId] = useState<string | null>(null);
        const [overlayPreviewScale, setOverlayPreviewScale] = useState(1);
        const [captionSelected, setCaptionSelected] = useState(false);
        const pendingSeekTimeRef = useRef<number | null>(null);
        const transitionTriggeredRef = useRef<boolean>(false);
        const progressBarRef = useRef<HTMLDivElement>(null);
        const isScrubbingRef = useRef(false);

        const overlayDesignHeight =
            adData.format === '1:1' ? OVERLAY_DESIGN_WIDTH : OVERLAY_DESIGN_HEIGHT_PORTRAIT;
        const titleCaptionSafeTop = useMemo(
            () =>
                captions?.enabled !== false && captions?.segments?.length
                    ? captionSafeTopPercent(
                          captionStyle || { fontSize: 20, strokeWidth: 1, verticalPosition: 23 },
                          adData.format
                      )
                    : undefined,
            [adData.format, captionStyle, captions?.enabled, captions?.segments?.length]
        );

        useLayoutEffect(() => {
            const videoArea = videoAreaRef.current;
            if (!videoArea) return;

            const syncOverlayScale = () => {
                const nextScale = videoArea.clientWidth / OVERLAY_DESIGN_WIDTH;
                if (!Number.isFinite(nextScale) || nextScale <= 0) return;
                setOverlayPreviewScale((current) => (Math.abs(current - nextScale) < 0.001 ? current : nextScale));
            };

            syncOverlayScale();
            const observer = new ResizeObserver(syncOverlayScale);
            observer.observe(videoArea);
            return () => observer.disconnect();
        }, [adData.format]);

        useEffect(() => {
            if (!captionEditingEnabled) setCaptionSelected(false);
        }, [captionEditingEnabled]);
        const wasPlayingBeforeScrubRef = useRef(false);
        const previewRepairAttemptsRef = useRef(new Set<string>());
        const sequenceFirstIdRef = useRef<string | null>(null);
        const rangePreviewRef = useRef<{ endTime: number; returnTime: number } | null>(null);

        // Derived
        const currentTake = takes.length > 0 ? takes[currentTakeIndex] : null;
        const isStandaloneTakePreview = standaloneTakeIndex === currentTakeIndex;
        const currentSharpness = currentTake ? resolveTakeSharpness(currentTake, adData.videoEnhancement) : 0;
        const currentEnhancement = currentTake
            ? resolveTakeEnhancement(currentTake, adData.videoEnhancement)
            : adData.videoEnhancement;
        const currentEnhancementFilter = enhancementPreviewCss(
            currentEnhancement,
            currentSharpness,
            enhancementFilterId
        );
        // A configuração de movimento é intencionalmente reduzida a valores
        // primitivos. O estado do projeto pode ser salvo/reidratado enquanto o
        // preview toca, trocando a referência do take sem que o zoom tenha mudado.
        // Recriar a animação nessa situação fazia o compositor voltar alguns
        // milissegundos e era percebido como uma tremedeira.
        const currentMotion = useMemo(() => {
            if (!currentTake?.motionEffect) return null;
            const effect = currentTake.motionEffect;
            return {
                takeId: currentTake.id,
                mediaType: currentTake.type,
                trimStart: currentTake.trim.start,
                trimEnd: currentTake.trim.end,
                effect: {
                    type: effect.type,
                    intensity: effect.intensity,
                    focalX: effect.focalX,
                    focalY: effect.focalY,
                    easing: effect.easing,
                },
            };
        }, [
            currentTake?.id,
            currentTake?.type,
            currentTake?.trim.start,
            currentTake?.trim.end,
            currentTake?.motionEffect?.type,
            currentTake?.motionEffect?.intensity,
            currentTake?.motionEffect?.focalX,
            currentTake?.motionEffect?.focalY,
            currentTake?.motionEffect?.easing,
        ]);
        const currentMotionOrigin = currentTake
            ? `${currentTake.motionEffect?.focalX ?? 50}% ${currentTake.motionEffect?.focalY ?? 50}%`
            : '50% 50%';
        const currentTakeId = currentTake?.id ?? null;
        const currentObjectFit = currentTake?.objectFit ?? 'cover';
        // Vídeos nativos podem usar uma superfície de hardware separada no
        // Chromium/Electron. Escalar essa superfície durante a reprodução é o
        // que causa a vibração percebida no preview. Para takes com movimento,
        // apresentamos os frames em uma textura canvas e deixamos o <video>
        // invisível atuar apenas como decoder/relógio. A exportação continua
        // usando a sua pipeline própria, sem depender deste canvas.
        const shouldUseCanvasMotionPreview = Boolean(
            currentMotion && currentMotion.mediaType === 'video' && !isHybridMode
        );
        const isCanvasMotionPreviewReady = Boolean(
            shouldUseCanvasMotionPreview &&
            currentTakeId &&
            canvasReadyTakeId === currentTakeId &&
            canvasFallbackTakeId !== currentTakeId
        );
        const allMuted = takes.length > 0 && takes.every((t) => t.muteOriginalAudio);
        const playbackSourceFor = useCallback(
            (take: MediaTake) => playbackSourceOverrides[take.id] || take.proxyUrl || take.url,
            [playbackSourceOverrides]
        );

        const resetMotionTransforms = useCallback(() => {
            motionAnimationRef.current?.cancel();
            motionAnimationRef.current = null;
            for (const element of [motionLayerRef1.current, motionLayerRef2.current, motionImageLayerRef.current]) {
                if (!element) continue;
                element.style.transform = 'translate3d(0,0,0) scale3d(1,1,1)';
                element.style.transformOrigin = '50% 50%';
            }
        }, []);

        useEffect(() => {
            if (!currentMotion) {
                resetMotionTransforms();
                return;
            }

            const target =
                currentMotion.mediaType === 'image'
                    ? motionImageLayerRef.current
                    : activeVideo === 1
                      ? motionLayerRef1.current
                      : motionLayerRef2.current;
            if (!target) return;

            // Trocar de take pode deixar uma animação pausada na camada que
            // acabou de sair. Ela não é visível, mas precisa ser cancelada antes
            // de criar a animação da nova camada.
            motionAnimationRef.current?.cancel();
            motionAnimationRef.current = null;
            for (const element of [motionLayerRef1.current, motionLayerRef2.current, motionImageLayerRef.current]) {
                if (!element || element === target) continue;
                element.style.transform = 'translate3d(0,0,0) scale3d(1,1,1)';
                element.style.transformOrigin = '50% 50%';
            }

            const effect = currentMotion.effect;
            const durationMs = Math.max(1, (currentMotion.trimEnd - currentMotion.trimStart) * 1000);

            const easing = effect.easing === 'smooth' ? 'cubic-bezier(0.4, 0, 0.2, 1)' : 'linear';
            const transformAt = (progress: number) => {
                const scale = Math.round(takeMotionScale(effect, progress) * 1_000_000) / 1_000_000;
                return `translate3d(0,0,0) scale3d(${scale},${scale},1)`;
            };
            const keyframes: Keyframe[] =
                effect.type === 'zoom-in-out'
                    ? [
                          { transform: transformAt(0), offset: 0, easing },
                          { transform: transformAt(0.5), offset: 0.5, easing },
                          { transform: transformAt(1), offset: 1 },
                      ]
                    : [
                          { transform: transformAt(0), offset: 0, easing },
                          { transform: transformAt(1), offset: 1 },
                      ];

            // O <video> nativo fica imóvel. A transformação acontece nesta camada
            // HTML externa para evitar arredondamento da superfície do decoder e
            // manter a interpolação integralmente no compositor do Chromium.
            target.style.transformOrigin = `${effect.focalX ?? 50}% ${effect.focalY ?? 50}%`;
            target.style.transform = 'translate3d(0,0,0) scale3d(1,1,1)';
            const animation = target.animate(keyframes, {
                duration: durationMs,
                fill: 'both',
                iterations: 1,
            });
            const activeMedia = activeVideo === 1 ? videoRef1.current : videoRef2.current;
            const mediaLocalTime =
                currentMotion.mediaType === 'video' && activeMedia
                    ? Math.max(0, activeMedia.currentTime - currentMotion.trimStart)
                    : currentTimeInTake;
            animation.currentTime = Math.min(durationMs, Math.max(0, mediaLocalTime * 1000));
            // A animação sempre nasce pausada. O efeito abaixo é o único
            // lugar que dá play/pause nela, para que um evento de buffer não a
            // recrie nem reinicie durante a reprodução.
            animation.pause();
            motionAnimationRef.current = animation;

            return () => {
                animation.cancel();
                if (motionAnimationRef.current === animation) motionAnimationRef.current = null;
            };
        }, [activeVideo, currentMotion, resetMotionTransforms]);

        // Controle de reprodução separado da criação da animação. Assim o
        // zoom é pausado no buffer e retomado na mesma posição, sem saltar para
        // o primeiro quadro a cada mudança de estado do player.
        useEffect(() => {
            if (!currentMotion) return;
            const animation = motionAnimationRef.current;
            if (!animation) return;
            const activeMedia = activeVideo === 1 ? videoRef1.current : videoRef2.current;
            animation.playbackRate =
                currentMotion.mediaType === 'video' && activeMedia && Number.isFinite(activeMedia.playbackRate)
                    ? activeMedia.playbackRate
                    : 1;
            if (isPlaying && !isBuffering) animation.play();
            else animation.pause();
        }, [activeVideo, currentMotion, isBuffering, isPlaying]);

        useEffect(() => {
            if (isPlaying || !currentMotion) return;
            const animation = motionAnimationRef.current;
            if (!animation) return;
            const durationMs = Math.max(1, (currentMotion.trimEnd - currentMotion.trimStart) * 1000);
            animation.currentTime = Math.min(durationMs, Math.max(0, currentTimeInTake * 1000));
        }, [currentMotion, currentTimeInTake, isPlaying]);

        // A troca entre takes já usa double buffering. O Chromium ainda emite
        // "waiting" por poucos milissegundos ao promover o próximo decoder,
        // mas mostrar o spinner nesse intervalo cria um flash desagradável.
        // Só revelamos o indicador se a espera passar de 280 ms — uma espera
        // real continua comunicada, enquanto a pré-carga normal fica invisível.
        useEffect(() => {
            if (!isBuffering || !isPlaying || isImageTake || isHybridMode) {
                setShowBufferingSpinner(false);
                return;
            }
            const timeoutId = window.setTimeout(() => setShowBufferingSpinner(true), 280);
            return () => window.clearTimeout(timeoutId);
        }, [isBuffering, isHybridMode, isImageTake, isPlaying]);

        // Converte somente a apresentação do preview com zoom para canvas.
        // requestVideoFrameCallback mantém o desenho alinhado aos frames já
        // decodificados; não há setState por frame nem escrita de transform
        // durante a reprodução.
        useEffect(() => {
            if (
                !currentTakeId ||
                !currentMotion ||
                currentMotion.mediaType !== 'video' ||
                isHybridMode ||
                canvasFallbackTakeId === currentTakeId
            ) {
                return;
            }

            const video = activeVideo === 1 ? videoRef1.current : videoRef2.current;
            const canvas = activeVideo === 1 ? motionCanvasRef1.current : motionCanvasRef2.current;
            if (!video || !canvas) return;

            let cancelled = false;
            let videoFrameCallbackId: number | null = null;
            let animationFrameId: number | null = null;

            const drawFrame = () => {
                if (cancelled || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
                if (!video.videoWidth || !video.videoHeight) return false;

                // clientWidth/clientHeight usam a caixa de layout, não a caixa
                // já transformada pelo zoom. Medir getBoundingClientRect aqui
                // faria o canvas ser redimensionado a cada frame e recriaria a
                // textura — exatamente o tipo de tremor que queremos evitar.
                const layoutWidth = canvas.clientWidth;
                const layoutHeight = canvas.clientHeight;
                if (!layoutWidth || !layoutHeight) return false;

                const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
                const targetWidth = Math.max(1, Math.round(layoutWidth * deviceScale));
                const targetHeight = Math.max(1, Math.round(layoutHeight * deviceScale));
                if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
                    canvas.width = targetWidth;
                    canvas.height = targetHeight;
                }

                const context = canvas.getContext('2d', { alpha: false });
                if (!context) return false;

                try {
                    context.setTransform(1, 0, 0, 1, 0, 0);
                    context.fillStyle = '#05090b';
                    context.fillRect(0, 0, targetWidth, targetHeight);
                    context.imageSmoothingEnabled = true;
                    context.imageSmoothingQuality = 'high';

                    const scale =
                        currentObjectFit === 'contain'
                            ? Math.min(targetWidth / video.videoWidth, targetHeight / video.videoHeight)
                            : Math.max(targetWidth / video.videoWidth, targetHeight / video.videoHeight);
                    const drawWidth = video.videoWidth * scale;
                    const drawHeight = video.videoHeight * scale;
                    context.drawImage(
                        video,
                        (targetWidth - drawWidth) / 2,
                        (targetHeight - drawHeight) / 2,
                        drawWidth,
                        drawHeight
                    );
                    setCanvasReadyTakeId((readyTakeId) =>
                        readyTakeId === currentTakeId ? readyTakeId : currentTakeId
                    );
                    return true;
                } catch {
                    // Se uma fonte externa não permitir drawImage, preservamos o
                    // vídeo nativo como fallback em vez de ocultar o preview.
                    setCanvasFallbackTakeId(currentTakeId);
                    return false;
                }
            };

            const scheduleNextFrame = () => {
                if (cancelled) return;
                if ('requestVideoFrameCallback' in video) {
                    videoFrameCallbackId = video.requestVideoFrameCallback(() => {
                        drawFrame();
                        scheduleNextFrame();
                    });
                    return;
                }
                animationFrameId = window.requestAnimationFrame(() => {
                    drawFrame();
                    scheduleNextFrame();
                });
            };

            const drawWhenReady = () => {
                drawFrame();
            };
            video.addEventListener('loadeddata', drawWhenReady);
            video.addEventListener('canplay', drawWhenReady);
            video.addEventListener('seeked', drawWhenReady);
            video.addEventListener('resize', drawWhenReady);
            drawFrame();
            scheduleNextFrame();

            return () => {
                cancelled = true;
                if (videoFrameCallbackId !== null && 'cancelVideoFrameCallback' in video) {
                    video.cancelVideoFrameCallback(videoFrameCallbackId);
                }
                if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
                video.removeEventListener('loadeddata', drawWhenReady);
                video.removeEventListener('canplay', drawWhenReady);
                video.removeEventListener('seeked', drawWhenReady);
                video.removeEventListener('resize', drawWhenReady);
            };
        }, [activeVideo, canvasFallbackTakeId, currentMotion, currentObjectFit, currentTakeId, isHybridMode]);

        const repairUnsupportedLocalVideo = useCallback(async (take: MediaTake) => {
            if (previewRepairAttemptsRef.current.has(take.id)) return;
            previewRepairAttemptsRef.current.add(take.id);
            const isOpsTake = take.externalMedia?.source === 'mileto_ops';
            try {
                if (isOpsTake) {
                    setIsBuffering(true);
                    const refreshed = await recoverOpsTakeSource(take);
                    setPlaybackSourceOverrides((current) => ({
                        ...current,
                        [take.id]: refreshed.proxyUrl || refreshed.fileUrl || refreshed.url,
                    }));
                    return;
                }
                const source = take.url || take.fileUrl || '';
                const parsed = new URL(source, window.location.origin);
                const marker = '/files/';
                const markerIndex = parsed.pathname.indexOf(marker);
                if (markerIndex < 0) throw new Error('Esta mídia não possui uma fonte local reparável.');
                const relPath = parsed.pathname
                    .slice(markerIndex + marker.length)
                    .split('/')
                    .map((segment) => decodeURIComponent(segment))
                    .join('/');
                setIsBuffering(true);
                toast.info('Preparando uma versão compatível deste take…', { duration: 2500 });
                const response = await fetch(`${API_BASE_URL}/api/files/preview-source`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ relPath }),
                });
                const result = await response.json();
                if (!response.ok || !result.ok || !result.publicUrl) {
                    throw new Error(result.message || 'Não foi possível preparar o take.');
                }
                const compatibleUrl = /^https?:\/\//i.test(result.publicUrl)
                    ? result.publicUrl
                    : `${API_BASE_URL}${result.publicUrl}`;
                setPlaybackSourceOverrides((current) => ({ ...current, [take.id]: compatibleUrl }));
            } catch (error) {
                toast.error(`Este take não pôde ser reproduzido: ${(error as Error).message}`);
            } finally {
                setIsBuffering(false);
                // URLs do Ops expiram por contrato. Libera uma nova renovação se
                // o mesmo take continuar aberto além da validade desta entrega.
                if (isOpsTake) {
                    window.setTimeout(() => previewRepairAttemptsRef.current.delete(take.id), 1500);
                }
            }
        }, []);

        // Determine the active transition for the current take
        const currentTransition = useMemo(() => {
            if (!currentTake) return null;
            return currentTake.transition?.asset || adData.globalTransition;
        }, [currentTake, adData.globalTransition]);

        // Calculate total duration (approximated for progress bar)
        const [audioDuration, setAudioDuration] = useState<number>(0);

        // Update audio duration when metadata loads
        useEffect(() => {
            if (audioMasterRef.current) {
                const updateDuration = () => {
                    if (audioMasterRef.current?.duration && Number.isFinite(audioMasterRef.current.duration)) {
                        setAudioDuration(audioMasterRef.current.duration);
                    }
                };
                audioMasterRef.current.addEventListener('loadedmetadata', updateDuration);
                // Also try immediately in case it's already loaded
                updateDuration();
                return () => {
                    audioMasterRef.current?.removeEventListener('loadedmetadata', updateDuration);
                };
            }
        }, [masterAudioUrl]);

        const totalDuration = useMemo(() => {
            const takesDur = takes.reduce((acc, t) => acc + (t.trim.end - t.trim.start), 0);
            const authoritativeAudioDuration =
                audioDuration > 0 ? audioDuration : Number(adData.narrationDuration || 0);
            if (authoritativeAudioDuration > 0) return authoritativeAudioDuration;
            if (takes.length === 0) return 30;
            return takesDur;
        }, [takes, audioDuration, adData.narrationDuration]);

        // Calculate global time for progress bar
        const globalTime = useMemo(() => {
            let time = 0;
            if (takes.length > 0) {
                for (let i = 0; i < currentTakeIndex; i++) {
                    const t = takes[i];
                    time += t.trim.end - t.trim.start;
                }

                time += currentTimeInTake;
            } else {
                time = currentTimeInTake;
            }

            return Math.min(totalDuration, Math.max(time, audioTime));
        }, [takes, currentTakeIndex, currentTimeInTake, audioTime, totalDuration]);

        // ─── Playback Control ───────────────────────────────────────────────

        const pauseAudio = useCallback(() => {
            // Safe pausing to avoid interrupting a pending play() request
            if (audioMasterRef.current && !audioMasterRef.current.paused) {
                // Note: calling pause() immediately after play() before the Promise resolves throws AbortError.
                // Modern browsers handle this internally. pause() returns void, so we just call it.
                audioMasterRef.current.pause();
            }
        }, []);

        const playAudio = useCallback(() => {
            if (
                audioMasterRef.current &&
                masterAudioUrl &&
                audioMasterRef.current.paused &&
                !audioMasterRef.current.ended // CRITICAL: Do not restart if it finished naturally
            ) {
                // Volume is already pre-mixed in the backend
                audioMasterRef.current.volume = 1;
                const playPromise = audioMasterRef.current.play();
                if (playPromise !== undefined) {
                    playPromise.catch((e) => {
                        // Ignore DOMException for aborted playback
                        if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
                            console.error('[audio] Master play failed:', e.message);
                        }
                    });
                }
            }
        }, [masterAudioUrl]);

        // Eventos `waiting` de poucos frames são normais ao trocar o decoder
        // pré-carregado. Só interrompemos a faixa mestre se a espera for real.
        const cancelDeferredAudioPause = useCallback(() => {
            if (bufferingAudioPauseTimerRef.current !== null) {
                window.clearTimeout(bufferingAudioPauseTimerRef.current);
                bufferingAudioPauseTimerRef.current = null;
            }
        }, []);

        const beginBuffering = useCallback(() => {
            setIsBuffering(true);
            if (bufferingAudioPauseTimerRef.current !== null) return;
            bufferingAudioPauseTimerRef.current = window.setTimeout(() => {
                bufferingAudioPauseTimerRef.current = null;
                pauseAudio();
            }, 280);
        }, [pauseAudio]);

        const finishBuffering = useCallback(() => {
            cancelDeferredAudioPause();
            setIsBuffering(false);
            if (isPlaying && !isStandaloneTakePreview) playAudio();
        }, [cancelDeferredAudioPause, isPlaying, isStandaloneTakePreview, playAudio]);

        useEffect(() => cancelDeferredAudioPause, [cancelDeferredAudioPause]);

        const stopAll = useCallback(() => {
            setIsPlaying(false);
            const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
            if (vid) vid.pause();
            cancelDeferredAudioPause();
            pauseAudio();
            clearInterval(progressIntervalRef.current);
        }, [cancelDeferredAudioPause, pauseAudio, activeVideo]);

        const play = useCallback(() => {
            const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
            if (
                isStandaloneTakePreview &&
                vid &&
                currentTake?.type === 'video' &&
                (vid.ended || vid.currentTime >= currentTake.trim.end - 0.02)
            ) {
                vid.currentTime = currentTake.trim.start;
                setCurrentTimeInTake(0);
            }
            if (
                isStandaloneTakePreview &&
                currentTake?.type === 'image' &&
                currentTimeInTake >= currentTake.trim.end - currentTake.trim.start - 0.02
            ) {
                setCurrentTimeInTake(0);
            }
            setIsPlaying(true);
            // If there are takes, play the video.
            if (vid && currentTake && !isImageTake) vid.play().catch(() => {});
            // If we ONLY have audio (no takes) or video is not buffering, play audio
            if (!isStandaloneTakePreview && (!currentTake || !isBuffering)) {
                playAudio();
            }
        }, [activeVideo, currentTake, currentTimeInTake, isBuffering, isImageTake, isStandaloneTakePreview, playAudio]);

        const pause = useCallback(() => {
            rangePreviewRef.current = null;
            stopAll();
        }, [stopAll]);

        const restart = useCallback(() => {
            rangePreviewRef.current = null;
            stopAll();
            setCurrentTakeIndex(0);
            setCurrentTimeInTake(0);
            setAudioTime(0);
            setActiveVideo(1); // Reset to first video player
            setActiveTransitionUrl(null);
            setStandaloneTakeIndex(null);
            transitionTriggeredRef.current = false;
            advancingRef.current = false;
            pendingSeekTimeRef.current = null;
            if (videoRef1.current) videoRef1.current.currentTime = takes[0]?.trim.start || 0;
            if (transitionRef.current) {
                transitionRef.current.pause();
                transitionRef.current.currentTime = 0;
            }
            if (audioMasterRef.current) audioMasterRef.current.currentTime = 0;
        }, [stopAll, takes]);

        // ─── Take Switching Logic ───────────────────────────────────────────

        // Ao esvaziar e repopular a sequência, o índice antigo podia ficar fora
        // do novo array. A mídia existia, mas o monitor permanecia vazio.
        useEffect(() => {
            if (takes.length === 0) {
                stopAll();
                sequenceFirstIdRef.current = null;
                setCurrentTakeIndex(0);
                setCurrentTimeInTake(0);
                setAudioTime(0);
                setActiveVideo(1);
                setIsImageTake(false);
                setIsBuffering(false);
                setActiveTransitionUrl(null);
                setStandaloneTakeIndex(null);
                setPlaybackSourceOverrides({});
                pendingSeekTimeRef.current = null;
                transitionTriggeredRef.current = false;
                advancingRef.current = false;

                // Remover o src é importante: apenas zerar o índice mantém o
                // último frame decodificado desenhado pelo Chromium.
                for (const video of [videoRef1.current, videoRef2.current, transitionRef.current]) {
                    if (!video) continue;
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                }
                return;
            }
            const sequenceChanged = sequenceFirstIdRef.current !== null && sequenceFirstIdRef.current !== takes[0].id;
            sequenceFirstIdRef.current = takes[0].id;
            if (sequenceChanged || currentTakeIndex >= takes.length) {
                setCurrentTakeIndex(0);
                setCurrentTimeInTake(0);
                setAudioTime(0);
                setActiveVideo(1);
                setStandaloneTakeIndex(null);
            }
        }, [takes, currentTakeIndex, stopAll]);

        // Mantém o próximo take carregado e já posicionado no primeiro quadro.
        // O player invisível deixa de começar o download somente depois do corte.
        useEffect(() => {
            const nextTake = takes[currentTakeIndex + 1];
            const standbyVideo = activeVideo === 1 ? videoRef2.current : videoRef1.current;
            if (!standbyVideo || !nextTake || nextTake.type !== 'video') return;

            const src = playbackSourceFor(nextTake);
            const seekToFirstFrame = () => {
                if (standbyVideo.readyState < HTMLMediaElement.HAVE_METADATA) return;
                if (Math.abs(standbyVideo.currentTime - nextTake.trim.start) > 0.015) {
                    standbyVideo.currentTime = nextTake.trim.start;
                }
            };

            standbyVideo.pause();
            standbyVideo.muted = true;
            standbyVideo.playbackRate = 1;
            if (standbyVideo.getAttribute('src') !== src) {
                standbyVideo.setAttribute('src', src);
                standbyVideo.load();
            }

            if (standbyVideo.readyState >= HTMLMediaElement.HAVE_METADATA) seekToFirstFrame();
            else standbyVideo.addEventListener('loadedmetadata', seekToFirstFrame, { once: true });

            return () => standbyVideo.removeEventListener('loadedmetadata', seekToFirstFrame);
        }, [activeVideo, currentTakeIndex, playbackSourceFor, takes]);

        // When take index changes, load the new source
        useEffect(() => {
            if (!currentTake) return;

            const isImg = currentTake.type === 'image';
            setIsImageTake(isImg);

            const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;

            if (vid) {
                // Load source logic
                const src = playbackSourceFor(currentTake);
                const startOffset = pendingSeekTimeRef.current !== null ? pendingSeekTimeRef.current : 0;
                pendingSeekTimeRef.current = null;
                transitionTriggeredRef.current = false; // Reset trigger for new take
                vid.playbackRate = 1; // Reset speed
                vid.muted = !!currentTake.muteOriginalAudio;

                const positionCurrentTake = () => {
                    const targetTime = currentTake.trim.start + startOffset;
                    if (Math.abs(vid.currentTime - targetTime) > 0.015) vid.currentTime = targetTime;
                    if (isPlaying && !isImg) {
                        vid.play().catch((e) => {
                            if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') console.error(e);
                        });
                    }
                };

                if (vid.getAttribute('src') !== src) {
                    vid.setAttribute('src', src);
                    vid.load();
                }
                if (vid.readyState >= HTMLMediaElement.HAVE_METADATA) positionCurrentTake();
                else vid.addEventListener('loadedmetadata', positionCurrentTake, { once: true });

                return () => vid.removeEventListener('loadedmetadata', positionCurrentTake);
            }
        }, [currentTakeIndex, takes, activeVideo, playbackSourceFor]); // Dependency on 'takes' ensures update on edit

        const seekToGlobalTime = useCallback(
            (requestedTime: number, preserveRange = false) => {
                if (totalDuration <= 0) return 0;
                if (!preserveRange) rangePreviewRef.current = null;
                const targetGlobalTime = Math.max(0, Math.min(requestedTime, totalDuration));
                let accumulated = 0;
                let targetTakeIndex = Math.max(0, takes.length - 1);
                let targetTimeInTake = 0;

                for (let i = 0; i < takes.length; i++) {
                    const takeDuration = Math.max(0, takes[i].trim.end - takes[i].trim.start);
                    if (targetGlobalTime < accumulated + takeDuration || i === takes.length - 1) {
                        targetTakeIndex = i;
                        targetTimeInTake = Math.max(0, Math.min(takeDuration, targetGlobalTime - accumulated));
                        break;
                    }
                    accumulated += takeDuration;
                }

                stopAll();
                pendingSeekTimeRef.current = targetTimeInTake;
                setStandaloneTakeIndex(null);
                setCurrentTakeIndex(targetTakeIndex);
                setCurrentTimeInTake(targetTimeInTake);
                setAudioTime(targetGlobalTime);

                if (audioMasterRef.current) audioMasterRef.current.currentTime = targetGlobalTime;
                if (targetTakeIndex === currentTakeIndex) {
                    const video = activeVideo === 1 ? videoRef1.current : videoRef2.current;
                    if (video && takes[targetTakeIndex]?.type === 'video') {
                        video.currentTime = takes[targetTakeIndex].trim.start + targetTimeInTake;
                    }
                    pendingSeekTimeRef.current = null;
                }

                return targetGlobalTime;
            },
            [activeVideo, currentTakeIndex, stopAll, takes, totalDuration]
        );

        const previewRange = useCallback(
            (requestedStart: number, requestedEnd: number) => {
                if (totalDuration <= 0) return;
                const startTime = Math.max(0, Math.min(requestedStart, totalDuration));
                const endTime = Math.min(totalDuration, Math.max(startTime + 0.05, requestedEnd));
                const returnTime = Math.max(0, Math.min(totalDuration, Math.max(globalTime, audioTime)));

                rangePreviewRef.current = { endTime, returnTime };
                seekToGlobalTime(startTime, true);
                setIsPlaying(true);

                window.requestAnimationFrame(() => {
                    const video = activeVideo === 1 ? videoRef1.current : videoRef2.current;
                    video?.play().catch(() => {});
                    playAudio();
                });
            },
            [activeVideo, audioTime, globalTime, playAudio, seekToGlobalTime, totalDuration]
        );

        // ─── Speed Curve & Time Update Loop ─────────────────────────────────

        useEffect(() => {
            // O estado de UI pode atualizar em cadência econômica; o movimento
            // visual é controlado separadamente pelo compositor do navegador.
            const checkInterval = 30;

            const tick = () => {
                if (!isPlaying) return;

                const activeRange = rangePreviewRef.current;
                if (activeRange) {
                    const takeStartTime = takes
                        .slice(0, currentTakeIndex)
                        .reduce((sum, take) => sum + Math.max(0, take.trim.end - take.trim.start), 0);
                    const video = activeVideo === 1 ? videoRef1.current : videoRef2.current;
                    const localTime =
                        currentTake?.type === 'video' && video
                            ? Math.max(0, video.currentTime - currentTake.trim.start)
                            : currentTimeInTake;
                    const sequenceTime =
                        masterAudioUrl && audioMasterRef.current
                            ? audioMasterRef.current.currentTime
                            : takeStartTime + localTime;

                    if (sequenceTime >= activeRange.endTime - 0.02) {
                        const returnTime = activeRange.returnTime;
                        rangePreviewRef.current = null;
                        seekToGlobalTime(returnTime);
                        return;
                    }
                }

                // --- AUDIO ONLY MODE ---
                if (!currentTake) {
                    // If there are no takes but we have audio, just act like a simple audio player
                    if (audioMasterRef.current) {
                        const currentAudioPos = audioMasterRef.current.currentTime;
                        setCurrentTimeInTake(currentAudioPos);
                        setAudioTime(currentAudioPos);
                        if (audioMasterRef.current.ended) {
                            stopAll();
                            setCurrentTimeInTake(0);
                            setAudioTime(0);
                        }
                    }
                    return;
                }

                // Sync true audio time for exact subtitle matching
                if (audioMasterRef.current && !isStandaloneTakePreview) {
                    const currentAudioTime = audioMasterRef.current.currentTime;
                    setAudioTime(currentAudioTime);
                    // A mixagem mestre determina o fim do anúncio. Não continue
                    // tocando takes depois que o áudio final acabar.
                    if (audioMasterRef.current.ended || currentAudioTime >= totalDuration - 0.02) {
                        stopAll();
                        setCurrentTakeIndex(0);
                        setCurrentTimeInTake(0);
                        setAudioTime(0);
                        setActiveVideo(1);
                        audioMasterRef.current.currentTime = 0;
                        return;
                    }
                }

                // --- VIDEO SEQUENCE MODE ---
                // Handle Image Duration
                if (currentTake.type === 'image') {
                    const duration = currentTake.trim.end - currentTake.trim.start; // usually 5s default
                    setCurrentTimeInTake((prev) => {
                        const next = prev + checkInterval / 1000;
                        if (next >= duration) {
                            advanceTrack();
                            return 0;
                        }
                        return next;
                    });
                    return;
                }

                // Handle Video Speed & End Check
                const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
                if (vid) {
                    const now = vid.currentTime;
                    const start = currentTake.trim.start;
                    const end = currentTake.trim.end;

                    // Sync local state for progress bar
                    setCurrentTimeInTake(Math.max(0, now - start));

                    // Dynamic Speed Remapping Logic
                    if (currentTake.speedPresetId && currentTake.speedPresetId !== 'normal') {
                        // The time spent inside this take so far
                        const timeElapsedInTimeline = now - start;
                        // The total rigid time box this take is allowed to occupy
                        const timelineDuration = end - start;

                        // How far along are we relative to the rigid box? (0 to 1)
                        // If duration is 0, avoid division by zero or NaN
                        const normalizedPosition = timelineDuration > 0 ? timeElapsedInTimeline / timelineDuration : 1;

                        // Calculate the instantaneous playback rate needed right now based on the curve math
                        const targetPlaybackRate = getPlaybackRateForRemap(
                            currentTake.speedPresetId,
                            normalizedPosition
                        );

                        // Check to save aggressive DOM writes if close enough
                        if (Math.abs(vid.playbackRate - targetPlaybackRate) > 0.05) {
                            vid.playbackRate = targetPlaybackRate;
                        }
                    } else {
                        // Regular playback (No effect)
                        if (vid.playbackRate !== 1) vid.playbackRate = 1;
                    }

                    // Check Transition Trigger
                    if (currentTransition && !transitionTriggeredRef.current) {
                        let speedAtEnd = 1.0;
                        if (currentTake.speedPresetId && currentTake.speedPresetId !== 'normal') {
                            // Calculates the instantaneous playback rate at the very end of the clip (normalized = 1.0)
                            speedAtEnd = getPlaybackRateForRemap(currentTake.speedPresetId, 1.0);
                        }

                        // Because the video is marching towards 'end' at `speedAtEnd` times its normal rate right now,
                        // the *actual* time remaining in real-world seconds is divided by the speed.
                        const timeRemaining = (end - now) / Math.max(0.1, speedAtEnd);

                        const transitionDuration = currentTransition.durationSec;
                        const halfTransition = transitionDuration / 2;

                        // Trigger the transition when we reach the halfway point before the cut
                        if (timeRemaining <= halfTransition) {
                            transitionTriggeredRef.current = true;

                            // Transition is Overlay Video (.mp4 / .webm)
                            const tUrl = `${API_BASE_URL}${currentTransition.publicUrl}`;
                            setActiveTransitionUrl(tUrl);

                            // Play the transition overlay
                            if (transitionRef.current) {
                                if (!transitionRef.current.src.endsWith(tUrl)) {
                                    transitionRef.current.src = tUrl; // Sync DOM assignment
                                }
                                transitionRef.current.currentTime = 0;
                                // The volume for the transition effect is baked into the main audio timeline by the backend already for the preview,
                                // so we MUST mute the visual transition video element to avoid double audio.
                                transitionRef.current.muted = true;
                                transitionRef.current.play().catch((e) => {
                                    if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') console.error(e);
                                });
                            }
                        }
                    }

                    // Check end
                    if (now >= end || vid.ended) {
                        advanceTrack();
                        return;
                    }
                }
            };

            const advanceTrack = () => {
                if (advancingRef.current) return;
                if (isStandaloneTakePreview) {
                    stopAll();
                    if (currentTake) {
                        setCurrentTimeInTake(Math.max(0, currentTake.trim.end - currentTake.trim.start));
                    }
                    return;
                }
                const isEndOfTakes = currentTakeIndex >= takes.length - 1;

                if (!isEndOfTakes) {
                    const nextIndex = currentTakeIndex + 1;
                    const nextT = takes[nextIndex];

                    const nextVid = activeVideo === 1 ? videoRef2.current : videoRef1.current;
                    if (nextVid && nextT && nextT.type === 'video') {
                        const src = playbackSourceFor(nextT);
                        if (nextVid.getAttribute('src') !== src) {
                            nextVid.setAttribute('src', src);
                            nextVid.load();
                        }

                        const isPrepared = () =>
                            nextVid.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
                            !nextVid.seeking &&
                            Math.abs(nextVid.currentTime - nextT.trim.start) < 0.12;
                        let startedPresentation = false;
                        const finishSwap = () => {
                            const currentVid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
                            currentVid?.pause();
                            nextVid.muted = !!nextT.muteOriginalAudio;
                            nextVid.playbackRate = 1;
                            setActiveVideo((prev) => (prev === 1 ? 2 : 1));
                            setCurrentTakeIndex(nextIndex);
                            setCurrentTimeInTake(0);
                            finishBuffering();
                            advancingRef.current = false;
                            if (isPlaying) {
                                nextVid.play().catch((e) => {
                                    if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') console.error(e);
                                });
                            }
                        };

                        // Se a rede ainda não entregou o quadro, segura o último frame
                        // do take atual em vez de revelar o fundo preto do monitor.
                        // Caminho quente: o primeiro quadro do próximo take já
                        // está no buffer. Não pausamos a narração nem esperamos
                        // outro callback do decoder para tornar o take visível.
                        if (isPrepared()) {
                            advancingRef.current = true;
                            startedPresentation = true;
                            finishSwap();
                            return;
                        }

                        // Recuperação: só pausa a faixa mestre se a mídia
                        // realmente demorar, evitando um engasgo artificial em
                        // pré-cargas que terminam em poucos milissegundos.
                        advancingRef.current = true;
                        beginBuffering();
                        const seekWhenPossible = () => {
                            if (nextVid.readyState >= HTMLMediaElement.HAVE_METADATA) {
                                nextVid.currentTime = nextT.trim.start;
                            }
                        };
                        const presentPreparedFrame = () => {
                            if (!advancingRef.current || startedPresentation || !isPrepared()) return;
                            startedPresentation = true;
                            nextVid.muted = !!nextT.muteOriginalAudio;
                            nextVid.playbackRate = 1;
                            cleanup();
                            finishSwap();
                        };
                        const onReady = () => {
                            presentPreparedFrame();
                        };
                        const timeoutId = window.setTimeout(() => {
                            cleanup();
                            advancingRef.current = false;
                            finishBuffering();
                            toast.error('O próximo take ainda não ficou pronto. Tente reproduzir novamente.');
                        }, 8000);
                        const cleanup = () => {
                            window.clearTimeout(timeoutId);
                            nextVid.removeEventListener('loadedmetadata', seekWhenPossible);
                            nextVid.removeEventListener('seeked', onReady);
                            nextVid.removeEventListener('canplay', onReady);
                            nextVid.removeEventListener('loadeddata', onReady);
                        };
                        nextVid.addEventListener('loadedmetadata', seekWhenPossible);
                        nextVid.addEventListener('seeked', onReady);
                        nextVid.addEventListener('canplay', onReady);
                        nextVid.addEventListener('loadeddata', onReady);
                        seekWhenPossible();
                        presentPreparedFrame();
                        return;
                    }

                    // Swap active video and update index
                    setActiveVideo((prev) => (prev === 1 ? 2 : 1));
                    setCurrentTakeIndex(nextIndex);
                    setCurrentTimeInTake(0);
                } else {
                    // Truly done
                    stopAll();
                    setCurrentTakeIndex(0); // Reset to start
                    setCurrentTimeInTake(0);
                    setActiveVideo(1);
                    setAudioTime(0);
                    if (audioMasterRef.current) audioMasterRef.current.currentTime = 0;
                }
            };

            const intervalId = setInterval(tick, checkInterval);
            progressIntervalRef.current = intervalId;

            return () => clearInterval(intervalId);
        }, [
            isPlaying,
            currentTakeIndex,
            takes,
            currentTake,
            stopAll,
            activeVideo,
            totalDuration,
            playbackSourceFor,
            beginBuffering,
            finishBuffering,
            isStandaloneTakePreview,
            currentTimeInTake,
            masterAudioUrl,
            seekToGlobalTime,
        ]);

        // ─── Audio Sync Checks (Periodic Watchdog) ──────────────────────────
        useEffect(() => {
            if (!isPlaying || isBuffering || isStandaloneTakePreview) return;

            const interval = setInterval(() => {
                const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
                const mas = audioMasterRef.current;

                if (!vid || vid.paused) return; // Se o vídeo não tá rodando, não cobra o áudio

                // CRITICAL FIX: To prevent the "Zombie Audio" bug where the audio finishes 2 seconds before the video
                // and the watchdog says "Hey, video is playing but audio is paused, let's force play!".
                // We check if it is explicitly `ended`. Also, we only sync if the audio still has time left.
                if (mas && masterAudioUrl && mas.paused && !mas.ended) {
                    // Check if there is still audio left to play, considering float precision
                    if (mas.currentTime < (mas.duration || 0) - 0.5) {
                        console.warn('[audio-watchdog] Vídeo tocando mas áudio mestre pausado! Forçando sync.');
                        mas.play().catch(() => {});
                    }
                }
            }, 500);

            return () => clearInterval(interval);
        }, [isPlaying, isBuffering, isStandaloneTakePreview, masterAudioUrl, activeVideo]);

        // Update mute state immediately if changed in UI
        useEffect(() => {
            const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
            if (vid && currentTake) {
                vid.muted = !!currentTake.muteOriginalAudio; // Force bool
            }
        }, [currentTake?.muteOriginalAudio, activeVideo]);

        // ─── Audio Elements Setup ───────────────────────────────────────────
        useEffect(() => {
            if (audioMasterRef.current && masterAudioUrl) {
                if (audioMasterRef.current.src !== masterAudioUrl) {
                    audioMasterRef.current.src = masterAudioUrl;
                }
                audioMasterRef.current.volume = 1; // Mixed volumes are baked in
            }
        }, [masterAudioUrl]);

        // ─── Timeline Seeking ───────────────────────────────────────────────\n        // (Handled by scrubbing system below: seekToClientX + handleScrubStart)\n
        // ─── Scrubbing (Drag Timeline) ──────────────────────────────────────
        const seekToClientX = useCallback(
            (clientX: number) => {
                if (totalDuration <= 0 || !progressBarRef.current) return;
                const rect = progressBarRef.current.getBoundingClientRect();
                const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
                const percentage = clickX / rect.width;
                const targetGlobalTime = percentage * totalDuration;

                let accumulated = 0;
                let targetTakeIndex = 0;
                let targetTimeInTake = 0;

                for (let i = 0; i < takes.length; i++) {
                    const t = takes[i];
                    const takeDur = t.trim.end - t.trim.start;
                    if (targetGlobalTime < accumulated + takeDur) {
                        targetTakeIndex = i;
                        targetTimeInTake = targetGlobalTime - accumulated;
                        break;
                    }
                    accumulated += takeDur;
                }

                if (targetTakeIndex >= takes.length) {
                    targetTakeIndex = Math.max(0, takes.length - 1);
                    if (takes.length > 0) {
                        const lastT = takes[targetTakeIndex];
                        const lastDur = lastT.trim.end - lastT.trim.start;
                        targetTimeInTake = Math.min(lastDur, targetGlobalTime - accumulated + lastDur);
                    }
                }

                pendingSeekTimeRef.current = targetTimeInTake;
                setStandaloneTakeIndex(null);
                setCurrentTakeIndex(targetTakeIndex);
                setCurrentTimeInTake(targetTimeInTake);
                setAudioTime(targetGlobalTime);

                if (audioMasterRef.current) audioMasterRef.current.currentTime = targetGlobalTime;

                if (targetTakeIndex === currentTakeIndex) {
                    const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
                    if (vid && takes[targetTakeIndex]?.type === 'video') {
                        vid.currentTime = takes[targetTakeIndex].trim.start + targetTimeInTake;
                    }
                    pendingSeekTimeRef.current = null;
                }
            },
            [totalDuration, takes, currentTakeIndex, activeVideo]
        );

        const handleScrubStart = useCallback(
            (e: React.MouseEvent<HTMLDivElement>) => {
                e.preventDefault();
                isScrubbingRef.current = true;
                wasPlayingBeforeScrubRef.current = isPlaying;
                if (isPlaying) pause();
                seekToClientX(e.clientX);

                const handleScrubMove = (ev: MouseEvent) => {
                    if (!isScrubbingRef.current) return;
                    seekToClientX(ev.clientX);
                };

                const handleScrubEnd = () => {
                    isScrubbingRef.current = false;
                    window.removeEventListener('mousemove', handleScrubMove);
                    window.removeEventListener('mouseup', handleScrubEnd);
                    if (wasPlayingBeforeScrubRef.current) {
                        play();
                    }
                };

                window.addEventListener('mousemove', handleScrubMove);
                window.addEventListener('mouseup', handleScrubEnd);
            },
            [isPlaying, pause, play, seekToClientX]
        );

        const seekToTakeStart = useCallback(
            (index: number) => {
                if (!takes[index]) return;
                stopAll();
                const targetGlobalTime = takes
                    .slice(0, index)
                    .reduce((total, take) => total + Math.max(0, take.trim.end - take.trim.start), 0);
                const outsideFinalTimeline = targetGlobalTime >= totalDuration - 0.001;

                pendingSeekTimeRef.current = 0;
                setStandaloneTakeIndex(outsideFinalTimeline ? index : null);
                setCurrentTakeIndex(index);
                setCurrentTimeInTake(0);
                setAudioTime(targetGlobalTime);
                if (!outsideFinalTimeline && audioMasterRef.current) {
                    audioMasterRef.current.currentTime = targetGlobalTime;
                }

                if (index === currentTakeIndex) {
                    const video = activeVideo === 1 ? videoRef1.current : videoRef2.current;
                    if (video && takes[index].type === 'video') video.currentTime = takes[index].trim.start;
                    pendingSeekTimeRef.current = null;
                }
            },
            [activeVideo, currentTakeIndex, stopAll, takes, totalDuration]
        );

        useImperativeHandle(ref, () => ({
            getCurrentTime: () => Math.max(0, Math.min(totalDuration, Math.max(globalTime, audioTime))),
            seekToTake: seekToTakeStart,
            seekToTime: seekToGlobalTime,
            previewRange,
            extractFrameSync: async (
                globalTime: number,
                isAlphaExport = false,
                targetWArg?: number,
                targetHArg?: number
            ): Promise<HTMLCanvasElement | null> => {
                if (totalDuration <= 0 || takes.length === 0) return null;

                // Em modo freeze/gravação ignoramos o watchdog de play
                stopAll();
                const targetGlobalTime = Math.max(0, Math.min(globalTime, totalDuration));

                let accumulated = 0;
                let targetTakeIndex = 0;
                let targetTimeInTake = 0;

                for (let i = 0; i < takes.length; i++) {
                    const takeDur = takes[i].trim.end - takes[i].trim.start;
                    if (targetGlobalTime < accumulated + takeDur) {
                        targetTakeIndex = i;
                        targetTimeInTake = targetGlobalTime - accumulated;
                        break;
                    }
                    accumulated += takeDur;
                }

                if (targetTakeIndex >= takes.length) {
                    targetTakeIndex = Math.max(0, takes.length - 1);
                    const lastDur = takes[targetTakeIndex].trim.end - takes[targetTakeIndex].trim.start;
                    targetTimeInTake = lastDur;
                }

                // Force local react states immediately so UI might catch up if needed
                flushSync(() => {
                    if (isAlphaExport && !isExportingFrame) setIsExportingFrame(true);
                    setCurrentTakeIndex(targetTakeIndex);
                    setCurrentTimeInTake(targetTimeInTake);
                    setAudioTime(targetGlobalTime);
                });

                const take = takes[targetTakeIndex];
                if (!take) return null;

                // Use an offscreen video specifically for export to prevent React state sync bugs
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                if (!w._exportVideoPlayer) {
                    w._exportVideoPlayer = document.createElement('video');
                    w._exportVideoPlayer.crossOrigin = 'anonymous';
                    w._exportVideoPlayer.muted = true;
                    w._exportVideoPlayer.playsInline = true;
                }
                const vid = w._exportVideoPlayer;

                // Sync audio master position for UI dependencies (captions)
                if (audioMasterRef.current) audioMasterRef.current.currentTime = targetGlobalTime;

                // Antes caía em localhost:3000 — porta errada, o servidor é o 3301.
                const API_BASE = API_BASE_URL;
                const getProxiedUrl = (rawUrl: string) => {
                    if (rawUrl.startsWith('http') && !rawUrl.includes('localhost') && !rawUrl.includes('127.0.0.1')) {
                        const cleanBase = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;
                        return `${cleanBase}/proxy?url=${encodeURIComponent(rawUrl)}`;
                    }
                    return rawUrl;
                };

                const fetchAsBlobUrl = async (url: string) => {
                    // Caching em memória para evitar baixar o vídeo 90 vezes seguidas no for-loop
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const w = window as any;
                    w._domCaptureBlobCache = w._domCaptureBlobCache || {};
                    if (w._domCaptureBlobCache[url]) return w._domCaptureBlobCache[url];

                    const proxied = getProxiedUrl(url);
                    const res = await fetch(proxied);
                    if (!res.ok) throw new Error('Falha no proxy ao baixar blob de ' + url);
                    const blob = await res.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    w._domCaptureBlobCache[url] = objectUrl;
                    return objectUrl;
                };

                const rawSrc = playbackSourceFor(take);

                if (!isAlphaExport) {
                    const src = await fetchAsBlobUrl(rawSrc);

                    if (!vid.src.endsWith(src)) {
                        vid.src = src;
                        vid.load();
                        // Wait for metadata to ensure videoWidth/videoHeight are available before seeking
                        if (vid.readyState < 1) {
                            await new Promise<void>((resolve) => {
                                const onLoaded = () => {
                                    vid.removeEventListener('loadedmetadata', onLoaded);
                                    resolve();
                                };
                                vid.addEventListener('loadedmetadata', onLoaded);
                                setTimeout(onLoaded, 1000);
                            });
                        }
                    }

                    const targetLocalTime = take.trim.start + targetTimeInTake;
                    if (take.type === 'video') {
                        if (Math.abs(vid.currentTime - targetLocalTime) > 0.01 || vid.readyState < 2) {
                            await new Promise<void>((resolve) => {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                let timeoutId: any = null;
                                const onSeeked = () => {
                                    if (timeoutId) clearTimeout(timeoutId);
                                    vid.removeEventListener('seeked', onSeeked);
                                    resolve();
                                };
                                vid.addEventListener('seeked', onSeeked);
                                vid.currentTime = targetLocalTime;

                                // 1000ms timeout for offline rendering. Quality > Speed.
                                timeoutId = setTimeout(() => {
                                    onSeeked();
                                }, 1000);
                            });

                            // Aguarda a GPU decodificar o frame — usa requestVideoFrameCallback se disponível
                            // (event-based, ~1 frame de latência) com fallback de 20ms.
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const vidAny = vid as any;
                            if (typeof vidAny.requestVideoFrameCallback === 'function') {
                                await new Promise<void>((resolve) => {
                                    let done = false;
                                    vidAny.requestVideoFrameCallback(() => {
                                        if (!done) {
                                            done = true;
                                            resolve();
                                        }
                                    });
                                    setTimeout(() => {
                                        if (!done) {
                                            done = true;
                                            resolve();
                                        }
                                    }, 100);
                                });
                            } else {
                                await new Promise((r) => setTimeout(r, 20));
                            }
                        } else {
                            vid.currentTime = targetLocalTime;
                        }
                    }
                }

                // Short breath for React to re-render overlays (captions/titles) with new audioTime

                // Use auto-detected target resolution from caller (matches output) — fallback 1080×1920
                const TARGET_W = targetWArg && targetWArg > 0 ? targetWArg : 1080;
                const TARGET_H = targetHArg && targetHArg > 0 ? targetHArg : 1920;
                const canvas = document.createElement('canvas');
                canvas.width = TARGET_W;
                canvas.height = TARGET_H;
                const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

                const drawMediaWithMotion = (
                    source: CanvasImageSource,
                    drawX: number,
                    drawY: number,
                    drawW: number,
                    drawH: number
                ) => {
                    const progress = normalizedTakeProgress(take, targetTimeInTake);
                    const scale = takeMotionScale(take.motionEffect, progress);
                    const focusX = TARGET_W * ((take.motionEffect?.focalX ?? 50) / 100);
                    const focusY = TARGET_H * ((take.motionEffect?.focalY ?? 50) / 100);
                    ctx.save();
                    ctx.translate(focusX, focusY);
                    ctx.scale(scale, scale);
                    ctx.translate(-focusX, -focusY);
                    ctx.drawImage(source, drawX, drawY, drawW, drawH);
                    ctx.restore();
                };

                // Background & Takes
                if (!isAlphaExport) {
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, TARGET_W, TARGET_H);

                    if (take.type === 'video') {
                        const vidW = vid.videoWidth;
                        const vidH = vid.videoHeight;
                        if (vidW > 0 && vidH > 0) {
                            // Use object-cover (Math.max) to fill the frame without black bars
                            const ratioW = TARGET_W / vidW;
                            const ratioH = TARGET_H / vidH;
                            const scale = Math.max(ratioW, ratioH);

                            const drawW = vidW * scale;
                            const drawH = vidH * scale;
                            const drawX = (TARGET_W - drawW) / 2;
                            const drawY = (TARGET_H - drawH) / 2;

                            drawMediaWithMotion(vid, drawX, drawY, drawW, drawH);
                        }
                    } else if (take.type === 'image') {
                        const img = new Image();
                        img.crossOrigin = 'anonymous';
                        const proxiedImageSrc = await fetchAsBlobUrl(rawSrc);
                        await new Promise((res, rej) => {
                            img.onload = res;
                            img.onerror = rej;
                            img.src = proxiedImageSrc;
                        });

                        const imgW = img.naturalWidth;
                        const imgH = img.naturalHeight;
                        if (imgW > 0 && imgH > 0) {
                            const ratioW = TARGET_W / imgW;
                            const ratioH = TARGET_H / imgH;
                            const scale = Math.max(ratioW, ratioH);
                            const drawW = imgW * scale;
                            const drawH = imgH * scale;
                            const drawX = (TARGET_W - drawW) / 2;
                            const drawY = (TARGET_H - drawH) / 2;

                            drawMediaWithMotion(img, drawX, drawY, drawW, drawH);
                        }
                    }
                } else {
                    // Modo de Exportação Alpha (Legendagem Híbrida):
                    // Limpa totalmente os pixels RGBA pra extrair títulos brilhantes no Edge/Chrome.
                    ctx.clearRect(0, 0, TARGET_W, TARGET_H);
                }

                // ━━━ Phase 2.5: Transition Overlay ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                if (!isAlphaExport) {
                    // Check if we're in a transition zone (near the end of a take)
                    const takeDuration = take.trim.end - take.trim.start;
                    const timeRemainingInTake = takeDuration - targetTimeInTake;
                    const activeTransition = take.transition?.asset || adData.globalTransition;

                    if (activeTransition && targetTakeIndex < takes.length - 1) {
                        const halfTransition = activeTransition.durationSec / 2;

                        if (timeRemainingInTake <= halfTransition && timeRemainingInTake >= 0) {
                            try {
                                // Calculate how far into the transition we are
                                const transitionProgress = halfTransition - timeRemainingInTake;
                                const tUrl = `${API_BASE_URL}${activeTransition.publicUrl}`;
                                const transitionBlobUrl = await fetchAsBlobUrl(tUrl);

                                const tVid = transitionRef.current || document.createElement('video');
                                if (!tVid.src.endsWith(transitionBlobUrl)) {
                                    tVid.src = transitionBlobUrl;
                                    tVid.load();
                                    // Wait for metadata like we do for primary video
                                    if (tVid.readyState < 1) {
                                        await new Promise<void>((resolve) => {
                                            const onLoaded = () => {
                                                tVid.removeEventListener('loadedmetadata', onLoaded);
                                                resolve();
                                            };
                                            tVid.addEventListener('loadedmetadata', onLoaded);
                                            setTimeout(onLoaded, 1000);
                                        });
                                    }
                                }
                                tVid.muted = true;

                                // Wait for seek precisely
                                if (Math.abs(tVid.currentTime - transitionProgress) > 0.01 || tVid.readyState < 2) {
                                    await new Promise<void>((resolve) => {
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        let timeoutId: any = null;
                                        const onSeeked = () => {
                                            if (timeoutId) clearTimeout(timeoutId);
                                            tVid.removeEventListener('seeked', onSeeked);
                                            resolve();
                                        };
                                        tVid.addEventListener('seeked', onSeeked);
                                        tVid.currentTime = transitionProgress;
                                        timeoutId = setTimeout(() => onSeeked(), 1000);
                                    });

                                    // Aguarda a GPU decodificar o frame da transição.
                                    await new Promise((r) => setTimeout(r, 80));
                                } else {
                                    tVid.currentTime = transitionProgress;
                                }

                                // Draw with 'screen' blend mode — matching the CSS mixBlendMode: 'screen'
                                ctx.globalCompositeOperation = 'screen';

                                // Scale transition to Cover the main frame, ensuring no empty margins break the screen blend
                                const tvW = tVid.videoWidth;
                                const tvH = tVid.videoHeight;
                                if (tvW > 0 && tvH > 0) {
                                    const ratioW = TARGET_W / tvW;
                                    const ratioH = TARGET_H / tvH;
                                    const scale = Math.max(ratioW, ratioH);
                                    const drawW = tvW * scale;
                                    const drawH = tvH * scale;
                                    const drawX = (TARGET_W - drawW) / 2;
                                    const drawY = (TARGET_H - drawH) / 2;

                                    ctx.drawImage(tVid, drawX, drawY, drawW, drawH);
                                } else {
                                    ctx.drawImage(tVid, 0, 0, TARGET_W, TARGET_H);
                                }

                                ctx.globalCompositeOperation = 'source-over'; // Reset
                            } catch (transErr) {
                                console.warn('[DOMCapture] Falha ao capturar transição:', transErr);
                            }
                        }
                    }
                }

                // ━━━ Phase 3: Overlay Capture (Captions + Titles) ━━━━━━━━━━━━━━━━━
                if (overlayContainerRef.current) {
                    try {
                        const node = overlayContainerRef.current;
                        const clientW = node.offsetWidth || 360;
                        const scaleRatio = TARGET_W / clientW;

                        // Espera TODAS as fontes terminarem de carregar antes de capturar
                        // (senão o snapshot sai com fonte fallback).
                        try {
                            await document.fonts.ready;
                        } catch {
                            /* ignore */
                        }
                        // Embed determinístico: usa NOSSAS fontes locais (data-URI, mesma origem) direto,
                        // em vez do getFontEmbedCSS do html-to-image (que buscava do Google e falhava).
                        overlayFontCssRef.current = selfHostedFontCss;

                        const overlayCanvas = await toCanvas(node, {
                            width: TARGET_W,
                            height: TARGET_H,
                            pixelRatio: 1,
                            style: {
                                transform: `scale(${scaleRatio})`,
                                transformOrigin: 'top left',
                                width: `${clientW}px`,
                                height: `${node.offsetHeight || 640}px`,
                            },
                            backgroundColor: 'rgba(0,0,0,0)',
                            skipFonts: false,
                            fontEmbedCSS: overlayFontCssRef.current || undefined,
                            cacheBust: false,
                            filter: (element) =>
                                !(element instanceof HTMLElement && element.dataset.titleEditorUi === 'true'),
                        });
                        ctx.drawImage(overlayCanvas, 0, 0, TARGET_W, TARGET_H);
                    } catch (overlayErr) {
                        console.warn('[DOMCapture] Falha ao capturar overlays (texto/legenda):', overlayErr);
                    }
                }

                return canvas;
            },
        }));

        // ─── Formatting ─────────────────────────────────────────────────────
        const formatTime = (s: number) => {
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            return `${m}:${sec.toString().padStart(2, '0')}`;
        };

        const displayDuration =
            isStandaloneTakePreview && currentTake
                ? Math.max(0, currentTake.trim.end - currentTake.trim.start)
                : totalDuration;
        const displayTime = isStandaloneTakePreview
            ? Math.min(displayDuration, Math.max(0, currentTimeInTake))
            : Math.min(totalDuration, Math.max(globalTime, audioTime));

        // Progress calculation (approximate)
        const progressPercent = displayDuration > 0 ? (displayTime / displayDuration) * 100 : 0;

        return (
            <div
                className={cn(
                    'bg-brand-card border border-black/5 dark:border-white/5 rounded-3xl overflow-hidden flex flex-col shadow-2xl',
                    compactViewport && 'mx-auto max-w-full'
                )}
                style={
                    compactViewport
                        ? {
                              width:
                                  compactViewportWidth || (adData.format === '1:1'
                                       ? 'min(100%, clamp(290px, calc(100dvh - 440px), 420px))'
                                      : 'min(100%, clamp(168.75px, calc((100dvh - 430px) * 0.5625), 247.5px))'),
                          }
                        : undefined
                }
            >
                <svg aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
                    <filter id={enhancementFilterId} colorInterpolationFilters="sRGB">
                        <feConvolveMatrix
                            order="3"
                            kernelMatrix={sharpnessKernel(currentSharpness)}
                            divisor="1"
                            bias="0"
                            targetX="1"
                            targetY="1"
                            edgeMode="duplicate"
                            preserveAlpha="true"
                        />
                    </filter>
                </svg>
                {/* Header */}
                {!hideControls && (
                    <div className="flex items-center justify-between px-5 py-3 border-b border-black/5 dark:border-white/5 bg-background shadow-inner z-10">
                        <span className="text-[10px] font-bold text-foreground tracking-widest uppercase flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-brand-accent shadow-[0_0_8px_rgba(0,230,118,0.8)] animate-pulse"></span>
                            Monitor de Corte
                        </span>
                        {showHeaderMute && (
                            <button
                                onClick={() => onMuteAll(!allMuted)}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
                                    allMuted
                                        ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.1)]'
                                        : 'hover:bg-black/5 dark:bg-white/5 text-brand-muted hover:text-foreground border border-transparent'
                                )}
                                title={allMuted ? 'Ativar áudio de todos' : 'Mutar todos os takes'}
                            >
                                {allMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                {allMuted ? 'Mudos' : 'Mutar Todos'}
                            </button>
                        )}
                    </div>
                )}

                {/* Video Area */}
                <div
                    ref={videoAreaRef}
                    className={cn(
                        'relative w-full flex items-center justify-center overflow-hidden group/video shadow-inner cursor-pointer',
                        compactViewport
                            ? adData.format === '1:1'
                                ? 'aspect-square'
                                : 'aspect-[9/16]'
                            : adData.format === '1:1'
                              ? 'aspect-square mx-auto max-w-[420px]'
                              : 'aspect-[9/16]',
                        isHybridMode ? 'bg-transparent' : 'bg-brand-dark'
                    )}
                    style={{ aspectRatio: adData.format === '1:1' ? '1 / 1' : '9 / 16' }}
                    onClick={() => {
                        if (captionEditingEnabled) setCaptionSelected(false);
                        if (isPlaying) pause();
                    }}
                >
                    {!currentTake && !isHybridMode && (
                        <div className="absolute inset-0 z-10 grid place-items-center bg-[radial-gradient(circle_at_50%_38%,rgba(0,230,118,.08),transparent_48%)]">
                            <div className="flex max-w-[220px] flex-col items-center gap-3 px-6 text-center">
                                <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/8 bg-white/[0.035] text-brand-muted/55 shadow-inner">
                                    <VideoOff className="h-6 w-6" />
                                </div>
                                <div>
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-foreground/75">
                                        Monitor vazio
                                    </p>
                                    <p className="mt-1 text-[10px] leading-relaxed text-brand-muted/55">
                                        Adicione um take para visualizar a sequência.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Native Video Elements for Double Buffering */}
                    <div
                        ref={motionLayerRef1}
                        className={cn(
                            'absolute inset-0 h-full w-full',
                            !currentTake || isHybridMode || isImageTake || activeVideo !== 1
                                ? 'opacity-0 pointer-events-none'
                                : 'opacity-100'
                        )}
                        style={{
                            transformOrigin: currentMotionOrigin,
                            filter: currentEnhancementFilter,
                            willChange: currentTake?.motionEffect ? 'transform' : 'auto',
                            backfaceVisibility: 'hidden',
                            transformStyle: 'preserve-3d',
                            contain: 'layout paint',
                            isolation: 'isolate',
                        }}
                    >
                        <canvas
                            ref={motionCanvasRef1}
                            aria-hidden="true"
                            className={cn(
                                'pointer-events-none absolute inset-0 z-[1] h-full w-full transition-none',
                                isCanvasMotionPreviewReady && activeVideo === 1 ? 'opacity-100' : 'opacity-0'
                            )}
                            style={{ display: 'block', backfaceVisibility: 'hidden', transform: 'translate3d(0,0,0)' }}
                        />
                        <video
                            ref={videoRef1}
                            crossOrigin="anonymous"
                            className={cn(
                                'absolute inset-0 h-full w-full',
                                currentTake?.objectFit === 'contain' ? 'object-contain' : 'object-cover'
                            )}
                            style={{
                                display: 'block',
                                backfaceVisibility: 'hidden',
                                opacity: isCanvasMotionPreviewReady && activeVideo === 1 ? 0 : 1,
                            }}
                            playsInline
                            preload="auto"
                            onWaiting={() => {
                                if (activeVideo === 1) {
                                    beginBuffering();
                                }
                            }}
                            onPlaying={() => {
                                if (activeVideo === 1) {
                                    finishBuffering();
                                }
                            }}
                            onError={() => {
                                if (activeVideo === 1 && currentTake?.type === 'video') {
                                    void repairUnsupportedLocalVideo(currentTake);
                                }
                            }}
                        />
                    </div>

                    <div
                        ref={motionLayerRef2}
                        className={cn(
                            'absolute inset-0 h-full w-full',
                            !currentTake || isHybridMode || isImageTake || activeVideo !== 2
                                ? 'opacity-0 pointer-events-none'
                                : 'opacity-100'
                        )}
                        style={{
                            transformOrigin: currentMotionOrigin,
                            filter: currentEnhancementFilter,
                            willChange: currentTake?.motionEffect ? 'transform' : 'auto',
                            backfaceVisibility: 'hidden',
                            transformStyle: 'preserve-3d',
                            contain: 'layout paint',
                            isolation: 'isolate',
                        }}
                    >
                        <canvas
                            ref={motionCanvasRef2}
                            aria-hidden="true"
                            className={cn(
                                'pointer-events-none absolute inset-0 z-[1] h-full w-full transition-none',
                                isCanvasMotionPreviewReady && activeVideo === 2 ? 'opacity-100' : 'opacity-0'
                            )}
                            style={{ display: 'block', backfaceVisibility: 'hidden', transform: 'translate3d(0,0,0)' }}
                        />
                        <video
                            ref={videoRef2}
                            crossOrigin="anonymous"
                            className={cn(
                                'absolute inset-0 h-full w-full',
                                currentTake?.objectFit === 'contain' ? 'object-contain' : 'object-cover'
                            )}
                            style={{
                                display: 'block',
                                backfaceVisibility: 'hidden',
                                opacity: isCanvasMotionPreviewReady && activeVideo === 2 ? 0 : 1,
                            }}
                            playsInline
                            preload="auto"
                            onWaiting={() => {
                                if (activeVideo === 2) {
                                    beginBuffering();
                                }
                            }}
                            onPlaying={() => {
                                if (activeVideo === 2) {
                                    finishBuffering();
                                }
                            }}
                            onError={() => {
                                if (activeVideo === 2 && currentTake?.type === 'video') {
                                    void repairUnsupportedLocalVideo(currentTake);
                                }
                            }}
                        />
                    </div>

                    {/* Transition Overlay (Ghost Player) */}
                    <video
                        ref={transitionRef}
                        className={cn(
                            'absolute top-0 left-0 w-full h-full object-contain pointer-events-none z-20',
                            isHybridMode ? 'opacity-0' : activeTransitionUrl ? 'opacity-100' : 'opacity-0'
                        )}
                        crossOrigin="anonymous"
                        style={{ mixBlendMode: 'screen' }} // The magic happens here!
                        playsInline
                        preload="auto"
                        onEnded={() => {
                            setActiveTransitionUrl(null); // Hide when done
                            transitionTriggeredRef.current = false;
                        }}
                    />

                    {/* Buffering Spinner */}
                    {showBufferingSpinner && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-transparent">
                            <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        </div>
                    )}

                    {/* Image Element for Image Takes */}
                    {isImageTake && currentTake && (
                        <div
                            ref={motionImageLayerRef}
                            className={cn('h-full w-full', isHybridMode && 'opacity-0')}
                            style={{
                                transformOrigin: currentMotionOrigin,
                                filter: currentEnhancementFilter,
                                willChange: currentTake?.motionEffect ? 'transform' : 'auto',
                                backfaceVisibility: 'hidden',
                                transformStyle: 'preserve-3d',
                                contain: 'layout paint',
                                isolation: 'isolate',
                            }}
                        >
                            <img
                                src={playbackSourceFor(currentTake)}
                                className={cn(
                                    'h-full w-full',
                                    currentTake.objectFit === 'contain' ? 'object-contain' : 'object-cover'
                                )}
                                style={{ display: 'block', backfaceVisibility: 'hidden' }}
                                crossOrigin="anonymous"
                                alt="Preview"
                            />
                        </div>
                    )}

                    {/* Hidden Audio Elements */}
                    <audio
                        ref={audioMasterRef}
                        crossOrigin="anonymous"
                        preload="auto"
                        onError={(e) => {
                            const audio = e.currentTarget as HTMLAudioElement;
                            const code = audio?.error?.code;
                            const msg = audio?.error?.message || 'unknown';
                            console.error(`[audio-master] Load error code=${code} msg=${msg} src=${audio?.src}`);
                            toast.error('Áudio master falhou ao carregar.', { duration: 3000 });
                        }}
                    />

                    {/* ━━━ Overlay Container for Export Capture (Captions + Titles) ━━━ */}
                    <div
                        className="pointer-events-none absolute inset-0 flex items-start justify-center overflow-hidden"
                        style={{ zIndex: 30 }}
                    >
                        <div
                            ref={overlayContainerRef}
                            className="relative shrink-0 pointer-events-none"
                            style={{
                                width: `${OVERLAY_DESIGN_WIDTH}px`,
                                height: `${overlayDesignHeight}px`,
                                transform: `scale(${overlayPreviewScale})`,
                                transformOrigin: 'top center',
                            }}
                        >
                            {captions?.segments && (
                                <div
                                    className={cn(
                                        'absolute inset-x-0 flex items-center justify-center pointer-events-none z-30 px-6',
                                        isHybridMode ? 'transition-none duration-0' : 'transition-all duration-200'
                                    )}
                                    style={{ bottom: `${captionStyle?.verticalPosition ?? 23}%` }}
                                >
                                    {(() => {
                                        const activeSegment = captions.segments.find(
                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                            (s: any) => audioTime >= s.start && audioTime <= s.end
                                        );
                                        if (!activeSegment || !activeSegment.words) return null;

                                        const renderedCaption = (
                                            <div
                                                className="font-black text-center tracking-wide leading-[1.2] flex flex-wrap justify-center drop-shadow-2xl px-4"
                                                style={{
                                                    fontFamily: captionStyle?.fontFamily || 'Montserrat',
                                                    fontSize: captionStyle?.fontSize
                                                        ? `${captionStyle.fontSize}px`
                                                        : '20px',
                                                    WebkitTextStroke: `${captionStyle?.strokeWidth ?? 1}px ${captionStyle?.strokeColor || 'black'}`,
                                                    paintOrder: 'stroke fill',
                                                    textShadow: '0px 6px 12px rgba(0,0,0,0.8)',
                                                    textTransform: captionStyle?.textCase === 'lowercase' ? 'lowercase' : 'uppercase',
                                                }}
                                            >
                                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                {activeSegment.words.map((w: any, index: number) => {
                                                    // Extend the "active" window slightly if it's the last word or there's a tiny gap
                                                    const nextStart =
                                                        activeSegment.words[index + 1]?.start || activeSegment.end;
                                                    const isActive = audioTime >= w.start && audioTime < nextStart;

                                                    return (
                                                        <span
                                                            key={index}
                                                            className={cn(
                                                                'mx-1.5',
                                                                isHybridMode
                                                                    ? 'transition-none duration-0'
                                                                    : 'transition-all duration-75 ease-out',
                                                                isActive ? 'scale-110 -translate-y-1 z-10' : ''
                                                            )}
                                                            style={{
                                                                color: isActive
                                                                    ? captionStyle?.activeColor || '#FFEA00'
                                                                    : captionStyle?.baseColor || '#FFFFFF',
                                                            }}
                                                        >
                                                            {w.text}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        );

                                        if (!captionStyle) return renderedCaption;

                                        return (
                                            <EditableCaptionOverlay
                                                style={captionStyle}
                                                selected={captionSelected && !isExportingFrame}
                                                editingEnabled={
                                                    captionEditingEnabled && Boolean(onCaptionStyleChange) && !isExportingFrame
                                                }
                                                designHeight={overlayDesignHeight}
                                                previewScale={overlayPreviewScale}
                                                onSelect={() => {
                                                    if (isPlaying) pause();
                                                    setCaptionSelected(true);
                                                }}
                                                onChange={(updates) => onCaptionStyleChange?.(updates)}
                                            >
                                                {renderedCaption}
                                            </EditableCaptionOverlay>
                                        );
                                    })()}
                                </div>
                            )}
                            {/* Dynamic Titles Overlay */}
                            {(() => {
                                // Helper function to animate titles based on exact timeline seconds, perfectly sync'd with exporting fps.
                                const getInlineAnimationStyles = (
                                    animId: string,
                                    timeElapsed: number,
                                    isExiting: boolean,
                                    timeRemaining: number
                                ): React.CSSProperties => {
                                    if (animId === 'none') return {};

                                    if (animId === 'blink') {
                                        const entrance = Math.min(1, Math.max(0, timeElapsed / 0.12));
                                        const pulse = 0.28 + 0.72 * ((Math.sin(timeElapsed * Math.PI * 4) + 1) / 2);
                                        const exit = isExiting ? Math.min(1, Math.max(0, timeRemaining / 0.35)) : 1;
                                        return {
                                            opacity: entrance * pulse * exit,
                                            transform: `scale(${0.98 + pulse * 0.02})`,
                                            filter: `brightness(${0.9 + pulse * 0.25})`,
                                        };
                                    }

                                    const animDuration = animId === 'pop' ? 0.25 : 0.4; // Impact agora em 0.25s snap

                                    // Entrance Animation
                                    if (!isExiting) {
                                        if (timeElapsed >= animDuration)
                                            return { transform: 'scale(1)', opacity: 1, left: '0px' };
                                        const progress = timeElapsed / animDuration; // 0 to 1

                                        if (animId === 'fade') {
                                            return { opacity: progress };
                                        } else if (animId === 'slide') {
                                            return {
                                                transform: `translateX(${-50 * (1 - progress)}px)`,
                                                opacity: progress,
                                            };
                                        } else if (animId === 'pop') {
                                            // Pop In (Impacto ultra-rápido): 0% -> 60% dá stretch pra 1.15x
                                            if (progress < 0.6) {
                                                const p = progress / 0.6;
                                                return { transform: `scale(${0.5 + p * 0.65})`, opacity: p };
                                            } else {
                                                const p = (progress - 0.6) / 0.4;
                                                return { transform: `scale(${1.15 - p * 0.15})`, opacity: 1 };
                                            }
                                        }
                                    }
                                    // Exit Animation
                                    else {
                                        if (timeRemaining >= animDuration)
                                            return { transform: 'scale(1)', opacity: 1, left: '0px' };
                                        const progress = 1 - timeRemaining / animDuration; // 0 to 1 exiting

                                        if (animId === 'fade') {
                                            return { opacity: 1 - progress };
                                        } else if (animId === 'slide') {
                                            return {
                                                transform: `translateX(${-50 * progress}px)`,
                                                opacity: 1 - progress,
                                            };
                                        } else if (animId === 'pop') {
                                            // Pop Out: 0% -> 40% infla pra 1.15, depois murcha até 0.5
                                            if (progress < 0.4) {
                                                const p = progress / 0.4;
                                                return { transform: `scale(${1.0 + p * 0.15})`, opacity: 1 };
                                            } else {
                                                const p = (progress - 0.4) / 0.6;
                                                return { transform: `scale(${1.15 - p * 0.65})`, opacity: 1 - p };
                                            }
                                        }
                                    }
                                    return {};
                                };

                                return dynamicTitles.filter((title) => title.isActive).map((title) => {
                                    if (
                                        audioTime >= title.startSec &&
                                        audioTime <= title.startSec + title.durationSec
                                    ) {
                                        const animId = title.animationId || 'pop';
                                        const timeRemaining = title.startSec + title.durationSec - audioTime;
                                        const isExiting = timeRemaining <= 0.5 && animId !== 'none';
                                        const timeElapsed = audioTime - title.startSec;

                                        const inlineStyles = getInlineAnimationStyles(
                                            animId,
                                            timeElapsed,
                                            isExiting,
                                            timeRemaining
                                        );

                                        return (
                                            <EditableTitleOverlay
                                                key={`${title.id}-${animId}`}
                                                title={title}
                                                selected={selectedTitleId === title.id}
                                                editingEnabled={
                                                    !!onTitleTransformChange && !isHybridMode && !isExportingFrame
                                                }
                                                onSelect={onTitleSelect}
                                                onChange={onTitleTransformChange}
                                                onDelete={onTitleDelete}
                                                captionSafeTopPct={titleCaptionSafeTop}
                                            >
                                                <div className="origin-center" style={inlineStyles}>
                                                    <DynamicTitleRenderer
                                                        title={title}
                                                        timeElapsed={timeElapsed}
                                                        isHybridMode={isHybridMode || isExportingFrame}
                                                    />
                                                </div>
                                            </EditableTitleOverlay>
                                        );
                                    }
                                    return null;
                                });
                            })()}
                            {/* Custom Image/Logo Overlay */}
                            {adData.customOverlayUrl && (
                                <div className="absolute inset-x-0 top-[5%] flex justify-center pointer-events-none z-50">
                                    <img
                                        src={adData.customOverlayUrl}
                                        alt="Overlay Img"
                                        className="max-w-[70%] max-h-[15vh] object-contain drop-shadow-[0_0_15px_rgba(0,0,0,0.5)]"
                                        crossOrigin="anonymous"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Big Play Button Overlay */}
                    {!isPlaying && (
                        <button
                            onClick={play}
                            className="absolute inset-0 z-10 flex items-center justify-center bg-brand-dark/40 hover:bg-brand-dark/60 transition-colors backdrop-blur-[1px]"
                        >
                            <div className="w-16 h-16 bg-brand-accent/20 backdrop-blur-md border border-brand-accent/40 rounded-full flex items-center justify-center hover:scale-110 transition-transform shadow-[0_0_30px_rgba(0,230,118,0.2)]">
                                <Play className="w-8 h-8 text-brand-accent ml-1.5 drop-shadow-[0_0_8px_rgba(0,230,118,0.8)]" />
                            </div>
                        </button>
                    )}

                    {/* Debug Mode HUD Overlay */}
                    {isDebugMode && (
                        <div className="absolute inset-0 z-50 pointer-events-none flex flex-col">
                            {/* Grid Lines */}
                            <div className="absolute inset-0 grid grid-cols-10 grid-rows-10 pointer-events-none opacity-20">
                                {Array.from({ length: 100 }).map((_, i) => (
                                    <div key={i} className="border-[0.5px] border-green-500/50" />
                                ))}
                            </div>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-px h-full bg-red-500/50" />
                                <div className="h-px w-full bg-red-500/50 absolute" />
                            </div>

                            {/* Stats HUD */}
                            <div className="absolute top-2 left-2 bg-black/80 text-green-400 font-mono text-[9px] p-2 rounded border border-green-500/30 flex flex-col gap-0.5 backdrop-blur-md">
                                <span className="text-foreground font-bold border-b border-green-500/30 pb-0.5 mb-0.5">
                                    DEV PARITY HUD
                                </span>
                                <span>TARGET: 720x1280 (16:9)</span>
                                <span>T_AUDIO: {audioTime.toFixed(3)}s</span>
                                <span>T_GLOBAL: {globalTime.toFixed(3)}s</span>
                                <span>TAKE_IDX: {currentTakeIndex}</span>
                                <span>T_IN_TAKE: {currentTimeInTake.toFixed(3)}s</span>
                                <span>FPS_THROTTLED: 30</span>
                                <span>RES_SCALE: cover</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Controls */}
                <div
                    className={cn(
                        'border-t border-black/5 bg-background z-10 dark:border-white/5',
                        compactViewport ? 'space-y-2.5 px-4 py-3' : 'space-y-4 px-5 py-4'
                    )}
                >
                    {/* Progress bar */}
                    <div
                        ref={progressBarRef}
                        className="group relative h-6 w-full cursor-pointer"
                        onMouseDown={handleScrubStart}
                    >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-2.5 rounded-full bg-[#8b5cf6]/10 ring-1 ring-inset ring-[#8b5cf6]/15">
                            {!isStandaloneTakePreview &&
                                displayDuration > 0 &&
                                dynamicTitles
                                    .filter((title) => title.isActive)
                                    .map((title) => {
                                        const startPercent = Math.min(
                                            100,
                                            Math.max(0, (title.startSec / displayDuration) * 100)
                                        );
                                        const rawWidth =
                                            (Math.max(0.1, title.durationSec || 0) / displayDuration) * 100;
                                        const widthPercent = Math.min(
                                            Math.max(0, 100 - startPercent),
                                            Math.max(1.25, rawWidth)
                                        );
                                        const isSelected = selectedTitleId === title.id;

                                        return (
                                            <div
                                                key={`timeline-title-${title.id}`}
                                                className={cn(
                                                    'absolute inset-y-0 z-10 rounded-sm border-x transition-all duration-200',
                                                    isSelected
                                                        ? 'border-[#fff1fb] bg-[#ff2bd6] shadow-[0_0_10px_2px_rgba(255,43,214,.9)]'
                                                        : 'border-[#eadfff] bg-[#8b5cf6] shadow-[0_0_7px_rgba(139,92,246,.7)]'
                                                )}
                                                style={{ left: `${startPercent}%`, width: `${widthPercent}%` }}
                                                title={`${title.text || 'Título'} · ${title.startSec.toFixed(1)}s–${(title.startSec + title.durationSec).toFixed(1)}s`}
                                                aria-label={`${title.text || 'Título'}: ${title.startSec.toFixed(1)}s a ${(title.startSec + title.durationSec).toFixed(1)}s`}
                                            />
                                        );
                                    })}
                        </div>

                        <div className="absolute inset-x-0 bottom-0 h-2 overflow-hidden rounded-full bg-black/5 ring-1 ring-inset ring-black/5 dark:bg-white/5 dark:ring-white/5">
                            <div
                                className="h-full bg-brand-accent/70 shadow-[0_0_10px_rgba(0,230,118,0.65)]"
                                style={{ width: `${Math.min(progressPercent, 100)}%` }}
                            />
                            <div className="pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-white/10" />
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={isPlaying ? pause : play}
                                className="w-10 h-10 flex items-center justify-center rounded-xl bg-brand-accent text-[#0a0f12] hover:bg-brand-accent/90 transition-colors shadow-[0_0_15px_rgba(0,230,118,0.3)]"
                            >
                                {isPlaying ? (
                                    <Pause className="w-5 h-5 fill-current" />
                                ) : (
                                    <Play className="w-5 h-5 ml-1 fill-current" />
                                )}
                            </button>
                            <button
                                onClick={restart}
                                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/5 dark:bg-white/5 text-brand-muted hover:text-foreground transition-colors"
                                title="Reiniciar sequência completa"
                            >
                                <RotateCcw className="w-5 h-5" />
                            </button>
                        </div>
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-brand-muted">
                            <span className="text-foreground">{formatTime(displayTime)}</span> /{' '}
                            {formatTime(displayDuration)}
                        </span>
                    </div>
                </div>

                {/* Compact Take List */}
                {!hideControls && showTakeList && (
                    <div className="border-t border-black/5 dark:border-white/5 divide-y divide-white/5 max-h-[180px] overflow-y-auto bg-background/50 backdrop-blur-sm z-0 relative">
                        {takes.map((take, i) => (
                            <div
                                key={take.id}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-2.5 transition-all cursor-pointer',
                                    i === currentTakeIndex
                                        ? 'bg-brand-accent/5 border-l-[3px] border-brand-accent'
                                        : 'hover:bg-black/5 dark:bg-white/5 border-l-[3px] border-transparent'
                                )}
                                onClick={() => seekToTakeStart(i)}
                            >
                                <span
                                    className={cn(
                                        'font-mono font-bold w-5 shrink-0 text-[10px]',
                                        i === currentTakeIndex ? 'text-brand-accent opacity-80' : 'text-brand-muted/40'
                                    )}
                                >
                                    {(i + 1).toString().padStart(2, '0')}
                                </span>
                                {i === currentTakeIndex && isPlaying && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse shrink-0 shadow-[0_0_5px_rgba(0,230,118,0.8)]" />
                                )}
                                <span
                                    className={cn(
                                        'truncate flex-1 font-semibold text-xs tracking-wide',
                                        i === currentTakeIndex ? 'text-foreground' : 'text-brand-muted/80'
                                    )}
                                >
                                    {take.fileName}
                                </span>

                                {/* Status Icons */}
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onMuteToggle(take.id);
                                        }}
                                        className={cn(
                                            'shrink-0 p-1.5 rounded-lg transition-colors border',
                                            take.muteOriginalAudio
                                                ? 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20'
                                                : 'text-brand-muted hover:text-foreground hover:bg-black/10 dark:bg-white/10 border-transparent'
                                        )}
                                        title={take.muteOriginalAudio ? 'Áudio Mudo' : 'Silenciar Mídia'}
                                    >
                                        {take.muteOriginalAudio ? (
                                            <VolumeX className="w-3.5 h-3.5" />
                                        ) : (
                                            <Volume2 className="w-3.5 h-3.5" />
                                        )}
                                    </button>
                                    {/* Speed Badge */}
                                    {take.speedPresetId && take.speedPresetId !== 'normal' && (
                                        <div
                                            className={cn(
                                                'shrink-0 p-1.5 rounded-lg transition-colors text-brand-lime bg-brand-lime/10 border border-brand-lime/20'
                                            )}
                                            title="Curva temporal aplicada"
                                        >
                                            <Zap className="w-3.5 h-3.5 drop-shadow-[0_0_5px_rgba(163,230,53,0.5)]" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
);

VideoSequencePreview.displayName = 'VideoSequencePreview';
