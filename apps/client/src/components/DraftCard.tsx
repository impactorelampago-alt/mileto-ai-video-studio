import { useRef, useState } from 'react';
import { Video, AlertTriangle, Trash2, Pencil, Check, X } from 'lucide-react';
import type { DraftProject } from '../hooks/useProjects';
import { cn } from '../lib/utils';

interface DraftCardProps {
    draft: DraftProject;
    onOpen: (draft: DraftProject) => void;
    onDelete: (id: string) => void;
    onRename: (id: string, newTitle: string) => void;
}

const formatDate = (iso: string) => {
    try {
        return new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(iso));
    } catch {
        return iso;
    }
};

const missingCount = (draft: DraftProject) => draft.mediaTakes.filter((t) => t.fileMissing).length;

export const DraftCard = ({ draft, onOpen, onDelete, onRename }: DraftCardProps) => {
    const missing = missingCount(draft);
    const hasMissing = missing > 0;

    // ── Video preview ────────────────────────────────────────────────────────
    const videoRef = useRef<HTMLVideoElement>(null);
    const [videoLoaded, setVideoLoaded] = useState(false);

    // Pick first video take, fall back to first image take
    const firstVideoTake = draft.mediaTakes.find((t) => t.type === 'video' && !t.fileMissing);
    const firstImageTake = !firstVideoTake ? draft.mediaTakes.find((t) => t.type === 'image' && !t.fileMissing) : null;

    const previewSrc = firstVideoTake ? firstVideoTake.proxyUrl || firstVideoTake.url : null;

    const handleMouseEnter = () => {
        const vid = videoRef.current;
        if (!vid || !previewSrc) return;
        vid.currentTime = 0;
        vid.play().catch(() => {});
    };

    const handleMouseLeave = () => {
        const vid = videoRef.current;
        if (!vid) return;
        vid.pause();
        vid.currentTime = 0;
    };

    // ── Inline title editing ─────────────────────────────────────────────────
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(draft.title || '');
    const inputRef = useRef<HTMLInputElement>(null);

    const startEditing = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditValue(draft.title || '');
        setIsEditing(true);
        setTimeout(() => inputRef.current?.select(), 0);
    };

    const commitRename = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== draft.title) {
            onRename(draft.id, trimmed);
        }
        setIsEditing(false);
    };

    const cancelRename = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setEditValue(draft.title || '');
        setIsEditing(false);
    };

    return (
        <div
            className={cn(
                'group relative rounded-2xl overflow-hidden border transition-all duration-200 bg-card cursor-pointer',
                hasMissing
                    ? 'border-amber-500/30 hover:border-amber-500/60'
                    : 'border-black/8 dark:border-white/8 hover:border-brand-accent/40',
                'hover:scale-[1.02] hover:shadow-lg'
            )}
            onClick={() => !isEditing && onOpen(draft)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* ── Thumbnail / Video Preview ─────────────────────────────────── */}
            <div className="w-full aspect-video bg-black/10 dark:bg-white/5 flex items-center justify-center relative overflow-hidden">
                {/* Fallback icon (shows until video/image loads) */}
                {!videoLoaded && !firstImageTake && <Video className="w-8 h-8 text-foreground/20 absolute" />}

                {/* Image take static thumbnail */}
                {firstImageTake && !firstVideoTake && (
                    <img
                        src={firstImageTake.proxyUrl || firstImageTake.url}
                        className="absolute inset-0 w-full h-full object-cover"
                        alt={draft.title}
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                )}

                {/* Static thumbnail from saved field (overrides above if set) */}
                {draft.thumbnail && (
                    <img
                        src={draft.thumbnail}
                        className="absolute inset-0 w-full h-full object-cover"
                        alt={draft.title}
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                )}

                {/* Hidden video element — shown via opacity once loaded */}
                {previewSrc && (
                    <video
                        ref={videoRef}
                        src={previewSrc}
                        className={cn(
                            'absolute inset-0 w-full h-full object-cover transition-opacity duration-200',
                            videoLoaded ? 'opacity-100' : 'opacity-0'
                        )}
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(e) => {
                            const vid = e.currentTarget;
                            // Seek to 1s for a nice cover frame (or last frame if shorter)
                            vid.currentTime = Math.min(1, (vid.duration || 0) * 0.1);
                        }}
                        onSeeked={() => setVideoLoaded(true)}
                        onError={() => setVideoLoaded(false)}
                    />
                )}

                {/* Format badge */}
                <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-bold backdrop-blur-sm z-10">
                    {draft.format ?? '9:16'}
                </span>
            </div>

            {/* ── Info row ──────────────────────────────────────────────────── */}
            <div className="p-3">
                {/* Title row */}
                {isEditing ? (
                    <div className="flex items-center gap-1 mb-0.5" onClick={(e) => e.stopPropagation()}>
                        <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename();
                                if (e.key === 'Escape') cancelRename();
                                e.stopPropagation();
                            }}
                            autoFocus
                            className="flex-1 text-xs font-semibold text-foreground bg-background border border-brand-accent/50 rounded-md px-2 py-0.5 outline-none focus:border-brand-accent min-w-0"
                        />
                        <button
                            onClick={commitRename}
                            className="w-5 h-5 flex items-center justify-center rounded bg-brand-accent/20 hover:bg-brand-accent/40 text-brand-accent transition-colors shrink-0"
                            title="Salvar"
                        >
                            <Check className="w-3 h-3" />
                        </button>
                        <button
                            onClick={cancelRename}
                            className="w-5 h-5 flex items-center justify-center rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors shrink-0"
                            title="Cancelar"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-1 group/title mb-0.5">
                        <p className="text-xs font-semibold text-foreground truncate flex-1">
                            {draft.title || 'Projeto sem título'}
                        </p>
                        <button
                            onClick={startEditing}
                            className="w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover/title:opacity-60 hover:opacity-100! text-foreground/60 transition-opacity shrink-0"
                            title="Renomear"
                        >
                            <Pencil className="w-3 h-3" />
                        </button>
                    </div>
                )}

                <p className="text-[10px] text-foreground/40">{formatDate(draft.updatedAt)}</p>

                {/* Missing files warning */}
                {hasMissing && (
                    <div className="flex items-center gap-1 mt-2 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                            {missing} arquivo{missing > 1 ? 's' : ''} não encontrado{missing > 1 ? 's' : ''}
                        </span>
                    </div>
                )}
            </div>

            {/* Delete button (top-right, on hover) */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete(draft.id);
                }}
                className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/60 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/80 z-10"
                title="Excluir rascunho"
            >
                <Trash2 className="w-3.5 h-3.5 text-white" />
            </button>
        </div>
    );
};
