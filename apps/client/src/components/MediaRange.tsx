import type { ChangeEventHandler } from 'react';
import { cn } from '../lib/utils';

interface MediaRangeProps {
    value: number;
    min?: number;
    max: number;
    step?: number;
    onChange: ChangeEventHandler<HTMLInputElement>;
    label: string;
    className?: string;
    disabled?: boolean;
    compact?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The visible rail stays deliberately subtle while the native range keeps a
 * generous hit target. Keeping the real input also preserves keyboard and
 * screen-reader support.
 */
export const MediaRange = ({
    value,
    min = 0,
    max,
    step = 0.01,
    onChange,
    label,
    className,
    disabled = false,
    compact = false,
}: MediaRangeProps) => {
    const safeMax = Number.isFinite(max) && max > min ? max : min + 0.01;
    const safeValue = clamp(Number.isFinite(value) ? value : min, min, safeMax);
    const progress = ((safeValue - min) / (safeMax - min)) * 100;

    return (
        <div
            className={cn(
                'group/media-range relative flex min-w-0 items-center',
                compact ? 'h-5' : 'h-7',
                disabled && 'opacity-45',
                className,
            )}
        >
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-white/25" />
            <span
                aria-hidden="true"
                className="pointer-events-none absolute left-0 h-1 rounded-full bg-brand-lime shadow-[0_0_8px_rgba(0,230,118,0.2)]"
                style={{ width: `${progress}%` }}
            />
            <input
                type="range"
                min={min}
                max={safeMax}
                step={step}
                value={safeValue}
                onChange={onChange}
                disabled={disabled}
                aria-label={label}
                className={cn(
                    'absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none',
                    'focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black',
                    '[&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:bg-transparent',
                    '[&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3',
                    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full',
                    '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#07110d] [&::-webkit-slider-thumb]:bg-brand-lime',
                    '[&::-webkit-slider-thumb]:opacity-0 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,230,118,0.5)]',
                    'hover:[&::-webkit-slider-thumb]:opacity-100 focus-visible:[&::-webkit-slider-thumb]:opacity-100 active:[&::-webkit-slider-thumb]:opacity-100',
                    '[&::-moz-range-track]:h-0.5 [&::-moz-range-track]:bg-transparent',
                    '[&::-moz-range-progress]:bg-transparent',
                    '[&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full',
                    '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#07110d] [&::-moz-range-thumb]:bg-brand-lime',
                )}
            />
        </div>
    );
};

export default MediaRange;
