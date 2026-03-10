import React, { useState, useRef, useEffect } from 'react';
import { Bug, X, Trash2, Copy, ChevronDown, ChevronUp, Cpu, MemoryStick } from 'lucide-react';
import { useDebug, type LogLevel } from '../context/DebugContext';
import { cn } from '../lib/utils';

const LEVEL_STYLES: Record<LogLevel, string> = {
    error: 'text-red-400 bg-red-500/10 border-l-2 border-red-500',
    warn: 'text-yellow-400 bg-yellow-500/10 border-l-2 border-yellow-500',
    info: 'text-blue-400 bg-blue-500/10 border-l-2 border-blue-500',
    log: 'text-muted-foreground bg-transparent border-l-2 border-border',
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    error: 'ERR',
    warn: 'WRN',
    info: 'INF',
    log: 'LOG',
};

// Simple FPS + memory monitor hook
function usePerf() {
    const [fps, setFps] = useState(0);
    const [mem, setMem] = useState<number | null>(null);
    const frames = useRef(0);
    const last = useRef(performance.now());
    const rafId = useRef(0);

    useEffect(() => {
        const tick = () => {
            frames.current++;
            const now = performance.now();
            if (now - last.current >= 1000) {
                setFps(Math.round((frames.current * 1000) / (now - last.current)));
                frames.current = 0;
                last.current = now;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const perf = performance as any;
                if (perf.memory) {
                    setMem(Math.round(perf.memory.usedJSHeapSize / 1024 / 1024));
                }
            }
            rafId.current = requestAnimationFrame(tick);
        };
        rafId.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId.current);
    }, []);

    return { fps, mem };
}

export const DebugPanel: React.FC = () => {
    const { logs, clearLogs } = useDebug();
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState<LogLevel | 'all'>('error');
    const [copied, setCopied] = useState(false);
    const [stackOpen, setStackOpen] = useState<number | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const { fps, mem } = usePerf();

    const errorCount = logs.filter((l) => l.level === 'error').length;
    const warnCount = logs.filter((l) => l.level === 'warn').length;

    const visible = filter === 'all' ? logs : logs.filter((l) => l.level === filter);

    const handleCopy = () => {
        const text = visible
            .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}${l.stack ? '\n' + l.stack : ''}`)
            .join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    // Scroll to top when new logs arrive
    useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [logs.length]);

    return (
        <div className="fixed bottom-4 left-4 z-9999 flex flex-col items-start gap-2">
            {/* Panel */}
            {open && (
                <div className="w-[420px] max-h-[520px] bg-zinc-950/95 backdrop-blur border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
                        <Bug className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-xs font-bold text-foreground flex-1">Debug Panel</span>

                        {/* Perf stats */}
                        <div className="flex items-center gap-2 text-[10px] font-mono mr-2">
                            <span
                                className={cn(
                                    'flex items-center gap-1',
                                    fps < 30 ? 'text-red-400' : fps < 50 ? 'text-yellow-400' : 'text-green-400'
                                )}
                            >
                                <Cpu className="w-3 h-3" />
                                {fps} fps
                            </span>
                            {mem !== null && (
                                <span className="text-zinc-400 flex items-center gap-1">
                                    <MemoryStick className="w-3 h-3" />
                                    {mem} MB
                                </span>
                            )}
                        </div>

                        {/* Actions */}
                        <button
                            onClick={handleCopy}
                            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-foreground transition-colors"
                            title="Copiar logs"
                        >
                            {copied ? (
                                <span className="text-green-400 text-[10px] font-bold">OK!</span>
                            ) : (
                                <Copy className="w-3.5 h-3.5" />
                            )}
                        </button>
                        <button
                            onClick={clearLogs}
                            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-foreground transition-colors"
                            title="Limpar logs"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => setOpen(false)}
                            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-foreground transition-colors"
                            title="Fechar"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {/* Filters */}
                    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800 shrink-0 bg-zinc-900/50">
                        {(['all', 'error', 'warn', 'log'] as const).map((lvl) => (
                            <button
                                key={lvl}
                                onClick={() => setFilter(lvl)}
                                className={cn(
                                    'px-2 py-0.5 rounded text-[10px] font-mono transition-colors',
                                    filter === lvl
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-zinc-400 hover:bg-zinc-700 hover:text-foreground'
                                )}
                            >
                                {lvl === 'all'
                                    ? `Todos (${logs.length})`
                                    : lvl === 'error'
                                      ? `Erro (${errorCount})`
                                      : lvl === 'warn'
                                        ? `Warn (${warnCount})`
                                        : 'Log'}
                            </button>
                        ))}
                    </div>

                    {/* Log list */}
                    <div ref={listRef} className="flex-1 overflow-y-auto font-mono text-[11px]">
                        {visible.length === 0 ? (
                            <div className="p-6 text-center text-zinc-600 text-xs">Nenhum log ainda</div>
                        ) : (
                            visible.map((entry) => (
                                <div
                                    key={entry.id}
                                    className={cn('px-3 py-1.5 border-b border-zinc-900', LEVEL_STYLES[entry.level])}
                                >
                                    <div className="flex items-start gap-2">
                                        <span className="text-zinc-600 shrink-0 mt-0.5">{entry.timestamp}</span>
                                        <span
                                            className={cn('shrink-0 font-bold text-[10px] mt-0.5', {
                                                'text-red-400': entry.level === 'error',
                                                'text-yellow-400': entry.level === 'warn',
                                                'text-blue-400': entry.level === 'info',
                                                'text-zinc-400': entry.level === 'log',
                                            })}
                                        >
                                            {LEVEL_LABELS[entry.level]}
                                        </span>
                                        <span className="break-all flex-1 leading-relaxed">{entry.message}</span>
                                        {entry.stack && (
                                            <button
                                                onClick={() => setStackOpen(stackOpen === entry.id ? null : entry.id)}
                                                className="shrink-0 text-zinc-500 hover:text-zinc-300"
                                            >
                                                {stackOpen === entry.id ? (
                                                    <ChevronUp className="w-3 h-3" />
                                                ) : (
                                                    <ChevronDown className="w-3 h-3" />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                    {entry.stack && stackOpen === entry.id && (
                                        <pre className="mt-1 text-[10px] text-zinc-500 whitespace-pre-wrap pl-10 leading-relaxed">
                                            {entry.stack}
                                        </pre>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Floating bug button */}
            <button
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-full shadow-lg border transition-all',
                    'bg-zinc-900/95 backdrop-blur border-zinc-700 hover:border-zinc-500',
                    errorCount > 0 ? 'border-red-500/60 shadow-red-500/20' : warnCount > 0 ? 'border-yellow-500/60' : ''
                )}
            >
                <Bug
                    className={cn(
                        'w-4 h-4',
                        errorCount > 0 ? 'text-red-400' : warnCount > 0 ? 'text-yellow-400' : 'text-zinc-400'
                    )}
                />
                <span className="text-[11px] font-mono text-zinc-300">{fps} fps</span>
                {errorCount > 0 && (
                    <span className="text-[10px] font-bold text-foreground bg-red-500 rounded-full px-1.5 py-0.5 leading-none">
                        {errorCount}
                    </span>
                )}
                {errorCount === 0 && warnCount > 0 && (
                    <span className="text-[10px] font-bold text-black bg-yellow-400 rounded-full px-1.5 py-0.5 leading-none">
                        {warnCount}
                    </span>
                )}
            </button>
        </div>
    );
};
