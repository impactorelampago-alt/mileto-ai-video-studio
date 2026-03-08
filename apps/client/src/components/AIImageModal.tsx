import React, { useState } from 'react';
import { X, Loader2, Image as ImageIcon, Sparkles } from 'lucide-react';
import { useWizard } from '../context/WizardContext';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

interface AIImageModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectId?: string;
}

export const AIImageModal: React.FC<AIImageModalProps> = ({ isOpen, onClose, projectId = 'default' }) => {
    const { apiKeys, addMediaTake } = useWizard();
    const [prompt, setPrompt] = useState('');
    const [aspectRatio, setAspectRatio] = useState('1:1');
    const [quality, setQuality] = useState('standard');
    const [isGenerating, setIsGenerating] = useState(false);

    if (!isOpen) return null;

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        if (!apiKeys.replicate) {
            toast.error('Configure a chave da API Replicate primeiro.');
            return;
        }

        setIsGenerating(true);
        try {
            const response = await fetch(`${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/ai/replicate/image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Replicate-Token': apiKeys.replicate,
                },
                body: JSON.stringify({
                    projectId,
                    prompt,
                    aspectRatio,
                    qualityPreset: quality,
                }),
            });

            const data = await response.json();

            if (data.ok && data.asset) {
                // Add to wizard context
                addMediaTake({
                    id: data.asset.id || uuidv4(),
                    fileName: `AI-Image-${Date.now()}`,
                    originalDurationSeconds: 3.5, // Default for image
                    url: `${((window as any).API_BASE_URL || 'http://localhost:3301')}${data.asset.publicUrl}`,
                    type: 'image',
                    trim: { start: 0, end: 3.5 },
                });
                toast.success('Imagem gerada com sucesso!');
                onClose();
            } else {
                toast.error(data.message || 'Erro ao gerar imagem');
            }
        } catch (error) {
            console.error(error);
            toast.error('Falha na comunicação com o servidor');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-primary/10 rounded-lg">
                            <Sparkles className="w-5 h-5 text-primary" />
                        </div>
                        <h2 className="text-lg font-semibold">Gerar Imagem IA</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 overflow-y-auto">
                    {/* Prompt */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Prompt (Descrição)</label>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Descreva a imagem que você quer criar..."
                            className="w-full h-32 bg-input/50 border border-input rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                        />
                    </div>

                    {/* Settings Row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Proporção</label>
                            <select
                                value={aspectRatio}
                                onChange={(e) => setAspectRatio(e.target.value)}
                                className="w-full bg-input/50 border border-input rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            >
                                <option value="1:1">Quadrado (1:1)</option>
                                <option value="16:9">Widescreen (16:9)</option>
                                <option value="9:16">Vertical (9:16)</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Qualidade</label>
                            <select
                                value={quality}
                                onChange={(e) => setQuality(e.target.value)}
                                className="w-full bg-input/50 border border-input rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            >
                                <option value="standard">Padrão</option>
                                <option value="quality">Alta Qualidade</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border bg-muted/20 rounded-b-xl flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-lg transition-colors"
                        disabled={isGenerating}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleGenerate}
                        disabled={!prompt.trim() || isGenerating}
                        className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-primary/20"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Gerando...
                            </>
                        ) : (
                            <>
                                <ImageIcon className="w-4 h-4" />
                                Gerar Imagem
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
