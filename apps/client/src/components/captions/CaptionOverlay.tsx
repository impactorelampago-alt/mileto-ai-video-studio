import React, { useMemo } from 'react';
import { CaptionTrack } from '../../types';
import { getPresetById } from '../../lib/captions/presets';

interface CaptionOverlayProps {
    currentTime: number; // Global time in seconds
    captionTrack?: CaptionTrack;
}

export const CaptionOverlay: React.FC<CaptionOverlayProps> = ({ currentTime, captionTrack }) => {
    if (!captionTrack || !captionTrack.enabled || !captionTrack.segments) {
        return null;
    }

    // efficient lookup could be binary search, but with < 50 segments array.find is fine
    const activeSegment = useMemo(() => {
        return captionTrack.segments.find((seg) => currentTime >= seg.start && currentTime <= seg.end);
    }, [captionTrack.segments, currentTime]);

    if (!activeSegment) return null;

    const preset = getPresetById(captionTrack.presetId);

    // If karaoke, find active word
    // Words are absolute time in our new model? Plan said "words: {text, start, end}".
    // Let's assume start/end are absolute for simplicity in renderer.
    const activeWordIndex = activeSegment.words?.findIndex((w) => currentTime >= w.start && currentTime <= w.end);

    return (
        // Container Query aware styling
        // Position: Bottom 12%, centered. Max width ~90%.
        <div
            className="absolute left-1/2 -translate-x-1/2 z-20 w-full flex justify-center pointer-events-none px-4"
            style={{ top: 'auto', bottom: '12%' }}
        >
            <div
                style={{
                    maxWidth: '90%',
                    width: 'auto',
                }}
                className="flex flex-col items-center justify-center transition-all duration-200"
            >
                <p
                    style={{
                        // CapCut Style Overrides - defaults if not overridden by preset spread (but we want to FORCE these)
                        // So we spread preset first, then overwrite.
                        ...preset.textStyle,

                        fontFamily: 'Montserrat, sans-serif',
                        fontWeight: 900,
                        textTransform: 'uppercase',
                        textAlign: 'center',
                        lineHeight: '1.15',
                        // Stroke / Shadow
                        textShadow: '0 2px 0 #000, 0 0 4px rgba(0,0,0,0.5)',
                        paintOrder: 'stroke fill',

                        // Force these critical CapCut styles
                        fontSize: 'clamp(16px, 6cqw, 42px)',
                        color: '#FFFFFF',
                        WebkitTextStroke: '1.5px black',
                    }}
                    className={`transition-all duration-200 ${preset.animation === 'pop' ? 'animate-in zoom-in-50 duration-100' : ''}`}
                >
                    {activeSegment.words && activeSegment.words.length > 0
                        ? // Render words for karaoke
                          activeSegment.words.map((word, i) => {
                              const isActive = i === activeWordIndex;
                              return (
                                  <span
                                      key={`${activeSegment.id}-${i}`}
                                      style={{
                                          // Active Word Style: Yellow + Stroke
                                          ...(isActive
                                              ? {
                                                    color: '#FFD400', // CapCut Yellow
                                                    textShadow: '0 2px 0 #000',
                                                    WebkitTextStroke: '1.5px black',
                                                    zIndex: 1,
                                                    position: 'relative', // maintain z-index
                                                }
                                              : {}),
                                      }}
                                      className="transition-colors duration-100 inline-block mr-1.5 last:mr-0"
                                  >
                                      {word.text}
                                  </span>
                              );
                          })
                        : // Fallback to simple text
                          activeSegment.text}
                </p>
            </div>
        </div>
    );
};
