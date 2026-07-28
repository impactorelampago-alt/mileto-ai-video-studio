import { useState, FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { GatewayError } from '../lib/gateway';

/**
 * Porta de entrada do app: sem sessão válida, nada mais é renderizado.
 * As chaves de IA e o saldo vivem no gateway — o login é o que libera o uso.
 */
export function LoginScreen() {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (loading) return;
        setError(null);
        setLoading(true);
        try {
            await login(email.trim(), password);
        } catch (err) {
            if (err instanceof GatewayError) {
                setError(err.status === 0 ? 'Sem conexão. Verifique sua internet e tente de novo.' : err.message);
            } else {
                setError('Não foi possível entrar. Tente novamente.');
            }
            setLoading(false);
        }
    }

    return (
        <div className="flex h-screen w-full items-center justify-center bg-background p-6">
            {/* brilho de fundo com o verde→teal da marca */}
            <div
                className="pointer-events-none absolute inset-0 opacity-30 blur-3xl"
                style={{
                    background:
                        'radial-gradient(600px circle at 30% 20%, #5bc63c33, transparent), radial-gradient(600px circle at 70% 80%, #0fa08d33, transparent)',
                }}
            />
            <div className="relative w-full max-w-sm">
                <div className="mb-8 flex flex-col items-center text-center">
                    <img src="/logo.png" alt="Mileto AI Video" className="mb-4 h-16 w-auto" />
                    <h1 className="text-xl font-semibold text-foreground">Mileto AI Video</h1>
                    <p className="mt-1 text-sm text-foreground/50">Entre com sua conta para começar a criar.</p>
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="rounded-2xl border border-white/10 bg-card/60 p-6 shadow-xl backdrop-blur"
                >
                    <label className="mb-1.5 block text-xs font-medium text-foreground/60">E-mail</label>
                    <input
                        type="email"
                        autoFocus
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="voce@empresa.com.br"
                        className="mb-4 w-full rounded-lg border border-white/10 bg-background/60 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-[#0fa08d] focus:ring-1 focus:ring-[#0fa08d]"
                    />

                    <label className="mb-1.5 block text-xs font-medium text-foreground/60">Senha</label>
                    <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="mb-5 w-full rounded-lg border border-white/10 bg-background/60 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-[#0fa08d] focus:ring-1 focus:ring-[#0fa08d]"
                    />

                    {error && (
                        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !email || !password}
                        className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #5bc63c, #0fa08d)' }}
                    >
                        {loading ? 'Entrando…' : 'Entrar'}
                    </button>
                </form>

                <p className="mt-6 text-center text-xs text-foreground/40">
                    Não tem conta? Fale com o suporte Mileto para adquirir seu acesso.
                </p>
            </div>
        </div>
    );
}
