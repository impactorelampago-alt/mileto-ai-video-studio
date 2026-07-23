import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { WizardProvider } from './context/WizardContext';
import { AuthProvider } from './context/AuthContext';
import { Toaster } from 'sonner';
import { ThemeProvider } from './components/ThemeProvider';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ThemeProvider defaultTheme="dark" storageKey="mileto-ui-theme">
            <AuthProvider>
                <WizardProvider>
                    <App />
                    <Toaster position="top-right" theme="system" closeButton />
                </WizardProvider>
            </AuthProvider>
        </ThemeProvider>
    </React.StrictMode>
);
