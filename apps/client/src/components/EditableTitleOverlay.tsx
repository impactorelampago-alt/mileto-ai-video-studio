import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent,
    ReactNode,
} from 'react';
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
    resizeHandle?: ResizeHandle;
    pointerId: number;
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
    startScale: number;
    startTextBoxWidthPct: number;
    startRect: DOMRect;
}

type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const RESIZE_HANDLES: Array<{
    id: ResizeHandle;
    className: string;
    cursor: string;
    label: string;
}> = [
    {
        id: 'nw',
        className: '-left-[17px] -top-[17px] h-3.5 w-3.5',
        cursor: 'cursor-nwse-resize',
        label: 'Redimensionar pelo canto superior esquerdo',
    },
    {
        id: 'n',
        className: '-top-[17px] left-1/2 h-2.5 w-7 -translate-x-1/2',
        cursor: 'cursor-ns-resize',
        label: 'Alterar altura pelo topo',
    },
    {
        id: 'ne',
        className: '-right-[17px] -top-[17px] h-3.5 w-3.5',
        cursor: 'cursor-nesw-resize',
        label: 'Redimensionar pelo canto superior direito',
    },
    {
        id: 'e',
        className: '-right-[17px] top-1/2 h-7 w-2.5 -translate-y-1/2',
        cursor: 'cursor-ew-resize',
        label: 'Alterar largura pela direita',
    },
    {
        id: 'se',
        className: '-bottom-[17px] -right-[17px] h-3.5 w-3.5',
        cursor: 'cursor-nwse-resize',
        label: 'Redimensionar pelo canto inferior direito',
    },
    {
        id: 's',
        className: '-bottom-[17px] left-1/2 h-2.5 w-7 -translate-x-1/2',
        cursor: 'cursor-ns-resize',
        label: 'Alterar altura pela base',
    },
    {
        id: 'sw',
        className: '-bottom-[17px] -left-[17px] h-3.5 w-3.5',
        cursor: 'cursor-nesw-resize',
        label: 'Redimensionar pelo canto inferior esquerdo',
    },
    {
        id: 'w',
        className: '-left-[17px] top-1/2 h-7 w-2.5 -translate-y-1/2',
        cursor: 'cursor-ew-resize',
        label: 'Alterar largura pela esquerda',
    },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizedText = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');

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
    const contentRef = useRef<HTMLDivElement>(null);
    const textInputRef = useRef<HTMLTextAreaElement>(null);
    const gestureRef = useRef<GestureState | null>(null);
    const finishingTextRef = useRef(false);
    const hiddenTextElementsRef = useRef<Array<{ element: HTMLElement; visibility: string }>>([]);
    const originalTextRef = useRef(title.text);
    const [isTextEditing, setIsTextEditing] = useState(false);
    const [draftText, setDraftText] = useState(title.text);
    const [editorBox, setEditorBox] = useState({ left: 0, top: 0, width: 100, height: 100 });
    const [editorTextStyle, setEditorTextStyle] = useState<CSSProperties>({});

    useEffect(() => {
        if (!isTextEditing) setDraftText(title.text);
    }, [isTextEditing, title.text]);

    useLayoutEffect(() => {
        if (!isTextEditing) return;

        const fitEditorToContent = () => {
            const editor = textInputRef.current;
            if (!editor) return;
            editor.style.height = '0px';
            editor.style.height = `${Math.max(editor.scrollHeight, 24)}px`;
        };

        fitEditorToContent();
        const frame = window.requestAnimationFrame(fitEditorToContent);
        return () => window.cancelAnimationFrame(frame);
    }, [draftText, editorBox.width, isTextEditing]);

    const restoreOriginalText = () => {
        hiddenTextElementsRef.current.forEach(({ element, visibility }) => {
            element.style.visibility = visibility;
        });
        hiddenTextElementsRef.current = [];
    };

    useEffect(
        () => () => {
            hiddenTextElementsRef.current.forEach(({ element, visibility }) => {
                element.style.visibility = visibility;
            });
            hiddenTextElementsRef.current = [];
        },
        []
    );

    const prepareInlineEditor = () => {
        restoreOriginalText();
        const content = contentRef.current;
        if (!content) return;

        const target = normalizedText(title.text);
        const candidates = Array.from(content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,span,div')).filter(
            (element) => {
                if (element.childElementCount > 0) return false;
                const value = normalizedText(element.textContent || '');
                return !!value && !!target && (target.includes(value) || value.includes(target));
            }
        );
        const contentRect = content.getBoundingClientRect();
        const visibleCandidates = candidates.filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        const bounds = visibleCandidates.reduce(
            (acc, element) => {
                const rect = element.getBoundingClientRect();
                return {
                    left: Math.min(acc.left, rect.left),
                    top: Math.min(acc.top, rect.top),
                    right: Math.max(acc.right, rect.right),
                    bottom: Math.max(acc.bottom, rect.bottom),
                };
            },
            {
                left: Number.POSITIVE_INFINITY,
                top: Number.POSITIVE_INFINITY,
                right: Number.NEGATIVE_INFINITY,
                bottom: Number.NEGATIVE_INFINITY,
            }
        );

        if (visibleCandidates.length && contentRect.width > 0 && contentRect.height > 0) {
            setEditorBox({
                left: clamp(((bounds.left - contentRect.left) / contentRect.width) * 100, 0, 100),
                top: clamp(((bounds.top - contentRect.top) / contentRect.height) * 100, 0, 100),
                width: clamp(((bounds.right - bounds.left) / contentRect.width) * 100, 8, 100),
                height: clamp(((bounds.bottom - bounds.top) / contentRect.height) * 100, 12, 100),
            });

            const styleSource =
                visibleCandidates
                    .filter((element) => element.getAttribute('aria-hidden') !== 'true')
                    .sort(
                        (left, right) =>
                            Number.parseFloat(getComputedStyle(right).fontSize) -
                            Number.parseFloat(getComputedStyle(left).fontSize)
                    )[0] || visibleCandidates[0];
            const computed = getComputedStyle(styleSource);
            const computedColor = computed.color;
            setEditorTextStyle({
                color:
                    computedColor === 'transparent' || computedColor === 'rgba(0, 0, 0, 0)'
                        ? title.secondaryColor || '#ffffff'
                        : computedColor,
                fontFamily: computed.fontFamily,
                fontSize: computed.fontSize,
                fontStyle: computed.fontStyle,
                fontWeight: computed.fontWeight,
                letterSpacing: computed.letterSpacing,
                lineHeight: computed.lineHeight,
                textAlign: computed.textAlign as CSSProperties['textAlign'],
                textShadow: computed.textShadow,
                textTransform: computed.textTransform as CSSProperties['textTransform'],
            });
        } else {
            setEditorBox({ left: 0, top: 0, width: 100, height: 100 });
            setEditorTextStyle({
                color: title.secondaryColor || '#ffffff',
                fontFamily: title.fontFamily || 'Inter',
                fontWeight: 800,
                textAlign: 'center',
            });
        }

        hiddenTextElementsRef.current = visibleCandidates.map((element) => ({
            element,
            visibility: element.style.visibility,
        }));
        visibleCandidates.forEach((element) => {
            element.style.visibility = 'hidden';
        });
    };

    const beginTextEditing = () => {
        if (!editingEnabled) return;
        finishingTextRef.current = false;
        gestureRef.current = null;
        originalTextRef.current = title.text;
        setDraftText(title.text);
        prepareInlineEditor();
        setIsTextEditing(true);
        onSelect?.(title.id);
        window.requestAnimationFrame(() => {
            textInputRef.current?.focus({ preventScroll: true });
            const end = textInputRef.current?.value.length ?? 0;
            textInputRef.current?.setSelectionRange(end, end);
        });
    };

    const finishTextEditing = (commit = true) => {
        if (finishingTextRef.current) return;
        finishingTextRef.current = true;
        if (commit && draftText !== title.text) onChange?.(title.id, { text: draftText });
        restoreOriginalText();
        setIsTextEditing(false);
        window.requestAnimationFrame(() => {
            rootRef.current?.focus({ preventScroll: true });
            finishingTextRef.current = false;
        });
    };

    const cancelTextEditing = () => {
        setDraftText(originalTextRef.current);
        finishTextEditing(false);
    };

    const startGesture = (
        event: ReactPointerEvent<HTMLDivElement>,
        mode: GestureState['mode'],
        resizeHandle?: ResizeHandle
    ) => {
        if (!editingEnabled) return;
        if ((event.target as HTMLElement).closest('[data-title-text-editor="true"]')) return;
        if (mode === 'move' && (event.target as HTMLElement).closest('[data-title-resize-handle="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect?.(title.id);
        rootRef.current?.focus({ preventScroll: true });

        const elementRect = rootRef.current?.getBoundingClientRect();
        const stageRect = rootRef.current?.parentElement?.getBoundingClientRect();
        if (!elementRect || !stageRect || stageRect.width <= 0) return;
        gestureRef.current = {
            mode,
            resizeHandle,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startPosX: title.posX ?? 50,
            startPosY: title.posY,
            startScale: title.scale ?? 1,
            startTextBoxWidthPct:
                title.textBoxWidthPct ?? ((rootRef.current?.offsetWidth ?? elementRect.width) / stageRect.width) * 100,
            startRect: elementRect,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId || !onChange) return;
        event.preventDefault();
        event.stopPropagation();
        const stage = rootRef.current?.parentElement?.getBoundingClientRect();
        if (!stage) return;

        if (gesture.mode === 'move') {
            onChange(title.id, {
                posX: clamp(gesture.startPosX + ((event.clientX - gesture.startX) / stage.width) * 100, 3, 97),
                posY: clamp(gesture.startPosY + ((event.clientY - gesture.startY) / stage.height) * 100, 0, 92),
            });
            return;
        }

        const handle = gesture.resizeHandle;
        if (!handle) return;

        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        const changesLeft = handle.includes('w');
        const changesRight = handle.includes('e');
        const changesTop = handle.includes('n');
        const changesBottom = handle.includes('s');
        const minimumWidth = 32;
        const minimumHeight = 22;

        let nextLeft = gesture.startRect.left + (changesLeft ? deltaX : 0);
        let nextRight = gesture.startRect.right + (changesRight ? deltaX : 0);
        let nextTop = gesture.startRect.top + (changesTop ? deltaY : 0);
        let nextBottom = gesture.startRect.bottom + (changesBottom ? deltaY : 0);

        if (nextRight - nextLeft < minimumWidth) {
            if (changesLeft) nextLeft = nextRight - minimumWidth;
            else nextRight = nextLeft + minimumWidth;
        }
        if (nextBottom - nextTop < minimumHeight) {
            if (changesTop) nextTop = nextBottom - minimumHeight;
            else nextBottom = nextTop + minimumHeight;
        }

        const updates: Partial<TitleHook> = {};
        if (changesLeft || changesRight) {
            const nextTextBoxWidthPct = clamp(
                gesture.startTextBoxWidthPct *
                    ((nextRight - nextLeft) / Math.max(1, gesture.startRect.width)),
                12,
                96
            );
            const actualWidth =
                gesture.startRect.width * (nextTextBoxWidthPct / Math.max(1, gesture.startTextBoxWidthPct));
            if (changesLeft && !changesRight) nextLeft = gesture.startRect.right - actualWidth;
            else nextRight = gesture.startRect.left + actualWidth;

            updates.textBoxWidthPct = nextTextBoxWidthPct;
            updates.scaleX = 1;
            updates.posX = clamp(((nextLeft + (nextRight - nextLeft) / 2 - stage.left) / stage.width) * 100, 3, 97);
        }
        if (changesTop || changesBottom) {
            const nextScale = clamp(
                gesture.startScale * ((nextBottom - nextTop) / Math.max(1, gesture.startRect.height)),
                0.25,
                4
            );
            const actualHeight = gesture.startRect.height * (nextScale / Math.max(0.01, gesture.startScale));
            if (changesTop && !changesBottom) nextTop = gesture.startRect.bottom - actualHeight;
            else nextBottom = gesture.startRect.top + actualHeight;

            updates.scale = nextScale;
            updates.scaleY = 1;
            updates.posY = clamp(((nextTop - stage.top) / stage.height) * 100, 0, 92);
        }
        onChange(title.id, updates);
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
            className={cn(
                'absolute z-40',
                editingEnabled ? 'pointer-events-auto touch-none select-none' : 'pointer-events-none'
            )}
            tabIndex={editingEnabled ? 0 : undefined}
            style={{
                left: `${title.posX ?? 50}%`,
                top: `${title.posY}%`,
                width: title.textBoxWidthPct ? `${title.textBoxWidthPct}%` : undefined,
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
                <div
                    ref={contentRef}
                    className={cn(
                        'origin-center whitespace-pre-wrap',
                        title.textBoxWidthPct && 'title-text-box w-full'
                    )}
                >
                    {children}
                </div>
                {editingEnabled && selected && (
                    <>
                        <div
                            data-title-editor-ui="true"
                            className="pointer-events-none absolute -inset-3 rounded-xl border border-brand-lime shadow-[0_0_0_1px_rgba(0,230,118,.18),0_0_24px_rgba(0,230,118,.18)]"
                        />
                        <div
                            data-title-editor-ui="true"
                            className="pointer-events-none absolute -top-9 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-lime/25 bg-[#07110d]/95 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-brand-lime shadow-xl"
                        >
                            {isTextEditing ? <PencilLine className="h-3 w-3" /> : <Move className="h-3 w-3" />}
                            {isTextEditing
                                ? 'Edite na própria arte · Ctrl+Enter conclui'
                                : 'Arraste · duplo clique edita · Delete apaga'}
                        </div>
                        {isTextEditing && (
                            <div
                                data-title-text-editor="true"
                                className="absolute z-30 min-h-6 min-w-12"
                                style={{
                                    left: `${editorBox.left}%`,
                                    top: `${editorBox.top}%`,
                                    width: `${editorBox.width}%`,
                                    minHeight: `${editorBox.height}%`,
                                }}
                            >
                                <textarea
                                    ref={textInputRef}
                                    data-title-text-editor="true"
                                    value={draftText}
                                    onChange={(event) => {
                                        const value = event.target.value;
                                        setDraftText(value);
                                    }}
                                    onInput={(event) => {
                                        event.currentTarget.style.height = '0px';
                                        event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
                                    }}
                                    onBlur={() => finishTextEditing(true)}
                                    onKeyDown={(event) => {
                                        event.stopPropagation();
                                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                            event.preventDefault();
                                            finishTextEditing(true);
                                        } else if (event.key === 'Escape') {
                                            event.preventDefault();
                                            cancelTextEditing();
                                        }
                                    }}
                                    aria-label="Editar texto do título"
                                    rows={Math.max(1, draftText.split('\n').length)}
                                    spellCheck={false}
                                    className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none selection:bg-brand-lime/30"
                                    style={{
                                        ...editorTextStyle,
                                        minHeight: '100%',
                                        height: 'auto',
                                        whiteSpace: 'pre-wrap',
                                    }}
                                />
                            </div>
                        )}
                        {RESIZE_HANDLES.map((handle) => (
                            <div
                                key={handle.id}
                                data-title-editor-ui="true"
                                data-title-resize-handle="true"
                                role="slider"
                                aria-label={handle.label}
                                className={cn(
                                    'absolute z-10 rounded-[4px] border-2 border-[#07110d] bg-brand-lime shadow-[0_0_12px_rgba(0,230,118,.75)]',
                                    isTextEditing && 'pointer-events-none opacity-30',
                                    handle.className,
                                    handle.cursor
                                )}
                                onPointerDown={(event) => startGesture(event, 'resize', handle.id)}
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
