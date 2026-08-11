import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { authStorage } from '../lib/authStorage';
import { gatewayApi, GatewayError, MiletoUser } from '../lib/gateway';
import { invalidateOpsBrandDirectoryCache } from '../lib/opsProjectBrand';

type AuthStatus = 'loading' | 'authed' | 'anon';

interface AuthContextValue {
    status: AuthStatus;
    user: MiletoUser | null;
    balance: number | null;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AuthStatus>('loading');
    const [user, setUser] = useState<MiletoUser | null>(null);
    const [balance, setBalance] = useState<number | null>(null);

    const refreshMe = useCallback(async () => {
        const token = await authStorage.get();
        if (!token) {
            invalidateOpsBrandDirectoryCache();
            setUser(null);
            setBalance(null);
            setStatus('anon');
            return;
        }
        try {
            const { user: u, balance: b } = await gatewayApi.me();
            setUser(u);
            setBalance(b);
            setStatus('authed');
        } catch (err) {
            // Token inválido/expirado (401) → limpa e volta para login.
            if (err instanceof GatewayError && err.status === 401) {
                await authStorage.clear();
                invalidateOpsBrandDirectoryCache();
                setUser(null);
                setBalance(null);
                setStatus('anon');
            } else {
                // Offline ou erro de servidor, mas temos um token salvo: deixa entrar
                // em modo degradado (sem saldo/dados frescos) em vez de bloquear no
                // login por uma queda de rede. Cada recurso de IA avisa se falhar.
                setStatus('authed');
            }
        }
    }, []);

    useEffect(() => {
        refreshMe();
    }, [refreshMe]);

    const login = useCallback(async (email: string, password: string) => {
        const { token, user: u } = await gatewayApi.login(email, password);
        await authStorage.set(token);
        invalidateOpsBrandDirectoryCache();
        setUser(u);
        setStatus('authed');
        // Busca saldo/assentos atualizados logo após entrar.
        refreshMe();
    }, [refreshMe]);

    const logout = useCallback(async () => {
        await gatewayApi.logout();
        await authStorage.clear();
        invalidateOpsBrandDirectoryCache();
        setUser(null);
        setBalance(null);
        setStatus('anon');
    }, []);

    return (
        <AuthContext.Provider value={{ status, user, balance, login, logout, refreshMe }}>
            {children}
        </AuthContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
    return ctx;
}
