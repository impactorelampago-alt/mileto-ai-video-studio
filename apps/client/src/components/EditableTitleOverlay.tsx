import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Move, PencilLine } from 'lucide-react';
import type { TitleHook } from '../types';
import { cn } from '../lib/utils';

interface EditableTitleOverlayProps {
    title: TitleHook;
    selected: boolean;
    editingEnabled: boolean;
    onSelect?: (_id: string | null) => void;
    onChange?: (_id: string, _updates: Partial<TitleHook>) => void;
    onDelete?: (_id: string) => void;
    children: ReactNode;
}

interface GestureState {
    mode: 'move' | 'resize';
    pointerId: number;
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
    startScale: number;
    startDistance: number;
    centerX: number;
    centerY: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const EditableTitleOverlay = ({
    title,
    selected,
    editingEnabled,
    onSelect,
    onChange,
    onDelete,
    children,
}: EditableTitleOverlayProps) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const textInputRef = useRef<HTMLInputElement>(null);
    const gestureRef = useRef<GestureState | null>(null);
    const originalTextRef = useRef(title.text);
    const [isTextEditing, setIsTextEditing] = useState(false);
    const [draftText, setDraftText] = useState(title.text);

    useEffect(() => {
        if (!isTextEditing) setDraftText(title.text);
    }, [isTextEditing, title.text]);

    const beginTextEditing = () => {
        if (!editingEnabled) return;
        gestureRef.current = null;
        originalTextRef.current = title.text;
        setDraftText(title.text);
        setIsTextEditing(true);
        onSelect?.(title.id);
        window.requestAnimationFrame(() => {
            textInputRef.current?.focus({ preventScroll: true });
            textInputRef.current?.select();
        });
    };

    const finishTextEditing = () => {
        setIsTextEditing(false);
        window.requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
    };

    const cancelTextEditing = () => {
        setDraftText(originalTextRef.current);
        onChange?.(title.id, { text: originalTextRef.current });
        finishTextEditing();
    };

