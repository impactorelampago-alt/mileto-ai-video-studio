import express from 'express';

// Define the log structure matching what the frontend expects or a general format
export interface LogEntry {
    id: string;
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    source: 'backend';
}

class GlobalLogger {
    private logs: LogEntry[] = [];
    private maxLogs = 500;
    private originalConsoleLog = console.log;
    private originalConsoleError = console.error;
    private originalConsoleWarn = console.warn;

    constructor() {
        this.overrideConsole();
    }

    private addLog(level: LogEntry['level'], ...args: any[]) {
        const message = args
            .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ');

        const entry: LogEntry = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: new Date().toISOString(),
            level,
            message,
            source: 'backend',
        };

        this.logs.unshift(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }
    }

    private overrideConsole() {
        console.log = (...args) => {
            this.originalConsoleLog.apply(console, args);
            this.addLog('info', ...args);
        };
        console.error = (...args) => {
            this.originalConsoleError.apply(console, args);
            this.addLog('error', ...args);
        };
        console.warn = (...args) => {
            this.originalConsoleWarn.apply(console, args);
            this.addLog('warn', ...args);
        };
    }

    public getLogs(): LogEntry[] {
        return this.logs;
    }

    public clearLogs() {
        this.logs = [];
    }
}

export const serverLogger = new GlobalLogger();

// Express Middleware to intercept requests
export const requestInterceptor = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const start = Date.now();
    const { method, url, body } = req;

    if (
        url.includes('/api/debug/logs') ||
        url.includes('/api/music/list') ||
        url.includes('/api/projects/default') ||
        url.includes('/health')
    ) {
        return next();
    }

    // Log incoming request
    let bodyStr = '';
    if (body && Object.keys(body).length > 0) {
        // Obfuscate api keys
        const safeBody = { ...body };
        if (safeBody.apiKey) safeBody.apiKey = '***';
        bodyStr = `| Body: ${JSON.stringify(safeBody).substring(0, 500)}`;
    }

    console.log(`[REQ] ${method} ${url} ${bodyStr}`);

    // Intercept response finish
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[RES] ${method} ${url} - Status: ${res.statusCode} - ${duration}ms`);
    });

    next();
};
