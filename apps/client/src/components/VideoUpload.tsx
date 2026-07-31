import { useState } from 'react';
import { Image as ImageIcon, UploadCloud, Video as VideoIcon } from 'lucide-react';
import { MediaSourceModal } from './MediaSourceModal';

type MediaKind = 'video' | 'image';

export const VideoUpload = () => {
    const [pickerKind, setPickerKind] = useState<MediaKind | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <>
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setMenuOpen((current) => !current)}
                    className="grid h-9 w-9 place-items-center rounded-xl border border-brand-lime/25 bg-brand-lime/[0.08] text-brand-lime shadow-[0_0_20px_rgba(0,239,151,0.06)] transition hover:bg-brand-lime/15"
                    title="Adicionar mídia"
                    aria-label="Adicionar mídia"
                    aria-expanded={menuOpen}
                >
                    <UploadCloud className="h-4 w-4" />
                </button>
                {menuOpen && (
                    <div className="absolute left-0 top-11 z-[80] flex gap-1 rounded-xl border border-white/10 bg-[#0b1214]/98 p-1.5 shadow-2xl backdrop-blur-xl">
                        <button
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                setPickerKind('video');
                            }}
                            className="grid h-9 w-9 place-items-center rounded-lg text-brand-muted transition hover:bg-brand-lime/10 hover:text-brand-lime"
                            title="Adicionar vídeos"
                            aria-label="Adicionar vídeos"
                        >
                            <VideoIcon className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                setPickerKind('image');
                            }}
                            className="grid h-9 w-9 place-items-center rounded-lg text-brand-muted transition hover:bg-violet-400/10 hover:text-violet-300"
                            title="Adicionar imagens"
                            aria-label="Adicionar imagens"
                        >
                            <ImageIcon className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </div>

            {pickerKind && <MediaSourceModal kind={pickerKind} onClose={() => setPickerKind(null)} />}
        </>
    );
};
