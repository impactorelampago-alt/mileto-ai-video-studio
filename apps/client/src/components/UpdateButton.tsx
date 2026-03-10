import { useEffect, useState, useRef } from 'react';
import { RefreshCw, Download, CheckCircle, AlertCircle, ArrowUpCircle } from 'lucide-react';

type UpdateState =
    | { type: 'idle' }
    | { type: 'checking'; percent: number }
    | { type: 'not-available' }
    | { type: 'available'; version: string }
    | { type: 'progress'; percent: number }
    | { type: 'downloaded' }
    | { type: 'error'; message: string };

const getElectronAPI = () => {
    try {
        if ((window as any).electronAPI) return (window as any).electronAPI;
        const { ipcRenderer } = (window as any).require('electron');
        return {
            checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
            installUpdate: () => ipcRenderer.invoke('install-update'),
            onUpdateStatus: (cb: (data: any) => void) => {
                const handler = (_: any, data: any) => cb(data);
                ipcRenderer.on('update-status', handler);
                return () => ipcRenderer.removeListener('update-status', handler);
            },
        };
    } catch {
        return null;
    }
};

export const UpdateButton = () => {
    const [state, setState] = useState<UpdateState>({ type: 'idle' });
    const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Stop any running fake-progress ticker
    const stopFakeTick = () => {
        if (tickRef.current) {
            clearTimeout(tickRef.current);
            tickRef.current = null;
        }
    };

    // Animate fake progress from current pct → 95%, ~80ms per step
    const runFakeTick = (currentPct: number) => {
        stopFakeTick();
        if (currentPct >= 95) return; // Hold at 95 until real result arrives
        const next = Math.min(currentPct + Math.random() * 10 + 4, 95);
        tickRef.current = setTimeout(() => {
            setState((prev) => {
                if (prev.type !== 'checking') return prev;
                return { type: 'checking', percent: Math.round(next) };
            });
            runFakeTick(Math.round(next));
        }, 80);
    };

    useEffect(() => {
        const api = getElectronAPI();
        if (!api) return;

        const cleanup = api.onUpdateStatus((data: any) => {
            stopFakeTick();
            if (resetRef.current) clearTimeout(resetRef.current);

            if (data.type === 'not-available' || data.type === 'error') {
                // Both cases = up to date (errors are typically "no update found" in Electron)
                setState({ type: 'checking', percent: 100 });
                resetRef.current = setTimeout(() => {
                    setState({ type: 'not-available' });
                    resetRef.current = setTimeout(() => setState({ type: 'idle' }), 4000);
                }, 350);
            } else {
                setState(data);
            }
        });

        return () => {
            cleanup?.();
            stopFakeTick();
            if (resetRef.current) clearTimeout(resetRef.current);
        };
    }, []);

    const handleClick = async () => {
        const api = getElectronAPI();
        if (!api) return;

        if (state.type === 'downloaded') {
            await api.installUpdate();
            return;
        }

        if (state.type === 'idle' || state.type === 'not-available' || state.type === 'error') {
            if (resetRef.current) clearTimeout(resetRef.current);
            stopFakeTick();

            // Start fake progress bar immediately — gives instant visual feedback
            setState({ type: 'checking', percent: 0 });
            runFakeTick(0);

            try {
                await api.checkForUpdates();
            } catch (err) {
                // checkForUpdates() threw locally — treat as "up to date"
                // (typical in dev mode or when no update server is configured)
                stopFakeTick();
                setState({ type: 'checking', percent: 100 });
                resetRef.current = setTimeout(() => {
                    setState({ type: 'not-available' });
                    resetRef.current = setTimeout(() => setState({ type: 'idle' }), 4000);
                }, 350);
                console.warn('[update] checkForUpdates threw:', err);
            }
        }
    };

    // ── Render helpers ──────────────────────────────────────────────────────

    // CHECKING STATE: fake scanning progress bar
    if (state.type === 'checking') {
        return (
            <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-accent/5 border border-brand-accent/20 min-w-[160px] overflow-hidden select-none">
                {/* Animated fill */}
                <div
                    className="absolute left-0 top-0 bottom-0 bg-brand-accent/15 transition-all duration-150"
                    style={{ width: `${state.percent}%` }}
                />
                <RefreshCw className="w-3.5 h-3.5 text-brand-accent/80 shrink-0 relative z-10 animate-spin" />
                <span className="text-xs font-bold text-brand-accent/70 relative z-10 flex-1">
                    {state.percent < 100 ? 'Verificando...' : 'Concluído'}
                </span>
                <span className="text-xs font-bold text-brand-accent/70 relative z-10 tabular-nums">
                    {state.percent}%
                </span>
            </div>
        );
    }

    // PROGRESS STATE: real download progress bar
    if (state.type === 'progress') {
        return (
            <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-accent/10 border border-brand-accent/30 min-w-[160px] overflow-hidden select-none">
                <div
                    className="absolute left-0 top-0 bottom-0 bg-brand-accent/20 transition-all duration-300"
                    style={{ width: `${state.percent}%` }}
                />
                <Download className="w-3.5 h-3.5 text-brand-accent shrink-0 relative z-10 animate-pulse" />
                <span className="text-xs font-bold text-brand-accent relative z-10 flex-1">Baixando...</span>
                <span className="text-xs font-bold text-brand-accent relative z-10 tabular-nums">{state.percent}%</span>
            </div>
        );
    }

    // AVAILABLE STATE: glowing green pulse button
    if (state.type === 'available') {
        return (
            <button
                onClick={handleClick}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer
                    bg-brand-accent text-black shadow-[0_0_16px_rgba(0,230,118,0.5)]
                    hover:shadow-[0_0_28px_rgba(0,230,118,0.8)] hover:scale-105 active:scale-95
                    animate-[pulse_2s_ease-in-out_infinite]"
                title={`Versão ${state.version} disponível`}
            >
                <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
                Atualizar Agora
            </button>
        );
    }

    // DOWNLOADED STATE: solid green, ready to install
    if (state.type === 'downloaded') {
        return (
            <button
                onClick={handleClick}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer
                    bg-brand-accent text-black hover:brightness-110 hover:scale-105 active:scale-95"
            >
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                Instalar Agora
            </button>
        );
    }

    // NOT AVAILABLE: brief success message
    if (state.type === 'not-available') {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold text-brand-accent select-none">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                Você está atualizado
            </div>
        );
    }

    // ERROR
    if (state.type === 'error') {
        return (
            <button
                onClick={handleClick}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-500 hover:bg-red-500/10 transition-all"
                title={state.message}
            >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Tentar novamente
            </button>
        );
    }

    // IDLE (default)
    return (
        <button
            onClick={handleClick}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold text-foreground/50 hover:bg-black/5 dark:hover:bg-white/5 hover:text-foreground border border-transparent hover:border-black/10 dark:hover:border-white/10 transition-all duration-200"
            title="Verificar se há atualizações disponíveis"
        >
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            Verificar Atualizações
        </button>
    );
};
