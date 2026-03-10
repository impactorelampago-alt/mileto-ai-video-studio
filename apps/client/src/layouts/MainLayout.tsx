import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Settings, ArrowLeft } from 'lucide-react';
import { ApiConfigModal } from '../components/ApiConfigModal';
import { ThemeToggle } from '../components/ThemeToggle';
import { StepHeader } from '../components/StepHeader';
import { UpdateButton } from '../components/UpdateButton';
import logoImg from '../../public/logo.png';

export const MainLayout = () => {
    const navigate = useNavigate();
    const [isApiModalOpen, setIsApiModalOpen] = useState(false);

    return (
        <div className="min-h-screen bg-background text-foreground font-sans flex flex-col transition-colors duration-300">
            <ApiConfigModal isOpen={isApiModalOpen} onClose={() => setIsApiModalOpen(false)} />

            {/* Top Navigation Bar */}
            <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-40">
                <div className="max-w-[1600px] mx-auto px-4 h-[64px] flex items-center justify-between gap-4">
                    {/* Left: Back button + Logo */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate('/home')}
                            className="flex items-center gap-2 p-2 pr-3 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 text-brand-muted hover:text-foreground transition-all group"
                            title="Voltar ao Início"
                        >
                            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                            <span className="text-xs font-semibold hidden sm:block">Início</span>
                        </button>

                        <div className="h-5 w-px bg-white/10" />

                        <div className="flex items-center gap-2.5">
                            <img
                                src={logoImg}
                                alt="Mileto AI Logo"
                                className="w-8 h-8 object-contain drop-shadow-[0_0_8px_rgba(0,230,118,0.3)]"
                            />
                            <span className="text-sm font-black text-foreground tracking-widest uppercase hidden sm:block">
                                Mileto{' '}
                                <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-lime to-brand-accent">
                                    AI
                                </span>
                            </span>
                        </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <UpdateButton />
                        <button
                            onClick={() => setIsApiModalOpen(true)}
                            className="p-2 hover:bg-white/5 hover:text-foreground rounded-xl transition-all text-brand-muted border border-transparent hover:border-white/10"
                            title="Configurações do Motor"
                        >
                            <Settings className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </header>

            {/* Step indicator */}
            <StepHeader />

            <main className="flex-1 w-full bg-background relative transition-colors duration-300">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none opacity-40" />
                <div className="w-full max-w-[1600px] mx-auto p-6 z-10 relative">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};
