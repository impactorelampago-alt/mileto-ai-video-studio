import { useEffect, useState, useCallback, FormEvent } from 'react';
import {
    Wallet, Users, Activity, Loader2, Trash2, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { gatewayApi, GatewayError, UsageRow, TeamMember } from '../lib/gateway';

const PLAN_LABEL: Record<string, string> = {
    solo: 'Solo',
    business: 'Business',
    enterprise: 'Enterprise',
};

const KIND_LABEL: Record<string, string> = {
    tts: 'Narração',
    chat: 'Assistente',
    stt: 'Legendas',
    image: 'Imagem',
    video: 'Vídeo',
};

const fmtCredits = (n: number | null | undefined) =>
    n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

export const Account = () => {
    const { user, balance, refreshMe } = useAuth();

    const [usage, setUsage] = useState<UsageRow[]>([]);
    const [last30, setLast30] = useState<{ credits: number; calls: number } | null>(null);
    const [team, setTeam] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);

    const isOwner = user?.role === 'owner';
    const canManageTeam = isOwner && (user?.maxSeats || 1) > 1;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const u = await gatewayApi.usage();
            setUsage(u.recent);
            setLast30(u.last30);
        } catch {
            /* consumo é secundário; ignora falha */
        }
        if (user?.role === 'owner' || user?.role === 'member') {
            try {
                const t = await gatewayApi.team();
                setTeam(t.team);
            } catch {
                /* sem equipe visível */
            }
        }
        setLoading(false);
    }, [user?.role]);

    useEffect(() => {
        refreshMe();
        load();
    }, [load, refreshMe]);

    return (
        <div className="w-full text-foreground">
            <div className="max-w-4xl mx-auto py-8 space-y-6">
                <header>
                    <h1 className="text-2xl font-extrabold tracking-tight">Minha Conta</h1>
                    <p className="text-sm text-foreground/50 mt-1">
                        {user?.name || user?.email}
                        {user?.orgName ? ` · ${user.orgName}` : ''}
                    </p>
                </header>

                {/* Cartões de resumo */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-white/10 bg-card/50 p-5">
                        <div className="flex items-center gap-2 text-brand-accent mb-2">
                            <Wallet className="w-4 h-4" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">Créditos Mileto</span>
                        </div>
                        <div className="text-2xl font-extrabold">{fmtCredits(balance)}</div>
                        <p className="text-[11px] text-foreground/40 mt-1">Saldo disponível para gerar IA</p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-card/50 p-5">
                        <div className="flex items-center gap-2 text-sky-400 mb-2">
                            <Activity className="w-4 h-4" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">Consumo (30 dias)</span>
                        </div>
                        <div className="text-2xl font-extrabold">{fmtCredits(last30?.credits ?? 0)}</div>
                        <p className="text-[11px] text-foreground/40 mt-1">{last30?.calls ?? 0} gerações no período</p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-card/50 p-5">
                        <div className="flex items-center gap-2 text-violet-400 mb-2">
                            <Users className="w-4 h-4" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">Plano</span>
                        </div>
                        <div className="text-2xl font-extrabold">{PLAN_LABEL[user?.orgPlan || ''] || 'Mileto'}</div>
                        <p className="text-[11px] text-foreground/40 mt-1">
                            {user?.seatsUsed ?? 1} de {user?.maxSeats ?? 1} membros
                        </p>
                    </div>
                </div>

                {/* Equipe (só dono de plano com mais de 1 assento) */}
                {canManageTeam && (
                    <TeamSection team={team} maxSeats={user?.maxSeats || 1} onChanged={load} />
                )}

                {/* Consumo recente */}
                <section className="rounded-2xl border border-white/10 bg-card/50 p-5">
                    <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-foreground/60" /> Últimas gerações
                    </h2>
                    {loading ? (
                        <div className="flex items-center gap-2 text-foreground/40 text-sm py-6 justify-center">
                            <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
                        </div>
                    ) : usage.length === 0 ? (
                        <p className="text-sm text-foreground/40 py-4">Nenhuma geração ainda.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-foreground/40">
                                        <th className="py-2 pr-4 font-semibold">Recurso</th>
                                        <th className="py-2 pr-4 font-semibold">Data</th>
                                        <th className="py-2 pr-4 font-semibold text-right">Créditos</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {usage.map((row, i) => (
                                        <tr key={i} className="border-t border-white/5">
                                            <td className="py-2 pr-4">
                                                {KIND_LABEL[row.kind] || row.kind}
                                                {row.model && <span className="block text-[10px] text-foreground/40">{row.model}</span>}
                                            </td>
                                            <td className="py-2 pr-4 text-foreground/50">
                                                {new Date(row.created_at).toLocaleString('pt-BR')}
                                            </td>
                                            <td className="py-2 pr-4 text-right font-mono">
                                                {row.demo ? 'demo' : fmtCredits(row.charged)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

// ─── Seção de equipe (só dono) ──────────────────────────────────────────────

function TeamSection({ team, maxSeats, onChanged }: { team: TeamMember[]; maxSeats: number; onChanged: () => void }) {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [adding, setAdding] = useState(false);

    const seatsFull = team.length >= maxSeats;

    async function handleAdd(e: FormEvent) {
        e.preventDefault();
        if (adding) return;
        setAdding(true);
        try {
            await gatewayApi.addMember(email.trim(), name.trim(), password);
            toast.success('Membro adicionado.');
            setEmail('');
            setName('');
            setPassword('');
            onChanged();
        } catch (err) {
            toast.error(err instanceof GatewayError ? err.message : 'Não foi possível adicionar o membro.');
        } finally {
            setAdding(false);
        }
    }

    async function handleRemove(userId: number, label: string) {
        try {
            await gatewayApi.removeMember(userId);
            toast.success(`Membro ${label} removido.`);
            onChanged();
        } catch (err) {
            toast.error(err instanceof GatewayError ? err.message : 'Não foi possível remover o membro.');
        }
    }

    return (
        <section className="rounded-2xl border border-white/10 bg-card/50 p-5">
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-foreground/60" /> Equipe
                <span className="text-[11px] font-normal text-foreground/40">
                    ({team.length}/{maxSeats})
                </span>
            </h2>

            <div className="space-y-2 mb-4">
                {team.map((m) => (
                    <div
                        key={m.id}
                        className="flex items-center justify-between rounded-lg border border-white/5 bg-background/40 px-3 py-2"
                    >
                        <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{m.name || m.email}</div>
                            <div className="text-[11px] text-foreground/40 truncate">
                                {m.email} · {m.role === 'owner' ? 'Dono' : 'Membro'}
                            </div>
                        </div>
                        {m.role !== 'owner' && (
                            <button
                                onClick={() => handleRemove(m.id, m.name || m.email)}
                                className="p-2 rounded-lg text-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                                title="Remover membro"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {seatsFull ? (
                <p className="text-[11px] text-amber-500/90">
                    Limite de membros do plano atingido. Faça upgrade para adicionar mais.
                </p>
            ) : (
                <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                        type="text"
                        placeholder="Nome"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="rounded-lg border border-white/10 bg-background/60 px-3 py-2 text-sm outline-none focus:border-[#0fa08d]"
                    />
                    <input
                        type="email"
                        required
                        placeholder="E-mail"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="rounded-lg border border-white/10 bg-background/60 px-3 py-2 text-sm outline-none focus:border-[#0fa08d]"
                    />
                    <input
                        type="password"
                        required
                        placeholder="Senha"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="rounded-lg border border-white/10 bg-background/60 px-3 py-2 text-sm outline-none focus:border-[#0fa08d]"
                    />
                    <button
                        type="submit"
                        disabled={adding || !email || !password}
                        className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-white transition disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #5bc63c, #0fa08d)' }}
                    >
                        {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                        Adicionar
                    </button>
                </form>
            )}
        </section>
    );
}
