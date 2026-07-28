import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWizard } from '../context/WizardContext';
import { cn } from '../lib/utils';
import { Music, Play, Pause, Pencil, Trash2, Check, X, Loader2, ArrowDownToLine, ArrowUpFromLine, HardDrive, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { MusicTrack } from '../types';

import { API_BASE_URL as API } from '../lib/apiBase';
import { DownloadModal } from './DownloadModal';
import { localAuthHeaders } from '../lib/serverAuth';
import { useDownloadJobs } from '../context/DownloadJobsContext';

const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const LOCAL_RENAMES_KEY = 'mileto_music_renames';

/** Read locally-cached rename overrides */
function getLocalRenames(): Record<string, string> {
    try {
        const raw = localStorage.getItem(LOCAL_RENAMES_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/** Save a rename override locally */
function saveLocalRename(id: string, displayName: string) {
    const renames = getLocalRenames();
    renames[id] = displayName;
    localStorage.setItem(LOCAL_RENAMES_KEY, JSON.stringify(renames));
}

/** Clear a local rename (after backend sync succeeds) */
function clearLocalRename(id: string) {
    const renames = getLocalRenames();
    delete renames[id];
    localStorage.setItem(LOCAL_RENAMES_KEY, JSON.stringify(renames));
}

export const MusicLibrary: React.FC = () => {
    const { musicLibrary, setMusicLibrary, selectedMusicId, setSelectedMusicId, loadMusicLibrary, draftScope } = useWizard();
    const { jobs: downloadJobs } = useDownloadJobs();

    const [isUploading, setIsUploading] = useState(false);
    const [scope, setScope] = useState<'local' | 'shared'>(draftScope);
    const [isDownloadOpen, setIsDownloadOpen] = useState(false);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [isPaused, setIsPaused] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const editInputRef = useRef<HTMLInputElement | null>(null);
    const animFrameRef = useRef<number>(0);

    useEffect(() => {
        if (scope !== 'local') return;
        const completedTracks = downloadJobs
            .filter((job) => job.phase === 'done' && job.track?.type === 'audio')
            .map((job) => job.track as MusicTrack);
        if (completedTracks.length === 0) return;
        setMusicLibrary((current) => {
            const currentIds = new Set(current.map((track) => track.id));
            const additions = completedTracks.filter((track) => !currentIds.has(track.id));
            return additions.length > 0 ? [...current, ...additions] : current;
        });
    }, [downloadJobs, scope, setMusicLibrary]);

    const loadScopeLibrary = useCallback(async (nextScope: 'local' | 'shared') => {
        if (nextScope === 'local') {
            await loadMusicLibrary();
            return;
        }
        try {
            const headers = await localAuthHeaders();
            const res = await fetch(`${API}/api/shared/files/list?path=${encodeURIComponent('Músicas')}`, { headers });
            const data = await res.json();
            if (!data.ok) throw new Error(data.message);
            const tracks: MusicTrack[] = (data.files || []).map((file: {
                id: string; name: string; publicUrl: string; durationSec?: number; createdAt: string;
            }) => ({
                id: file.id,
                originalName: file.name,
                displayName: file.name.replace(/\.[^.]+$/, ''),
                publicUrl: file.publicUrl,
                filePath: '',
                durationSec: Number(file.durationSec || 0),
                createdAt: file.createdAt,
            }));
            setMusicLibrary(tracks);
        } catch (error) {
            setMusicLibrary([]);
            toast.error(error instanceof Error ? error.message : 'Falha ao carregar músicas compartilhadas.');
        }
    }, [loadMusicLibrary, setMusicLibrary]);

    // Focus input when entering edit mode
    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    // Apply locally-cached renames on library load
    useEffect(() => {
        const renames = getLocalRenames();
        const ids = Object.keys(renames);
        if (ids.length === 0 || musicLibrary.length === 0) return;

        let changed = false;
        const updated = musicLibrary.map((t) => {
            if (renames[t.id] && t.displayName !== renames[t.id]) {
                changed = true;
                return { ...t, displayName: renames[t.id] };
            }
            return t;
        });
        if (changed) setMusicLibrary(updated);
    }, [musicLibrary.length]); // Only run when library size changes

    // ----- Audio time tracking via requestAnimationFrame -----
    const updateTime = useCallback(() => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            setDuration(audioRef.current.duration || 0);
        }
        animFrameRef.current = requestAnimationFrame(updateTime);
    }, []);

    const startTimeTracking = useCallback(() => {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(updateTime);
    }, [updateTime]);

    const stopTimeTracking = useCallback(() => {
        cancelAnimationFrame(animFrameRef.current);
    }, []);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            cancelAnimationFrame(animFrameRef.current);
            audioRef.current?.pause();
        };
    }, []);

    // ----- Upload -----
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const maxSize = 30 * 1024 * 1024;
        if (file.size > maxSize) {
            toast.error('Arquivo muito grande (máximo 30MB)');
            return;
        }

        setIsUploading(true);
        const toastId = toast.loading(`Enviando ${file.name}...`);

        try {
            const formData = new FormData();
            formData.append('file', file);
            if (scope === 'shared') formData.append('parent', 'Músicas');

            const headers = scope === 'shared' ? await localAuthHeaders() : undefined;
            const res = await fetch(scope === 'shared' ? `${API}/api/shared/files/upload` : `${API}/api/music/upload`, {
                method: 'POST',
                body: formData,
                headers,
            });

            const data = await res.json();
            if (!data.ok) throw new Error(data.message || 'Erro no upload');

            if (scope === 'shared') {
                await loadScopeLibrary('shared');
                toast.success(data.deduplicated ? 'Música já existia; referência criada.' : 'Música compartilhada com a equipe.', { id: toastId });
                return;
            }
            setMusicLibrary((prev) => [...prev, data.track as MusicTrack]);
            toast.success(`Música adicionada: ${data.track.displayName}`, { id: toastId });
        } catch (error: unknown) {
            let msg = error instanceof Error ? error.message : 'Erro desconhecido';
            if (msg === 'Failed to fetch') {
                msg = 'Não foi possível conectar ao servidor. Verifique se o backend está rodando na porta correta.';
            }
            toast.error(`Falha no upload: ${msg}`, { id: toastId });
        } finally {
            setIsUploading(false);
            e.target.value = '';
        }
    };

    // ----- Play / Pause -----
    const togglePlay = (track: MusicTrack) => {
        // If same track — toggle pause/resume
        if (playingId === track.id) {
            if (audioRef.current) {
                if (audioRef.current.paused) {
                    audioRef.current.play().catch(() => {});
                    setIsPaused(false);
                    startTimeTracking();
                } else {
                    audioRef.current.pause();
                    setIsPaused(true);
                    stopTimeTracking();
                }
            }
            return;
        }

        // Different track — stop current, start new
        if (audioRef.current) {
            audioRef.current.pause();
            stopTimeTracking();
        }

        const audioSrc = track.publicUrl.startsWith('http') ? track.publicUrl : `${API}${track.publicUrl}`;
        const audio = new Audio(audioSrc);
        audioRef.current = audio;
        audio.onended = () => {
            setPlayingId(null);
            setIsPaused(false);
            setCurrentTime(0);
            stopTimeTracking();
        };
        audio.onloadedmetadata = () => {
            setDuration(audio.duration || 0);
        };
        audio.play().catch(() => {});
        setPlayingId(track.id);
        setIsPaused(false);
        setCurrentTime(0);
        startTimeTracking();
    };

    // Seek handler
    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        if (audioRef.current) {
            audioRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    // ----- Select -----
    const handleSelect = (track: MusicTrack) => {
        setSelectedMusicId(selectedMusicId === track.id ? null : track.id);
    };

    // ----- Rename (optimistic + offline fallback) -----
    const startRename = (track: MusicTrack) => {
        setEditingId(track.id);
        setEditValue(track.displayName);
    };

    const cancelRename = () => {
        setEditingId(null);
        setEditValue('');
    };

    const confirmRename = async () => {
        if (!editingId) return;
        const trimmed = editValue.trim();
        if (trimmed.length === 0 || trimmed.length > 60) {
            toast.error('O nome deve ter entre 1 e 60 caracteres');
            return;
        }

        const previousName = musicLibrary.find((t) => t.id === editingId)?.displayName;
        const targetId = editingId;

        // 1. Optimistic update — UI updates immediately
        setMusicLibrary((prev) => prev.map((t) => (t.id === targetId ? { ...t, displayName: trimmed } : t)));
        setEditingId(null);
        setEditValue('');

        // 2. Try backend
        try {
            const headers = scope === 'shared'
                ? { ...(await localAuthHeaders()), 'Content-Type': 'application/json' }
                : { 'Content-Type': 'application/json' };
            const res = await fetch(scope === 'shared' ? `${API}/api/shared/files/rename` : `${API}/api/music/${targetId}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(scope === 'shared' ? { id: targetId, name: trimmed } : { displayName: trimmed }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
                throw new Error(data.message || `Erro ${res.status}`);
            }

            // Backend confirmed — clear any local override
            clearLocalRename(targetId);
            toast.success('Nome atualizado');
        } catch (error: unknown) {
            // 3. Offline fallback — keep the optimistic name, persist locally
            saveLocalRename(targetId, trimmed);

            const msg = error instanceof Error ? error.message : 'Erro desconhecido';
            if (msg === 'Failed to fetch') {
                toast.warning('Servidor offline — nome salvo localmente', {
                    description: 'O nome será sincronizado quando o servidor voltar.',
                });
            } else {
                // Backend returned an error — revert the UI change
                setMusicLibrary((prev) =>
                    prev.map((t) => (t.id === targetId ? { ...t, displayName: previousName || trimmed } : t))
                );
                toast.error(`Falha ao renomear: ${msg}`);
            }
        }
    };

    const handleRenameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmRename();
        } else if (e.key === 'Escape') {
            cancelRename();
        }
    };

    // ----- Delete -----
    const handleDelete = async (track: MusicTrack) => {
        if (playingId === track.id) {
            audioRef.current?.pause();
            stopTimeTracking();
            setPlayingId(null);
            setIsPaused(false);
        }

        // Tira a faixa da lista + limpa seleção (usado no sucesso e no "já não existe")
        const removeLocally = () => {
            setMusicLibrary((prev) => prev.filter((t) => t.id !== track.id));
            if (selectedMusicId === track.id) {
                setSelectedMusicId(null);
            }
        };

        try {
            const headers = scope === 'shared' ? await localAuthHeaders() : undefined;
            const res = await fetch(
                scope === 'shared' ? `${API}/api/shared/files/item/${track.id}` : `${API}/api/music/${track.id}`,
                { method: 'DELETE', headers }
            );

            // 404 = a faixa não existe no servidor (ex.: entrada obsoleta em memória de uma
            // sessão antiga). Reconcilia removendo da UI mesmo assim — não há o que apagar lá.
            if (res.status === 404) {
                removeLocally();
                toast.success(scope === 'shared' ? 'Música já não estava na biblioteca.' : 'Música removida');
                return;
            }

            const data = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
            if (!data.ok) throw new Error(data.message || `Erro ${res.status}`);

            removeLocally();
            toast.success(scope === 'shared' ? 'Música movida para a lixeira por 30 dias.' : 'Música removida');
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Erro desconhecido';
            toast.error(`Falha ao remover: ${msg}`);
        }
    };

    const handleShare = async (track: MusicTrack) => {
        try {
            const headers = { ...(await localAuthHeaders()), 'Content-Type': 'application/json' };
            const response = await fetch(`${API}/api/shared/files/import-local`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    sourceUrl: track.publicUrl,
                    backendPath: track.filePath,
                    name: track.originalName,
                    parent: 'Músicas',
                }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.message);
            toast.success(
                result.deduplicated
                    ? 'Música compartilhada sem duplicar espaço no R2; a cópia local foi mantida.'
                    : 'Música compartilhada com a equipe; a cópia local foi mantida.'
            );
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Falha ao compartilhar a música.');
        }
    };

    // Load library on mount
    useEffect(() => {
        void loadScopeLibrary(scope);
    }, [scope, loadScopeLibrary]);

    useEffect(() => {
        setScope(draftScope);
    }, [draftScope]);

    return (
        <div className="bg-background border border-black/5 dark:border-white/5 rounded-3xl p-6 space-y-5 shadow-inner">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-[13px] tracking-wide uppercase font-semibold text-brand-muted flex items-center gap-2">
                    <Music className="w-4 h-4 text-brand-accent" />
                    Música de Fundo
                </h3>
                <div className="flex items-center gap-2.5">
                    <div className="flex items-center gap-0.5 rounded-lg border border-black/10 dark:border-white/10 p-0.5">
                        <button
                            type="button"
                            onClick={() => setScope('local')}
                            className={cn('p-1.5 rounded-md transition-colors', scope === 'local' ? 'bg-brand-lime/15 text-brand-lime' : 'text-brand-muted')}
                            title="Biblioteca local"
                        >
                            <HardDrive className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setScope('shared')}
                            className={cn('p-1.5 rounded-md transition-colors', scope === 'shared' ? 'bg-brand-accent/15 text-brand-accent' : 'text-brand-muted')}
                            title="Biblioteca compartilhada com a equipe"
                        >
                            <Users className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    {scope === 'local' && <button
                        type="button"
                        onClick={() => setIsDownloadOpen(true)}
                        className="cursor-pointer text-xs px-4 py-2 rounded-xl font-bold transition-all border shadow-sm bg-brand-lime/10 text-brand-lime border-brand-lime/20 hover:bg-brand-lime/20 flex items-center gap-2"
                    >
                        <ArrowDownToLine className="w-3.5 h-3.5" />
                        Download
                    </button>}
                    <label
                        className={cn(
                            'cursor-pointer text-xs px-4 py-2 rounded-xl font-bold transition-all border shadow-sm',
                            isUploading
                                ? 'opacity-50 cursor-not-allowed bg-black/5 dark:bg-white/5 text-foreground/40 border-black/5 dark:border-white/5'
                                : 'bg-brand-accent/10 text-brand-accent border-brand-accent/20 hover:bg-brand-accent/20'
                        )}
                    >
                        {isUploading ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Enviando...
                            </span>
                        ) : (
                            <span className="flex items-center gap-2">
                                <ArrowUpFromLine className="w-3.5 h-3.5" />
                                Enviar Música
                            </span>
                        )}
                        <input
                            type="file"
                            accept="audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg"
                            className="hidden"
                            onChange={handleUpload}
                            disabled={isUploading}
                        />
                    </label>
                </div>
            </div>

            {/* Empty State */}
            {musicLibrary.length === 0 && (
                <div className="border border-dashed border-black/10 dark:border-white/10 bg-background/50 rounded-2xl p-8 flex flex-col items-center justify-center text-center">
                    <div className="w-12 h-12 bg-black/5 dark:bg-white/5 rounded-2xl flex items-center justify-center mb-4 text-brand-muted shadow-inner">
                        <Music className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">Nenhuma música adicionada</p>
                    <p className="text-[11px] text-brand-muted uppercase tracking-wider font-semibold mt-1">
                        MP3, WAV ou OGG (máx 30MB)
                    </p>
                    <p className="text-[11px] text-brand-muted/70 mt-3 leading-snug max-w-[220px]">
                        Use <span className="font-bold text-brand-accent">Enviar Música</span> para adicionar suas
                        próprias trilhas (MP3, WAV ou OGG).
                    </p>
                </div>
            )}

            {/* Playlist */}
            {musicLibrary.length > 0 && (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {musicLibrary.map((track) => {
                        const isSelected = selectedMusicId === track.id;
                        const isTrackActive = playingId === track.id;
                        const isTrackPaused = isTrackActive && isPaused;
                        const isTrackPlaying = isTrackActive && !isPaused;
                        const isEditing = editingId === track.id;

                        return (
                            <div key={track.id} className="space-y-0">
                                {/* Main row */}
                                <div
                                    className={cn(
                                        'flex items-center gap-3 border p-3 transition-all',
                                        isTrackActive ? 'rounded-t-2xl' : 'rounded-2xl',
                                        isSelected
                                            ? 'border-brand-accent/40 bg-brand-accent/10 shadow-[0_0_15px_rgba(0,230,118,0.05)]'
                                            : 'border-black/5 dark:border-white/5 bg-background hover:bg-black/5 dark:bg-white/5',
                                        isTrackActive && !isSelected && 'border-b-0'
                                    )}
                                >
                                    {/* Play / Pause */}
                                    <button
                                        onClick={() => togglePlay(track)}
                                        className={cn(
                                            'w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all shadow-sm',
                                            isTrackPlaying
                                                ? 'bg-brand-accent text-[#0a0f12]'
                                                : isTrackPaused
                                                  ? 'bg-brand-accent/60 text-[#0a0f12]'
                                                  : 'bg-black/10 dark:bg-white/10 text-foreground hover:bg-black/20 dark:bg-white/20'
                                        )}
                                        title={isTrackPlaying ? 'Pausar' : 'Reproduzir'}
                                    >
                                        {isTrackPlaying ? (
                                            <Pause className="w-3.5 h-3.5 fill-current" />
                                        ) : (
                                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                                        )}
                                    </button>

                                    {/* Name + Duration */}
                                    <div className="flex-1 min-w-0">
                                        {isEditing ? (
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    ref={editInputRef}
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value.slice(0, 60))}
                                                    onKeyDown={handleRenameKeyDown}
                                                    className="flex-1 bg-background border border-brand-accent/40 rounded-lg px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-accent"
                                                    maxLength={60}
                                                />
                                                <button
                                                    onClick={confirmRename}
                                                    className="p-1 text-brand-accent hover:bg-brand-accent/10 rounded-md transition-colors"
                                                    title="Salvar"
                                                >
                                                    <Check className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={cancelRename}
                                                    className="p-1 text-brand-muted hover:bg-black/10 dark:bg-white/10 rounded-md transition-colors"
                                                    title="Cancelar"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="text-sm font-semibold text-foreground truncate leading-tight">
                                                    {track.displayName}
                                                </p>
                                                <p className="text-xs text-brand-muted/70 font-mono mt-0.5">
                                                    {formatDuration(track.durationSec)}
                                                </p>
                                            </>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    {!isEditing && (
                                        <div className="flex items-center gap-1 shrink-0">
                                            {scope === 'local' && (
                                                <button
                                                    onClick={() => void handleShare(track)}
                                                    className="p-1.5 text-brand-muted hover:text-brand-accent hover:bg-brand-accent/10 rounded-lg transition-colors"
                                                    title="Compartilhar com a equipe mantendo a cópia local"
                                                >
                                                    <Users className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleSelect(track)}
                                                className={cn(
                                                    'p-1.5 rounded-lg transition-colors text-[10px] font-bold uppercase tracking-wider',
                                                    isSelected
                                                        ? 'bg-brand-accent text-[#0a0f12] shadow-[0_0_10px_rgba(0,230,118,0.4)]'
                                                        : 'text-brand-muted hover:text-foreground hover:bg-black/10 dark:bg-white/10'
                                                )}
                                                title={isSelected ? 'Desselecionar' : 'Selecionar'}
                                            >
                                                {isSelected ? (
                                                    <Check className="w-3.5 h-3.5" />
                                                ) : (
                                                    <span className="px-2">Usar</span>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => startRename(track)}
                                                className="p-1.5 text-brand-muted hover:text-foreground hover:bg-black/10 dark:bg-white/10 rounded-lg transition-colors"
                                                title="Renomear"
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(track)}
                                                className="p-1.5 text-brand-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                title="Remover"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Progress bar — only shown for the active track */}
                                {isTrackActive && (
                                    <div
                                        className={cn(
                                            'border border-t-0 rounded-b-2xl px-4 py-3 space-y-2 relative overflow-hidden',
                                            isSelected
                                                ? 'border-brand-accent/40 bg-brand-accent/5'
                                                : 'border-black/5 dark:border-white/5 bg-background'
                                        )}
                                    >
                                        <input
                                            type="range"
                                            min={0}
                                            max={duration || 0}
                                            step={0.1}
                                            value={currentTime}
                                            onChange={handleSeek}
                                            className="w-full h-1 bg-black/10 dark:bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-brand-accent [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,230,118,0.7)]"
                                        />
                                        <div className="flex justify-between text-[10px] text-brand-muted font-mono uppercase tracking-wider font-semibold">
                                            <span>{formatDuration(currentTime)}</span>
                                            <span>{formatDuration(duration)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {isDownloadOpen && (
                <DownloadModal
                    onClose={() => setIsDownloadOpen(false)}
                    onDownloaded={(media) => {
                        if (media.type === 'audio') setMusicLibrary((prev) => [...prev, media]);
                    }}
                />
            )}
        </div>
    );
};
