import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center bg-card border border-border rounded-xl">
                    <div className="p-3 bg-red-500/10 rounded-full mb-4">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                    </div>
                    <h2 className="text-xl font-bold mb-2">Ops! Algo deu errado.</h2>
                    <p className="text-muted-foreground mb-6 max-w-md">
                        Ocorreu um erro inesperado ao renderizar esta parte do aplicativo. Nenhuma informação foi
                        perdida. Tente recarregar.
                    </p>

                    {this.state.error && (
                        <div className="bg-muted/50 p-3 rounded-lg text-xs font-mono text-left w-full max-w-lg mb-6 overflow-auto max-h-32">
                            {this.state.error.toString()}
                        </div>
                    )}

                    <button
                        onClick={() => window.location.reload()}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Recarregar Página
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
