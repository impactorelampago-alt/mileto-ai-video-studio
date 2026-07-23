import React, { useState } from 'react';
import { useWizard } from '../context/WizardContext';
import { X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface ApiConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ApiConfigModal: React.FC<ApiConfigModalProps> = ({ isOpen, onClose }) => {
    const { apiKeys, setApiKey } = useWizard();
    const [validating, setValidating] = useState<Record<string, boolean>>({});
    const [valid, setValid] = useState<Record<string, boolean>>({});
    const [fishWallet, setFishWallet] = useState<{ credit: number; accountId: string | null } | null>(null);

    if (!isOpen) return null;

    const validateKey = async (
        provider: 'gemini' | 'openai' | 'fishAudio' | 'elevenLabs' | 'replicate' | 'runway',
        rawKey: string
    ) => {
        const key = rawKey.trim();
        if (!key) return;

        setValidating((prev) => ({ ...prev, [provider]: true }));

        try {
            let endpoint = `${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/test-${provider.toLowerCase()}`;
            // Adaptation for new integration routes
            if (provider === 'replicate') {
                endpoint = `${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/integrations/replicate/test`;
            } else if (provider === 'runway') {
                endpoint = `${((window as any).API_BASE_URL || 'http://localhost:3301')}/api/runway/validate`;
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Pass specific headers for new integrations
                    ...(provider === 'replicate' ? { 'X-Replicate-Token': key } : {}),
                    ...(provider === 'runway' ? { 'X-Runway-Token': key } : {}),
                },
                body: JSON.stringify({ apiKey: key }),
            });

            const data = await response.json();

            if (data.ok) {
                setValid((prev) => ({ ...prev, [provider]: true }));

                // A Fish devolve saldo e id da conta: é o que distingue "chave errada"
                // de "chave certa sem crédito".
                if (provider === 'fishAudio' && typeof data.credit === 'number') {
                    setFishWallet({ credit: data.credit, accountId: data.accountId ?? null });
                    if (data.credit <= 0) {
                        toast.error(
                            `Chave válida, mas a conta ${data.accountId ?? ''} está com saldo de API US$ ${data.credit.toFixed(2)}. Confira se é a mesma conta do painel da Fish.`,
                            { duration: 12000 }
                        );
                    } else {
                        toast.success(`Fish Audio conectada · saldo US$ ${data.credit.toFixed(2)}`);
                    }
                } else {
                    toast.success(`${provider} API Connected`);
                }
            } else {
                setValid((prev) => ({ ...prev, [provider]: false }));
                toast.error(`Error: ${data.message}`);
            }
        } catch {
            toast.error('Failed to connect to backend server');
            setValid((prev) => ({ ...prev, [provider]: false }));
        } finally {
            setValidating((prev) => ({ ...prev, [provider]: false }));
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="bg-card border border-border w-full max-w-md rounded-lg p-6 shadow-xl relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
                >
                    <X className="w-5 h-5" />
                </button>

                <h2 className="text-xl font-bold mb-4 text-foreground">Configurações de API</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    Insira suas chaves de API para habilitar as funcionalidades de IA.
                </p>

                <div className="space-y-4">
                    {/* Gemini */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">
                            Gemini API Key <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                            <input
                                type="password"
                                value={apiKeys.gemini}
                                onChange={(e) => setApiKey('gemini', e.target.value)}
                                onBlur={(e) => validateKey('gemini', e.target.value)}
                                className={cn(
                                    'w-full bg-input/50 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 transition-all text-foreground',
                                    valid.gemini
                                        ? 'border-primary/50 focus:ring-primary'
                                        : 'border-input focus:ring-primary'
                                )}
                                placeholder="sk-..."
                            />
                            <div className="absolute right-3 top-2.5">
                                {validating.gemini && (
                                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                )}
                                {!validating.gemini && valid.gemini && <Check className="w-4 h-4 text-primary" />}
                                {!validating.gemini && valid.gemini === false && (
                                    <AlertCircle className="w-4 h-4 text-destructive" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* OpenAI */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">OpenAI API Key (Opcional)</label>
                        <div className="relative">
                            <input
                                type="password"
                                value={apiKeys.openai}
                                onChange={(e) => setApiKey('openai', e.target.value)}
                                onBlur={(e) => validateKey('openai', e.target.value)}
                                className={cn(
                                    'w-full bg-input/50 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 transition-all text-foreground',
                                    valid.openai
                                        ? 'border-primary/50 focus:ring-primary'
                                        : 'border-input focus:ring-primary'
                                )}
                                placeholder="sk-..."
                            />
                            <div className="absolute right-3 top-2.5">
                                {validating.openai && (
                                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                )}
                                {!validating.openai && valid.openai && <Check className="w-4 h-4 text-primary" />}
                                {!validating.openai && valid.openai === false && (
                                    <AlertCircle className="w-4 h-4 text-destructive" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Fish Audio */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">
                            Fish Audio API Key (Opcional)
                        </label>
                        <div className="relative">
                            <input
                                type="password"
                                value={apiKeys.fishAudio}
                                onChange={(e) => setApiKey('fishAudio', e.target.value)}
                                onBlur={(e) => validateKey('fishAudio', e.target.value)}
                                className={cn(
                                    'w-full bg-input/50 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 transition-all text-foreground',
                                    valid.fishAudio
                                        ? 'border-primary/50 focus:ring-primary'
                                        : 'border-input focus:ring-primary'
                                )}
                                placeholder="sk-..."
                            />
                            <div className="absolute right-3 top-2.5">
                                {validating.fishAudio && (
                                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                )}
                                {!validating.fishAudio && valid.fishAudio && <Check className="w-4 h-4 text-primary" />}
                                {!validating.fishAudio && valid.fishAudio === false && (
                                    <AlertCircle className="w-4 h-4 text-destructive" />
                                )}
                            </div>
                        </div>

                        {fishWallet && (
                            <div
                                className={cn(
                                    'text-xs rounded-md px-3 py-2 border',
                                    fishWallet.credit > 0
                                        ? 'text-primary border-primary/30 bg-primary/5'
                                        : 'text-destructive border-destructive/30 bg-destructive/5'
                                )}
                            >
                                <span className="font-semibold">
                                    Saldo de API: US$ {fishWallet.credit.toFixed(4)}
                                </span>
                                {fishWallet.accountId && (
                                    <span className="opacity-70"> · conta {fishWallet.accountId}…</span>
                                )}
                                {fishWallet.credit <= 0 && (
                                    <p className="mt-1 opacity-90 leading-snug">
                                        Sem saldo. Se o painel da Fish mostra saldo, esta chave é de outra
                                        conta — gere uma nova chave na conta certa. O modelo{' '}
                                        <strong>S2.1 Pro grátis</strong> funciona mesmo sem saldo.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ElevenLabs */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">
                            ElevenLabs API Key (Narração expressiva)
                        </label>
                        <div className="relative">
                            <input
                                type="password"
                                value={apiKeys.elevenLabs}
                                onChange={(e) => setApiKey('elevenLabs', e.target.value)}
                                onBlur={(e) => validateKey('elevenLabs', e.target.value)}
                                className={cn(
                                    'w-full bg-input/50 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 transition-all text-foreground',
                                    valid.elevenLabs
                                        ? 'border-primary/50 focus:ring-primary'
                                        : 'border-input focus:ring-primary'
                                )}
                                placeholder="sk_..."
                            />
                            <div className="absolute right-3 top-2.5">
                                {validating.elevenLabs && (
                                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                )}
                                {!validating.elevenLabs && valid.elevenLabs && (
                                    <Check className="w-4 h-4 text-primary" />
                                )}
                                {!validating.elevenLabs && valid.elevenLabs === false && (
                                    <AlertCircle className="w-4 h-4 text-destructive" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Replicate */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">
                            Replicate API Key (Gerar Imagens)
                        </label>
                        <div className="relative">
                            <input
                                type="password"
                                value={apiKeys.replicate || ''}
                                onChange={(e) => setApiKey('replicate', e.target.value)}
                                onBlur={(e) => validateKey('replicate', e.target.value)}
                                className={cn(
                                    'w-full bg-input/50 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 transition-all text-foreground',
                                    valid.replicate
                                        ? 'border-primary/50 focus:ring-primary'
                                        : 'border-input focus:ring-primary',
                                    valid.replicate === false &&
                                        'border-destructive focus:ring-destructive animate-pulse'
                                )}
                                placeholder="r8_..."
                            />
                            <div className="absolute right-3 top-2.5">
                                {validating.replicate && (
                                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                )}
                                {!validating.replicate && valid.replicate && <Check className="w-4 h-4 text-primary" />}
                                {!validating.replicate && valid.replicate === false && (
                                    <AlertCircle className="w-4 h-4 text-destructive" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Runway */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">
                            Runway API Key (Gerar Vídeos)
                        </label>
                        <div className="relative">
                            <input
                                type="password"
                                value={apiKeys.runway || ''}
                                onChange={(e) => setApiKey('runway', e.target.value)}
                                onBlur={(e) => validateKey('runway', e.target.value)}
                                className={cn(
                                    'w-full bg-input/50 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 transition-all text-foreground',
                                    valid.runway
                                        ? 'border-primary/50 focus:ring-primary'
                                        : 'border-input focus:ring-primary',
                                    valid.runway === false && 'border-destructive focus:ring-destructive animate-pulse'
                                )}
                                placeholder="key_..."
                            />
                            <div className="absolute right-3 top-2.5">
                                {validating.runway && (
                                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                )}
                                {!validating.runway && valid.runway && <Check className="w-4 h-4 text-primary" />}
                                {!validating.runway && valid.runway === false && (
                                    <AlertCircle className="w-4 h-4 text-destructive" />
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end">
                    <button
                        onClick={onClose}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm transition-colors"
                    >
                        Pronto
                    </button>
                </div>
            </div>
        </div>
    );
};
