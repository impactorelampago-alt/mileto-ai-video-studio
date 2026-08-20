import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

// Editor de enquadramento 1:1: mostra a mídia inteira (contain) e sobrepõe uma
// "janela" quadrada semitransparente. Arrastar (ou clicar) move a janela; o que
// fica fora escurece. A posição vira uma fração 0..1 no estilo `object-position`
// — a MESMA que o bake de export usa (squareCoverOffset), então preview = MP4.

interface FramingEditorProps {
    src: string;
    type: 'video' | 'image';
    value?: { x: number; y: number };
    onChange: (value: { x: number; y: number }) => void;
    /** Quando "ignorar 1:1" está ligado, a janela fica inerte e apagada. */
    disabled?: boolean;
    /** Altura fixa em px. Se ausente, o palco preenche 100% do pai (fill). */
    heightPx?: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export const FramingEditor: React.FC<FramingEditorProps> = ({
    src,
    type,
    value,
    onChange,
    disabled = false,
    heightPx,
}) => {
    const stageRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    // Proporção intrínseca da mídia (largura/altura). Padrão vertical até carregar.
    const [aspect, setAspect] = useState(9 / 16);
    const aspectRef = useRef(aspect);
    aspectRef.current = aspect;
    const draggingRef = useRef(false);

    const fx = clamp01(value?.x ?? 0.5);
    const fy = clamp01(value?.y ?? 0.5);

    useLayoutEffect(() => {
        const el = stageRef.current;
        if (!el) return;
        const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Geometria da caixa "contain" e da janela quadrada (para render). Mede a
    // altura real do palco — funciona tanto com altura fixa quanto em fill.
    const stageW = size.w;
    const stageH = size.h;
    let innerW = stageW;
    let innerH = stageH;
    if (stageW > 0 && stageH > 0) {
        if (stageW / stageH > aspect) {
            innerH = stageH;
            innerW = stageH * aspect;
        } else {
            innerW = stageW;
            innerH = stageW / aspect;
        }
    }
    const innerLeft = (stageW - innerW) / 2;
    const innerTop = (stageH - innerH) / 2;
    const side = Math.min(innerW, innerH);
    const slackX = Math.max(0, innerW - side);
    const slackY = Math.max(0, innerH - side);
    const winLeft = innerLeft + fx * slackX;
    const winTop = innerTop + fy * slackY;

    const applyPoint = useCallback(
        (clientX: number, clientY: number) => {
            const el = stageRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const sW = rect.width;
            const sH = rect.height;
            const a = aspectRef.current;
            let iW = sW;
            let iH = sH;
            if (sW / sH > a) {
                iH = sH;
                iW = sH * a;
            } else {
                iW = sW;
                iH = sW / a;
            }
            const iL = (sW - iW) / 2;
            const iT = (sH - iH) / 2;
            const s = Math.min(iW, iH);
            const slX = Math.max(0, iW - s);
            const slY = Math.max(0, iH - s);
            const left = Math.min(slX, Math.max(0, clientX - rect.left - iL - s / 2));
            const top = Math.min(slY, Math.max(0, clientY - rect.top - iT - s / 2));
            onChange({ x: slX > 0 ? left / slX : 0.5, y: slY > 0 ? top / slY : 0.5 });
        },
        [onChange],
    );

    const onPointerDown = (e: React.PointerEvent) => {
        if (disabled) return;
        draggingRef.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        applyPoint(e.clientX, e.clientY);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (!draggingRef.current) return;
        applyPoint(e.clientX, e.clientY);
    };
    const stopDragging = () => {
        draggingRef.current = false;
    };

    const mediaStyle: React.CSSProperties = {
        position: 'absolute',
        left: innerLeft,
        top: innerTop,
        width: innerW,
        height: innerH,
        objectFit: 'contain',
        pointerEvents: 'none',
        userSelect: 'none',
    };

    return (
        <div
            ref={stageRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            style={{
                // Com altura fixa, ocupa o próprio bloco; sem ela, preenche o pai
                // (que precisa ser position:relative) via inset:0 — robusto contra
                // os quirks de height:100% dentro de flexbox.
                ...(heightPx
                    ? { position: 'relative', width: '100%', height: heightPx }
                    : { position: 'absolute', inset: 0 }),
                minHeight: 0,
                background: '#000',
                borderRadius: 10,
                overflow: 'hidden',
                touchAction: 'none',
                cursor: disabled ? 'not-allowed' : 'grab',
                userSelect: 'none',
            }}
        >
            {type === 'video' ? (
                <video
                    src={src}
                    muted
                    loop
                    autoPlay
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(v.videoWidth / v.videoHeight);
                    }}
                    style={mediaStyle}
                />
            ) : (
                <img
                    src={src}
                    alt=""
                    draggable={false}
                    onLoad={(e) => {
                        const im = e.currentTarget;
                        if (im.naturalWidth > 0 && im.naturalHeight > 0) setAspect(im.naturalWidth / im.naturalHeight);
                    }}
                    style={mediaStyle}
                />
            )}

            {stageW > 0 && side > 0 && (
                <div
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        left: winLeft,
                        top: winTop,
                        width: side,
                        height: side,
                        boxSizing: 'border-box',
                        border: `2px solid ${disabled ? 'rgba(148,163,184,0.7)' : '#a78bfa'}`,
                        borderRadius: 6,
                        boxShadow: `0 0 0 9999px rgba(0,0,0,${disabled ? 0.72 : 0.55})`,
                        pointerEvents: 'none',
                    }}
                >
                    {!disabled && (
                        <>
                            <span
                                style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    width: 18,
                                    height: 2,
                                    background: '#a78bfa',
                                    transform: 'translate(-50%,-50%)',
                                }}
                            />
                            <span
                                style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    width: 2,
                                    height: 18,
                                    background: '#a78bfa',
                                    transform: 'translate(-50%,-50%)',
                                }}
                            />
                            <span
                                style={{
                                    position: 'absolute',
                                    top: 4,
                                    left: 6,
                                    fontSize: 11,
                                    color: '#fff',
                                    background: 'rgba(0,0,0,0.5)',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                }}
                            >
                                janela 1:1
                            </span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
