import { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';
import { DebugProvider } from './context/DebugContext';
import { DebugPanel } from './components/DebugPanel';
import { ChatMileto } from './components/chat/ChatMileto';
import { SHOW_DEBUG_FEATURES } from './context/WizardContext';
import { useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { DownloadJobsProvider } from './context/DownloadJobsContext';
import { ExportJobsProvider } from './context/ExportJobsContext';
import { OpsCompanyGuard } from './components/OpsCompanyGuard';

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Downloads = lazy(() => import('./pages/Downloads').then((m) => ({ default: m.Downloads })));
const DownloadQueue = lazy(() => import('./pages/DownloadQueue').then((m) => ({ default: m.DownloadQueue })));
const Account = lazy(() => import('./pages/Account').then((m) => ({ default: m.Account })));
const Integrations = lazy(() => import('./pages/Integrations').then((m) => ({ default: m.Integrations })));
const AiChatSettings = lazy(() => import('./pages/AiChatSettings').then((m) => ({ default: m.AiChatSettings })));
const AiTitleGeneratorSettings = lazy(() => import('./pages/AiTitleGeneratorSettings').then((m) => ({ default: m.AiTitleGeneratorSettings })));
const Step1 = lazy(() => import('./pages/Step1').then((m) => ({ default: m.Step1 })));
const Step2 = lazy(() => import('./pages/Step2').then((m) => ({ default: m.Step2 })));
const Step3 = lazy(() => import('./pages/Step3').then((m) => ({ default: m.Step3 })));
const Step4 = lazy(() => import('./pages/Step4').then((m) => ({ default: m.Step4 })));

function App() {
    const { status, user } = useAuth();

    // Enquanto valida o token guardado, evita piscar a tela de login.
    if (status === 'loading') {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background text-foreground/50">
                Carregando…
            </div>
        );
    }

    // Sem sessão, o app inteiro fica atrás do login — inclusive o chat flutuante
    // e o painel de debug, que vivem fora das rotas.
    if (status === 'anon') {
        return <LoginScreen />;
    }

    return (
        <DebugProvider>
            <HashRouter>
                <DownloadJobsProvider>
                    <ExportJobsProvider>
                        <Suspense
                            fallback={
                                <div className="flex h-screen w-full items-center justify-center text-foreground/50">
                                    Carregando interface...
                                </div>
                            }
                        >
                            <Routes>
                                <Route path="/" element={<MainLayout />}>
                                    <Route index element={<Home />} />
                                    <Route path="files" element={<Downloads />} />
                                    <Route path="downloads" element={<DownloadQueue />} />
                                    <Route path="account" element={<Account />} />
                                    <Route path="integrations" element={<Integrations />} />
                                    <Route path="ai/chat" element={user?.role === 'owner' ? <AiChatSettings /> : <Navigate to="/" replace />} />
                                    <Route path="ai/title-generator" element={user?.role === 'owner' ? <AiTitleGeneratorSettings /> : <Navigate to="/" replace />} />
                                    <Route path="wizard/step/1" element={<Step1 />} />
                                    <Route path="wizard/step/2" element={<OpsCompanyGuard><Step2 /></OpsCompanyGuard>} />
                                    <Route path="wizard/step/3" element={<OpsCompanyGuard><Step3 /></OpsCompanyGuard>} />
                                    <Route path="wizard/step/4" element={<OpsCompanyGuard><Step4 /></OpsCompanyGuard>} />
                                    {/* Legacy paths → redirect to new wizard paths */}
                                    <Route path="step/1" element={<Navigate to="/wizard/step/1" replace />} />
                                    <Route path="step/2" element={<Navigate to="/wizard/step/2" replace />} />
                                    <Route path="step/3" element={<Navigate to="/wizard/step/3" replace />} />
                                    <Route path="step/4" element={<Navigate to="/wizard/step/4" replace />} />
                                </Route>
                            </Routes>
                        </Suspense>
                        {/* Chat flutuante: fora das ROTAS (aparece em todas), mas DENTRO do
                        HashRouter — ele usa useNavigate() para aplicar o roteiro e ir ao Step 1. */}
                        <ChatMileto />
                    </ExportJobsProvider>
                </DownloadJobsProvider>
            </HashRouter>
            {SHOW_DEBUG_FEATURES && <DebugPanel />}
        </DebugProvider>
    );
}

export default App;
