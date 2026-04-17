import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Construction, Film } from 'lucide-react';

export const Editor = () => {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col gap-8 py-8">
            <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
            >
                <ArrowLeft className="w-4 h-4" />
                Voltar ao início
            </button>

            <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
                <div className="relative">
                    <div className="absolute inset-0 bg-brand-lime/20 blur-3xl rounded-full" />
                    <div className="relative w-20 h-20 rounded-2xl bg-card border-2 border-border flex items-center justify-center">
                        <Construction className="w-10 h-10 text-brand-lime" />
                    </div>
                </div>

                <div className="flex flex-col gap-2 max-w-xl">
                    <h1 className="text-3xl md:text-4xl font-black text-foreground">
                        Editor Manual em Construção
                    </h1>
                    <p className="text-base text-muted-foreground">
                        O editor profissional estilo CapCut está sendo desenvolvido. Em breve você terá timeline multi-track, cortes precisos, transições e muito mais.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Film className="w-4 h-4 text-brand-lime" />
                    <span className="text-sm font-bold text-brand-lime uppercase tracking-wider">
                        Em desenvolvimento
                    </span>
                </div>
            </div>
        </div>
    );
};
