import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { ApiConfigModal } from '../components/ApiConfigModal';
import { ThemeToggle } from '../components/ThemeToggle';
import { StepHeader } from '../components/StepHeader';
import logoImg from '../../public/logo.png';

export const MainLayout = () => {
    const [isApiModalOpen, setIsApiModalOpen] = useState(false);

    return (
        <div className="min-h-screen bg-background text-foreground font-sans flex flex-col transition-colors duration-300">
            <ApiConfigModal isOpen={isApiModalOpen} onClose={() => setIsApiModalOpen(false)} />

            {/* Top Navigation Bar / Header - Premium Desktop Feel */}
            <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-40">
                <div className="max-w-[1600px] mx-auto px-6 h-[72px] flex items-center justify-between">
                    {/* Logo Lockup - Clean Symbol Style */}
                    <div className="flex items-center gap-3.5 group cursor-default">
                        <div className="relative flex items-center justify-center">
                            {/* Logo Glow Effect */}
                            <div className="absolute inset-x-0 inset-y-0 rounded-full bg-brand-lime/20 blur-xl group-hover:bg-brand-accent/30 transition-all duration-700 opacity-0 group-hover:opacity-100"></div>

                            {/* Official Logo Image */}
                            <img
                                src={logoImg}
                                alt="Mileto AI Logo"
                                className="w-16 h-16 object-contain transform group-hover:scale-110 transition-transform duration-500 drop-shadow-[0_0_12px_rgba(0,230,118,0.3)] relative z-10"
                            />
                        </div>

                        <div className="flex flex-col justify-center">
                            <h1 className="text-xl font-black text-foreground tracking-widest uppercase leading-none drop-shadow-sm">
                                Mileto{' '}
                                <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-lime to-brand-accent">
                                    AI
                                </span>
                            </h1>
                            <span className="text-[9px] text-brand-muted uppercase tracking-[0.25em] font-bold mt-0.5 ml-[2px]">
                                Video Studio
                            </span>
                        </div>
                    </div>

                    {/* Window Controls / Actions */}
                    <div className="flex items-center gap-4">
                        <ThemeToggle />
                        <button
                            onClick={() => setIsApiModalOpen(true)}
                            className="p-2.5 hover:bg-black/5 dark:bg-white/5 hover:text-foreground rounded-xl transition-all text-muted-foreground border border-transparent hover:border-black/10 dark:border-white/10"
                            title="Configurações do Motor"
                        >
                            <Settings className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </header>

            {/* Horizontal Stepper */}
            <StepHeader />

            <main className="flex-1 w-full bg-background relative transition-colors duration-300">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none opacity-40"></div>

                <div className="w-full max-w-[1600px] mx-auto p-6 z-10 relative">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};
