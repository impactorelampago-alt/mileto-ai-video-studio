import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { WizardProvider } from './context/WizardContext';
import { Toaster } from 'sonner';
import { ThemeProvider } from './components/ThemeProvider';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ThemeProvider defaultTheme="dark" storageKey="mileto-ui-theme">
            <WizardProvider>
                <App />
                <Toaster position="top-right" theme="system" closeButton />
            </WizardProvider>
        </ThemeProvider>
    </React.StrictMode>
);
