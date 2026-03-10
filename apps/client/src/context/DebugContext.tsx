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
            // Capture all UI logs
            const msg = args.map(String).join(' ');
            addLog('log', msg);
        };

        // Backend Log Polling
        let isFetching = false;
        const fetchBackendLogs = async () => {
            if (isFetching) return;
            isFetching = true;
            try {
                const API =
                    import.meta.env.VITE_API_BASE_URL || (window as any).API_BASE_URL || 'http://localhost:3301';
                const res = await fetch(`${API}/api/debug/logs`);
                const data = await res.json();

                if (data.ok && data.logs) {
                    setLogs((prev) => {
                        // Merge frontend and backend logs
                        const newLogs = [...prev];
                        let updated = false;

                        data.logs.forEach((blog: any) => {
                            // Simple deduplication strategy using id from backend
                            if (!newLogs.some((l) => l.stack === blog.id)) {
                                newLogs.push({
                                    id: ++_counter,
                                    level: blog.level === 'warn' ? 'warn' : blog.level === 'error' ? 'error' : 'log',
                                    message: `[BACKEND] ${blog.message}`,
                                    timestamp: new Date(blog.timestamp).toLocaleTimeString('pt-BR', { hour12: false }),
                                    stack: blog.id, // use stack to store backend ID for deduplication
                                });
                                updated = true;
                            }
                        });

                        // Only sort and slice if we actually added new backend logs
                        if (updated) {
                            const parseTime = (t: string) => {
                                const parts = t.split(':').map(Number);
                                if (parts.length < 3) return 0;
                                return parts[0] * 3600 + parts[1] * 60 + parts[2];
                            };

                            return [...newLogs]
                                .sort((a, b) => parseTime(b.timestamp) - parseTime(a.timestamp))
                                .slice(0, 500);
                        }
                        return prev;
                    });
                }
            } catch (err) {
                // Ignore fetch errors
            } finally {
                isFetching = false;
            }
        };

        const intervalId = setInterval(fetchBackendLogs, 2000);

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
            clearInterval(intervalId);
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
