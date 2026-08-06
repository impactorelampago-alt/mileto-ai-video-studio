import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Move } from 'lucide-react';
import type { CaptionStyle } from '../types';
import { cn } from '../lib/utils';

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

interface GestureState {
    mode: 'move' | 'resize';
    handle?: ResizeHandle;
    pointerId: number;
    startX: number;
    startY: number;
    startVerticalPosition: number;
    startFontSize: number;
}

interface EditableCaptionOverlayProps {
    style: CaptionStyle;
    selected: boolean;
    editingEnabled: boolean;
    designHeight: number;
    previewScale: number;
    onSelect: () => void;
    onChange: (_updates: Partial<CaptionStyle>) => void;
    children: ReactNode;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const RESIZE_HANDLES: Array<{ id: ResizeHandle; className: string; cursor: string }> = [
    { id: 'nw', className: '-left-2 -top-2', cursor: 'cursor-nwse-resize' },
    { id: 'ne', className: '-right-2 -top-2', cursor: 'cursor-nesw-resize' },
    { id: 'se', className: '-bottom-2 -right-2', cursor: 'cursor-nwse-resize' },
    { id: 'sw', className: '-bottom-2 -left-2', cursor: 'cursor-nesw-resize' },
];

export const EditableCaptionOverlay = ({
    style,
    selected,
    editingEnabled,
    designHeight,
    previewScale,
    onSelect,
    onChange,
    children,
}: EditableCaptionOverlayProps) => {
    const gestureRef = useRef<GestureState | null>(null);

    useEffect(() => {
        if (!editingEnabled) gestureRef.current = null;
    }, [editingEnabled]);

    const beginGesture = (event: PointerEvent<HTMLDivElement>, mode: GestureState['mode'], handle?: ResizeHandle) => {
        if (!editingEnabled) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect();
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = {
            mode,
            handle,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startVerticalPosition: style.verticalPosition ?? 23,
            startFontSize: style.fontSize,
        };
    };

    const moveGesture = (event: PointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();

        const scale = Math.max(previewScale, 0.01);
        const deltaX = (event.clientX - gesture.startX) / scale;
        const deltaY = (event.clientY - gesture.startY) / scale;

        if (gesture.mode === 'move') {
            const nextPosition = gesture.startVerticalPosition - (deltaY / designHeight) * 100;
            onChange({ verticalPosition: Math.round(clamp(nextPosition, 5, 85)) });
            return;
        }

        const resizeDelta =
            gesture.handle === 'nw'
                ? (-deltaX - deltaY) / 2
                : gesture.handle === 'ne'
                  ? (deltaX - deltaY) / 2
                  : gesture.handle === 'sw'
                    ? (-deltaX + deltaY) / 2
                    : (deltaX + deltaY) / 2;
        onChange({ fontSize: Math.round(clamp(gesture.startFontSize + resizeDelta, 8, 80)) });
    };

    const endGesture = (event: PointerEvent<HTMLDivElement>) => {
        if (gestureRef.current?.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        gestureRef.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!editingEnabled) return;
        const verticalPosition = style.verticalPosition ?? 23;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            onChange({ verticalPosition: clamp(verticalPosition + (event.key === 'ArrowUp' ? 1 : -1), 5, 85) });
        } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            onChange({ fontSize: clamp(style.fontSize + 2, 8, 80) });
        } else if (event.key === '-') {
            event.preventDefault();
            onChange({ fontSize: clamp(style.fontSize - 2, 8, 80) });
        }
    };

    return (
        <div
            role={editingEnabled ? 'button' : undefined}
            tabIndex={editingEnabled ? 0 : undefined}
            aria-label={editingEnabled ? 'Legenda: arraste para ajustar a altura e use os cantos para alterar o tamanho' : undefined}
            className={cn(
                'relative rounded-md px-2 py-1 outline-none',
                editingEnabled && 'pointer-events-auto touch-none select-none cursor-move',
                selected && editingEnabled && 'ring-1 ring-brand-accent shadow-[0_0_0_1px_rgba(0,230,118,.18)]'
            )}
            onClick={(event) => {
                if (!editingEnabled) return;
                event.stopPropagation();
                onSelect();
            }}
            onPointerDown={(event) => beginGesture(event, 'move')}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onKeyDown={handleKeyDown}
        >
            {children}

            {selected && editingEnabled && (
                <>
                    <span className="pointer-events-none absolute -top-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-brand-accent/35 bg-[#07110d]/95 px-2 py-1 text-[6px] font-black uppercase tracking-[0.12em] text-brand-accent shadow-lg">
                        <Move className="h-2.5 w-2.5" /> Arraste · cantos redimensionam
                    </span>
                    {RESIZE_HANDLES.map((handle) => (
                        <div
                            key={handle.id}
                            role="slider"
                            aria-label="Redimensionar legenda"
                            aria-valuemin={8}
                            aria-valuemax={80}
                            aria-valuenow={style.fontSize}
                            className={cn(
                                'absolute h-3.5 w-3.5 rounded-[3px] border border-[#07110d] bg-brand-accent shadow-[0_2px_8px_rgba(0,0,0,.5)]',
                                handle.className,
                                handle.cursor
                            )}
                            onPointerDown={(event) => beginGesture(event, 'resize', handle.id)}
                            onPointerMove={moveGesture}
                            onPointerUp={endGesture}
                            onPointerCancel={endGesture}
                        />
                    ))}
                </>
            )}
        </div>
    );
};
