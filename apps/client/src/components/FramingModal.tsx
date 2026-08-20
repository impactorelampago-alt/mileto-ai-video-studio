import React, { useState } from 'react';
import { Crop, Ban, X, Check } from 'lucide-react';
import { FramingEditor } from './FramingEditor';
import type { TakeFramingRecord } from '../lib/opsTakeCuration';

// Modal focado só no enquadramento 1:1 (aberto pelo card do acervo). Não mexe no
// tempo do take — só na faixa que aparece quando a saída é quadrada + na marca
// "ignorar 1:1". Guarda um rascunho local e devolve o registro no "Salvar".

interface FramingModalProps {
    fileName: string;
    src: string;
    type: 'video' | 'image';
    initial?: TakeFramingRecord | null;
    onSave: (record: TakeFramingRecord) => void;
    onClose: () => void;
}

export const FramingModal: React.FC<FramingModalProps> = ({ fileName, src, type, initial, onSave, onClose }) => {
    const [framing, setFraming] = useState<{ x: number; y: number } | undefined>(initial?.framing);
    const [ignoreSquare, setIgnoreSquare] = useState<boolean>(Boolean(initial?.ignoreSquare));

    return (
        <div
            className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md rounded-2xl border border-white/10 bg-card p-5 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-3 flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/15 text-violet-300">
                        <Crop className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-sm font-black uppercase tracking-wider text-foreground">Enquadramento 1:1</h3>
                        <p className="truncate text-[11px] text-brand-muted" title={fileName}>{fileName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-brand-muted transition hover:bg-white/5 hover:text-foreground"
                        aria-label="Fechar"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <FramingEditor
                    src={src}
                    type={type}
                    value={framing}
                    onChange={setFraming}
                    disabled={ignoreSquare}
                    heightPx={300}
                />

                <p className="mt-2 text-[11px] text-brand-muted">
                    Arraste o quadrado pra escolher a faixa que aparece no vídeo quadrado. O que fica fora é descartado.
                </p>

                <button
                    type="button"
                    onClick={() => setIgnoreSquare((value) => !value)}
                    className={`mt-3 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-bold transition ${
                        ignoreSquare
                            ? 'border-red-400/50 bg-red-500/15 text-red-200'
                            : 'border-white/10 text-brand-muted hover:border-red-400/40 hover:text-red-300'
                    }`}
                >
                    <Ban className="h-4 w-4 shrink-0" />
                    <span className="flex-1">Ignorar no 1:1 — a IA não escolhe este take</span>
                    <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${ignoreSquare ? 'bg-red-500' : 'bg-white/15'}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${ignoreSquare ? 'right-0.5' : 'left-0.5'}`} />
                    </span>
                </button>

                <div className="mt-4 flex items-center justify-end gap-2">
                    <button onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-brand-muted transition hover:text-foreground">
                        Cancelar
                    </button>
                    <button
                        onClick={() => onSave({ framing, ignoreSquare })}
                        className="flex items-center gap-2 rounded-lg bg-linear-to-r from-brand-lime to-brand-accent px-5 py-2 text-xs font-extrabold uppercase tracking-wider text-[#0a0f12] transition hover:scale-[1.02]"
                    >
                        <Check className="h-4 w-4" /> Salvar
                    </button>
                </div>
            </div>
        </div>
    );
};
