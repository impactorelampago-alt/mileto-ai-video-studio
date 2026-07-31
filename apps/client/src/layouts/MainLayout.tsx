import { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
    Bell,
    CheckCircle2,
    Download,
    Film,
    FolderOpen,
    Home,
    Image as ImageIcon,
    Loader2,
    Link2,
    LogOut,
    Music,
    RefreshCw,
    Trash2,
    User,
    Wallet,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { ThemeToggle } from '../components/ThemeToggle';
import { StepHeader } from '../components/StepHeader';
import logoImg from '../../public/logo.png';
import { cn } from '../lib/utils';
import { updater, UpdateStatus } from '../lib/updater';
import { useWizard } from '../context/WizardContext';
import { useAuth } from '../context/AuthContext';
import { useDownloadJobs } from '../context/DownloadJobsContext';

/** Rótulo amigável do plano da organização. */
const PLAN_LABEL: Record<string, string> = {
    solo: 'Plano Solo',
    business: 'Plano Business',
    enterprise: 'Plano Enterprise',
};

export const MainLayout = () => {
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [isDownloadPanelOpen, setIsDownloadPanelOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const progressToastId = useRef<string | number | null>(null);
    const { saveProject } = useWizard();
    const { user, logout } = useAuth();
    const { activeCount, jobs, clearHistory } = useDownloadJobs();
    const prevPathRef = useRef<string>(location.pathname);
    const downloadPanelRef = useRef<HTMLDivElement | null>(null);

    // Auto-save do rascunho quando o usuário sai de qualquer /wizard/step/*.
    // Isso cobre tanto o clique no logo quanto navegação via StepHeader e back do browser.
    useEffect(() => {
        const prev = prevPathRef.current;
        const curr = location.pathname;
        const changedWizardRoute = prev !== curr && prev.startsWith('/wizard/step/');
        if (changedWizardRoute) {
            // saveProject internamente só grava se houver conteúdo — vazio não vira rascunho.
            const previousStep = Number(prev.match(/\/wizard\/step\/(\d+)/)?.[1] || 1);
            void saveProject({ lastStep: previousStep });
        }
        prevPathRef.current = curr;
    }, [location.pathname, saveProject]);

    // Também salva no fechamento da janela (Electron quit / refresh).
    useEffect(() => {
        const onBeforeUnload = () => {
            // Fire-and-forget: em beforeunload não podemos aguardar async.
            void saveProject({ keepalive: true });
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [saveProject]);

    useEffect(() => {
        if (!isDownloadPanelOpen) return;
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!downloadPanelRef.current?.contains(event.target as Node)) setIsDownloadPanelOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsDownloadPanelOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isDownloadPanelOpen]);

    useEffect(() => {
        setIsDownloadPanelOpen(false);
    }, [location.pathname]);

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

    const notificationJobs = [...jobs]
        .sort((a, b) => {
            const activeDifference = Number(b.phase === 'downloading') - Number(a.phase === 'downloading');
            return activeDifference || b.startedAt - a.startedAt;
        })
        .slice(0, 4);
    const finishedNotificationCount = jobs.filter((job) => job.phase !== 'downloading').length;

    const clearNotificationHistory = async () => {
        try {
            await clearHistory();
            toast.success('Histórico de notificações apagado.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Não foi possível limpar o histórico.');
        }
    };

    return (
        <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden transition-colors duration-300">
            {/* Sidebar Lateral - Visível na Home e na aba Arquivos */}
            {(location.pathname === '/' ||
                location.pathname === '/files' ||
                location.pathname === '/downloads' ||
                location.pathname === '/account' ||
                location.pathname === '/integrations') && (
                <aside className="w-[260px] flex-shrink-0 bg-[#0a0f12] border-r border-border/50 flex flex-col justify-between py-6 z-40 relative transition-all">
                    {/* Parte Superior */}
                    <div className="flex flex-col gap-10 px-6">
                        {/* Logo Lockup */}
                        <div onClick={() => navigate('/')} className="flex items-center gap-3 cursor-pointer group">
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
                                <h2 className="text-sm font-bold text-foreground truncate max-w-[180px]">
                                    {user?.name || user?.email || 'Minha conta'}
                                </h2>
                                <p className="text-[10px] text-brand-muted uppercase tracking-wider font-semibold">
                                    {user?.role === 'super_admin'
                                        ? 'Super Admin'
                                        : PLAN_LABEL[user?.orgPlan || ''] || 'Mileto AI'}
                                </p>
                            </div>
                        </div>

                        {/* Menu de Navegação */}
                        <nav className="flex flex-col gap-2 mt-4">
                            <button
                                onClick={() => navigate('/')}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-3 rounded-xl transition-all border',
                                    location.pathname === '/'
                                        ? 'bg-brand-lime/10 text-brand-lime border-brand-lime/20'
                                        : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border-transparent'
                                )}
                            >
                                <Home className="w-5 h-5" />
                                <span className="text-sm font-bold">Início</span>
                            </button>
                            <button
                                onClick={() => navigate('/files')}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-3 rounded-xl transition-all border',
                                    location.pathname === '/files'
                                        ? 'bg-brand-lime/10 text-brand-lime border-brand-lime/20'
                                        : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border-transparent'
                                )}
                            >
                                <FolderOpen className="w-5 h-5" />
                                <span className="text-sm font-bold">Arquivos</span>
                            </button>
                            <button
                                onClick={() => navigate('/downloads')}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-3 rounded-xl transition-all border',
                                    location.pathname === '/downloads'
                                        ? 'bg-brand-lime/10 text-brand-lime border-brand-lime/20'
                                        : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border-transparent'
                                )}
                            >
                                <Download className="w-5 h-5" />
                                <span className="text-sm font-bold">Downloads</span>
                                {activeCount > 0 && (
                                    <span className="ml-auto flex min-w-5 h-5 items-center justify-center rounded-full bg-brand-lime px-1.5 text-[10px] font-black text-[#0a0f12]">
                                        {activeCount}
                                    </span>
                                )}
                            </button>
                            <button
                                onClick={() => navigate('/account')}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-3 rounded-xl transition-all border',
                                    location.pathname === '/account'
                                        ? 'bg-brand-lime/10 text-brand-lime border-brand-lime/20'
                                        : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border-transparent'
                                )}
                            >
                                <Wallet className="w-5 h-5" />
                                <span className="text-sm font-bold">Minha Conta</span>
                            </button>
                            <button
                                onClick={() => navigate('/integrations')}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-3 rounded-xl transition-all border',
                                    location.pathname === '/integrations'
                                        ? 'bg-brand-lime/10 text-brand-lime border-brand-lime/20'
                                        : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border-transparent'
                                )}
                            >
                                <Link2 className="w-5 h-5" />
                                <span className="text-sm font-bold">Integrações</span>
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
                            <RefreshCw
                                className={cn(
                                    'w-4 h-4 transition-transform duration-500',
                                    isCheckingUpdate ? 'animate-spin' : 'group-hover:rotate-180'
                                )}
                            />
                            <span className="text-xs font-semibold">
                                {isCheckingUpdate ? 'Verificando...' : 'Verificar Atualizações'}
                            </span>
                        </button>

                        <button
                            onClick={() => void logout()}
                            className="flex items-center gap-3 text-muted-foreground hover:text-red-400 transition-colors group mt-2"
                        >
                            <LogOut className="w-4 h-4" />
                            <span className="text-xs font-semibold">Sair</span>
                        </button>
                    </div>
                </aside>
            )}

            {/* Conteúdo Principal (Direita) */}
            <div className="flex-1 flex flex-col min-w-0 h-screen relative bg-background">
                {/* Faixa global: aparece em todas as abas e concentra atividades do app. */}
                <div className="relative z-50 flex shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-4 py-2 backdrop-blur-sm">
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        title="Voltar para o início"
                        aria-label="Voltar para o início"
                        className="group flex items-center gap-2 rounded-xl px-2 py-1 transition-all hover:bg-white/5"
                    >
                        <div className="relative flex items-center justify-center">
                            <div className="absolute inset-0 rounded-full bg-brand-lime/20 opacity-0 blur-lg transition-opacity duration-500 group-hover:opacity-100" />
                            <img
                                src={logoImg}
                                alt="Mileto AI"
                                className="relative z-10 h-7 w-7 object-contain drop-shadow-[0_0_6px_rgba(0,230,118,0.3)]"
                            />
                        </div>
                        <span className="text-[11px] font-black uppercase leading-none tracking-widest text-foreground/80 group-hover:text-foreground">
                            Mileto{' '}
                            <span className="bg-linear-to-r from-brand-lime to-brand-accent bg-clip-text text-transparent">
                                AI
                            </span>
                        </span>
                    </button>

                    <div ref={downloadPanelRef} className="relative">
                        <button
                            type="button"
                            onClick={() => setIsDownloadPanelOpen((open) => !open)}
                            aria-label="Atividades em segundo plano"
                            aria-expanded={isDownloadPanelOpen}
                            title="Atividades"
                            className={cn(
                                'relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all',
                                isDownloadPanelOpen
                                    ? 'border-brand-lime/30 bg-brand-lime/15 text-brand-lime'
                                    : 'border-white/10 bg-white/5 text-brand-muted hover:border-white/20 hover:text-foreground'
                            )}
                        >
                            <Bell className="h-4.5 w-4.5" />
                            {activeCount > 0 && (
                                <span className="absolute -right-1.5 -top-1.5 flex min-w-5 h-5 items-center justify-center rounded-full border-2 border-background bg-brand-lime px-1 text-[9px] font-black text-[#0a0f12]">
                                    {activeCount > 9 ? '9+' : activeCount}
                                </span>
                            )}
                        </button>

                        {isDownloadPanelOpen && (
                            <div className="absolute right-0 top-[calc(100%+0.6rem)] w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-brand-dark/98 shadow-2xl backdrop-blur-xl">
                                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                                    <div>
                                        <p className="text-sm font-black text-foreground">Atividades</p>
                                        <p className="mt-0.5 text-[10px] text-brand-muted">
                                            {activeCount > 0
                                                ? `${activeCount} ${activeCount === 1 ? 'atividade em andamento' : 'atividades em andamento'}`
                                                : 'Nenhuma atividade em andamento'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {finishedNotificationCount > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => void clearNotificationHistory()}
                                                title="Apagar notificações finalizadas"
                                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-brand-muted transition-colors hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-300"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                        {activeCount > 0 && (
                                            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-lime" />
                                        )}
                                    </div>
                                </div>

                                <div className="max-h-80 overflow-y-auto">
                                    {notificationJobs.length === 0 ? (
                                        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-brand-muted">
                                            <Bell className="h-7 w-7 opacity-40" />
                                            <p className="text-xs">
                                                Downloads, importações, gerações e exportações aparecerão aqui.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-white/5">
                                            {notificationJobs.map((job) => {
                                                const progress = Math.max(
                                                    0,
                                                    Math.min(100, Number(job.percent || job.stepPercent || 0))
                                                );
                                                return (
                                                    <div key={job.id} className="flex gap-3 px-4 py-3">
                                                        <div
                                                            className={cn(
                                                                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                                                                job.phase === 'downloading'
                                                                    ? 'bg-brand-accent/10 text-brand-accent'
                                                                    : job.phase === 'done'
                                                                      ? 'bg-brand-lime/10 text-brand-lime'
                                                                      : 'bg-red-500/10 text-red-400'
                                                            )}
                                                        >
                                                            {job.phase === 'downloading' ? (
                                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                            ) : job.phase === 'done' ? (
                                                                <CheckCircle2 className="h-4 w-4" />
                                                            ) : (
                                                                <XCircle className="h-4 w-4" />
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                {job.mode === 'video' ? (
                                                                    <Film className="h-3 w-3 shrink-0 text-brand-muted" />
                                                                ) : job.mode === 'image' ? (
                                                                    <ImageIcon className="h-3 w-3 shrink-0 text-brand-muted" />
                                                                ) : (
                                                                    <Music className="h-3 w-3 shrink-0 text-brand-muted" />
                                                                )}
                                                                <p className="truncate text-xs font-bold text-foreground">
                                                                    {job.track?.displayName ||
                                                                        job.title ||
                                                                        'Preparando download...'}
                                                                </p>
                                                            </div>
                                                            {job.phase === 'downloading' ? (
                                                                <div className="mt-2">
                                                                    <div className="mb-1 flex justify-between text-[9px] text-brand-muted">
                                                                        <span>
                                                                            {job.statusText ||
                                                                                (job.step === 'processing'
                                                                                    ? 'Processando'
                                                                                    : 'Baixando')}
                                                                        </span>
                                                                        <span>{Math.round(progress)}%</span>
                                                                    </div>
                                                                    <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                                                                        <div
                                                                            className="h-full bg-linear-to-r from-brand-lime to-brand-accent transition-all duration-500"
                                                                            style={{
                                                                                width: `${Math.max(2, progress)}%`,
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <p
                                                                        className={cn(
                                                                            'mt-1 text-[10px]',
                                                                            job.phase === 'done'
                                                                                ? 'text-brand-lime'
                                                                                : 'text-red-400'
                                                                        )}
                                                                    >
                                                                        {job.phase === 'done'
                                                                            ? 'Concluído'
                                                                            : job.error || 'Falhou'}
                                                                    </p>
                                                                    {job.phase === 'done' && job.outputPath && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const { ipcRenderer } = (
                                                                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                                                    window as any
                                                                                ).require('electron');
                                                                                void ipcRenderer.invoke(
                                                                                    'export-show-in-folder',
                                                                                    job.outputPath
                                                                                );
                                                                            }}
                                                                            className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-black text-brand-lime hover:bg-brand-lime/10"
                                                                        >
                                                                            <FolderOpen className="h-3 w-3" /> Abrir
                                                                            pasta
                                                                        </button>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsDownloadPanelOpen(false);
                                        navigate('/downloads');
                                    }}
                                    className="flex w-full items-center justify-center gap-2 border-t border-white/10 px-4 py-3 text-xs font-black text-brand-lime transition-colors hover:bg-brand-lime/5"
                                >
                                    <Download className="h-3.5 w-3.5" /> Ver todas as atividades
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Horizontal Stepper */}
                <div className="relative z-30 shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
                    <StepHeader />
                </div>

                {/* Área de Scroll com Background */}
                <main className="relative flex w-full flex-1 flex-col overflow-y-auto overscroll-contain">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none opacity-40"></div>

                    <div
                        className={cn(
                            'relative mx-auto flex w-full max-w-[1500px] flex-1 flex-col',
                            location.pathname.includes('/wizard/step/')
                                ? 'px-3 pb-0 pt-3 sm:px-4 lg:px-5 lg:pt-4'
                                : 'p-6 md:p-10'
                        )}
                    >
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};
