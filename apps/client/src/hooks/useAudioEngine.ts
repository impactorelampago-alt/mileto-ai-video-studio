import { useEffect, useRef, useState, useCallback } from 'react';
import { AudioTimeline } from '../types';

export const useAudioEngine = (
    timeline: AudioTimeline | null,
    onLoad?: (sourceUrl: string, duration: number) => void
) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [isReady, setIsReady] = useState(false);
    const [buffersVersion, setBuffersVersion] = useState(0);

    const audioContextRef = useRef<AudioContext | null>(null);
    const audioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const sourceNodesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
    const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
    const startTimeRef = useRef<number>(0); // When playback started (context time)
    const pausedTimeRef = useRef<number>(0); // Where we paused (timeline time)
    const animationFrameRef = useRef<number>(0);

    // Init Context
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
        return () => {
            audioContextRef.current?.close();
        };
    }, []);

    const pendingRequestsRef = useRef<Map<string, Promise<void>>>(new Map());

    // Load Buffers when timeline changes (simple caching)
    useEffect(() => {
        if (!timeline || !audioContextRef.current) return;

        const load = async () => {
            const ctx = audioContextRef.current!;

            // Collect all unique URLs from the timeline
            const uniqueUrls = new Set<string>();
            timeline.tracks.forEach((t) => {
                t.clips.forEach((c) => uniqueUrls.add(c.sourceUrl));
            });

            const promises = Array.from(uniqueUrls).map(async (url) => {
                // 1. Already loaded?
                if (audioBuffersRef.current.has(url)) {
                    const buf = audioBuffersRef.current.get(url);
                    // Ensure we notify onLoad even if cached, but maybe debounce it?
                    // Actually, if it's cached, we might have already notified.
                    // But if the component re-mounted, we need to notify again for the consumer to update state.
                    if (buf && onLoad) onLoad(url, buf.duration);
                    return;
                }

                // 2. Already loading?
                if (pendingRequestsRef.current.has(url)) {
                    try {
                        await pendingRequestsRef.current.get(url);
                    } catch {
                        /* ignore */
                    }

                    if (audioBuffersRef.current.has(url)) {
                        const buf = audioBuffersRef.current.get(url);
                        if (buf && onLoad) onLoad(url, buf.duration);
                    }
                    return;
                }

                // 3. New Load
                const loadPromise = (async () => {
                    try {
                        const response = await fetch(url);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const arrayBuffer = await response.arrayBuffer();
                        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                        audioBuffersRef.current.set(url, audioBuffer);
                        setBuffersVersion((v) => v + 1);

                        if (onLoad) {
                            onLoad(url, audioBuffer.duration);
                        }
                    } catch (e) {
                        console.error('Failed to load audio', url, e);
                    } finally {
                        pendingRequestsRef.current.delete(url);
                    }
                })();

                pendingRequestsRef.current.set(url, loadPromise);
                await loadPromise;
            });

            await Promise.all(promises);
            setIsReady(true);
        };

        load();
    }, [
        // Only re-run if the SET of URLs changes, or if audioContext changes.
        // We can't easily memoize the set of URLs in the dependency array without a custom hook or useMemo.
        // But we can approximate by joining them, or just accept that timeline updates might trigger meaningful checks.
        // The real fix is to make sure we don't re-trigger if nothing changed.
        // For now, let's keep timeline but ensure safe idempotency.
        // Actually, the issue is likely that onLoad triggers setTimeline -> new reference -> re-run.
        // We should wrap the URL list in useMemo.
        timeline?.tracks.map((t) => t.clips.map((c) => c.sourceUrl).join(',')).join('|') || '',
        audioContextRef, // stable
    ]);

    const stopAll = useCallback(() => {
        sourceNodesRef.current.forEach((node) => {
            try {
                node.stop();
            } catch {
                // Ignore errors if already stopped
            }
            node.disconnect();
        });
        sourceNodesRef.current.clear();

        gainNodesRef.current.forEach((node) => node.disconnect());
        gainNodesRef.current.clear();

        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        setIsPlaying(false);
    }, []);

    const play = useCallback(() => {
        if (!timeline || !audioContextRef.current || !isReady) return;
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();

        stopAll(); // Ensure clean slate

        const startOffset = pausedTimeRef.current; // Start from here (seconds)
        startTimeRef.current = ctx.currentTime - startOffset;

        // Schedule clips
        timeline.tracks.forEach((track) => {
            if (!track.enabled || track.muted) return; // Skip muted

            track.clips.forEach((clip) => {
                const buffer = audioBuffersRef.current.get(clip.sourceUrl);
                if (!buffer) return;

                // Calculate when this clip should play relative to global time
                // Clip starts at clip.startSec
                // We are at startOffset.

                // If clip ends before startOffset, skip
                const duration = (clip.outSec || buffer.duration) - clip.inSec;
                const clipEnd = clip.startSec + duration;

                if (clipEnd <= startOffset) return;

                // If clip starts after startOffset
                // Schedule at (clip.startSec - startOffset) -> valid if > 0
                // If clip starts before startOffset but ends after (overlap)
                // Schedule at 0 (now), but offset into buffer by (startOffset - clip.startSec) + clip.inSec

                let when: number;
                let offset: number;
                let playDuration = duration;

                if (clip.startSec >= startOffset) {
                    // Future clip
                    when = ctx.currentTime + (clip.startSec - startOffset);
                    offset = clip.inSec;
                } else {
                    // Overlapping clip
                    when = ctx.currentTime;
                    const timePassedInClip = startOffset - clip.startSec;
                    offset = clip.inSec + timePassedInClip;
                    playDuration = duration - timePassedInClip;
                }

                if (playDuration <= 0) return;

                const source = ctx.createBufferSource();
                source.buffer = buffer;

                const gain = ctx.createGain();
                gain.gain.value = track.volume * (clip.volume ?? 1); // Combine volumes

                // Fades (Simple linear for MVP)
                // We'd need to compute relative times for volume automation, skipping for now
                // Or just apply static volume

                source.connect(gain);
                gain.connect(ctx.destination);

                source.start(when, offset, playDuration);

                const key = `${track.id}-${clip.id}`;
                sourceNodesRef.current.set(key, source);
                gainNodesRef.current.set(key, gain);

                // Cleanup on end?
                source.onended = () => {
                    sourceNodesRef.current.delete(key);
                };
            });
        });

        setIsPlaying(true);

        const tick = () => {
            const t = ctx.currentTime - startTimeRef.current;
            setCurrentTime(t);
            if (t >= timeline.durationSec) {
                pause();
                setCurrentTime(timeline.durationSec); // Snap to end? Or loop?
            } else {
                animationFrameRef.current = requestAnimationFrame(tick);
            }
        };
        animationFrameRef.current = requestAnimationFrame(tick);
    }, [timeline, isReady, isPlaying]); // stopAll is internal

    // Real-time Volume Adjustment
    useEffect(() => {
        if (!timeline) return;
        timeline.tracks.forEach((track) => {
            track.clips.forEach((clip) => {
                const key = `${track.id}-${clip.id}`;
                const gainNode = gainNodesRef.current.get(key);
                if (gainNode) {
                    // Smooth transition to avoid clicking
                    const newVolume = track.volume * (clip.volume ?? 1);
                    gainNode.gain.setTargetAtTime(newVolume, audioContextRef.current?.currentTime || 0, 0.1);
                }
            });
        });
    }, [timeline]); // Re-run when timeline updates (including volume changes)

    const pause = useCallback(() => {
        if (!audioContextRef.current) return;
        const ctx = audioContextRef.current;

        // Save current time
        pausedTimeRef.current = ctx.currentTime - startTimeRef.current;
        setCurrentTime(pausedTimeRef.current);

        stopAll();
    }, [stopAll]);

    const seek = useCallback(
        (time: number) => {
            const wasPlaying = isPlaying;
            if (wasPlaying) pause();
            pausedTimeRef.current = Math.max(0, time);
            setCurrentTime(pausedTimeRef.current);
            if (wasPlaying) play();
        },
        [isPlaying, pause, play]
    );

    return {
        isPlaying,
        currentTime,
        play,
        pause,
        seek,
        isReady,
        audioBuffers: audioBuffersRef.current,
        buffersVersion, // Export version to trigger effects on load
    };
};
