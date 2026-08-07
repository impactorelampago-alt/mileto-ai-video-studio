import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { API_BASE_URL as API } from '../lib/apiBase';

export interface DownloadJobTrack {
    id: string;
    displayName: string;
    originalName: string;
    filePath: string;
    publicUrl: string;
    durationSec: number;
    createdAt: string;
    type: 'audio' | 'video' | 'image';
}

export interface DownloadJobSnapshot {
    id: string;
    phase: 'downloading' | 'done' | 'error';
    percent: number;
    step: 'downloading' | 'processing';
    stepPercent: number;
    mode: 'audio' | 'video' | 'image';
    title?: string;
    destination: string;
    startedAt: number;
    completedAt?: number;
    track?: DownloadJobTrack;
    error?: string;
    source?: 'download' | 'editor-import' | 'ai-generation' | 'export';
    statusText?: string;
    cancellable?: boolean;
    outputPath?: string;
    assetId?: string;
}

export interface InternetDownloadRequest {
    url: string;
    mode: 'audio' | 'video';
    quality: string;
    audioBitrate: number;
    destination: string;
    title?: string;
    onComplete?: (track: DownloadJobTrack) => void;
}

interface RegisterJobDetails {
    mode: DownloadJobSnapshot['mode'];
    title?: string;
    destination: string;
    onComplete?: (track: DownloadJobTrack) => void;
}

interface RegisterClientJobDetails extends RegisterJobDetails {
    id?: string;
    source: 'download' | 'editor-import' | 'ai-generation' | 'export';
    statusText?: string;
}

interface DownloadJobsContextValue {
    jobs: DownloadJobSnapshot[];
    activeCount: number;
    refresh: () => Promise<DownloadJobSnapshot[]>;
    registerJob: (jobId: string, details: RegisterJobDetails) => void;
    registerClientJob: (details: RegisterClientJobDetails) => string;
    updateClientJob: (jobId: string, patch: Partial<DownloadJobSnapshot>) => void;
    enqueueInternetDownloads: (requests: InternetDownloadRequest[]) => number;
    cancelJob: (jobId: string) => Promise<void>;
    clearHistory: () => Promise<number>;
}

const DownloadJobsContext = createContext<DownloadJobsContextValue | null>(null);

