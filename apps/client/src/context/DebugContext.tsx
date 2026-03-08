import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type LogLevel = 'error' | 'warn' | 'info' | 'log';

export interface LogEntry {
    id: number;
    level: LogLevel;
    message: string;
    timestamp: string;
    stack?: string;
}

interface DebugContextType {
    logs: LogEntry[];
    clearLogs: () => void;
    addLog: (level: LogLevel, message: string, stack?: string) => void;
}

const DebugContext = createContext<DebugContextType | undefined>(undefined);

let _counter = 0;

export const DebugProvider = ({ children }: { children: ReactNode }) => {
    const [logs, setLogs] = useState<LogEntry[]>([]);

    const addLog = useCallback((level: LogLevel, message: string, stack?: string) => {
        const entry: LogEntry = {
            id: ++_counter,
            level,
            message: String(message).slice(0, 2000),
            timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
            stack,
        };
        setLogs((prev) => [entry, ...prev].slice(0, 200)); // keep last 200
    }, []);

    const clearLogs = useCallback(() => setLogs([]), []);

    // Intercept console methods
    useEffect(() => {
        const origError = console.error.bind(console);
        const origWarn = console.warn.bind(console);
        const origLog = console.log.bind(console);

        console.error = (...args: unknown[]) => {
            origError(...args);
            const err = args[0];
            addLog(
                'error',
                args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '),
                err instanceof Error ? err.stack : undefined
            );
        };

        console.warn = (...args: unknown[]) => {
            origWarn(...args);
            addLog('warn', args.map(String).join(' '));
        };

        console.log = (...args: unknown[]) => {
            origLog(...args);
            // Only capture logs that look like app events (not noisy React internals)
            const msg = args.map(String).join(' ');
            if (msg.includes('[debug]') || msg.includes('[preview]') || msg.includes('[audio]')) {
                addLog('log', msg);
            }
        };

        // Global unhandled errors
        const handleError = (e: ErrorEvent) => {
            addLog('error', `[Uncaught] ${e.message} @ ${e.filename}:${e.lineno}`, e.error?.stack);
        };
        const handleRejection = (e: PromiseRejectionEvent) => {
            addLog('error', `[UnhandledPromise] ${String(e.reason)}`);
        };

        window.addEventListener('error', handleError);
        window.addEventListener('unhandledrejection', handleRejection);

        return () => {
            console.error = origError;
            console.warn = origWarn;
            console.log = origLog;
            window.removeEventListener('error', handleError);
            window.removeEventListener('unhandledrejection', handleRejection);
        };
    }, [addLog]);

    return <DebugContext.Provider value={{ logs, clearLogs, addLog }}>{children}</DebugContext.Provider>;
};

export const useDebug = () => {
    const ctx = useContext(DebugContext);
    if (!ctx) throw new Error('useDebug must be used within DebugProvider');
    return ctx;
};
