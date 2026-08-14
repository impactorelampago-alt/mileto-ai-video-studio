import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Sinaliza aos renderizadores internos (ex.: AutoFitText) que o encaixe na caixa
 * é responsabilidade do FitToBox. Quando ativo, cada estilo deve renderizar o
 * texto no seu tamanho base (uma linha lógica) e deixar o FitToBox escalar o
 * bloco inteiro — evitando encaixe em dobro.
 */
export const FitToBoxContext = createContext(false);
export const useFitToBoxActive = () => useContext(FitToBoxContext);

interface FitToBoxProps {
    active: boolean;
    /** Teto de crescimento para texto curto numa caixa larga. */
    maxScale?: number;
    /** Piso de encolhimento para texto longo numa caixa estreita. */
    minScale?: number;
    /** Fração da largura da caixa que o título tenta preencher. */
    fill?: number;
    /** Valores que, ao mudar, exigem remedir o encaixe (texto, fonte, estilo…). */
    deps?: unknown[];
    children: ReactNode;
}

/**
 * Escala o título inteiro (tipografia + ícones + decorações) para preencher a
 * caixa configurada: texto curto cresce, texto longo diminui até caber em uma
 * linha lógica, respeitando teto/piso. O scale é gravado inline no elemento vivo
 * dentro de um useLayoutEffect síncrono, então o frame capturado pelo
 * html-to-image na exportação recebe exatamente a mesma geometria do preview.
 */
export const FitToBox = ({
    active,
    maxScale = 2.6,
    minScale = 0.35,
    fill = 0.98,
    deps = [],
    children,
}: FitToBoxProps) => {
    const boxRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!active) return;
        const box = boxRef.current;
        const art = artRef.current;
        if (!box || !art) return;

        let frame = 0;
        const measure = () => {
            // Mede a largura natural sem o scale anterior interferindo.
            art.style.transform = 'none';
            const available = box.clientWidth;
            const natural = art.scrollWidth;
            if (!(available > 0) || !(natural > 0)) return;
            const scale = Math.max(minScale, Math.min(maxScale, (available * fill) / natural));
            art.style.transform = `scale(${scale})`;
        };

        // Primeira medição síncrona: o frame de exportação nunca captura o
        // título no tamanho provisório antes do encaixe.
        measure();
        const schedule = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(measure);
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(box);
        void document.fonts?.ready.then(schedule).catch(() => undefined);

        return () => {
            window.cancelAnimationFrame(frame);
            observer.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, maxScale, minScale, fill, ...deps]);

    if (!active) return <>{children}</>;

    return (
        <FitToBoxContext.Provider value={true}>
            <div ref={boxRef} className="flex w-full justify-center">
                <div ref={artRef} className={cn('inline-block')} style={{ transformOrigin: 'center top' }}>
                    {children}
                </div>
            </div>
        </FitToBoxContext.Provider>
    );
};
