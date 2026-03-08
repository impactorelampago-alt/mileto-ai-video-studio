import { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';
import { DebugProvider } from './context/DebugContext';
import { DebugPanel } from './components/DebugPanel';
import { ChatMileto } from './components/chat/ChatMileto';
import { SHOW_DEBUG_FEATURES } from './context/WizardContext';

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
                        <Route path="/" element={<MainLayout />}>
                            <Route index element={<Navigate to="/step/1" replace />} />
                            <Route path="step/1" element={<Step1 />} />
                            <Route path="step/2" element={<Step2 />} />
                            <Route path="step/3" element={<Step3 />} />
                            <Route path="step/4" element={<Step4 />} />
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