export const DownloadJobsProvider = ({ children }: { children: React.ReactNode }) => {
    const [serverJobs, setServerJobs] = useState<DownloadJobSnapshot[]>([]);
    const [clientJobs, setClientJobs] = useState<DownloadJobSnapshot[]>([]);
    const jobsRef = useRef<DownloadJobSnapshot[]>([]);
    const pendingInternetRef = useRef<Array<{ clientJobId: string; request: InternetDownloadRequest }>>([]);
    const pumpingInternetRef = useRef(false);
    const knownPhasesRef = useRef(new Map<string, DownloadJobSnapshot['phase']>());
    const completionCallbacksRef = useRef(new Map<string, (track: DownloadJobTrack) => void>());
    const initializedRef = useRef(false);

    const applyJobs = useCallback((nextJobs: DownloadJobSnapshot[]) => {
        if (initializedRef.current) {
            for (const job of nextJobs) {
                const previousPhase = knownPhasesRef.current.get(job.id);
                if (previousPhase === 'downloading' && job.phase === 'done') {
                    toast.success(`“${job.track?.displayName || job.title || 'Download'}” foi concluído.`);
                    if (job.track) {
                        completionCallbacksRef.current.get(job.id)?.(job.track);
                        window.dispatchEvent(new CustomEvent('mileto:download-complete', { detail: job.track }));
                    }
                    completionCallbacksRef.current.delete(job.id);
                } else if (
                    previousPhase === 'downloading' &&
                    job.phase === 'error' &&
                    job.error !== 'Download cancelado.'
                ) {
                    toast.error(job.error || 'Um download falhou.');
                    completionCallbacksRef.current.delete(job.id);
                }
            }
        }

        knownPhasesRef.current = new Map(nextJobs.map((job) => [job.id, job.phase]));
        initializedRef.current = true;
        jobsRef.current = nextJobs;
        setServerJobs(nextJobs.map((job) => ({ ...job, source: job.source || 'download', cancellable: true })));
    }, []);

    const refresh = useCallback(async () => {
        try {
            const response = await fetch(`${API}/api/download/jobs`, {
                signal: AbortSignal.timeout(10000),
            });
            const data = (await response.json()) as {
                ok: boolean;
                jobs?: DownloadJobSnapshot[];
                message?: string;
            };
            if (!response.ok || !data.ok) throw new Error(data.message || 'Falha ao consultar downloads.');
            const nextJobs = data.jobs || [];
            applyJobs(nextJobs);
            return nextJobs;
        } catch {
            return jobsRef.current;
        }
    }, [applyJobs]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const poll = async () => {
            const nextJobs = await refresh();
            if (cancelled) return;
            const hasActive = nextJobs.some((job) => job.phase === 'downloading');
            timer = setTimeout(() => void poll(), hasActive ? 900 : 4000);
        };

        void poll();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [refresh]);

    const registerJob = useCallback(
        (jobId: string, details: RegisterJobDetails) => {
            if (details.onComplete) {
                completionCallbacksRef.current.set(jobId, details.onComplete);
            }
            knownPhasesRef.current.set(jobId, 'downloading');
            initializedRef.current = true;
            setServerJobs((current) => {
                if (current.some((job) => job.id === jobId)) return current;
                const nextJobs: DownloadJobSnapshot[] = [
                    {
                        id: jobId,
                        phase: 'downloading',
                        percent: 0,
                        step: 'downloading',
                        stepPercent: 0,
                        mode: details.mode,
                        title: details.title,
                        destination: details.destination,
                        startedAt: Date.now(),
                        source: 'download',
                        cancellable: true,
                    },
                    ...current,
                ];
                jobsRef.current = nextJobs;
                return nextJobs;
            });
            void refresh();
        },
        [refresh]
    );

    const registerClientJob = useCallback((details: RegisterClientJobDetails) => {
        const id = details.id || `client-${crypto.randomUUID()}`;
        const job: DownloadJobSnapshot = {
            id,
            phase: 'downloading',
            percent: 0,
            step: 'processing',
            stepPercent: 0,
            mode: details.mode,
            title: details.title,
            destination: details.destination,
            startedAt: Date.now(),
            source: details.source,
            statusText: details.statusText,
            cancellable: false,
        };
        setClientJobs((current) => [job, ...current.filter((candidate) => candidate.id !== id)]);
        return id;
    }, []);

    const updateClientJob = useCallback((jobId: string, patch: Partial<DownloadJobSnapshot>) => {
        setClientJobs((current) =>
            current.map((job) => {
                if (job.id !== jobId) return job;
                const next = { ...job, ...patch };
                if (job.phase === 'downloading' && next.phase === 'done') {
                    toast.success(`“${next.title || 'Atividade'}” foi concluída.`);
                } else if (job.phase === 'downloading' && next.phase === 'error') {
                    toast.error(next.error || 'Uma atividade falhou.');
                }
                return next;
            })
        );
    }, []);

    const pumpInternetDownloads = useCallback(async () => {
        if (pumpingInternetRef.current || pendingInternetRef.current.length === 0) return;
        pumpingInternetRef.current = true;
        try {
            while (pendingInternetRef.current.length > 0) {
                const pending = pendingInternetRef.current[0];
                let response: Response;
                try {
                    response = await fetch(`${API}/api/download/start`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(pending.request),
                    });
                } catch {
                    // O servidor local pode estar reiniciando. Mantém o item na fila.
                    break;
                }

                const data = (await response.json().catch(() => ({}))) as {
                    ok?: boolean;
                    jobId?: string;
                    message?: string;
                };
                if (response.status === 429) break;

                pendingInternetRef.current.shift();
                if (!response.ok || !data.ok || !data.jobId) {
                    updateClientJob(pending.clientJobId, {
                        phase: 'error',
                        error: data.message || `Não foi possível iniciar o download (${response.status}).`,
                        completedAt: Date.now(),
                    });
                    continue;
                }

                setClientJobs((current) => current.filter((job) => job.id !== pending.clientJobId));
                registerJob(data.jobId, {
                    mode: pending.request.mode,
                    title: pending.request.title,
                    destination: pending.request.destination,
                    onComplete: pending.request.onComplete,
                });
            }
        } finally {
            pumpingInternetRef.current = false;
        }
    }, [registerJob, updateClientJob]);

    const enqueueInternetDownloads = useCallback(
        (requests: InternetDownloadRequest[]) => {
            const accepted = requests.slice(0, 50);
            if (!accepted.length) return 0;

            const placeholders = accepted.map((request) => {
                const clientJobId = `internet-queue-${crypto.randomUUID()}`;
                pendingInternetRef.current.push({ clientJobId, request });
                return {
                    id: clientJobId,
                    phase: 'downloading' as const,
                    percent: 0,
                    step: 'downloading' as const,
                    stepPercent: 0,
                    mode: request.mode,
                    title: request.title,
                    destination: request.destination,
                    startedAt: Date.now(),
                    source: 'download' as const,
                    statusText: 'Aguardando vaga na fila',
                    cancellable: false,
                };
            });
            setClientJobs((current) => [...placeholders, ...current]);
            window.setTimeout(() => void pumpInternetDownloads(), 0);
            return accepted.length;
        },
        [pumpInternetDownloads]
    );

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (pendingInternetRef.current.length > 0) void pumpInternetDownloads();
        }, 2500);
        return () => window.clearInterval(timer);
    }, [pumpInternetDownloads]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const cutoff = Date.now() - 30 * 60 * 1000;
            setClientJobs((current) =>
                current.filter((job) => job.phase === 'downloading' || (job.completedAt || job.startedAt) >= cutoff)
            );
        }, 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const cancelJob = useCallback(
        async (jobId: string) => {
            const response = await fetch(`${API}/api/download/${jobId}`, { method: 'DELETE' });
            const data = (await response.json()) as { ok: boolean; message?: string };
            if (!response.ok || !data.ok) throw new Error(data.message || 'Não foi possível cancelar o download.');
            toast.success('Download cancelado.');
            await refresh();
        },
        [refresh]
    );

    const clearHistory = useCallback(async () => {
        const response = await fetch(`${API}/api/download/jobs/history`, { method: 'DELETE' });
        const data = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            removed?: number;
            message?: string;
        };
        if (!response.ok || !data.ok) {
            throw new Error(data.message || 'Não foi possível limpar o histórico.');
        }

        setClientJobs((current) => current.filter((job) => job.phase === 'downloading'));
        knownPhasesRef.current = new Map(
            [...knownPhasesRef.current.entries()].filter(([, phase]) => phase === 'downloading')
        );
        const remainingServerJobs = await refresh();
        return Number(data.removed || 0) + remainingServerJobs.filter((job) => job.phase !== 'downloading').length;
    }, [refresh]);

    const jobs = useMemo(
        () => [...clientJobs, ...serverJobs.filter((job) => !clientJobs.some((clientJob) => clientJob.id === job.id))],
        [clientJobs, serverJobs]
    );

    const value = useMemo<DownloadJobsContextValue>(
        () => ({
            jobs,
            activeCount: jobs.filter((job) => job.phase === 'downloading').length,
            refresh,
            registerJob,
            registerClientJob,
            updateClientJob,
            enqueueInternetDownloads,
            cancelJob,
            clearHistory,
        }),
        [cancelJob, clearHistory, enqueueInternetDownloads, jobs, refresh, registerClientJob, registerJob, updateClientJob]
    );

    return <DownloadJobsContext.Provider value={value}>{children}</DownloadJobsContext.Provider>;
};

export const useDownloadJobs = () => {
    const context = useContext(DownloadJobsContext);
    if (!context) throw new Error('useDownloadJobs deve ser usado dentro de DownloadJobsProvider.');
    return context;
};
