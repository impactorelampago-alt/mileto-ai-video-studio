import { useNavigate } from 'react-router-dom';
import { Sparkles, Film, ArrowRight, Wand2, Scissors, Clock } from 'lucide-react';

export const Home = () => {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col gap-10 py-8">
            {/* Hero */}
            <div className="flex flex-col gap-2">
                <h1 className="text-4xl md:text-5xl font-black text-foreground tracking-tight">
                    Bem-vindo de volta{' '}
                    <span className="inline-block" role="img" aria-label="wave">
                        👋
                    </span>
                </h1>
                <p className="text-lg text-muted-foreground">
                    Escolha como você quer criar seu vídeo hoje.
                </p>
            </div>

            {/* Two creation modes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* AI Mode */}
                <button
                    onClick={() => navigate('/wizard/step/1')}
                    className="group relative overflow-hidden rounded-2xl border-2 border-brand-lime/40 bg-linear-to-br from-brand-lime/10 via-card to-card p-8 text-left transition-all duration-300 hover:border-brand-lime hover:shadow-[0_0_40px_rgba(0,230,118,0.2)] hover:-translate-y-1"
                >
                    <div className="absolute top-4 right-4 flex items-center gap-1 px-2 py-1 rounded-full bg-brand-lime/20 border border-brand-lime/40">
                        <Sparkles className="w-3 h-3 text-brand-lime" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-brand-lime">
                            Recomendado
                        </span>
                    </div>

                    <div className="mb-6 w-16 h-16 rounded-2xl bg-brand-lime/15 border border-brand-lime/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        <Wand2 className="w-8 h-8 text-brand-lime" />
                    </div>

                    <h2 className="text-2xl font-black text-foreground mb-2">
                        Criação com IA
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                        Escreva um roteiro e deixe a Mileto gerar narração, legendas, títulos e montar seu vídeo automaticamente em 4 passos.
                    </p>

                    <ul className="space-y-2 mb-8">
                        {[
                            'Narração TTS automática',
                            'Legendas sincronizadas (Whisper)',
                            'Títulos gerados por IA',
                            'Fluxo guiado de 4 etapas',
                        ].map((feat) => (
                            <li key={feat} className="flex items-center gap-2 text-sm text-foreground/80">
                                <div className="w-1.5 h-1.5 rounded-full bg-brand-lime" />
                                {feat}
                            </li>
                        ))}
                    </ul>

                    <div className="flex items-center gap-2 text-brand-lime font-bold text-sm group-hover:gap-3 transition-all">
                        Começar com IA
                        <ArrowRight className="w-4 h-4" />
                    </div>
                </button>

                {/* Manual Mode */}
                <button
                    onClick={() => navigate('/editor')}
                    className="group relative overflow-hidden rounded-2xl border-2 border-border bg-card p-8 text-left transition-all duration-300 hover:border-foreground/40 hover:shadow-[0_0_40px_rgba(255,255,255,0.05)] hover:-translate-y-1"
                >
                    <div className="mb-6 w-16 h-16 rounded-2xl bg-foreground/5 border border-border flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        <Film className="w-8 h-8 text-foreground" />
                    </div>

                    <h2 className="text-2xl font-black text-foreground mb-2">
                        Edição Manual
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                        Editor completo com timeline multi-track. Controle total sobre cortes, transições, áudio e efeitos.
                    </p>

                    <ul className="space-y-2 mb-8">
                        {[
                            'Timeline multi-track',
                            'Cortes e recortes precisos',
                            'Transições personalizáveis',
                            'Controle profissional',
                        ].map((feat) => (
                            <li key={feat} className="flex items-center gap-2 text-sm text-foreground/80">
                                <div className="w-1.5 h-1.5 rounded-full bg-foreground/60" />
                                {feat}
                            </li>
                        ))}
                    </ul>

                    <div className="flex items-center gap-2 text-foreground font-bold text-sm group-hover:gap-3 transition-all">
                        Abrir Editor
                        <ArrowRight className="w-4 h-4" />
                    </div>
                </button>
            </div>

            {/* Recent projects placeholder */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                        Rascunhos recentes
                    </h3>
                </div>

                <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 flex flex-col items-center justify-center gap-3">
                    <div className="w-14 h-14 rounded-full bg-foreground/5 flex items-center justify-center">
                        <Scissors className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-base font-bold text-foreground">Nenhum projeto ainda</p>
                    <p className="text-sm text-muted-foreground text-center max-w-md">
                        Seus projetos aparecerão aqui. Cada vídeo criado fica salvo automaticamente como rascunho.
                    </p>
                </div>
            </div>
        </div>
    );
};
