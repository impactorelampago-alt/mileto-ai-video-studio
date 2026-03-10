import { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HomeLayout } from './layouts/HomeLayout';
import { MainLayout } from './layouts/MainLayout';
import { DebugProvider } from './context/DebugContext';
import { DebugPanel } from './components/DebugPanel';
import { ChatMileto } from './components/chat/ChatMileto';
import { SHOW_DEBUG_FEATURES } from './context/WizardContext';

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const Step1 = lazy(() => import('./pages/Step1').then((m) => ({ default: m.Step1 })));
const Step2 = lazy(() => import('./pages/Step2').then((m) => ({ default: m.Step2 })));
const Step3 = lazy(() => import('./pages/Step3').then((m) => ({ default: m.Step3 })));
const Step4 = lazy(() => import('./pages/Step4').then((m) => ({ default: m.Step4 })));

function App() {
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
                        {/* Home screen with sidebar */}
                        <Route path="/" element={<HomeLayout />}>
                            <Route index element={<Navigate to="/home" replace />} />
                            <Route path="home" element={<HomePage />} />
                        </Route>

                        {/* Wizard steps with their own top-bar layout */}
                        <Route path="/step" element={<MainLayout />}>
                            <Route path="1" element={<Step1 />} />
                            <Route path="2" element={<Step2 />} />
                            <Route path="3" element={<Step3 />} />
                            <Route path="4" element={<Step4 />} />
                        </Route>

                        {/* Fallback */}
                        <Route path="*" element={<Navigate to="/home" replace />} />
                    </Routes>
                </Suspense>
            </HashRouter>
            {SHOW_DEBUG_FEATURES && <DebugPanel />}
            <ChatMileto />
        </DebugProvider>
    );
}

export default App;
