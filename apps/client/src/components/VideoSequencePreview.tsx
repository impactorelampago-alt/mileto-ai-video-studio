import React, { useEffect, useRef, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Loader2, Zap } from 'lucide-react';
import { MediaTake, TitleHook, CaptionTrack } from '../types';
import { cn } from '../lib/utils';
import { useWizard } from '../context/WizardContext';
import { DynamicTitleRenderer } from './DynamicTitleRenderer';
import { getPlaybackRateForRemap } from '../lib/speedRemapping';
import { toPng } from 'html-to-image';
import { toast } from 'sonner';

export interface VideoSequencePreviewRef {
    seekToTime: (globalTime: number) => void;
    extractFrameSync: (globalTime: number, isAlphaExport?: boolean) => Promise<HTMLCanvasElement | null>;
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
        },
        ref
    ) => {
        const { captionStyle, adData, isDebugMode } = useWizard();

        // Refs
        const videoRef1 = useRef<HTMLVideoElement>(null);
        const videoRef2 = useRef<HTMLVideoElement>(null);
        const transitionRef = useRef<HTMLVideoElement>(null);
        const audioMasterRef = useRef<HTMLAudioElement>(null);
        const progressIntervalRef = useRef<number>(0);
        const overlayContainerRef = useRef<HTMLDivElement>(null);

        // State
        const [isPlaying, setIsPlaying] = useState(false);
        const [isExportingFrame, setIsExportingFrame] = useState(false);
        const [currentTakeIndex, setCurrentTakeIndex] = useState(0);
        const [currentTimeInTake, setCurrentTimeInTake] = useState(0);
        const [audioTime, setAudioTime] = useState(0); // True audio time for subtitles
        const [isImageTake, setIsImageTake] = useState(false);
        const [isBuffering, setIsBuffering] = useState(false);
        const [activeVideo, setActiveVideo] = useState<1 | 2>(1);
        const [activeTransitionUrl, setActiveTransitionUrl] = useState<string | null>(null);
        const pendingSeekTimeRef = useRef<number | null>(null);
        const transitionTriggeredRef = useRef<boolean>(false);
        const progressBarRef = useRef<HTMLDivElement>(null);
        const isScrubbingRef = useRef(false);
        const wasPlayingBeforeScrubRef = useRef(false);
        // Grace window after each take switch — suppresses the buffering spinner
        // that fires when the newly-active video's onWaiting triggers (normal during switch).
        const justSwitchedTakeRef = useRef(false);

        // Derived
        const currentTake = takes.length > 0 ? takes[currentTakeIndex] : null;
        const allMuted = takes.length > 0 && takes.every((t) => t.muteOriginalAudio);

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
            if (takes.length === 0) return audioDuration > 0 ? audioDuration : 30;
            // The true total duration is whichever is longer (usually the audio dictates the final length due to CTA)
            return Math.max(takesDur, audioDuration);
        }, [takes, audioDuration]);

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

            // If the video loops back around but audio is still running, ensure the timeline doesn't pull backward visually
            return Math.max(time, audioTime);
        }, [takes, currentTakeIndex, currentTimeInTake, audioTime]);

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

        // When take index changes, load the new source
        useEffect(() => {
            if (!currentTake) return;

            const isImg = currentTake.type === 'image';
            setIsImageTake(isImg);

            const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;

            if (vid) {
                // Load source logic
                const src = currentTake.proxyUrl || currentTake.url;
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
        }, [currentTakeIndex, takes, activeVideo]);

        // ─── Proactive Next-Take Preload ─────────────────────────────────────────
        // Load the NEXT take into the idle buffer + seek to trim.start.
        // Seeking alone is enough to make the browser decode the first frame
        // at that position WITHOUT calling play(), which avoids triggering
        // the onWaiting/buffering spinner on the idle video element.
        useEffect(() => {
            const nextIndex = currentTakeIndex + 1;
            if (nextIndex >= takes.length) return;
            const nextTake = takes[nextIndex];
            if (nextTake.type !== 'video') return;

            const idleVid = activeVideo === 1 ? videoRef2.current : videoRef1.current;
            if (!idleVid) return;

            const src = nextTake.proxyUrl || nextTake.url;

            const seekToStart = () => {
                idleVid.currentTime = nextTake.trim.start;
                idleVid.muted = !!nextTake.muteOriginalAudio;
            };

            if (idleVid.src !== src) {
                idleVid.src = src;
                idleVid.load();
                // Seek only after enough data is available
                idleVid.addEventListener('loadedmetadata', seekToStart, { once: true });
                return () => idleVid.removeEventListener('loadedmetadata', seekToStart);
            } else {
                seekToStart();
            }
        }, [currentTakeIndex, takes, activeVideo]);

        // ─── Synchronous Opacity Swap (before browser paint) ──────────────────
        // useLayoutEffect fires synchronously after React DOM mutations but BEFORE
        // the browser paints. This eliminates the render-cycle gap where both
        // video elements could be invisible (causing the black flash).
        // Inline style.opacity overrides Tailwind opacity-0/opacity-100 classes.
        React.useLayoutEffect(() => {
            const v1 = videoRef1.current;
            const v2 = videoRef2.current;
            if (!v1 || !v2) return;

            const show = !isHybridMode && !isImageTake;
            v1.style.opacity = show && activeVideo === 1 ? '1' : '0';
            v2.style.opacity = show && activeVideo === 2 ? '1' : '0';
        }, [activeVideo, isHybridMode, isImageTake]);

        // ─── Speed Curve & Time Update Loop ─────────────────────────────────

        useEffect(() => {
            const checkInterval = 30; // Check ~30 times/sec (low CPU overhead)

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
                if (masterAudioUrl && audioMasterRef.current) {
                    setAudioTime(audioMasterRef.current.currentTime);
                } else if (!masterAudioUrl) {
                    // Fallback to timeline global time if no master audio exists
                    let accumulated = 0;
                    if (takes.length > 0) {
                        for (let i = 0; i < currentTakeIndex; i++) {
                            accumulated += takes[i].trim.end - takes[i].trim.start;
                        }
                        const vid = activeVideo === 1 ? videoRef1.current : videoRef2.current;
                        const now = vid && currentTake ? vid.currentTime : 0;
                        const start = currentTake ? currentTake.trim.start : 0;
                        setAudioTime(accumulated + Math.max(0, now - start));
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
                            const apiBase =
                                (window as any).API_BASE_URL ||
                                import.meta.env.VITE_API_BASE_URL ||
                                'http://localhost:3301';
                            const tUrl = `${apiBase}${currentTransition.publicUrl}`;
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
                        const src = nextT.proxyUrl || nextT.url;
                        const srcChanged = nextVid.src !== src;
                        if (srcChanged) {
                            nextVid.src = src;
                            nextVid.load();
                            nextVid.currentTime = nextT.trim.start;
                        }
                        // If src didn't change, preload already sought to trim.start — skip redundant re-seek.
                        nextVid.muted = !!nextT.muteOriginalAudio;
                        nextVid.playbackRate = 1;
                        if (isPlaying) {
                            nextVid.play().catch((e) => {
                                if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') console.error(e);
                            });
                        }
                    }

                    // Suppress buffering spinner for 500ms after take switch
                    // (onWaiting fires on the newly-active video during normal buffering at start).
                    justSwitchedTakeRef.current = true;
                    setTimeout(() => {
                        justSwitchedTakeRef.current = false;
                    }, 500);

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

            // Master Audio ending handling
            if (audioMasterRef.current && audioMasterRef.current.ended && isPlaying) {
                // If the audio has finished playing, we DO NOT kill the video playback immediately
                // if there are still takes remaining. If takes are done, advanceTrack() will handle the stop.
                // However, we MUST ensure the watchdog or progress loop doesn't restart it.
                // The native HTMLAudioElement.ended property will stay true.
            }

            const intervalId = setInterval(tick, checkInterval);
            progressIntervalRef.current = intervalId;

            return () => clearInterval(intervalId);
        }, [isPlaying, currentTakeIndex, takes, currentTake, stopAll, activeVideo]);

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
            extractFrameSync: async (globalTime: number, isAlphaExport = false): Promise<HTMLCanvasElement | null> => {
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
                if (isAlphaExport && !isExportingFrame) setIsExportingFrame(true);
                setCurrentTakeIndex(targetTakeIndex);
                setCurrentTimeInTake(targetTimeInTake);
                setAudioTime(targetGlobalTime);

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

                const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3301';
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

                const rawSrc = take.proxyUrl || take.url;

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

                            // Aguarda a GPU decodificar o frame.
                            await new Promise((r) => setTimeout(r, 80));
                        } else {
                            vid.currentTime = targetLocalTime;
                        }
                    }
                }

                // Short breath for React to re-render overlays (captions/titles) with new audioTime
                await new Promise((r) => setTimeout(r, 10));

                const TARGET_W = 1080;
                const TARGET_H = 1920;
                const canvas = document.createElement('canvas');
                canvas.width = TARGET_W;
                canvas.height = TARGET_H;
                const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

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

                            ctx.drawImage(vid, drawX, drawY, drawW, drawH);
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

                            ctx.drawImage(img, drawX, drawY, drawW, drawH);
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
                                const tUrl = `${import.meta.env.VITE_API_BASE_URL || ''}${activeTransition.publicUrl}`;
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
                        await new Promise((r) => setTimeout(r, 60));

                        const overlayDataUrl = await toPng(node, {
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
                            cacheBust: true, // Crucial to prevent html-to-image from caching previous captions
                        });
                        const overlayImg = new Image();
                        await new Promise<void>((res, rej) => {
                            overlayImg.onload = () => res();
                            overlayImg.onerror = rej;
                            overlayImg.src = overlayDataUrl;
                        });
                        ctx.drawImage(overlayImg, 0, 0, TARGET_W, TARGET_H);
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
        const progressPercent = totalDuration > 0 ? (Math.max(globalTime, audioTime) / totalDuration) * 100 : 0;

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
                    {/* Native Video Elements for Double Buffering */}
                    <video
                        ref={videoRef1}
                        crossOrigin="anonymous"
                        className={cn(
                            'absolute top-0 left-0 w-full h-full object-cover', // default
                            currentTake?.objectFit === 'contain' ? 'object-contain' : 'object-cover',
                            isHybridMode || isImageTake || activeVideo !== 1
                                ? 'opacity-0 pointer-events-none'
                                : 'opacity-100'
                        )}
                        style={{
                            transition: 'opacity 100ms ease',
                        }}
                        playsInline
                        preload="auto"
                        onWaiting={() => {
                            // Don't show spinner on normal take transitions
                            if (activeVideo === 1 && !justSwitchedTakeRef.current) {
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
                    />

                    <video
                        ref={videoRef2}
                        crossOrigin="anonymous"
                        className={cn(
                            'absolute top-0 left-0 w-full h-full',
                            currentTake?.objectFit === 'contain' ? 'object-contain' : 'object-cover',
                            isHybridMode || isImageTake || activeVideo !== 2
                                ? 'opacity-0 pointer-events-none'
                                : 'opacity-100'
                        )}
                        style={{
                            transition: 'opacity 100ms ease',
                        }}
                        playsInline
                        preload="auto"
                        onWaiting={() => {
                            // Don't show spinner on normal take transitions
                            if (activeVideo === 2 && !justSwitchedTakeRef.current) {
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
                    />

                    {/* Transition Overlay (Ghost Player) */}
                    <video
                        ref={transitionRef}
                        className={cn(
                            'absolute top-0 left-0 w-full h-full object-contain pointer-events-none z-30',
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
                            src={currentTake.proxyUrl || currentTake.url}
                            className={cn(
                                'w-full h-full',
                                currentTake.objectFit === 'contain' ? 'object-contain' : 'object-cover',
                                isHybridMode && 'opacity-0'
                            )}
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
                                    const captionTime = masterAudioUrl 
                                        ? audioTime 
                                        : (currentTake ? currentTake.trim.start + currentTimeInTake : 0);

                                    const activeSegment = captions.segments.find(
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        (s: any) => captionTime >= s.start && captionTime <= s.end
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
                                                const isActive = captionTime >= w.start && captionTime < nextStart;

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
                                        <div
                                            key={`${title.id}-${animId}`}
                                            className="absolute inset-x-0 flex items-center justify-center pointer-events-none z-40 px-6"
                                            style={{ top: `${title.posY}%` }}
                                        >
                                            <div
                                                className="origin-center"
                                                style={{ transform: `scale(${(title.scale ?? 1) * 0.85})` }}
                                            >
                                                <div className="origin-center" style={inlineStyles}>
                                                    <DynamicTitleRenderer
                                                        title={title}
                                                        timeElapsed={timeElapsed}
                                                        isHybridMode={isHybridMode || isExportingFrame}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            });
                        })()}
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
