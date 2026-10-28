import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
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
    const sessionRevision = useRef(0);
    const refreshRevision = useRef(0);

    const refreshMe = useCallback(async () => {
        const session = sessionRevision.current;
        const refresh = ++refreshRevision.current;
        const isCurrent = () => sessionRevision.current === session && refreshRevision.current === refresh;
        const token = await authStorage.get();
        if (!isCurrent()) return;
        const canApply = async () => {
            if (!isCurrent()) return false;
            const currentToken = await authStorage.get();
            return isCurrent() && currentToken === token;
        };
        if (!token) {
            invalidateOpsBrandDirectoryCache();
            setUser(null);
            setBalance(null);
            setStatus('anon');
            return;
        }
        try {
            const { user: u, balance: b } = await gatewayApi.me();
            if (!await canApply()) return;
            setUser(u);
            setBalance(b);
            setStatus('authed');
        } catch (err) {
            if (!await canApply()) return;
            // Token inválido/expirado (401) → limpa e volta para login.
            if (err instanceof GatewayError && err.status === 401) {
                const cleared = await authStorage.clear(token);
                if (!isCurrent() || cleared === false) return;
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
        void refreshMe();
        return () => { sessionRevision.current += 1; refreshRevision.current += 1; };
    }, [refreshMe]);

    const login = useCallback(async (email: string, password: string) => {
        const session = ++sessionRevision.current;
        refreshRevision.current += 1;
        const { token, user: u } = await gatewayApi.login(email, password);
        if (sessionRevision.current !== session) return;
        await authStorage.set(token);
        if (sessionRevision.current !== session) return;
        invalidateOpsBrandDirectoryCache();
        setUser(u);
        setStatus('authed');
        // Busca saldo/assentos atualizados logo após entrar.
        void refreshMe();
    }, [refreshMe]);

    const logout = useCallback(async () => {
        const session = ++sessionRevision.current;
        refreshRevision.current += 1;
        await gatewayApi.logout();
        if (sessionRevision.current !== session) return;
        await authStorage.clear();
        if (sessionRevision.current !== session) return;
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
