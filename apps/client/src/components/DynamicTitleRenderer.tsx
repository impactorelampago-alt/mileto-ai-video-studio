import React, { useEffect } from 'react';
import { cn } from '../lib/utils';
import { API_BASE_URL } from '../lib/apiBase';
import { TitleHook } from '../types';

interface Props {
    title: TitleHook;
    className?: string;
    timeElapsed?: number;
    isHybridMode?: boolean;
    previewMode?: boolean;
}

import {
    Search,
    MapPin,
    Navigation,
    Globe,
    ShoppingBag,
    ArrowRight,
    BadgePercent,
    CheckCircle2,
    Clock3,
    Sparkles,
    Star,
    Zap,
    Crown,
    ArrowUpRight,
} from 'lucide-react';

export const DynamicTitleRenderer: React.FC<Props> = ({
    title,
    className,
    timeElapsed = 0,
    isHybridMode = false,
    previewMode = false,
}) => {
    const text = title.text || '';
    const styleId = title.styleId || 'default';
    const primary = title.primaryColor || '#FF0000'; // Default red
    const secondary = title.secondaryColor || '#ffffff'; // Default white

    // Helper logic to split first word for specific styles
    const firstSpaceIdx = text.search(/\s/);
    const firstWord = firstSpaceIdx !== -1 ? text.substring(0, firstSpaceIdx) : text;
    const restOfText = firstSpaceIdx !== -1 ? text.substring(firstSpaceIdx) : '';
    const words = text.trim().split(/\s+/).filter(Boolean);
    const midpoint = Math.max(1, Math.ceil(words.length / 2));
    const manualLines = text.replace(/\r\n?/g, '\n').split('\n');
    const hasManualBreaks = manualLines.length > 1;
    // Alguns modelos premium dividem o texto automaticamente em duas linhas.
    // Depois que o usuário redimensiona a caixa, a largura escolhida passa a
    // comandar a quebra natural; apenas Enters explícitos continuam forçando linha.
    const usesEditedTextBox = title.textBoxWidthPct != null;
    const firstLine = hasManualBreaks
        ? manualLines[0]
        : usesEditedTextBox
          ? text.trim()
          : words.slice(0, midpoint).join(' ');
    const secondLine = hasManualBreaks
        ? manualLines.slice(1).join('\n')
        : usesEditedTextBox
          ? ''
          : words.slice(midpoint).join(' ');

    const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
    const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp01(value), 3);
    const easeOutBack = (value: number) => {
        const p = clamp01(value);
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    };
    const enterProgress = (delay = 0, duration = 0.45, back = false) => {
        if (previewMode) return 1;
        const raw = (timeElapsed - delay) / duration;
        return back ? easeOutBack(raw) : easeOutCubic(raw);
    };
    const exitOpacity = previewMode ? 1 : clamp01(Math.max(0, title.durationSec - timeElapsed) / 0.3);
    const motionStyle = (
        kind: 'rise' | 'drop' | 'left' | 'right' | 'pop',
        delay = 0,
        duration = 0.45
    ): React.CSSProperties => {
        const progress = enterProgress(delay, duration, kind === 'pop');
        const opacity = clamp01(progress) * exitOpacity;
        if (kind === 'rise') return { opacity, transform: `translateY(${(1 - progress) * 28}px)` };
        if (kind === 'drop') return { opacity, transform: `translateY(${(progress - 1) * 28}px)` };
        if (kind === 'left') return { opacity, transform: `translateX(${(progress - 1) * 42}px)` };
        if (kind === 'right') return { opacity, transform: `translateX(${(1 - progress) * 42}px)` };
        return { opacity, transform: `scale(${0.58 + progress * 0.42})` };
    };
    const lineProgress = (delay = 0, duration = 0.5) => enterProgress(delay, duration);
    const pulse = previewMode ? 0.5 : (Math.sin(Math.max(0, timeElapsed) * 5.5) + 1) / 2;
    const fontStack = (defaultFont: string) => {
        const family = title.fontFamily || defaultFont;
        const primaryFamily = family.includes(',') ? family : `"${family}"`;
        return /playfair|serif/i.test(family)
            ? `${primaryFamily}, Georgia, "Times New Roman", serif`
            : `${primaryFamily}, "Arial Black", Arial, Helvetica, sans-serif`;
    };

    // Audio Preview Logic for CTA
    useEffect(() => {
        if (!title.hasSound || !styleId.startsWith('cta-')) return;

        const baseUrl = API_BASE_URL;

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
                            textShadow: `0 0 10px ${primary}, 0 0 20px ${primary}, 0 0 40px ${primary}`,
                        }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'glassmorphism':
            return (
                <div
                    className={cn('relative p-6 rounded-3xl border border-white/20 shadow-2xl', className)}
                    style={{
                        backgroundColor: `${primary}40`,
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                    }}
                >
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
                <div
                    className={cn('relative w-full flex justify-center py-2', className)}
                    style={{ backgroundColor: primary }}
                >
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

        case 'premium-kinetic-punch':
            return (
                <div className={cn('relative max-w-[520px] text-center', className)} style={motionStyle('pop', 0, 0.5)}>
                    <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-black/75 px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] text-white/75">
                        <Zap className="h-3 w-3" style={{ color: primary }} /> Atenção
                    </div>
                    <div className="relative px-3 py-1">
                        <h2
                            className="relative text-4xl font-black uppercase leading-[.92] tracking-[-0.055em] md:text-6xl"
                            style={{
                                color: secondary,
                                fontFamily: fontStack('Archivo Black'),
                                textShadow: `6px 6px 0 ${primary}, 0 12px 30px rgba(0,0,0,.55)`,
                            }}
                        >
                            {text}
                        </h2>
                    </div>
                    <div
                        className="mx-auto mt-3 h-1.5 rounded-full"
                        style={{ backgroundColor: primary, width: `${lineProgress(0.18) * 78}%` }}
                    />
                </div>
            );

        case 'premium-sticker-pop':
            return (
                <div className={cn('relative', className)} style={motionStyle('pop', 0.02, 0.5)}>
                    <div className="absolute -inset-3 rotate-2 rounded-[28px] bg-black/90" />
                    <div
                        className="relative -rotate-2 rounded-[24px] border-[5px] border-white px-7 py-4 shadow-[0_14px_35px_rgba(0,0,0,.45)]"
                        style={{ backgroundColor: primary }}
                    >
                        <Star className="absolute -right-4 -top-4 h-9 w-9 rotate-12 fill-white text-white drop-shadow-lg" />
                        <h2
                            className="max-w-[440px] text-center text-3xl font-black uppercase leading-none tracking-[-0.04em] md:text-5xl"
                            style={{
                                color: secondary,
                                fontFamily: fontStack('Archivo Black'),
                                textShadow: '0 3px 0 rgba(0,0,0,.28)',
                            }}
                        >
                            {text}
                        </h2>
                    </div>
                </div>
            );

        case 'premium-marker-swipe':
            return (
                <div
                    className={cn('relative max-w-[500px] px-4 py-3 text-center', className)}
                    style={motionStyle('rise', 0, 0.45)}
                >
                    <div
                        className="absolute bottom-2 left-1/2 h-[52%] -translate-x-1/2 -rotate-1 -skew-x-6 rounded-sm"
                        style={{ backgroundColor: primary, width: `${lineProgress(0.08, 0.55) * 100}%`, opacity: 0.92 }}
                    />
                    <h2
                        className="relative text-3xl font-black uppercase leading-[.96] tracking-[-0.035em] md:text-5xl"
                        style={{
                            color: secondary,
                            fontFamily: fontStack('League Spartan'),
                            textShadow: '0 3px 14px rgba(0,0,0,.85)',
                        }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'premium-split-block':
            return (
                <div className={cn('flex max-w-[500px] flex-col items-start gap-1.5', className)}>
                    <div
                        className="max-w-full -skew-x-6 bg-black px-5 py-2 shadow-xl"
                        style={motionStyle('left', 0, 0.4)}
                    >
                        <span
                            className="block skew-x-6 text-3xl font-black uppercase leading-none tracking-tight md:text-5xl"
                            style={{ color: secondary, fontFamily: fontStack('Anton') }}
                        >
                            {firstLine || text}
                        </span>
                    </div>
                    {secondLine && (
                        <div
                            className="max-w-full -skew-x-6 px-5 py-2 shadow-xl"
                            style={{ backgroundColor: primary, ...motionStyle('right', 0.13, 0.42) }}
                        >
                            <span
                                className="block skew-x-6 text-2xl font-black uppercase leading-none tracking-tight md:text-4xl"
                                style={{ color: '#07110D', fontFamily: fontStack('Anton') }}
                            >
                                {secondLine}
                            </span>
                        </div>
                    )}
                </div>
            );

        case 'premium-outline-echo':
            return (
                <div
                    className={cn('relative min-w-[330px] py-8 text-center', className)}
                    style={motionStyle('pop', 0, 0.48)}
                >
                    {[3, 2, 1].map((level) => (
                        <span
                            key={level}
                            aria-hidden="true"
                            className="absolute inset-x-0 text-4xl font-black uppercase leading-none tracking-[-0.05em] md:text-6xl"
                            style={{
                                top: `${(3 - level) * 9}px`,
                                color: 'transparent',
                                fontFamily: fontStack('Archivo Black'),
                                WebkitTextStroke: `2px ${primary}`,
                                opacity: 0.13 + level * 0.13,
                            }}
                        >
                            {text}
                        </span>
                    ))}
                    <h2
                        className="relative text-4xl font-black uppercase leading-none tracking-[-0.05em] md:text-6xl"
                        style={{
                            color: secondary,
                            fontFamily: fontStack('Archivo Black'),
                            textShadow: '0 8px 25px rgba(0,0,0,.7)',
                        }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'premium-creator-caption':
            return (
                <div
                    className={cn(
                        'relative max-w-[500px] overflow-hidden rounded-2xl border border-white/15 bg-black/85 p-1 shadow-2xl',
                        className
                    )}
                    style={motionStyle('rise', 0, 0.42)}
                >
                    <div className="flex items-center gap-2 px-4 pb-2 pt-3 text-[9px] font-black uppercase tracking-[.24em] text-white/55">
                        <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: primary, boxShadow: `0 0 12px ${primary}` }}
                        />
                        Ponto de vista
                    </div>
                    <div className="rounded-xl bg-white/[.07] px-5 py-4">
                        <h2
                            className="text-2xl font-black leading-tight md:text-4xl"
                            style={{ color: secondary, fontFamily: fontStack('DM Sans') }}
                        >
                            {text}
                        </h2>
                    </div>
                    <div
                        className="h-1 origin-left rounded-full"
                        style={{ backgroundColor: primary, transform: `scaleX(${lineProgress(0.15)})` }}
                    />
                </div>
            );

        case 'premium-sale-spotlight':
            return (
                <div
                    className={cn('relative max-w-[510px] pt-4 text-center', className)}
                    style={motionStyle('pop', 0, 0.48)}
                >
                    <div
                        className="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-white bg-black px-3 py-1 text-[10px] font-black uppercase tracking-widest"
                        style={{ color: primary }}
                    >
                        <BadgePercent className="h-3.5 w-3.5" /> Oferta especial
                    </div>
                    <div
                        className="relative overflow-hidden rounded-[22px] border-4 border-white px-7 pb-5 pt-7 shadow-[0_16px_40px_rgba(0,0,0,.5)]"
                        style={{ backgroundColor: primary }}
                    >
                        <div className="absolute -right-10 -top-16 h-36 w-36 rounded-full bg-white/25 blur-2xl" />
                        <h2
                            className="relative text-3xl font-black uppercase leading-[.94] tracking-[-0.045em] md:text-5xl"
                            style={{
                                color: secondary,
                                fontFamily: fontStack('Archivo Black'),
                                textShadow: '0 4px 0 rgba(0,0,0,.22)',
                            }}
                        >
                            {text}
                        </h2>
                    </div>
                </div>
            );

        case 'premium-price-tag':
            return (
                <div className={cn('relative flex items-center', className)} style={motionStyle('right', 0, 0.45)}>
                    <div
                        className="relative flex min-w-[330px] items-center gap-4 py-4 pl-10 pr-7 shadow-[0_14px_34px_rgba(0,0,0,.45)]"
                        style={{ backgroundColor: primary, clipPath: 'polygon(9% 0,100% 0,100% 100%,9% 100%,0 50%)' }}
                    >
                        <span className="absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-black/50 ring-2 ring-white/45" />
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-[.25em] text-black/55">
                                Condição especial
                            </p>
                            <h2
                                className="mt-0.5 text-3xl font-black uppercase leading-none md:text-5xl"
                                style={{ color: secondary, fontFamily: fontStack('League Spartan') }}
                            >
                                {text}
                            </h2>
                        </div>
                    </div>
                </div>
            );

        case 'premium-urgency-pulse':
            return (
                <div
                    className={cn(
                        'relative flex max-w-[500px] items-center gap-4 rounded-2xl border-2 bg-black/90 px-5 py-4 shadow-2xl',
                        className
                    )}
                    style={{
                        borderColor: primary,
                        boxShadow: `0 0 ${16 + pulse * 18}px ${primary}44`,
                        ...motionStyle('pop', 0, 0.45),
                    }}
                >
                    <div
                        className="grid h-12 w-12 shrink-0 place-items-center rounded-xl"
                        style={{ backgroundColor: `${primary}25`, color: primary }}
                    >
                        <Clock3 className="h-7 w-7" />
                    </div>
                    <div>
                        <p className="text-[9px] font-black uppercase tracking-[.28em]" style={{ color: primary }}>
                            Acaba em breve
                        </p>
                        <h2
                            className="mt-1 text-2xl font-black uppercase leading-none md:text-4xl"
                            style={{ color: secondary, fontFamily: fontStack('Anton') }}
                        >
                            {text}
                        </h2>
                    </div>
                </div>
            );

        case 'premium-coupon-ticket':
            return (
                <div
                    className={cn('relative w-full max-w-full min-w-0 rounded-2xl border-2 border-dashed p-2 shadow-2xl', className)}
                    style={{ borderColor: primary, ...motionStyle('rise', 0, 0.44) }}
                >
                    <div
                        className="relative flex w-full min-w-0 items-center gap-3 rounded-xl px-4 py-3"
                        style={{ backgroundColor: primary }}
                    >
                        <BadgePercent className="h-8 w-8 shrink-0" style={{ color: secondary }} />
                        <div className="h-10 shrink-0 border-l-2 border-dashed border-black/25" />
                        <div className="min-w-0 flex-1">
                            <p className="text-[8px] font-black uppercase tracking-[.28em] text-black/50">
                                Use no checkout
                            </p>
                            <h2
                                className="mt-1 max-w-full break-words text-3xl font-black uppercase leading-[.9] tracking-[-0.04em]"
                                style={{
                                    color: secondary,
                                    fontFamily: fontStack('Space Grotesk'),
                                    overflowWrap: 'anywhere',
                                }}
                            >
                                {text}
                            </h2>
                        </div>
                    </div>
                </div>
            );

        case 'premium-benefit-badge':
            return (
                <div
                    className={cn(
                        'relative flex max-w-[500px] items-center gap-4 rounded-full border border-white/20 bg-black/85 py-3 pl-3 pr-6 shadow-2xl',
                        className
                    )}
                    style={motionStyle('left', 0, 0.42)}
                >
                    <div
                        className="grid h-12 w-12 shrink-0 place-items-center rounded-full"
                        style={{ backgroundColor: primary }}
                    >
                        <CheckCircle2 className="h-7 w-7" style={{ color: secondary }} />
                    </div>
                    <div>
                        <p className="text-[8px] font-black uppercase tracking-[.25em] text-white/45">
                            Benefício confirmado
                        </p>
                        <h2
                            className="mt-0.5 text-2xl font-black leading-none md:text-4xl"
                            style={{ color: secondary, fontFamily: fontStack('DM Sans') }}
                        >
                            {text}
                        </h2>
                    </div>
                </div>
            );

        case 'premium-product-launch':
            return (
                <div
                    className={cn(
                        'relative max-w-[520px] overflow-hidden rounded-3xl border border-white/20 bg-[#080A10]/90 px-7 py-6 text-left shadow-2xl',
                        className
                    )}
                    style={motionStyle('rise', 0, 0.48)}
                >
                    <div
                        className="absolute inset-y-0 right-0 w-2/3 opacity-35 blur-2xl"
                        style={{ background: `radial-gradient(circle at right, ${primary}, transparent 66%)` }}
                    />
                    <div
                        className="relative flex items-center gap-2 text-[9px] font-black uppercase tracking-[.28em]"
                        style={{ color: primary }}
                    >
                        <Sparkles className="h-4 w-4" /> Nova geração
                    </div>
                    <h2
                        className="relative mt-3 text-3xl font-bold uppercase leading-[.95] tracking-[-0.04em] md:text-5xl"
                        style={{ color: secondary, fontFamily: fontStack('Space Grotesk') }}
                    >
                        {text}
                    </h2>
                    <div className="relative mt-4 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.18em] text-white/50">
                        Descubra agora <ArrowRight className="h-3.5 w-3.5" style={{ color: primary }} />
                    </div>
                </div>
            );

        case 'premium-luxury-editorial':
            return (
                <div
                    className={cn('relative min-w-[390px] px-8 py-6 text-center', className)}
                    style={motionStyle('rise', 0, 0.55)}
                >
                    <div
                        className="mx-auto mb-4 h-px origin-center"
                        style={{ backgroundColor: primary, width: `${lineProgress(0.05) * 70}%` }}
                    />
                    <div
                        className="mb-2 flex items-center justify-center gap-2 text-[8px] font-semibold uppercase tracking-[.45em]"
                        style={{ color: primary }}
                    >
                        <Crown className="h-3.5 w-3.5" /> Edição exclusiva
                    </div>
                    <h2
                        className="max-w-[470px] text-3xl font-semibold italic leading-tight md:text-5xl"
                        style={{
                            color: secondary,
                            fontFamily: fontStack('Playfair Display'),
                            textShadow: '0 8px 28px rgba(0,0,0,.75)',
                        }}
                    >
                        {text}
                    </h2>
                    <div
                        className="mx-auto mt-4 h-px origin-center"
                        style={{ backgroundColor: primary, width: `${lineProgress(0.18) * 42}%` }}
                    />
                </div>
            );

        case 'premium-swiss-modern':
            return (
                <div
                    className={cn('flex max-w-[520px] items-stretch bg-white text-black shadow-2xl', className)}
                    style={motionStyle('left', 0, 0.48)}
                >
                    <div
                        className="flex w-16 shrink-0 flex-col justify-between p-3"
                        style={{ backgroundColor: primary }}
                    >
                        <span className="text-[9px] font-black uppercase tracking-widest">M / 01</span>
                        <ArrowUpRight className="h-5 w-5" />
                    </div>
                    <div className="px-5 py-4 text-left">
                        <p className="text-[8px] font-bold uppercase tracking-[.32em] text-black/45">
                            Ideia em destaque
                        </p>
                        <h2
                            className="mt-2 max-w-[420px] text-2xl font-black uppercase leading-[.95] tracking-[-0.04em] md:text-4xl"
                            style={{ fontFamily: fontStack('DM Sans') }}
                        >
                            {text}
                        </h2>
                    </div>
                </div>
            );

        case 'premium-glass-prism':
            return (
                <div
                    className={cn(
                        'relative max-w-[520px] overflow-hidden rounded-[26px] border border-white/25 bg-black/55 px-7 py-6 shadow-2xl backdrop-blur-xl',
                        className
                    )}
                    style={motionStyle('pop', 0, 0.5)}
                >
                    <div
                        className="absolute -left-16 -top-20 h-44 w-44 rounded-full blur-3xl"
                        style={{ backgroundColor: `${primary}80` }}
                    />
                    <div className="absolute -bottom-20 -right-14 h-44 w-44 rounded-full bg-fuchsia-500/35 blur-3xl" />
                    <div className="relative flex items-center gap-2 text-[8px] font-black uppercase tracking-[.3em] text-white/55">
                        <span className="h-1.5 w-10 rounded-full" style={{ backgroundColor: primary }} /> Perspectiva
                    </div>
                    <h2
                        className="relative mt-3 text-3xl font-bold leading-tight tracking-[-0.035em] md:text-5xl"
                        style={{ color: secondary, fontFamily: fontStack('Space Grotesk') }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'premium-cinema-chapter':
            return (
                <div
                    className={cn('min-w-[420px] max-w-[560px] text-center', className)}
                    style={motionStyle('rise', 0, 0.58)}
                >
                    <div className="mb-3 flex items-center justify-center gap-3">
                        <span
                            className="h-px flex-1 origin-right"
                            style={{ backgroundColor: primary, transform: `scaleX(${lineProgress(0.05)})` }}
                        />
                        <span
                            className="text-[8px] font-semibold uppercase tracking-[.45em]"
                            style={{ color: primary }}
                        >
                            Capítulo um
                        </span>
                        <span
                            className="h-px flex-1 origin-left"
                            style={{ backgroundColor: primary, transform: `scaleX(${lineProgress(0.05)})` }}
                        />
                    </div>
                    <h2
                        className="text-3xl font-medium uppercase leading-tight tracking-[.12em] md:text-5xl"
                        style={{
                            color: secondary,
                            fontFamily: fontStack('Montserrat'),
                            textShadow: '0 8px 30px rgba(0,0,0,.8)',
                        }}
                    >
                        {text}
                    </h2>
                </div>
            );

        case 'premium-magazine-stack':
            return (
                <div
                    className={cn('relative max-w-[500px] border-l-[7px] px-5 py-2 text-left', className)}
                    style={{ borderColor: primary, ...motionStyle('left', 0, 0.48) }}
                >
                    <div className="mb-2 flex items-center gap-2 text-[8px] font-black uppercase tracking-[.32em] text-white/55">
                        <span className="rounded-full px-2 py-1" style={{ backgroundColor: primary, color: '#08090C' }}>
                            Em pauta
                        </span>
                        Mileto Journal
                    </div>
                    <h2
                        className="text-4xl font-black uppercase leading-[.82] tracking-[-0.025em] md:text-6xl"
                        style={{
                            color: secondary,
                            fontFamily: fontStack('Bebas Neue'),
                            textShadow: '0 8px 24px rgba(0,0,0,.7)',
                        }}
                    >
                        {firstLine || text}
                    </h2>
                    {secondLine && (
                        <h3
                            className="mt-1 text-3xl font-black uppercase leading-none tracking-tight md:text-5xl"
                            style={{ color: primary, fontFamily: fontStack('Bebas Neue') }}
                        >
                            {secondLine}
                        </h3>
                    )}
                </div>
            );

        case 'premium-chrome-future':
            return (
                <div
                    className={cn('relative max-w-[520px] px-5 py-4 text-center', className)}
                    style={motionStyle('pop', 0, 0.52)}
                >
                    <div
                        className="mb-2 flex items-center justify-center gap-2 text-[8px] font-black uppercase tracking-[.35em]"
                        style={{ color: primary }}
                    >
                        <Sparkles className="h-3.5 w-3.5" /> Future series
                    </div>
                    <h2
                        className="bg-clip-text text-4xl font-black uppercase leading-[.9] tracking-[-0.06em] text-transparent md:text-6xl"
                        style={{
                            backgroundImage: `linear-gradient(180deg, #ffffff 0%, ${primary} 28%, #5a6873 48%, #ffffff 68%, ${primary} 100%)`,
                            fontFamily: fontStack('Archivo Black'),
                            filter: `drop-shadow(0 0 ${8 + pulse * 9}px ${primary}70) drop-shadow(0 8px 16px rgba(0,0,0,.8))`,
                            WebkitTextStroke: '1px rgba(255,255,255,.5)',
                        }}
                    >
                        {text}
                    </h2>
                    <div
                        className="mx-auto mt-3 h-[2px] rounded-full"
                        style={{
                            background: `linear-gradient(90deg, transparent, ${primary}, transparent)`,
                            width: `${lineProgress(0.2) * 88}%`,
                        }}
                    />
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
