import { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Home, User, RefreshCw, Cpu } from 'lucide-react';
import { toast } from 'sonner';
import { ApiConfigModal } from '../components/ApiConfigModal';
import { ThemeToggle } from '../components/ThemeToggle';
import { StepHeader } from '../components/StepHeader';
import logoImg from '../../public/logo.png';
import { cn } from '../lib/utils';
import { updater, UpdateStatus } from '../lib/updater';
import { useWizard } from '../context/WizardContext';

export const MainLayout = () => {
    const [isApiModalOpen, setIsApiModalOpen] = useState(false);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const progressToastId = useRef<string | number | null>(null);
    const { saveProject } = useWizard();
    const prevPathRef = useRef<string>(location.pathname);

    // Auto-save do rascunho quando o usuário sai de qualquer /wizard/step/*.
    // Isso cobre tanto o clique no logo quanto navegação via StepHeader e back do browser.
    useEffect(() => {
        const prev = prevPathRef.current;
        const curr = location.pathname;
        const leavingWizard = prev.startsWith('/wizard/step/') && !curr.startsWith('/wizard/step/');
        if (leavingWizard) {
            // saveProject internamente só grava se houver conteúdo — vazio não vira rascunho.
            void saveProject();
        }
        prevPathRef.current = curr;
    }, [location.pathname, saveProject]);

    // Também salva no fechamento da janela (Electron quit / refresh).
    useEffect(() => {
        const onBeforeUnload = () => {
            // Fire-and-forget: em beforeunload não podemos aguardar async.
            void saveProject();
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [saveProject]);

    useEffect(() => {
        const off = updater.onStatus((s: UpdateStatus) => {
            if (s.type === 'progress') {
                const pct = Math.max(0, Math.min(100, Math.round(s.percent)));
                const msg = `Baixando atualização... ${pct}%`;
                if (progressToastId.current == null) {
                    progressToastId.current = toast.loading(msg);
                } else {
                    toast.loading(msg, { id: progressToastId.current });
                }
            } else if (s.type === 'downloaded') {
                if (progressToastId.current != null) {
                    toast.dismiss(progressToastId.current);
                    progressToastId.current = null;
                }
                toast.success(`Versão ${s.version} baixada. Reiniciando para instalar...`, { duration: 2500 });
                setTimeout(() => void updater.install(), 2000);
            } else if (s.type === 'error') {
                if (progressToastId.current != null) {
                    toast.dismiss(progressToastId.current);
                    progressToastId.current = null;
                }
                toast.error(`Erro na atualização: ${s.message}`);
                setIsCheckingUpdate(false);
            }
        });
        return off;
    }, []);

    const handleCheckUpdates = async () => {
        if (isCheckingUpdate) return;

        if (!updater.isAvailable()) {
            window.open('https://github.com/impactorelampago-alt/mileto-ai-video-studio/releases', '_blank');
            return;
        }

        setIsCheckingUpdate(true);
        const checkToastId = toast.loading('Verificando atualizações...');

        try {
            const res = await updater.check();
            toast.dismiss(checkToastId);

            if (!res.ok) {
                toast.error(res.message || 'Falha ao verificar atualizações');
                setIsCheckingUpdate(false);
                return;
            }

            if (!res.updateInfo || res.updateInfo.version === res.currentVersion) {
                toast.success(`Você já está na versão mais recente (${res.currentVersion}).`);
                setIsCheckingUpdate(false);
                return;
            }

            toast.info(`Nova versão ${res.updateInfo.version} disponível. Baixando...`);
            const dl = await updater.download();
            if (!dl.ok) {
                toast.error(dl.message || 'Falha ao baixar atualização');
                setIsCheckingUpdate(false);
            }
        } catch (err: unknown) {
            toast.dismiss(checkToastId);
            toast.error(err instanceof Error ? err.message : 'Erro desconhecido');
            setIsCheckingUpdate(false);
        }
    };

    return (
        <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden transition-colors duration-300">
            <ApiConfigModal isOpen={isApiModalOpen} onClose={() => setIsApiModalOpen(false)} />

            {/* Sidebar Lateral - Visível apenas na Home */}
            {location.pathname === '/' && (
                <aside className="w-[260px] flex-shrink-0 bg-[#0a0f12] border-r border-border/50 flex flex-col justify-between py-6 z-40 relative transition-all">
                    
                    {/* Parte Superior */}
                    <div className="flex flex-col gap-10 px-6">
                        {/* Logo Lockup */}
                        <div
                            onClick={() => navigate('/')}
                            className="flex items-center gap-3 cursor-pointer group"
                        >
                            <div className="relative flex items-center justify-center">
                                <div className="absolute inset-0 rounded-full bg-brand-lime/20 blur-xl group-hover:bg-brand-accent/30 transition-all duration-700 opacity-0 group-hover:opacity-100"></div>
                                <img
                                    src={logoImg}
                                    alt="Mileto AI Logo"
                                    className="w-10 h-10 object-contain drop-shadow-[0_0_8px_rgba(0,230,118,0.3)] relative z-10"
                                />
                            </div>
                            <div className="flex flex-col justify-center">
                                <h1 className="text-base font-black text-foreground tracking-widest uppercase leading-none drop-shadow-sm">
                                    Mileto{' '}
                                    <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-lime to-brand-accent">
                                        AI
                                    </span>
                                </h1>
                                <span className="text-[8px] text-brand-muted uppercase tracking-[0.2em] font-bold mt-0.5 ml-[2px]">
                                    Video Studio
                                </span>
                            </div>
                        </div>

                        {/* Perfil do Usuário */}
                        <div className="flex flex-col items-center gap-3">
                            <div className="relative">
                                <div className="w-16 h-16 rounded-full border border-brand-lime/40 bg-brand-lime/5 flex items-center justify-center">
                                    <User className="w-7 h-7 text-brand-muted" />
                                </div>
                                <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-brand-lime rounded-full border-2 border-[#0a0f12]"></div>
                            </div>
                            <div className="text-center">
                                <h2 className="text-sm font-bold text-foreground">Usuário</h2>
                                <p className="text-[10px] text-brand-muted uppercase tracking-wider font-semibold">Plano Gratuito</p>
                            </div>
                        </div>

                        {/* Menu de Navegação */}
                        <nav className="flex flex-col gap-2 mt-4">
                            <button
                                onClick={() => navigate('/')}
                                className={cn(
                                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                                    location.pathname === '/' || location.pathname.startsWith('/wizard')
                                        ? "bg-brand-lime/10 text-brand-lime border border-brand-lime/20"
                                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                )}
                            >
                                <Home className="w-5 h-5" />
                                <span className="text-sm font-bold">Início</span>
                            </button>
                        </nav>
                    </div>

                    {/* Parte Inferior (Rodapé da Sidebar) */}
                    <div className="px-6 flex flex-col gap-4 border-t border-white/5 pt-6 mt-6">
                        <div className="flex items-center justify-between text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                            <span className="text-xs font-semibold">Tema</span>
                            <ThemeToggle />
                        </div>
                        
                        <button
                            onClick={handleCheckUpdates}
                            disabled={isCheckingUpdate}
                            className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors group disabled:opacity-60 disabled:cursor-wait"
                        >
                            <RefreshCw className={cn(
                                'w-4 h-4 transition-transform duration-500',
                                isCheckingUpdate ? 'animate-spin' : 'group-hover:rotate-180'
                            )} />
                            <span className="text-xs font-semibold">
                                {isCheckingUpdate ? 'Verificando...' : 'Verificar Atualizações'}
                            </span>
                        </button>

                        <button 
                            onClick={() => setIsApiModalOpen(true)}
                            className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors group mt-2"
                        >
                            <div className="px-2 py-1 bg-white/5 border border-white/10 rounded flex items-center gap-1 group-hover:border-brand-lime/40 transition-colors">
                                <Cpu className="w-3 h-3" />
                                <span className="text-[10px] font-bold">API</span>
                            </div>
                            <span className="text-xs font-semibold">Configurações</span>
                        </button>
                    </div>
                </aside>
            )}

            {/* Conteúdo Principal (Direita) */}
            <div className="flex-1 flex flex-col min-w-0 h-screen relative bg-background">
                {/* Topbar com logo → volta pra Home. Só aparece fora da Home (que já tem logo na sidebar).
                    Fica numa faixa própria acima do stepper pra não sobrepor nenhum step. */}
                {location.pathname !== '/' && (
                    <div className="shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-sm z-40 px-4 py-2 flex items-center">
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            title="Voltar para o início"
                            aria-label="Voltar para o início"
                            className="flex items-center gap-2 px-2 py-1 rounded-xl hover:bg-white/5 transition-all group"
                        >
                            <div className="relative flex items-center justify-center">
                                <div className="absolute inset-0 rounded-full bg-brand-lime/20 blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                <img
                                    src={logoImg}
                                    alt="Mileto AI"
                                    className="w-7 h-7 object-contain drop-shadow-[0_0_6px_rgba(0,230,118,0.3)] relative z-10"
                                />
                            </div>
                            <span className="text-[11px] font-black uppercase tracking-widest text-foreground/80 group-hover:text-foreground leading-none">
                                Mileto{' '}
                                <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-lime to-brand-accent">
                                    AI
                                </span>
                            </span>
                        </button>
                    </div>
                )}

                {/* Horizontal Stepper */}
                <div className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm z-30">
                    <StepHeader />
                </div>

                {/* Área de Scroll com Background */}
                <main className="flex-1 overflow-y-auto relative w-full flex flex-col">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none opacity-40"></div>
                    
                    <div className="w-full max-w-[1400px] mx-auto p-6 md:p-10 relative flex-1 flex flex-col">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};
