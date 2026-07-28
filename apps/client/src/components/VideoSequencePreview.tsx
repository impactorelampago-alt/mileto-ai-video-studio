import React, { useEffect, useRef, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { flushSync } from 'react-dom';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Loader2, Zap, VideoOff } from 'lucide-react';
import { AdData, CaptionStyle, MediaTake, TitleHook, CaptionTrack } from '../types';
import { cn } from '../lib/utils';
import { API_BASE_URL } from '../lib/apiBase';
import { useWizard } from '../context/WizardContext';
import { DynamicTitleRenderer } from './DynamicTitleRenderer';
import { getPlaybackRateForRemap } from '../lib/speedRemapping';
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import { toast } from 'sonner';
import { normalizedTakeProgress, takeMotionScale } from '../lib/takeMotion';
import { EditableTitleOverlay } from './EditableTitleOverlay';

export interface VideoSequencePreviewRef {
    seekToTime: (globalTime: number) => void;
    getCurrentTime: () => number;
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
    captions?: CaptionTrack; // Add captions prop
    dynamicTitles?: TitleHook[];
    isHybridMode?: boolean; // Propaga a intenção Híbrida p/ o extrator
    selectedTitleId?: string | null;
    onTitleSelect?: (_id: string | null) => void;
    onTitleTransformChange?: (_id: string, _updates: Partial<TitleHook>) => void;
    onTitleDelete?: (_id: string) => void;
    adDataOverride?: AdData;
    captionStyleOverride?: CaptionStyle | null;
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
            captions, // Extract captions
            dynamicTitles = [],
            isHybridMode = false, // Modo Overlay-only
            selectedTitleId = null,
            onTitleSelect,
            onTitleTransformChange,
            onTitleDelete,
            adDataOverride,
            captionStyleOverride,
            debugModeOverride,
        },
        ref
    ) => {
        const wizard = useWizard();
        const captionStyle = captionStyleOverride === undefined ? wizard.captionStyle : captionStyleOverride;
        const adData = adDataOverride || wizard.adData;
        const isDebugMode = debugModeOverride ?? wizard.isDebugMode;

        // Refs
        const videoRef1 = useRef<HTMLVideoElement>(null);
        const videoRef2 = useRef<HTMLVideoElement>(null);
        const imageTakeRef = useRef<HTMLImageElement>(null);
        const transitionRef = useRef<HTMLVideoElement>(null);
        const audioMasterRef = useRef<HTMLAudioElement>(null);
        const progressIntervalRef = useRef<number>(0);
        const motionFrameRef = useRef<number | null>(null);
        const motionVideoFrameRef = useRef<number | null>(null);
        const overlayContainerRef = useRef<HTMLDivElement>(null);
        const overlayFontCssRef = useRef<string | null>(null);

        // State
        const [isPlaying, setIsPlaying] = useState(false);
        const [isExportingFrame, setIsExportingFrame] = useState(false);
        const [currentTakeIndex, setCurrentTakeIndex] = useState(0);
        const [currentTimeInTake, setCurrentTimeInTake] = useState(0);
        const [audioTime, setAudioTime] = useState(0); // True audio time for subtitles
        const [isImageTake, setIsImageTake] = useState(false);
        const [isBuffering, setIsBuffering] = useState(false);
        const [activeVideo, setActiveVideo] = useState<1 | 2>(1);
        const [playbackSourceOverrides, setPlaybackSourceOverrides] = useState<Record<string, string>>({});
        const [activeTransitionUrl, setActiveTransitionUrl] = useState<string | null>(null);
        const pendingSeekTimeRef = useRef<number | null>(null);
        const transitionTriggeredRef = useRef<boolean>(false);
        const progressBarRef = useRef<HTMLDivElement>(null);
        const isScrubbingRef = useRef(false);
        const wasPlayingBeforeScrubRef = useRef(false);
        const previewRepairAttemptsRef = useRef(new Set<string>());
        const sequenceFirstIdRef = useRef<string | null>(null);

        // Derived
        const currentTake = takes.length > 0 ? takes[currentTakeIndex] : null;
        const currentMotionOrigin = currentTake
            ? `${currentTake.motionEffect?.focalX ?? 50}% ${currentTake.motionEffect?.focalY ?? 50}%`
            : '50% 50%';
        const allMuted = takes.length > 0 && takes.every((t) => t.muteOriginalAudio);
        const playbackSourceFor = useCallback(
            (take: MediaTake) => playbackSourceOverrides[take.id] || take.proxyUrl || take.url,
            [playbackSourceOverrides]
        );

        const resetMotionTransforms = useCallback(() => {
            for (const element of [videoRef1.current, videoRef2.current, imageTakeRef.current]) {
                if (!element) continue;
                element.style.transform = 'translate3d(0,0,0) scale3d(1,1,1)';
                element.style.transformOrigin = '50% 50%';
            }
        }, []);

        const renderMotionFrame = useCallback((element: HTMLElement, take: MediaTake, localTime: number) => {
            const progress = normalizedTakeProgress(take, localTime);
            const scale = takeMotionScale(take.motionEffect, progress);
            const focalX = take.motionEffect?.focalX ?? 50;
            const focalY = take.motionEffect?.focalY ?? 50;
            // Escrita direta no compositor: React não arredonda nem reinicia a
            // interpolação a cada atualização do relógio.
            element.style.transformOrigin = `${focalX}% ${focalY}%`;
            element.style.transform = `translate3d(0,0,0) scale3d(${scale},${scale},1)`;
        }, []);

        useEffect(() => {
            if (motionFrameRef.current !== null) {
                window.cancelAnimationFrame(motionFrameRef.current);
                motionFrameRef.current = null;
            }
            const previousVideo = currentTake?.type === 'video'
                ? activeVideo === 1 ? videoRef1.current : videoRef2.current
                : null;
            const previousVideoWithFrames = previousVideo as (HTMLVideoElement & {
                cancelVideoFrameCallback?: (handle: number) => void;
            }) | null;
            if (motionVideoFrameRef.current !== null) {
                previousVideoWithFrames?.cancelVideoFrameCallback?.(motionVideoFrameRef.current);
                motionVideoFrameRef.current = null;
            }
            resetMotionTransforms();
            if (!currentTake?.motionEffect) return;

            const target =
                currentTake.type === 'image'
                    ? imageTakeRef.current
                    : activeVideo === 1
                      ? videoRef1.current
                      : videoRef2.current;
            if (!target) return;

            const videoTarget = currentTake.type === 'video' ? (target as HTMLVideoElement) : null;
            if (videoTarget) {
                type VideoFrameMetadataLite = { mediaTime: number };
                const framedVideo = videoTarget as HTMLVideoElement & {
                    requestVideoFrameCallback?: (
                        callback: (_now: number, metadata: VideoFrameMetadataLite) => void
                    ) => number;
                    cancelVideoFrameCallback?: (handle: number) => void;
                };
                const drawPresentedFrame = (_now: number, metadata: VideoFrameMetadataLite) => {
                    const localTime = Math.max(0, metadata.mediaTime - currentTake.trim.start);
                    renderMotionFrame(videoTarget, currentTake, localTime);
                    if (isPlaying && framedVideo.requestVideoFrameCallback) {
                        motionVideoFrameRef.current = framedVideo.requestVideoFrameCallback(drawPresentedFrame);
                    }
                };

                // O zoom muda junto com o quadro efetivamente apresentado pelo decoder.
                // Isso elimina a disputa entre o relógio de 60 Hz da tela e vídeos de 24/30 fps.
                if (framedVideo.requestVideoFrameCallback) {
                    renderMotionFrame(videoTarget, currentTake, Math.max(0, videoTarget.currentTime - currentTake.trim.start));
                    if (isPlaying) {
                        motionVideoFrameRef.current = framedVideo.requestVideoFrameCallback(drawPresentedFrame);
                    }
                } else {
                    const drawFallback = () => {
                        renderMotionFrame(
                            videoTarget,
                            currentTake,
                            Math.max(0, videoTarget.currentTime - currentTake.trim.start)
                        );
                        if (isPlaying) motionFrameRef.current = window.requestAnimationFrame(drawFallback);
                    };
                    drawFallback();
                }
            } else {
                const takeDuration = Math.max(0.001, currentTake.trim.end - currentTake.trim.start);
                let localTime = Math.max(0, currentTimeInTake);
                let previousFrameAt = performance.now();
                const drawImageFrame = (now: number) => {
                    const elapsed = Math.max(0, Math.min(0.05, (now - previousFrameAt) / 1000));
                    previousFrameAt = now;
                    localTime = Math.min(takeDuration, localTime + elapsed);
                    renderMotionFrame(target, currentTake, localTime);
                    if (isPlaying) motionFrameRef.current = window.requestAnimationFrame(drawImageFrame);
                };
                drawImageFrame(previousFrameAt);
            }

            return () => {
                if (motionFrameRef.current !== null) {
                    window.cancelAnimationFrame(motionFrameRef.current);
                    motionFrameRef.current = null;
                }
                if (motionVideoFrameRef.current !== null) {
                    const framedVideo = videoTarget as (HTMLVideoElement & {
                        cancelVideoFrameCallback?: (handle: number) => void;
                    }) | null;
                    framedVideo?.cancelVideoFrameCallback?.(motionVideoFrameRef.current);
                    motionVideoFrameRef.current = null;
                }
            };
            // currentTimeInTake é apenas o ponto inicial. Durante o play, o callback
            // acompanha os quadros apresentados e não reinicia a cada tick da interface.
        }, [activeVideo, currentTake, isImageTake, isPlaying, renderMotionFrame, resetMotionTransforms]);

        useEffect(() => {
            if (isPlaying || !currentTake?.motionEffect) return;
            const target =
                currentTake.type === 'image'
                    ? imageTakeRef.current
                    : activeVideo === 1
                      ? videoRef1.current
                      : videoRef2.current;
            if (target) renderMotionFrame(target, currentTake, currentTimeInTake);
        }, [activeVideo, currentTake, currentTimeInTake, isImageTake, isPlaying, renderMotionFrame]);

        const repairUnsupportedLocalVideo = useCallback(async (take: MediaTake) => {
            if (previewRepairAttemptsRef.current.has(take.id)) return;
            previewRepairAttemptsRef.current.add(take.id);
            try {
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

        const stopAll = useCallback(() => {
            setIsPlaying(false);
            const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
            if (vid) vid.pause();
            pauseAudio();
            clearInterval(progressIntervalRef.current);
        }, [pauseAudio, activeVideo]);

        const play = useCallback(() => {
            setIsPlaying(true);
            const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
            // If there are takes, play the video.
            if (vid && currentTake && !isImageTake) vid.play().catch(() => {});
            // If we ONLY have audio (no takes) or video is not buffering, play audio
            if (!currentTake || !isBuffering) {
                playAudio();
            }
        }, [isImageTake, isBuffering, playAudio, currentTake, activeVideo]);

        const pause = useCallback(() => {
            stopAll();
        }, [stopAll]);

        const restart = useCallback(() => {
            stopAll();
            setCurrentTakeIndex(0);
            setCurrentTimeInTake(0);
            setAudioTime(0);
            setActiveVideo(1); // Reset to first video player
            setActiveTransitionUrl(null);
            transitionTriggeredRef.current = false;
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
                setPlaybackSourceOverrides({});
                pendingSeekTimeRef.current = null;
                transitionTriggeredRef.current = false;

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
            }
        }, [takes, currentTakeIndex, stopAll]);

        // When take index changes, load the new source
        useEffect(() => {
            if (!currentTake) return;

            const isImg = currentTake.type === 'image';
            setIsImageTake(isImg);

            const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;

            if (vid) {
                // Load source logic
                const src = playbackSourceFor(currentTake);
                if (!vid.src.endsWith(src)) {
                    vid.src = src;
                    vid.load();
                }

                // Set initial time
                const startOffset = pendingSeekTimeRef.current !== null ? pendingSeekTimeRef.current : 0;
                vid.currentTime = currentTake.trim.start + startOffset;
                pendingSeekTimeRef.current = null;
                transitionTriggeredRef.current = false; // Reset trigger for new take
                vid.playbackRate = 1; // Reset speed
                vid.muted = !!currentTake.muteOriginalAudio;

                if (isPlaying && !isImg) {
                    vid.play().catch((e) => {
                        if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') console.error(e);
                    });
                }
            }
        }, [currentTakeIndex, takes, activeVideo, playbackSourceFor]); // Dependency on 'takes' ensures update on edit

        // ─── Speed Curve & Time Update Loop ─────────────────────────────────

        useEffect(() => {
            // O estado de UI pode atualizar em cadência econômica; o movimento
            // visual é controlado separadamente por requestAnimationFrame.
            const checkInterval = 30;

            const tick = () => {
                if (!isPlaying) return;

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
                if (audioMasterRef.current) {
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
                const isEndOfTakes = currentTakeIndex >= takes.length - 1;

                if (!isEndOfTakes) {
                    const nextIndex = currentTakeIndex + 1;
                    const nextT = takes[nextIndex];

                    // Preload into the next video player
                    const nextVid = activeVideo === 1 ? videoRef2.current : videoRef1.current;
                    if (nextVid && nextT && nextT.type === 'video') {
                        const src = playbackSourceFor(nextT);
                        if (nextVid.src !== src) {
                            nextVid.src = src;
                            nextVid.load();
                        }
                        nextVid.currentTime = nextT.trim.start;
                        nextVid.muted = !!nextT.muteOriginalAudio;
                        nextVid.playbackRate = 1;
                        if (isPlaying) {
                            nextVid.play().catch((e) => {
                                if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') console.error(e);
                            });
                        }
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
        }, [isPlaying, currentTakeIndex, takes, currentTake, stopAll, activeVideo, totalDuration, playbackSourceFor]);

        // ─── Audio Sync Checks (Periodic Watchdog) ──────────────────────────
        useEffect(() => {
            if (!isPlaying || isBuffering) return;

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
        }, [isPlaying, isBuffering, masterAudioUrl, activeVideo]);

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

        useImperativeHandle(ref, () => ({
            getCurrentTime: () => Math.max(0, Math.min(totalDuration, Math.max(globalTime, audioTime))),
            seekToTime: (globalTime: number) => {
                if (totalDuration <= 0) return;
                const targetGlobalTime = Math.max(0, Math.min(globalTime, totalDuration));

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

                        // Give React an extra moment to fully flush the DOM unmounts (prevents ghost text)
                        if (overlayFontCssRef.current === null) {
                            overlayFontCssRef.current = await getFontEmbedCSS(node).catch(() => '');
                        }

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

        // Progress calculation (approximate)
        const progressPercent =
            totalDuration > 0 ? (Math.min(totalDuration, Math.max(globalTime, audioTime)) / totalDuration) * 100 : 0;

        return (
            <div className="bg-brand-card border border-black/5 dark:border-white/5 rounded-3xl overflow-hidden flex flex-col shadow-2xl">
                {/* Header */}
                {!hideControls && (
                    <div className="flex items-center justify-between px-5 py-3 border-b border-black/5 dark:border-white/5 bg-background shadow-inner z-10">
                        <span className="text-[10px] font-bold text-foreground tracking-widest uppercase flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-brand-accent shadow-[0_0_8px_rgba(0,230,118,0.8)] animate-pulse"></span>
                            Monitor de Corte
                        </span>
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
                    </div>
                )}

                {/* Video Area */}
                <div
                    className={cn(
                        'relative w-full flex items-center justify-center overflow-hidden group/video shadow-inner cursor-pointer',
                        adData.format === '1:1' ? 'aspect-square mx-auto max-w-[420px]' : 'aspect-9/16',
                        isHybridMode ? 'bg-transparent' : 'bg-brand-dark'
                    )}
                    onClick={() => {
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
                    <video
                        ref={videoRef1}
                        crossOrigin="anonymous"
                        className={cn(
                            'absolute top-0 left-0 w-full h-full object-cover', // default
                            currentTake?.objectFit === 'contain' ? 'object-contain' : 'object-cover',
                            !currentTake || isHybridMode || isImageTake || activeVideo !== 1
                                ? 'opacity-0 pointer-events-none'
                                : 'opacity-100'
                        )}
                        style={{
                            transformOrigin: currentMotionOrigin,
                            willChange: currentTake?.motionEffect ? 'transform' : 'auto',
                            backfaceVisibility: 'hidden',
                            transformStyle: 'preserve-3d',
                        }}
                        playsInline
                        preload="auto"
                        onWaiting={() => {
                            if (activeVideo === 1) {
                                setIsBuffering(true);
                                pauseAudio();
                            }
                        }}
                        onPlaying={() => {
                            if (activeVideo === 1) {
                                setIsBuffering(false);
                                if (isPlaying) playAudio();
                            }
                        }}
                        onError={() => {
                            if (activeVideo === 1 && currentTake?.type === 'video') {
                                void repairUnsupportedLocalVideo(currentTake);
                            }
                        }}
                    />

                    <video
                        ref={videoRef2}
                        crossOrigin="anonymous"
                        className={cn(
                            'absolute top-0 left-0 w-full h-full',
                            currentTake?.objectFit === 'contain' ? 'object-contain' : 'object-cover',
                            !currentTake || isHybridMode || isImageTake || activeVideo !== 2
                                ? 'opacity-0 pointer-events-none'
                                : 'opacity-100'
                        )}
                        style={{
                            transformOrigin: currentMotionOrigin,
                            willChange: currentTake?.motionEffect ? 'transform' : 'auto',
                            backfaceVisibility: 'hidden',
                            transformStyle: 'preserve-3d',
                        }}
                        playsInline
                        preload="auto"
                        onWaiting={() => {
                            if (activeVideo === 2) {
                                setIsBuffering(true);
                                pauseAudio();
                            }
                        }}
                        onPlaying={() => {
                            if (activeVideo === 2) {
                                setIsBuffering(false);
                                if (isPlaying) playAudio();
                            }
                        }}
                        onError={() => {
                            if (activeVideo === 2 && currentTake?.type === 'video') {
                                void repairUnsupportedLocalVideo(currentTake);
                            }
                        }}
                    />

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
                    {isBuffering && isPlaying && !isImageTake && !isHybridMode && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                            <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        </div>
                    )}

                    {/* Image Element for Image Takes */}
                    {isImageTake && currentTake && (
                        <img
                            ref={imageTakeRef}
                            src={playbackSourceFor(currentTake)}
                            className={cn(
                                'w-full h-full',
                                currentTake.objectFit === 'contain' ? 'object-contain' : 'object-cover',
                                isHybridMode && 'opacity-0'
                            )}
                            style={{
                                transformOrigin: currentMotionOrigin,
                                willChange: currentTake?.motionEffect ? 'transform' : 'auto',
                                backfaceVisibility: 'hidden',
                                transformStyle: 'preserve-3d',
                            }}
                            crossOrigin="anonymous"
                            alt="Preview"
                        />
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
                        ref={overlayContainerRef}
                        className="absolute inset-0 pointer-events-none"
                        style={{ zIndex: 30 }}
                    >
                        {captions?.segments && (
                            <div
                                className={cn(
                                    'absolute inset-x-0 flex items-center justify-center pointer-events-none z-30 px-6',
                                    isHybridMode ? 'transition-none duration-0' : 'transition-all duration-200'
                                )}
                                style={{ bottom: `${captionStyle?.verticalPosition ?? 15}%` }}
                            >
                                {(() => {
                                    const activeSegment = captions.segments.find(
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        (s: any) => audioTime >= s.start && audioTime <= s.end
                                    );
                                    if (!activeSegment || !activeSegment.words) return null;

                                    return (
                                        <div
                                            className="font-black text-center uppercase tracking-wide leading-[1.2] flex flex-wrap justify-center drop-shadow-2xl px-4"
                                            style={{
                                                fontFamily: captionStyle?.fontFamily || 'Poppins',
                                                fontSize: captionStyle?.fontSize
                                                    ? `${captionStyle.fontSize}px`
                                                    : '48px',
                                                WebkitTextStroke: `${captionStyle?.strokeWidth || 6}px ${captionStyle?.strokeColor || 'black'}`,
                                                paintOrder: 'stroke fill',
                                                textShadow: '0px 6px 12px rgba(0,0,0,0.8)',
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
                                        return { transform: `translateX(${-50 * progress}px)`, opacity: 1 - progress };
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

                            return dynamicTitles.map((title) => {
                                if (audioTime >= title.startSec && audioTime <= title.startSec + title.durationSec) {
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
                <div className="px-5 py-4 border-t border-black/5 dark:border-white/5 space-y-4 bg-background z-10">
                    {/* Progress bar */}
                    <div
                        ref={progressBarRef}
                        className="w-full bg-black/5 dark:bg-white/5 rounded-full h-2.5 overflow-hidden cursor-pointer relative group flex items-center hover:h-3.5 transition-all"
                        onMouseDown={handleScrubStart}
                    >
                        <div
                            className="h-full bg-brand-accent shadow-[0_0_10px_rgba(0,230,118,0.8)]"
                            style={{ width: `${Math.min(progressPercent, 100)}%` }}
                        />
                        <div className="absolute inset-0 bg-black/10 dark:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
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
                            <span className="text-foreground">{formatTime(Math.max(globalTime, audioTime))}</span> /{' '}
                            {formatTime(totalDuration)}
                        </span>
                    </div>
                </div>

                {/* Compact Take List */}
                {!hideControls && (
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
                                onClick={() => {
                                    // Optional: Click to jump to take logic could go here
                                    stopAll();
                                    setCurrentTakeIndex(i);
                                    setCurrentTimeInTake(0);
                                }}
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
