import { useEffect, useMemo, useState } from 'react';
import { Check, Crosshair, Focus, Minus, MousePointer2, Plus, ScanSearch, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { MediaTake, TakeMotionEffect, TakeZoomType } from '../types';
import { cn } from '../lib/utils';

interface ZoomEffectsModalProps {
    isOpen: boolean;
    takes: MediaTake[];
    onClose: () => void;
    onApply: (_takeIds: string[], _effect: TakeMotionEffect | null) => void;
}

const FOCUS_POINTS = [
    { id: 'center', label: 'Centro', x: 50, y: 50 },
    { id: 'top', label: 'Rosto / topo', x: 50, y: 32 },
    { id: 'left', label: 'Esquerda', x: 32, y: 50 },
    { id: 'right', label: 'Direita', x: 68, y: 50 },
];

export const ZoomEffectsModal = ({ isOpen, takes, onClose, onApply }: ZoomEffectsModalProps) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [type, setType] = useState<TakeZoomType>('zoom-in');
    const [intensity, setIntensity] = useState(0.12);
    const [easing, setEasing] = useState<TakeMotionEffect['easing']>('smooth');
    const [focalX, setFocalX] = useState(50);
    const [focalY, setFocalY] = useState(50);

    useEffect(() => {
        if (!isOpen) return;
        setSelectedIds(new Set(takes.map((take) => take.id)));
        const existing = takes.find((take) => take.motionEffect)?.motionEffect;
        if (existing) {
            setType(existing.type);
            setIntensity(existing.intensity);
            setEasing(existing.easing);
            setFocalX(existing.focalX);
            setFocalY(existing.focalY);
        }
    }, [isOpen, takes]);

    const allSelected = takes.length > 0 && selectedIds.size === takes.length;
    const selectedTakes = useMemo(() => takes.filter((take) => selectedIds.has(take.id)), [takes, selectedIds]);

    if (!isOpen) return null;

    const toggleTake = (id: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const apply = () => {
        if (selectedIds.size === 0) return;
        onApply(Array.from(selectedIds), { type, intensity, easing, focalX, focalY });
        onClose();
    };

    const remove = () => {
        if (selectedIds.size === 0) return;
        onApply(Array.from(selectedIds), null);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-[#030706]/85 p-5 backdrop-blur-md">
            <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-emerald-400/15 bg-[#0b1214] shadow-[0_35px_120px_rgba(0,0,0,.65)]">
                <header className="flex items-start justify-between border-b border-white/7 bg-linear-to-r from-emerald-500/10 via-transparent to-cyan-500/7 px-7 py-6">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.22em] text-brand-lime">
                            <ScanSearch className="h-4 w-4" /> Movimento de câmera
                        </div>
                        <h2 className="text-2xl font-black tracking-tight text-foreground">Zoom profissional nos takes</h2>
                        <p className="mt-1.5 max-w-2xl text-sm text-brand-muted">
                            Selecione um ou vários takes e aplique um movimento suave, sem alterar seus cortes.
                        </p>
                    </div>
                    <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-white/8 bg-white/5 text-brand-muted transition hover:bg-white/10 hover:text-foreground" title="Fechar">
                        <X className="h-5 w-5" />
                    </button>
                </header>

                <div className="grid min-h-0 flex-1 lg:grid-cols-[1.05fr_.95fr]">
                    <section className="min-h-0 overflow-y-auto border-b border-white/7 p-6 lg:border-b-0 lg:border-r">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-black text-foreground">Escolha os takes</h3>
                                <p className="mt-1 text-xs text-brand-muted">{selectedIds.size} de {takes.length} selecionados</p>
                            </div>
                            <button
                                onClick={() => setSelectedIds(allSelected ? new Set() : new Set(takes.map((take) => take.id)))}
                                className="rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-foreground/70 transition hover:border-brand-lime/30 hover:text-brand-lime"
                            >
                                {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {takes.map((take, index) => {
                                const selected = selectedIds.has(take.id);
                                return (
                                    <button
                                        key={take.id}
                                        onClick={() => toggleTake(take.id)}
                                        className={cn(
                                            'group relative overflow-hidden rounded-2xl border bg-black/25 text-left transition',
                                            selected ? 'border-brand-lime/55 ring-1 ring-brand-lime/15' : 'border-white/8 hover:border-white/18'
                                        )}
                                    >
                                        <div className="relative aspect-video overflow-hidden bg-black">
                                            {take.type === 'video' ? (
                                                <video src={take.proxyUrl || take.url} className="h-full w-full object-cover opacity-75" muted />
                                            ) : (
                                                <img src={take.proxyUrl || take.url} alt="" className="h-full w-full object-cover opacity-75" />
                                            )}
                                            <span className={cn('absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-lg border backdrop-blur', selected ? 'border-brand-lime/40 bg-brand-lime text-[#07110d]' : 'border-white/15 bg-black/50 text-transparent')}>
                                                <Check className="h-3.5 w-3.5" />
                                            </span>
                                            <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-1 font-mono text-[9px] font-bold text-white/70">{String(index + 1).padStart(2, '0')}</span>
                                        </div>
                                        <div className="px-3 py-2.5">
                                            <p className="truncate text-[11px] font-bold text-foreground/85">{take.fileName}</p>
                                            <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-brand-muted">
                                                {take.motionEffect ? 'Zoom configurado' : 'Sem movimento'}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className="min-h-0 overflow-y-auto p-6">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            {([
                                { id: 'zoom-in' as const, label: 'Zoom In', description: 'Aproxima gradualmente', Icon: ZoomIn },
                                { id: 'zoom-out' as const, label: 'Zoom Out', description: 'Abre o enquadramento', Icon: ZoomOut },
                                { id: 'zoom-in-out' as const, label: 'In + Out', description: 'Aproxima e retorna', Icon: ScanSearch },
                            ]).map(({ id, label, description, Icon }) => (
                                <button key={id} onClick={() => setType(id)} className={cn('rounded-2xl border p-4 text-left transition', type === id ? 'border-brand-lime/50 bg-brand-lime/9 shadow-[0_12px_35px_rgba(0,230,118,.08)]' : 'border-white/8 bg-white/[.025] hover:border-white/16')}>
                                    <Icon className={cn('mb-4 h-6 w-6', type === id ? 'text-brand-lime' : 'text-brand-muted')} />
                                    <p className="text-sm font-black text-foreground">{label}</p>
                                    <p className="mt-1 text-[10px] text-brand-muted">{description}</p>
                                </button>
                            ))}
                        </div>

                        <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-wider text-brand-muted">Intensidade</span>
                                <span className="rounded-lg bg-brand-lime/10 px-2 py-1 font-mono text-xs font-black text-brand-lime">{Math.round(intensity * 100)}%</span>
                            </div>
                            <input type="range" min="0.04" max="0.3" step="0.01" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} className="w-full accent-brand-lime" />
                            <div className="mt-2 flex justify-between text-[9px] font-bold uppercase text-brand-muted/60"><span>Discreto</span><span>Marcante</span></div>
                        </div>

                        <div className="mt-5">
                            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-brand-muted"><Crosshair className="h-4 w-4" /> Ponto de foco</div>
                            <div className="grid grid-cols-2 gap-2">
                                {FOCUS_POINTS.map((point) => {
                                    const selected = focalX === point.x && focalY === point.y;
                                    return <button key={point.id} onClick={() => { setFocalX(point.x); setFocalY(point.y); }} className={cn('flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-bold transition', selected ? 'border-cyan-400/40 bg-cyan-400/8 text-cyan-300' : 'border-white/8 text-foreground/65 hover:border-white/16')}><Focus className="h-3.5 w-3.5" /> {point.label}</button>;
                                })}
                            </div>
                        </div>

                        <div className="mt-5 flex rounded-xl border border-white/8 bg-black/20 p-1">
                            <button onClick={() => setEasing('smooth')} className={cn('flex-1 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wider transition', easing === 'smooth' ? 'bg-white/10 text-foreground' : 'text-brand-muted')}>Suave</button>
                            <button onClick={() => setEasing('linear')} className={cn('flex-1 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wider transition', easing === 'linear' ? 'bg-white/10 text-foreground' : 'text-brand-muted')}>Constante</button>
                        </div>

                        <div className="mt-5 rounded-2xl border border-brand-lime/15 bg-brand-lime/[.045] p-4">
                            <div className="flex items-center gap-2 text-xs font-black text-brand-lime"><MousePointer2 className="h-4 w-4" /> Aplicar sem alterar os cortes</div>
                            <p className="mt-1.5 text-[10px] leading-relaxed text-foreground/55">O movimento acompanha cada take do início ao fim e fica salvo no projeto.</p>
                        </div>
                    </section>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/7 bg-black/20 px-7 py-5">
                    <button onClick={remove} disabled={selectedIds.size === 0 || selectedTakes.every((take) => !take.motionEffect)} className="inline-flex items-center gap-2 rounded-xl border border-white/8 px-4 py-3 text-xs font-black text-brand-muted transition hover:border-red-400/25 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"><Minus className="h-4 w-4" /> Remover zoom</button>
                    <button onClick={apply} disabled={selectedIds.size === 0} className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-brand-lime to-brand-accent px-6 py-3 text-xs font-black uppercase tracking-wider text-[#06110d] shadow-[0_14px_38px_rgba(0,230,118,.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"><Plus className="h-4 w-4" /> Aplicar em {selectedIds.size} {selectedIds.size === 1 ? 'take' : 'takes'}</button>
                </footer>
            </div>
        </div>
    );
};
