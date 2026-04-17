import React, { useEffect } from 'react';
import { cn } from '../lib/utils';
import { TitleHook } from '../types';

interface Props {
    title: TitleHook;
    className?: string;
    timeElapsed?: number;
    isHybridMode?: boolean;
}

import { Search, MapPin, Navigation, Globe, ShoppingBag, ArrowRight } from 'lucide-react';

export const DynamicTitleRenderer: React.FC<Props> = ({ title, className, timeElapsed = 0, isHybridMode = false }) => {
    const text = title.text || '';
    const styleId = title.styleId || 'default';
    const primary = title.primaryColor || '#FF0000'; // Default red
    const secondary = title.secondaryColor || '#ffffff'; // Default white

    // Helper logic to split first word for specific styles
    const firstSpaceIdx = text.indexOf(' ');
    const firstWord = firstSpaceIdx !== -1 ? text.substring(0, firstSpaceIdx) : text;
    const restOfText = firstSpaceIdx !== -1 ? text.substring(firstSpaceIdx) : '';

    // Audio Preview Logic for CTA
    useEffect(() => {
        if (!title.hasSound || !styleId.startsWith('cta-')) return;

        const baseUrl = import.meta.env.VITE_API_BASE_URL || '';

        const playSfx = () => {
            const audio = new Audio(`${baseUrl}/transitions/hit.mp3`);
            audio.volume = 0.5;
            audio.play().catch(() => {}); // catch errors in case of autoplay restrictions
        };

        const t1 = setTimeout(playSfx, 1125); // Corresponds to 45% of 2500ms
        const t2 = setTimeout(playSfx, 1375); // Corresponds to 55% of 2500ms

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, [title.hasSound, styleId]);

    // JS-based Animation Helpers for Export (Frame-by-Frame Sync)
    const getMouseStyles = (time: number): React.CSSProperties => {
        const p = Math.max(0, Math.min(1, time / 2.5));
        if (p < 0.2) return { transform: 'translate(30px, 30px)', opacity: p / 0.2 };
        if (p < 0.4) {
            const moveP = (p - 0.2) / 0.2;
            return { transform: `translate(${30 - moveP * 30}px, ${30 - moveP * 30}px) scale(1)`, opacity: 1 };
        }
        if (p < 0.45) {
            const scaleP = (p - 0.4) / 0.05;
            return { transform: `translate(0px, 0px) scale(${1 - scaleP * 0.15})`, opacity: 1 };
        }
        if (p < 0.5) {
            const scaleP = (p - 0.45) / 0.05;
            return { transform: `translate(0px, 0px) scale(${0.85 + scaleP * 0.15})`, opacity: 1 };
        }
        if (p < 0.55) {
            const scaleP = (p - 0.5) / 0.05;
            return { transform: `translate(0px, 0px) scale(${1 - scaleP * 0.15})`, opacity: 1 };
        }
        if (p < 0.6) {
            const scaleP = (p - 0.55) / 0.05;
            return { transform: `translate(0px, 0px) scale(${0.85 + scaleP * 0.15})`, opacity: 1 };
        }
        if (p < 0.9) return { transform: 'translate(0px, 0px) scale(1)', opacity: 1 };
        const fadeP = (p - 0.9) / 0.1;
        return { transform: 'translate(0px, 0px) scale(1)', opacity: 1 - fadeP };
    };

    const getTapStyles = (time: number): React.CSSProperties => {
        const p = Math.max(0, Math.min(1, time / 2.5));
        if (p < 0.2) return { transform: 'translateY(40px)', opacity: p / 0.2 };
        if (p < 0.4) {
            const moveP = (p - 0.2) / 0.2;
            return { transform: `translateY(${40 - moveP * 40}px) scale(1)`, opacity: 1 };
        }
        if (p < 0.45) {
            const scaleP = (p - 0.4) / 0.05;
            return { transform: `translateY(0) scale(${1 - scaleP * 0.1})`, opacity: 1 };
        }
        if (p < 0.5) {
            const scaleP = (p - 0.45) / 0.05;
            return { transform: `translateY(0) scale(${0.9 + scaleP * 0.1})`, opacity: 1 };
        }
        if (p < 0.55) {
            const scaleP = (p - 0.5) / 0.05;
            return { transform: `translateY(0) scale(${1 - scaleP * 0.1})`, opacity: 1 };
        }
        if (p < 0.6) {
            const scaleP = (p - 0.55) / 0.05;
            return { transform: `translateY(0) scale(${0.9 + scaleP * 0.1})`, opacity: 1 };
        }
        if (p < 0.9) return { transform: 'translateY(0) scale(1)', opacity: 1 };
        const fadeP = (p - 0.9) / 0.1;
        return { transform: 'translateY(0) scale(1)', opacity: 1 - fadeP };
    };

    switch (styleId) {
        case 'cta-search':
            return (
                <div className={cn('relative flex items-center justify-center', className)}>
                    {/* Search Bar Base */}
                    <div
                        className="flex items-center gap-3 px-6 py-4 rounded-full shadow-2xl overflow-hidden min-w-[320px] max-w-[90vw]"
                        style={{ backgroundColor: secondary }}
                    >
                        <Search className="w-6 h-6 shrink-0" style={{ color: primary }} />
                        <span
                            className="text-2xl md:text-3xl font-semibold truncate flex-1"
                            style={{ color: '#333333', fontFamily: title.fontFamily || 'Inter' }}
                        >
                            {text}
                        </span>
                    </div>
                    {/* SVG Mouse Pointer Cursor */}
                    <div
                        className={cn(
                            'absolute right-4 top-8 z-50 drop-shadow-md origin-top-left pointer-events-none',
                            !isHybridMode && 'anim-cta-mouse'
                        )}
                        style={isHybridMode ? getMouseStyles(timeElapsed) : undefined}
                    >
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="M5.5 2.5L19.5 10L12 11.5L15 19.5L12 21L8.5 13.5L3.5 16.5L5.5 2.5Z"
                                fill="#1A1A1A"
                                stroke="white"
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                </div>
            );

        case 'cta-tap':
            return (
                <div className={cn('relative flex items-center justify-center', className)}>
                    {/* Solid Button Base */}
                    <div
                        className="px-10 py-5 rounded-2xl shadow-[0_10px_25px_rgba(0,0,0,0.5)] flex items-center justify-center transform transition-transform"
                        style={{ backgroundColor: primary }}
                    >
                        <span
                            className="text-3xl md:text-4xl font-bold tracking-tight text-center"
                            style={{ color: secondary, fontFamily: title.fontFamily || 'Poppins' }}
                        >
                            {text}
                        </span>
                    </div>
                    {/* SVG Finger Tap Cursor - High Quality Apple Style */}
                    <div
                        className={cn(
                            'absolute bottom-[-20px] right-[-10px] z-50 drop-shadow-[0_5px_8px_rgba(0,0,0,0.6)] origin-top pointer-events-none',
                            !isHybridMode && 'anim-cta-tap'
                        )}
                        style={isHybridMode ? getTapStyles(timeElapsed) : undefined}
                    >
                        <svg width="45" height="45" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="M12.5 13.5V4.5C12.5 2.567 14.067 1 16 1C17.933 1 19.5 2.567 19.5 4.5V11C19.5 11 21 8.5 22.5 8.5C24.4 8.5 25.5 10 25.8 11.5V13.5L26.3 13.2C27.5 12.5 29 12.5 30 13.5C30.8 14.3 31.5 15.2 31.5 16.5V23C31.5 27.97 27.47 32 22.5 32H14.5C9.53 32 5.5 27.97 5.5 23V20L7.5 18C8.8 16.7 10.5 16.7 11.8 17.5L12.5 18V13.5Z"
                                fill="white"
                                stroke="#1A1A1A"
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                </div>
            );

        case 'cta-whatsapp':
            return (
                <div className={cn('relative flex items-center justify-center', className)}>
                    {/* WhatsApp Pill Button */}
                    <div
                        className="flex items-center gap-4 px-6 py-4 shadow-xl rounded-full relative overflow-hidden"
                        style={{ backgroundColor: primary }}
                    >
                        {/* WhatsApp Outlined/Transparent Icon SVG */}
                        <svg
                            width="34"
                            height="34"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            className="shrink-0 drop-shadow-sm"
                        >
                            <path
                                d="M12.01 2.01c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.42 1.28 4.88L2 22l5.31-1.39c1.42.79 3.03 1.25 4.7 1.25 5.5 0 9.96-4.46 9.96-9.96 0-5.5-4.46-9.96-9.96-9.96Zm5.6 14.12c-.24.67-1.38 1.28-1.93 1.35-.51.07-1.16.1-3.32-.79-2.61-1.07-4.25-3.76-4.38-3.93-.13-.17-1.04-1.39-1.04-2.65 0-1.26.65-1.89.89-2.14.24-.25.53-.32.7-.32.18 0 .35 0 .5.01.16.01.37-.06.57.43.21.5.7 1.71.76 1.84.06.13.1.28.02.45-.09.17-.13.27-.26.43-.13.15-.28.34-.4.46-.14.14-.28.3-.12.57.16.27.71 1.17 1.54 1.9.89.8 1.8.96 2.06 1.05.25.09.4.07.55-.1.14-.17.65-.75.82-1.01.17-.26.34-.22.58-.13.24.09 1.53.72 1.79.85.26.13.44.2.5.31.07.11.07.65-.17 1.32Z"
                                fill={secondary}
                            />
                        </svg>
                        <span
                            className="text-2xl md:text-3xl font-semibold tracking-tight"
                            style={{ color: secondary, fontFamily: title.fontFamily || 'Inter' }}
                        >
                            {text}
                        </span>
                    </div>
                    {/* SVG Mouse Pointer Cursor Base */}
                    <div
                        className={cn(
                            'absolute right-0 bottom-[-10px] z-50 drop-shadow-md origin-top-left pointer-events-none',
                            !isHybridMode && 'anim-cta-mouse'
                        )}
                        style={isHybridMode ? getMouseStyles(timeElapsed) : undefined}
                    >
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="M5.5 2.5L19.5 10L12 11.5L15 19.5L12 21L8.5 13.5L3.5 16.5L5.5 2.5Z"
                                fill="#1A1A1A"
                                stroke="white"
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                </div>
            );

        case 'cta-shop':
            return (
                <div className={cn('relative flex items-center justify-center', className)}>
                    <div
                        className="flex items-center gap-4 px-8 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.5)] rounded-2xl relative overflow-hidden"
                        style={{ backgroundColor: primary, border: `2px solid ${secondary}40` }}
                    >
                        <ShoppingBag className="w-8 h-8 shrink-0" style={{ color: secondary }} strokeWidth={2} />
                        <span
                            className="text-3xl font-black uppercase tracking-tight"
                            style={{ color: secondary, fontFamily: title.fontFamily || 'Montserrat' }}
                        >
                            {text}
                        </span>
                    </div>
                </div>
            );

        case 'cta-minimal':
            return (
                <div className={cn('relative flex items-center justify-center', className)}>
                    <div
                        className="flex items-center gap-4 px-6 py-3 rounded-full shadow-lg"
                        style={{ backgroundColor: `${primary}E6`, backdropFilter: 'blur(8px)' }}
                    >
                        <span
                            className="text-2xl font-bold tracking-widest uppercase"
                            style={{ color: secondary, fontFamily: title.fontFamily || 'Anton' }}
                        >
                            {text}
                        </span>
                        <div className="bg-white/20 p-2 rounded-full">
                            <ArrowRight className="w-5 h-5 shrink-0" style={{ color: secondary }} strokeWidth={3} />
                        </div>
                    </div>
                </div>
            );

        case 'neo-pop':
            return (
                <div className={cn('relative drop-shadow-lg', className)}>
                    <h2
                        className="text-4xl md:text-5xl font-black italic tracking-tighter uppercase whitespace-pre-wrap text-center leading-tight"
                        style={{ fontFamily: title.fontFamily || 'Montserrat' }}
                    >
                        <span
                            className="mr-2"
                            style={{ color: primary, filter: `drop-shadow(0 2px 10px ${primary}80)` }}
                        >
                            {firstWord}
                        </span>
                        <span style={{ color: secondary, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                            {restOfText}
                        </span>
                    </h2>
                </div>
            );

        case 'solid-ribbon':
            return (
                <div className={cn('relative inline-block', className)}>
                    <div className="px-6 py-2 shadow-xl -skew-x-10" style={{ backgroundColor: primary }}>
                        <h2
                            className="text-3xl md:text-4xl font-bold tracking-wider uppercase skew-x-10 drop-shadow-sm text-center"
                            style={{ color: secondary, fontFamily: title.fontFamily || 'Oswald' }}
                        >
                            {text}
                        </h2>
                    </div>
                </div>
            );

        case 'gradient-glow':
            return (
                <div className={cn('relative', className)} style={{ filter: `drop-shadow(0 0 15px ${primary}66)` }}>
                    <h2
                        className="bg-clip-text text-transparent text-4xl md:text-5xl font-black tracking-tight uppercase text-center"
                        style={{
                            backgroundImage: `linear-gradient(to right, ${primary}, ${secondary})`,
                            fontFamily: title.fontFamily || 'Inter',
                        }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'framed-box':
            return (
                <div className={cn('relative p-4 border-2 border-white/90 bg-black/40 backdrop-blur-sm', className)}>
                    {/* Accent Corner Brackets */}
                    <div
                        className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 -translate-x-1 -translate-y-1"
                        style={{ borderColor: primary }}
                    />
                    <div
                        className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 translate-x-1 translate-y-1"
                        style={{ borderColor: primary }}
                    />

                    <h2
                        className="text-3xl md:text-4xl font-bold tracking-widest uppercase text-center drop-shadow-md"
                        style={{ color: secondary, fontFamily: title.fontFamily || 'Roboto' }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'minimal-underline':
            return (
                <div className={cn('relative inline-flex flex-col items-center', className)}>
                    <h2
                        className="text-4xl md:text-5xl font-bold tracking-wide uppercase text-center drop-shadow-xl z-10"
                        style={{ color: secondary, fontFamily: title.fontFamily || 'Poppins' }}
                    >
                        {text}
                    </h2>
                    <div
                        className="h-3 w-[110%] -mt-4 shadow-lg z-0 -skew-x-15 mix-blend-screen"
                        style={{ backgroundColor: primary }}
                    />
                </div>
            );
            
        case 'neon-cyber':
            return (
                <div className={cn('relative flex flex-col items-center', className)}>
                    <h2
                        className="text-4xl md:text-5xl font-black tracking-tighter uppercase text-center z-10"
                        style={{
                            color: secondary,
                            fontFamily: title.fontFamily || 'Press Start 2P, Impact',
                            textShadow: `0 0 10px ${primary}, 0 0 20px ${primary}, 0 0 40px ${primary}`
                        }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'glassmorphism':
            return (
                <div className={cn('relative p-6 rounded-3xl border border-white/20 shadow-2xl', className)}
                     style={{ backgroundColor: `${primary}40`, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
                    <h2
                        className="text-3xl md:text-4xl font-semibold tracking-wide text-center"
                        style={{ color: secondary, fontFamily: title.fontFamily || 'Inter' }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'cinema-wide':
            return (
                <div className={cn('relative w-full flex justify-center py-2', className)}
                     style={{ backgroundColor: primary }}>
                    <h2
                        className="text-2xl md:text-3xl font-medium tracking-[0.3em] uppercase text-center"
                        style={{ color: secondary, fontFamily: title.fontFamily || 'Helvetica' }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'loc-pin-viagem':
            return (
                <div className={cn('relative anim-loc-entrance', className)}>
                    <div
                        className="flex items-center gap-4 px-6 py-3 rounded-full shadow-2xl backdrop-blur-lg"
                        style={{ backgroundColor: `${primary}99` }}
                    >
                        <div className="anim-loc-pin-bounce shrink-0">
                            <MapPin
                                className="w-7 h-7 drop-shadow-lg"
                                style={{ color: secondary }}
                                fill={secondary}
                                strokeWidth={0}
                            />
                        </div>
                        <div className="w-px h-6 opacity-40" style={{ backgroundColor: secondary }} />
                        <span
                            className="text-2xl md:text-3xl font-semibold tracking-tight whitespace-nowrap"
                            style={{ color: secondary, fontFamily: title.fontFamily || 'Inter' }}
                        >
                            {text}
                        </span>
                    </div>
                </div>
            );

        case 'loc-minimal-urbano':
            return (
                <div className={cn('relative anim-loc-entrance flex flex-col items-start gap-1', className)}>
                    <div className="flex items-center gap-3">
                        <Navigation
                            className="w-5 h-5 shrink-0 drop-shadow-[0_0_8px_var(--glow)]"
                            style={{ color: primary, '--glow': `${primary}88` } as React.CSSProperties}
                            fill={primary}
                            strokeWidth={0}
                        />
                        <span
                            className="text-3xl md:text-4xl font-extralight tracking-wide"
                            style={{ color: secondary, fontFamily: title.fontFamily || 'Inter' }}
                        >
                            {text}
                        </span>
                    </div>
                    <div
                        className="anim-loc-line-grow h-[2px] w-full origin-left"
                        style={{ backgroundColor: primary }}
                    />
                </div>
            );

        case 'loc-tag-geo':
            return (
                <div className={cn('relative anim-loc-tag-entrance', className)}>
                    <div className="flex items-center gap-3 px-5 py-3 shadow-xl" style={{ backgroundColor: primary }}>
                        <Globe className="w-6 h-6 shrink-0" style={{ color: secondary }} strokeWidth={2} />
                        <span
                            className="text-2xl md:text-3xl font-bold tracking-wider uppercase"
                            style={{ color: secondary, fontFamily: title.fontFamily || 'Oswald' }}
                        >
                            {text}
                        </span>
                    </div>
                </div>
            );

        case 'premium-01':
            return (
                <div
                    className={cn('relative drop-shadow-2xl', className)}
                    style={{ '--primary-color': primary } as React.CSSProperties}
                >
                    <div className="premium-01-box shadow-[0_0_30px_-5px_var(--primary-color)]">
                        <div className="premium-01-inner px-10 py-5 flex items-center justify-center relative overflow-hidden">
                            {/* Glow interno (opcional) */}
                            <div
                                className="absolute inset-0 opacity-10 blur-2xl pointer-events-none"
                                style={{ backgroundColor: primary }}
                            />
                            <h2
                                className="text-4xl md:text-5xl font-black tracking-widest text-center uppercase"
                                style={{ color: secondary, fontFamily: title.fontFamily || 'Montserrat' }}
                            >
                                {text}
                            </h2>
                        </div>
                    </div>
                </div>
            );

        case 'image-overlay':
            return (
                <div className={cn('relative', className)}>
                    {(title as any).imageUrl && (
                        <img
                            src={(title as any).imageUrl}
                            alt={text}
                            className="max-w-full max-h-32 object-contain rounded-lg shadow-lg"
                            style={{
                                filter: `drop-shadow(0 0 10px ${primary}40)`,
                            }}
                        />
                    )}
                    {text && (
                        <h2
                            className="text-2xl md:text-3xl font-bold tracking-wide uppercase text-center mt-2 drop-shadow-lg"
                            style={{
                                color: secondary,
                                fontFamily: title.fontFamily || 'Inter',
                                textShadow: `2px 2px 0px ${primary}80`,
                            }}
                        >
                            {text}
                        </h2>
                    )}
                </div>
            );

        default:
            // The original fallback aesthetic
            return (
                <div
                    className={cn(
                        'shadow-2xl -skew-x-10 px-6 py-2 border-2 border-black/20 dark:border-white/20 relative',
                        className
                    )}
                    style={{ backgroundColor: primary }}
                >
                    <h2
                        className="font-black uppercase text-3xl tracking-widest skew-x-10 drop-shadow-md text-center"
                        style={{ color: secondary, fontFamily: title.fontFamily || 'Montserrat' }}
                    >
                        {text}
                    </h2>
                </div>
            );
    }
};
