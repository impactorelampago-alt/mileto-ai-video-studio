import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Home, Settings } from 'lucide-react';
import { useState } from 'react';
import { ApiConfigModal } from '../components/ApiConfigModal';
import { ThemeToggle } from '../components/ThemeToggle';
import { cn } from '../lib/utils';
import { UpdateButton } from '../components/UpdateButton';
import logoImg from '../../public/logo.png';

const NAV_ITEMS = [{ icon: Home, label: 'Início', path: '/home' }];

export const HomeLayout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [isApiModalOpen, setIsApiModalOpen] = useState(false);

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background text-foreground font-sans">
            <ApiConfigModal isOpen={isApiModalOpen} onClose={() => setIsApiModalOpen(false)} />

            {/* ── SIDEBAR — adapts to light/dark theme ── */}
            <aside className="flex flex-col w-[220px] shrink-0 h-full border-r border-black/8 dark:border-white/5 bg-gray-50 dark:bg-[#060a0d]">
                {/* Logo */}
                <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
                    <img
                        src={logoImg}
                        alt="Mileto AI"
                        className="w-8 h-8 object-contain drop-shadow-[0_0_8px_rgba(0,230,118,0.4)]"
                    />
                    <div>
                        <span className="text-sm font-black tracking-widest uppercase text-foreground leading-none">
                            Mileto{' '}
                            <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-lime to-brand-accent">
                                AI
                            </span>
                        </span>
                        <span className="block text-[8px] text-foreground/40 uppercase tracking-[0.2em]">
                            Video Studio
                        </span>
                    </div>
                </div>

                {/* Divider */}
                <div className="mx-4 h-px bg-black/8 dark:bg-white/8 mb-5" />

                {/* Profile Placeholder */}
                <div className="flex flex-col items-center px-5 mb-6">
                    <div className="relative">
                        <div
                            className="w-14 h-14 rounded-full flex items-center justify-center select-none"
                            style={{
                                background:
                                    'linear-gradient(135deg, rgba(0,230,118,0.15) 0%, rgba(120,120,120,0.05) 100%)',
                                boxShadow: '0 0 0 2px rgba(0,230,118,0.25), 0 0 16px rgba(0,230,118,0.08)',
                            }}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                className="w-7 h-7 text-foreground/30"
                                stroke="currentColor"
                                strokeWidth={1.5}
                            >
                                <circle cx="12" cy="8" r="4" />
                                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                            </svg>
                        </div>
                        <span className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full bg-brand-accent border-2 border-background shadow-[0_0_6px_rgba(0,230,118,0.6)]" />
                    </div>
                    <p className="mt-2.5 text-xs font-semibold text-foreground/70">Usuário</p>
                    <p className="text-[10px] text-foreground/40">Plano Gratuito</p>
                </div>

                {/* Navigation */}
                <nav className="flex-1 flex flex-col gap-1 px-3">
                    {NAV_ITEMS.map(({ icon: Icon, label, path }) => {
                        const isActive = location.pathname === path || (path === '/home' && location.pathname === '/');
                        return (
                            <button
                                key={path}
                                onClick={() => navigate(path)}
                                className={cn(
                                    'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 text-left',
                                    isActive
                                        ? 'bg-brand-accent/15 text-brand-accent shadow-[inset_0_0_0_1px_rgba(0,230,118,0.2)]'
                                        : 'text-foreground/50 hover:bg-black/5 dark:hover:bg-white/5 hover:text-foreground'
                                )}
                            >
                                <Icon
                                    className={cn(
                                        'w-4 h-4 shrink-0',
                                        isActive ? 'text-brand-accent' : 'text-foreground/40'
                                    )}
                                />
                                {label}
                            </button>
                        );
                    })}
                </nav>

                {/* Footer */}
                <div className="px-3 pb-5 flex flex-col gap-0.5">
                    <div className="mx-2 h-px bg-black/8 dark:bg-white/8 mb-3" />

                    {/* Theme Row */}
                    <div className="flex items-center gap-3 px-3 py-2">
                        <span className="text-xs font-semibold text-foreground/40 flex-1">Tema</span>
                        <ThemeToggle />
                    </div>

                    {/* Update Button */}
                    <div className="px-1">
                        <UpdateButton />
                    </div>

                    {/* Settings */}
                    <button
                        onClick={() => setIsApiModalOpen(true)}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 text-foreground/50 hover:bg-black/5 dark:hover:bg-white/5 hover:text-foreground"
                    >
                        <Settings className="w-4 h-4 shrink-0 text-foreground/40" />
                        Configurações
                    </button>
                </div>
            </aside>

            {/* ── MAIN CONTENT ── */}
            <main className="flex-1 min-w-0 h-full overflow-y-auto bg-background">
                <Outlet />
            </main>
        </div>
    );
};
