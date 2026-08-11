import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './fonts-selfhosted.css';
import { WizardProvider } from './context/WizardContext';
import { AuthProvider } from './context/AuthContext';
import { Toaster } from 'sonner';
import { ThemeProvider } from './components/ThemeProvider';
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, XCircle } from 'lucide-react';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ThemeProvider defaultTheme="dark" storageKey="mileto-ui-theme">
            <AuthProvider>
                <WizardProvider>
                    <App />
                    <Toaster
                        position="top-right"
                        theme="dark"
                        richColors
                        expand
                        gap={10}
                        closeButton
                        icons={{
                            success: <CheckCircle2 className="h-5 w-5 text-brand-lime" />,
                            info: <Info className="h-5 w-5 text-cyan-300" />,
                            warning: <AlertTriangle className="h-5 w-5 text-amber-300" />,
                            error: <XCircle className="h-5 w-5 text-red-300" />,
                            loading: <LoaderCircle className="h-5 w-5 animate-spin text-violet-300" />,
                        }}
                        toastOptions={{
                            classNames: {
                                toast: '!rounded-2xl !border !border-white/10 !bg-[#0b1212]/95 !text-white !shadow-[0_24px_80px_rgba(0,0,0,.58),0_0_36px_rgba(0,230,118,.06)] !backdrop-blur-xl',
                                title: '!text-[13px] !font-extrabold !text-white',
                                description: '!text-[11px] !leading-relaxed !text-white/50',
                                actionButton: '!rounded-lg !bg-brand-lime !font-bold !text-[#07110d]',
                                cancelButton: '!rounded-lg !bg-white/8 !text-white/70',
                                closeButton: '!border-white/10 !bg-[#111a1a] !text-white/70 hover:!text-white',
                                success: '!border-brand-lime/30 !bg-[linear-gradient(115deg,rgba(0,230,118,.15),rgba(11,18,18,.97)_44%)]',
                                info: '!border-cyan-400/25 !bg-[linear-gradient(115deg,rgba(34,211,238,.13),rgba(11,18,18,.97)_44%)]',
                                warning: '!border-amber-400/25 !bg-[linear-gradient(115deg,rgba(251,191,36,.13),rgba(11,18,18,.97)_44%)]',
                                error: '!border-red-400/25 !bg-[linear-gradient(115deg,rgba(248,113,113,.13),rgba(11,18,18,.97)_44%)]',
                                loading: '!border-violet-400/25 !bg-[linear-gradient(115deg,rgba(167,139,250,.13),rgba(11,18,18,.97)_44%)]',
                            },
                        }}
                    />
                </WizardProvider>
            </AuthProvider>
        </ThemeProvider>
    </React.StrictMode>
);
