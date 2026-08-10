import { useState } from 'react';
import { SlidersHorizontal, RotateCcw, ChevronDown } from 'lucide-react';
import { useWizard } from '../context/WizardContext';
import { DEFAULT_VOICE_SETTINGS, FISH_MODELS, type TtsProvider, type VoiceSettings } from '../types';
import { cn } from '../lib/utils';
import { invalidatedNarrationDerivatives } from '../lib/narrationState';
import { effectiveSystemVoicePreset } from '../lib/systemVoices';
import { DEFAULT_PRESET_AUDIO_CONFIG, SYSTEM_MUSIC_TRACKS } from '../lib/systemMusic';

interface SliderRowProps {
    label: string;
    hint: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    onChange: (v: number) => void;
    /** Marca visualmente a faixa recomendada dentro do trilho (0–1 relativo). */
    safeFrom: number;
    safeTo: number;
    inverted?: boolean;
}

const SliderRow = ({
    label,
    hint,
    value,
    min,
    max,
    step,
    format,
    onChange,
    safeFrom,
    safeTo,
    inverted,
}: SliderRowProps) => (
    <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
            <label className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">
                {label}
                {inverted && <span className="ml-1.5 text-[9px] normal-case text-amber-500/90">invertido</span>}
            </label>
            <span className="text-[11px] font-mono tabular-nums text-foreground">{format(value)}</span>
        </div>

        <div className="relative">
            {/* Faixa recomendada, desenhada atrás do input */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-black/10 dark:bg-white/10 pointer-events-none">
                <div
                    className="absolute h-1 rounded-full bg-brand-accent/40"
                    style={{ left: `${safeFrom * 100}%`, width: `${(safeTo - safeFrom) * 100}%` }}
                />
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="relative w-full appearance-none bg-transparent cursor-pointer
                    [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                    [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-brand-accent [&::-webkit-slider-thumb]:border-2
                    [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:shadow"
            />
        </div>

        <p className="text-[10px] text-brand-muted/80 leading-snug">{hint}</p>
    </div>
);

export const VoiceSettingsPanel = () => {
    const { adData, updateAdData, customVoices, musicLibrary, selectedMusicId, setSelectedMusicId } = useWizard();
    // Fechado por padrão: é ajuste opcional e não pode empurrar o botão de
    // gerar narração para fora da tela.
    const [isOpen, setIsOpen] = useState(false);

    const provider: TtsProvider = adData.selectedVoiceProvider ?? 'fishAudio';
    const settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...adData.voiceSettings };
    const selectedPreset =
        effectiveSystemVoicePreset(adData.selectedVoiceId) ||
        customVoices.find((voice) => voice.id === adData.selectedVoiceId)?.preset || {
            voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
            musicTrackId: null,
            audioConfig: {
                narration: { ...DEFAULT_PRESET_AUDIO_CONFIG.narration },
                background: { ...DEFAULT_PRESET_AUDIO_CONFIG.background },
            },
        };

    const patch = (changes: Partial<VoiceSettings>) =>
        updateAdData({
            ...invalidatedNarrationDerivatives(),
            voiceSettings: { ...settings, ...changes },
            // Os ajustes mudam o áudio: obriga a regerar antes de seguir.
            isNarrationGenerated: false,
            narrationAudioUrl: null,
            narrationAudioPath: null,
            sharedNarrationAssetId: undefined,
            narrationDuration: 0,
        });

    const isDefault =
        (Object.keys(selectedPreset.voiceSettings) as (keyof VoiceSettings)[]).every(
            (k) => settings[k] === selectedPreset.voiceSettings[k],
        ) &&
        selectedMusicId === selectedPreset.musicTrackId &&
        JSON.stringify(adData.audioConfig) === JSON.stringify(selectedPreset.audioConfig);

    const resetToVoicePreset = () => {
        updateAdData({
            ...invalidatedNarrationDerivatives(),
            voiceSettings: { ...selectedPreset.voiceSettings },
            audioConfig: {
                narration: { ...selectedPreset.audioConfig.narration },
                background: { ...selectedPreset.audioConfig.background },
            },
            audioTimeline: undefined,
            isNarrationGenerated: false,
            narrationAudioUrl: null,
            narrationAudioPath: null,
            sharedNarrationAssetId: undefined,
            narrationDuration: 0,
        });
        const musicExists =
            !selectedPreset.musicTrackId ||
            musicLibrary.some((track) => track.id === selectedPreset.musicTrackId) ||
            SYSTEM_MUSIC_TRACKS.some((track) => track.id === selectedPreset.musicTrackId);
        setSelectedMusicId(musicExists ? selectedPreset.musicTrackId : null);
    };

    const currentModelHasTags = FISH_MODELS.find((m) => m.id === settings.fishModel)?.tags ?? false;

    // Resumo mostrado quando fechado, para não precisar abrir só pra conferir.
    const summary = [
        `${settings.speed.toFixed(2)}×`,
        provider === 'fishAudio' ? `${settings.volume > 0 ? '+' : ''}${settings.volume} dB` : null,
        provider === 'fishAudio' ? FISH_MODELS.find((m) => m.id === settings.fishModel)?.label : null,
        provider === 'elevenLabs' ? `expr ${settings.stability.toFixed(2)}` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-background overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-4">
                <button
                    onClick={() => setIsOpen((v) => !v)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left group"
                    aria-expanded={isOpen}
                >
                    <SlidersHorizontal className="w-4 h-4 text-brand-accent shrink-0" />
                    <h3 className="text-[13px] font-bold uppercase tracking-wider text-foreground">Ajuste da Voz</h3>
                    {!isOpen && (
                        <span className="text-[11px] font-mono tabular-nums text-brand-muted truncate">{summary}</span>
                    )}
                    <ChevronDown
                        className={cn(
                            'w-4 h-4 text-brand-muted transition-transform shrink-0 group-hover:text-foreground',
                            isOpen && 'rotate-180'
                        )}
                    />
                </button>

                {isOpen && (
                    <button
                        onClick={resetToVoicePreset}
                        disabled={isDefault}
                        className={cn(
                            'flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0',
                            isDefault
                                ? 'text-brand-muted/40 cursor-default'
                                : 'text-brand-muted hover:text-brand-accent'
                        )}
                    >
                        <RotateCcw className="w-3 h-3" />
                        Preset da voz
                    </button>
                )}
            </div>

            {!isOpen ? null : (
            <div className="px-4 pb-4 space-y-5">
            <SliderRow
                label="Velocidade"
                hint="Faixa segura destacada. Os extremos são território sem garantia de qualidade do fornecedor."
                value={settings.speed}
                min={0.5}
                max={2}
                step={0.05}
                format={(v) => `${v.toFixed(2)}×`}
                onChange={(speed) => patch({ speed })}
                safeFrom={(0.8 - 0.5) / 1.5}
                safeTo={(1.25 - 0.5) / 1.5}
            />

            {provider === 'fishAudio' && (
                <SliderRow
                    label="Volume"
                    hint="Ganho aplicado pela própria Fish Audio, em decibéis."
                    value={settings.volume}
                    min={-20}
                    max={20}
                    step={1}
                    format={(v) => `${v > 0 ? '+' : ''}${v} dB`}
                    onChange={(volume) => patch({ volume })}
                    safeFrom={(-5 + 20) / 40}
                    safeTo={(5 + 20) / 40}
                />
            )}

            {provider === 'elevenLabs' && (
                <>
                    <SliderRow
                        label="Expressividade"
                        hint="Menor = mais emoção. A própria ElevenLabs descreve valores altos como voz monótona. Para anúncio, 0.30–0.45."
                        value={settings.stability}
                        min={0}
                        max={1}
                        step={0.05}
                        format={(v) => v.toFixed(2)}
                        onChange={(stability) => patch({ stability })}
                        safeFrom={0.3}
                        safeTo={0.45}
                        inverted
                    />
                    <SliderRow
                        label="Fidelidade à voz"
                        hint="Quanto o resultado deve se parecer com a voz original. Muito alto pode carregar ruídos do áudio de referência."
                        value={settings.similarityBoost}
                        min={0}
                        max={1}
                        step={0.05}
                        format={(v) => v.toFixed(2)}
                        onChange={(similarityBoost) => patch({ similarityBoost })}
                        safeFrom={0.6}
                        safeTo={0.85}
                    />
                </>
            )}

            {provider === 'fishAudio' && (
                <div className="border-t border-black/5 dark:border-white/5 pt-4 space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">Modelo</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {FISH_MODELS.map((m) => (
                            <button
                                key={m.id}
                                onClick={() => patch({ fishModel: m.id })}
                                className={cn(
                                    'px-3 py-2 rounded-lg border text-[11px] font-bold transition-all text-left',
                                    settings.fishModel === m.id
                                        ? 'border-brand-accent bg-brand-accent/15 text-foreground'
                                        : 'border-black/10 dark:border-white/10 bg-background text-brand-muted hover:border-brand-accent/40'
                                )}
                            >
                                {m.label}
                                {m.tags && (
                                    <span className="block text-[9px] font-semibold text-brand-accent/80 normal-case mt-0.5">
                                        aceita tags
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-brand-muted/80 leading-snug">
                        {FISH_MODELS.find((m) => m.id === settings.fishModel)?.note}
                    </p>

                    {currentModelHasTags ? (
                        <p className="text-[10px] text-brand-muted/80 leading-relaxed pt-1">
                            Esse modelo aceita <strong>tags de emoção escritas no roteiro</strong>, entre colchetes e em
                            inglês — <code className="text-brand-accent">[excited]</code>,{' '}
                            <code className="text-brand-accent">[whispering]</code>,{' '}
                            <code className="text-brand-accent">[confident]</code>,{' '}
                            <code className="text-brand-accent">[break]</code> para pausa, e{' '}
                            <code className="text-brand-accent">[emphasis]</code> antes da palavra a destacar. São 66
                            tags oficiais e elas <strong>não contam na cobrança</strong>. Peça um roteiro ao Chat Mileto
                            que ele já aplica.
                        </p>
                    ) : (
                        <p className="text-[10px] text-amber-500/90 leading-relaxed pt-1">
                            O S1 não entende tags de emoção — se você escrever <code>[excited]</code> no roteiro, ele
                            vai <strong>ler a palavra em voz alta</strong>.
                        </p>
                    )}
                </div>
            )}
            </div>
            )}
        </div>
    );
};
