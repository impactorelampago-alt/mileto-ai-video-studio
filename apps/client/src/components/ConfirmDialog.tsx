import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, FolderPlus } from 'lucide-react';
import { cn } from '../lib/utils';

type Variant = 'danger' | 'accent';

interface BaseProps {
    title: string;
    message?: string;
    onClose: () => void;
}

interface ConfirmProps extends BaseProps {
    mode: 'confirm';
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: Variant;
    onConfirm: () => void;
}

interface PromptProps extends BaseProps {
    mode: 'prompt';
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: (value: string) => void;
}

type Props = ConfirmProps | PromptProps;

/**
 * Diálogo premium reutilizável (confirm / prompt) seguindo a identidade visual
 * do Mileto: fundo escuro, glow verde, scanlines HUD, cantos arredondados.
 * Substitui os window.confirm / window.prompt nativos, que destoavam da UI.
 */
export const ConfirmDialog = (props: Props) => {
    const { title, message, onClose, mode, confirmLabel, cancelLabel } = props;
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        // Foca o input no modo prompt e seleciona tudo.
        if (mode === 'prompt') {
            const t = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(t);
        }
    }, [mode]);

    // ESC fecha; Enter confirma.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && mode === 'confirm') {
                (props as ConfirmProps).onConfirm();
            }
            if (e.key === 'Enter' && mode === 'prompt' && value.trim()) {
                (props as PromptProps).onConfirm(value.trim());
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [mode, onClose, props, value]);

    const variant: Variant = mode === 'confirm' ? (props as ConfirmProps).variant ?? 'danger' : 'accent';
    const isDanger = variant === 'danger';

    const handleConfirm = () => {
        if (mode === 'confirm') (props as ConfirmProps).onConfirm();
        else if (value.trim()) (props as PromptProps).onConfirm(value.trim());
    };

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="bg-brand-dark/95 border border-brand-accent/30 rounded-3xl w-full max-w-md shadow-[0_0_50px_rgba(0,230,118,0.15)] flex flex-col overflow-hidden relative z-[201] ring-1 ring-white/5 animate-[fadeIn_0.15s_ease-out]">
                {/* Scanlines HUD */}
                <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[20px_20px] opacity-20"></div>

                {/* Header com ícone */}
                <div className="flex items-start justify-between px-6 py-5 border-b border-black/10 dark:border-white/10 bg-brand-card/50 shrink-0 relative z-10 gap-4">
                    <div className="flex items-center gap-4">
                        <div
                            className={cn(
                                'p-2.5 rounded-xl border shadow-[0_0_15px_rgba(0,230,118,0.2)]',
                                isDanger
                                    ? 'bg-red-500/10 border-red-500/25 shadow-[0_0_15px_rgba(239,68,68,0.25)]'
                                    : 'bg-brand-accent/10 border-brand-accent/20'
                            )}
                        >
                            {mode === 'prompt' ? (
                                <FolderPlus className={cn('w-6 h-6', isDanger ? 'text-red-400' : 'text-brand-accent drop-shadow-[0_0_8px_rgba(0,230,118,0.8)]')} />
                            ) : (
                                <AlertTriangle className={cn('w-6 h-6', isDanger ? 'text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'text-brand-accent drop-shadow-[0_0_8px_rgba(0,230,118,0.8)]')} />
                            )}
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-black uppercase tracking-wider text-foreground text-[15px] drop-shadow-md break-words">
                                {title}
                            </h3>
                            {message && (
                                <p className="text-[12px] text-brand-muted font-medium mt-1.5 leading-relaxed break-words">
                                    {message}
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 bg-black/5 dark:bg-white/5 hover:bg-red-500/20 rounded-full text-brand-muted hover:text-red-400 transition-all border border-transparent hover:border-red-500/30 shrink-0"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Corpo (input só no modo prompt) */}
                <div className="p-6 flex flex-col gap-5 relative z-10">
                    {mode === 'prompt' && (
                        <input
                            ref={inputRef}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={(props as PromptProps).placeholder}
                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-brand-muted/50 outline-none focus:border-brand-accent/50 focus:bg-black/40 transition-all"
                        />
                    )}

                    {/* Botões */}
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-foreground border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all uppercase tracking-wider"
                        >
                            {cancelLabel || 'Cancelar'}
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={mode === 'prompt' && !value.trim()}
                            className={cn(
                                'flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed',
                                isDanger
                                    ? 'bg-red-500 text-white hover:bg-red-600 hover:shadow-[0_0_25px_rgba(239,68,68,0.4)]'
                                    : 'bg-brand-lime text-[#0a0f12] hover:brightness-110 hover:shadow-[0_0_25px_rgba(0,230,118,0.35)]'
                            )}
                        >
                            {confirmLabel || (mode === 'prompt' ? 'Criar' : 'Confirmar')}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ConfirmDialog;