    const startGesture = (event: ReactPointerEvent<HTMLDivElement>, mode: GestureState['mode']) => {
        if (!editingEnabled) return;
        if ((event.target as HTMLElement).closest('[data-title-text-editor="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect?.(title.id);
        rootRef.current?.focus({ preventScroll: true });

        const elementRect = rootRef.current?.getBoundingClientRect();
        const centerX = elementRect ? elementRect.left + elementRect.width / 2 : event.clientX;
        const centerY = elementRect ? elementRect.top + elementRect.height / 2 : event.clientY;
        gestureRef.current = {
            mode,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startPosX: title.posX ?? 50,
            startPosY: title.posY,
            startScale: title.scale ?? 1,
            startDistance: Math.max(12, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
            centerX,
            centerY,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId || !onChange) return;
        event.preventDefault();
        const stage = rootRef.current?.parentElement?.getBoundingClientRect();
        if (!stage) return;

        if (gesture.mode === 'move') {
            onChange(title.id, {
                posX: clamp(gesture.startPosX + ((event.clientX - gesture.startX) / stage.width) * 100, 3, 97),
                posY: clamp(gesture.startPosY + ((event.clientY - gesture.startY) / stage.height) * 100, 0, 92),
            });
            return;
        }

        const distance = Math.hypot(event.clientX - gesture.centerX, event.clientY - gesture.centerY);
        onChange(title.id, { scale: clamp(gesture.startScale * (distance / gesture.startDistance), 0.35, 3) });
    };

    const endGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (gestureRef.current?.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // O ponteiro pode ter sido liberado pelo navegador ao sair da janela.
        }
    };

    const editorHandlers = editingEnabled
        ? {
              onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => startGesture(event, 'move'),
              onPointerMove: moveGesture,
              onPointerUp: endGesture,
              onPointerCancel: endGesture,
          }
        : {};

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!editingEnabled || !selected || isTextEditing) return;
        if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            event.stopPropagation();
            onDelete?.(title.id);
            return;
        }
        if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault();
            event.stopPropagation();
            beginTextEditing();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onSelect?.(null);
            rootRef.current?.blur();
        }
    };

    return (
        <div
            ref={rootRef}
            className={cn('absolute z-40', editingEnabled ? 'pointer-events-auto touch-none select-none' : 'pointer-events-none')}
            tabIndex={editingEnabled ? 0 : undefined}
            style={{
                left: `${title.posX ?? 50}%`,
                top: `${title.posY}%`,
                transform: `translateX(-50%) scale(${(title.scale ?? 1) * 0.85})`,
                transformOrigin: 'top center',
                cursor: editingEnabled ? 'move' : undefined,
            }}
            onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest('[data-title-text-editor="true"]')) return;
                event.preventDefault();
                event.stopPropagation();
                beginTextEditing();
            }}
            onKeyDown={handleKeyDown}
            {...editorHandlers}
        >
            <div className="relative inline-flex origin-center">
                <div className={cn('origin-center transition-opacity', isTextEditing && 'opacity-20')}>{children}</div>
                {editingEnabled && selected && (
                    <>
                        <div data-title-editor-ui="true" className="pointer-events-none absolute -inset-3 rounded-xl border border-brand-lime shadow-[0_0_0_1px_rgba(0,230,118,.18),0_0_24px_rgba(0,230,118,.18)]" />
                        <div data-title-editor-ui="true" className="pointer-events-none absolute -top-9 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-lime/25 bg-[#07110d]/95 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-brand-lime shadow-xl">
                            {isTextEditing ? <PencilLine className="h-3 w-3" /> : <Move className="h-3 w-3" />}
                            {isTextEditing ? 'Digite e pressione Enter' : 'Arraste · duplo clique edita · Delete apaga'}
                        </div>
                        {isTextEditing && (
                            <div
                                data-title-text-editor="true"
                                className="absolute left-1/2 top-1/2 z-30 w-[min(280px,76vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-brand-lime/40 bg-[#07110d]/95 p-2 shadow-[0_18px_55px_rgba(0,0,0,.7),0_0_26px_rgba(0,230,118,.14)] backdrop-blur-xl"
                            >
                                <input
                                    ref={textInputRef}
                                    data-title-text-editor="true"
                                    value={draftText}
                                    onChange={(event) => {
                                        const value = event.target.value;
                                        setDraftText(value);
                                        onChange?.(title.id, { text: value });
                                    }}
                                    onBlur={finishTextEditing}
                                    onKeyDown={(event) => {
                                        event.stopPropagation();
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            finishTextEditing();
                                        } else if (event.key === 'Escape') {
                                            event.preventDefault();
                                            cancelTextEditing();
                                        }
                                    }}
                                    aria-label="Editar texto do título"
                                    className="h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-center text-sm font-black text-white outline-none selection:bg-brand-lime/30 focus:border-brand-lime"
                                />
                            </div>
                        )}
                        {[
                            '-left-[17px] -top-[17px] cursor-nwse-resize',
                            '-right-[17px] -top-[17px] cursor-nesw-resize',
                            '-bottom-[17px] -left-[17px] cursor-nesw-resize',
                            '-bottom-[17px] -right-[17px] cursor-nwse-resize',
                        ].map((className) => (
                            <div
                                key={className}
                                data-title-editor-ui="true"
                                className={cn('absolute z-10 h-3.5 w-3.5 rounded-[4px] border-2 border-[#07110d] bg-brand-lime shadow-[0_0_12px_rgba(0,230,118,.75)]', isTextEditing && 'pointer-events-none opacity-30', className)}
                                onPointerDown={(event) => startGesture(event, 'resize')}
                                onPointerMove={moveGesture}
                                onPointerUp={endGesture}
                                onPointerCancel={endGesture}
                            />
                        ))}
                    </>
                )}
            </div>
        </div>
    );
};
