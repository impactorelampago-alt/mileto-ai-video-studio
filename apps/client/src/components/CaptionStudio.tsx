import React from 'react';
import { useWizard } from '../context/WizardContext';
import { Settings2, Type, PaintBucket, TypeOutline } from 'lucide-react';
import type { CaptionStyle } from '../types';
export const CaptionStudio: React.FC = () => {
    const { adData, updateAdData, captionStyle, setCaptionStyle } = useWizard();

    if (!adData.captions || !captionStyle) return null;

    const handleTextChange = (segmentIndex: number, newText: string) => {
        const newSegments = [...adData.captions!.segments];
        const oldSegment = newSegments[segmentIndex];

        // 1. Split the new text into an array of words
        const newWords = newText.split(/\s+/).filter((w) => w.length > 0);

        // 2. Map the new words to the available time evenly
        // If the user completely changes the sentence, mapping strictly by index causes
        // short words to take long pauses and vice-versa if the word count changes drastically.
        // A better approach for real-time editing is to distribute the segment's total duration
        // evenly across the new number of words.

        const segmentDuration = oldSegment.end - oldSegment.start;
        const timePerWord = newWords.length > 0 ? segmentDuration / newWords.length : 0;

        const updatedWords = newWords.map((wordText, i) => {
            return {
                text: wordText,
                start: oldSegment.start + i * timePerWord,
                end: oldSegment.start + (i + 1) * timePerWord,
            };
        });

        // 3. Save both the raw string and the reconstructed timed array
        newSegments[segmentIndex] = {
            ...oldSegment,
            text: newText,
            words: updatedWords,
        };

        updateAdData({
            captions: {
                ...adData.captions!,
                segments: newSegments,
            },
        });
    };

    const updateStyle = (updates: Partial<CaptionStyle>) => {
        setCaptionStyle({ ...captionStyle, ...updates });
    };

    return (
        <div className="bg-card border border-border rounded-xl shadow-xl overflow-hidden flex flex-col h-[600px]">
            <div className="bg-muted/30 border-b border-border p-4 flex items-center justify-between">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Settings2 className="w-5 h-5 text-primary" />
                    Estúdio de Legendas
                </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                {/* Style Controls Section */}
                <div className="space-y-4">
                    <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2 uppercase tracking-wider">
                        <PaintBucket className="w-4 h-4" />
                        Aparência
                    </h4>

                    {/* Font Family */}
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-foreground">
                            <span>Fonte</span>
                            <span className="font-mono text-[10px]">{captionStyle.fontFamily || 'Poppins'}</span>
                        </div>
                        <select
                            value={captionStyle.fontFamily || 'Poppins'}
                            onChange={(e) => updateStyle({ fontFamily: e.target.value })}
                            className="w-full bg-input/50 hover:bg-input border border-border/50 rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all cursor-pointer"
                        >
                            <option value="Poppins">Poppins</option>
                            <option value="Impact">Impact</option>
                            <option value="Montserrat">Montserrat</option>
                            <option value="Anton">Anton</option>
                            <option value="Bebas Neue">Bebas Neue</option>
                        </select>
                    </div>

                    {/* Font Size */}
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-foreground">
                            <span>Tamanho da Fonte</span>
                            <span className="font-mono">{captionStyle.fontSize}px</span>
                        </div>
                        <input
                            type="range"
                            min="8"
                            max="80"
                            step="2"
                            value={captionStyle.fontSize}
                            onChange={(e) => updateStyle({ fontSize: parseInt(e.target.value) })}
                            className="w-full accent-primary"
                        />
                    </div>

                    {/* Stroke Width */}
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-foreground">
                            <span className="flex items-center gap-1">
                                <TypeOutline className="w-3 h-3" />
                                Contorno
                            </span>
                            <span className="font-mono">{captionStyle.strokeWidth}px</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="12"
                            step="1"
                            value={captionStyle.strokeWidth}
                            onChange={(e) => updateStyle({ strokeWidth: parseInt(e.target.value) })}
                            className="w-full accent-primary"
                        />
                    </div>

                    {/* Vertical Position */}
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-foreground">
                            <span>Altura (Posição)</span>
                            <span className="font-mono">{captionStyle.verticalPosition ?? 15}%</span>
                        </div>
                        <input
                            type="range"
                            min="5"
                            max="50"
                            step="1"
                            value={captionStyle.verticalPosition ?? 15}
                            onChange={(e) => updateStyle({ verticalPosition: parseInt(e.target.value) })}
                            className="w-full accent-primary"
                        />
                    </div>

                    {/* Colors Grid */}
                    <div className="grid grid-cols-3 gap-3 pt-2">
                        <div className="space-y-1.5">
                            <label className="text-[10px] text-muted-foreground uppercase text-center block">
                                Destaque
                            </label>
                            <input
                                type="color"
                                value={captionStyle.activeColor}
                                onChange={(e) => updateStyle({ activeColor: e.target.value })}
                                className="w-full h-8 rounded cursor-pointer border-0 p-0"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] text-muted-foreground uppercase text-center block">
                                Letra
                            </label>
                            <input
                                type="color"
                                value={captionStyle.baseColor}
                                onChange={(e) => updateStyle({ baseColor: e.target.value })}
                                className="w-full h-8 rounded cursor-pointer border-0 p-0"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] text-muted-foreground uppercase text-center block">
                                Borda
                            </label>
                            <input
                                type="color"
                                value={captionStyle.strokeColor}
                                onChange={(e) => updateStyle({ strokeColor: e.target.value })}
                                className="w-full h-8 rounded cursor-pointer border-0 p-0"
                            />
                        </div>
                    </div>
                </div>

                {/* Text Editor Section */}
                <div className="space-y-3 pt-4 border-t border-border/50">
                    <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2 uppercase tracking-wider">
                        <Type className="w-4 h-4" />
                        Texto da Legenda
                    </h4>
                    <div className="space-y-2">
                        {adData.captions.segments.map((segment, index) => (
                            <div key={segment.id} className="relative group">
                                <span className="absolute left-2 top-2 text-[10px] text-muted-foreground font-mono">
                                    {segment.start.toFixed(1)}s
                                </span>
                                <textarea
                                    className="w-full bg-input/50 hover:bg-input focus:bg-input border border-border/50 rounded-lg pl-10 pr-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all resize-none min-h-[60px]"
                                    value={segment.text}
                                    onChange={(e) => handleTextChange(index, e.target.value)}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
