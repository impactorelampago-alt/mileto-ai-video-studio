import { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';
import { DebugProvider } from './context/DebugContext';
import { DebugPanel } from './components/DebugPanel';
import { ChatMileto } from './components/chat/ChatMileto';
import { SHOW_DEBUG_FEATURES } from './context/WizardContext';
import { useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Account = lazy(() => import('./pages/Account').then((m) => ({ default: m.Account })));
const Step1 = lazy(() => import('./pages/Step1').then((m) => ({ default: m.Step1 })));
const Step2 = lazy(() => import('./pages/Step2').then((m) => ({ default: m.Step2 })));
const Step3 = lazy(() => import('./pages/Step3').then((m) => ({ default: m.Step3 })));
const Step4 = lazy(() => import('./pages/Step4').then((m) => ({ default: m.Step4 })));

function App() {
    const { status } = useAuth();

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
                <Suspense
                    fallback={
                        <div className="flex h-screen w-full items-center justify-center text-foreground/50">
                            Carregando interface...
                        </div>
                    }
                >
                    <Routes>
                        {/* Minha Conta fica fora do MainLayout: tela própria, sem o stepper do wizard. */}
                        <Route path="/account" element={<Account />} />
                        <Route path="/" element={<MainLayout />}>
                            <Route index element={<Home />} />
                            <Route path="wizard/step/1" element={<Step1 />} />
                            <Route path="wizard/step/2" element={<Step2 />} />
                            <Route path="wizard/step/3" element={<Step3 />} />
                            <Route path="wizard/step/4" element={<Step4 />} />
                            {/* Legacy paths → redirect to new wizard paths */}
                            <Route path="step/1" element={<Navigate to="/wizard/step/1" replace />} />
                            <Route path="step/2" element={<Navigate to="/wizard/step/2" replace />} />
                            <Route path="step/3" element={<Navigate to="/wizard/step/3" replace />} />
                            <Route path="step/4" element={<Navigate to="/wizard/step/4" replace />} />
                        </Route>
                    </Routes>
                </Suspense>
            </HashRouter>
            {SHOW_DEBUG_FEATURES && <DebugPanel />}
            <ChatMileto />
        </DebugProvider>
    );
}

export default App;
