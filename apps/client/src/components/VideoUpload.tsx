import { useState } from 'react';
import { Image as ImageIcon, Layers3, Video as VideoIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { MediaSourceModal } from './MediaSourceModal';

type MediaKind = 'video' | 'image';

export const VideoUpload = () => {
    const [pickerKind, setPickerKind] = useState<MediaKind | null>(null);

    const cards: Array<{
        kind: MediaKind;
        title: string;
        formats: string;
        icon: typeof VideoIcon;
    }> = [
        { kind: 'video', title: 'Adicionar vídeo', formats: 'MP4, MOV · PC, Equipe ou Ops', icon: VideoIcon },
        { kind: 'image', title: 'Adicionar imagem', formats: 'JPG, PNG · PC, Equipe ou Ops', icon: ImageIcon },
    ];

    return (
        <>
            <div className="grid grid-cols-2 gap-4">
                {cards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <button
                            key={card.kind}
                            type="button"
                            onClick={() => setPickerKind(card.kind)}
                            className={cn(
                                'group relative flex min-h-[170px] flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-card p-6 text-center transition-all',
                                'hover:border-primary/60 hover:bg-primary/[0.035] hover:shadow-[0_0_30px_rgba(0,239,151,0.06)]'
                            )}
                        >
                            <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-white/8 bg-black/15 px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-brand-muted">
                                <Layers3 className="h-3 w-3" /> 3 origens
                            </span>
                            <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-primary transition-transform group-hover:scale-105">
                                <Icon className="h-6 w-6" />
                            </span>
                            <p className="mt-3 text-sm font-bold text-foreground">{card.title}</p>
                            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{card.formats}</p>
                        </button>
                    );
                })}
            </div>

            {pickerKind && <MediaSourceModal kind={pickerKind} onClose={() => setPickerKind(null)} />}
        </>
    );
};
