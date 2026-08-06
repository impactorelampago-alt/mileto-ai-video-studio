import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { AiAgentId, AiChatAgentSetting, GatewayError, gatewayApi } from '../lib/gateway';

export const AiChatSettings = () => {
    const [agents, setAgents] = useState<AiChatAgentSetting[]>([]);
    const [selectedId, setSelectedId] = useState<AiAgentId>('director');
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const selected = useMemo(() => agents.find((agent) => agent.id === selectedId) || agents[0], [agents, selectedId]);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await gatewayApi.aiChatSettings();
            setAgents(data.agents);
            const current = data.agents.find((agent) => agent.id === 'director') || data.agents[0];
            if (current) {
                setSelectedId(current.id);
                setDraft(current.effectivePrompt);
            }
        } catch (error) {
            const message = error instanceof GatewayError ? error.message : 'Não foi possível carregar os prompts.';
            setLoadError(message);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const selectAgent = (agent: AiChatAgentSetting) => {
        setSelectedId(agent.id);
        setDraft(agent.effectivePrompt);
    };

    const save = async () => {
        if (!selected || !draft.trim()) return toast.error('O prompt não pode ficar vazio.');
        setSaving(true);
        try {
            const data = await gatewayApi.saveAiAgentPrompt(selected.id, draft.trim());
            setAgents(data.agents);
            const updated = data.agents.find((agent) => agent.id === selected.id);
            if (updated) setDraft(updated.effectivePrompt);
            toast.success('Prompt da agência salvo para toda a equipe.');
        } catch (error) {
            toast.error(error instanceof GatewayError ? error.message : 'Não foi possível salvar o prompt.');
        } finally {
            setSaving(false);
        }
    };

    const reset = async () => {
        if (!selected) return;
        setSaving(true);
        try {
            const data = await gatewayApi.saveAiAgentPrompt(selected.id, null);
            setAgents(data.agents);
            const updated = data.agents.find((agent) => agent.id === selected.id);
            if (updated) setDraft(updated.effectivePrompt);
            toast.success('Agente voltou a usar o padrão Mileto.');
        } catch (error) {
            toast.error(error instanceof GatewayError ? error.message : 'Não foi possível restaurar o padrão.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="w-full overflow-y-auto text-foreground">
            <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
                <header className="flex items-start justify-between gap-6">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-brand-lime">
                            <Bot className="h-4 w-4" /> IA · Chat
                        </div>
                        <h1 className="text-3xl font-black tracking-tight">Prompts da sua agência</h1>
                        <p className="mt-2 max-w-3xl text-sm text-foreground/55">
                            O padrão Mileto continua disponível. Ao personalizar um agente, o novo prompt passa a valer para o dono e toda a equipe desta agência.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-brand-lime/20 bg-brand-lime/5 px-3 py-2 text-xs text-brand-lime">
                        <ShieldCheck className="h-4 w-4" /> Isolado por agência
                    </div>
                </header>

                {loading ? (
                    <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-foreground/50"><Loader2 className="h-5 w-5 animate-spin" /> Carregando agentes…</div>
                ) : loadError ? (
                    <div className="flex min-h-80 flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-card/45 px-6 text-center">
                        <p className="max-w-xl text-sm text-foreground/60">{loadError}</p>
                        <button type="button" onClick={() => void load()} className="rounded-xl border border-brand-lime/25 px-4 py-2.5 text-xs font-black text-brand-lime hover:bg-brand-lime/10">Tentar novamente</button>
                    </div>
                ) : (
                    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                        <aside className="space-y-2 rounded-2xl border border-white/10 bg-card/45 p-3">
                            {agents.map((agent) => (
                                <button
                                    key={agent.id}
                                    type="button"
                                    onClick={() => selectAgent(agent)}
                                    className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === agent.id ? 'border-brand-lime/30 bg-brand-lime/10' : 'border-transparent hover:border-white/10 hover:bg-white/5'}`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm font-bold">{agent.shortLabel}</span>
                                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${agent.usesDefault ? 'bg-white/5 text-foreground/45' : 'bg-brand-lime/15 text-brand-lime'}`}>
                                            {agent.usesDefault ? 'Padrão' : 'Agência'}
                                        </span>
                                    </div>
                                    <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-foreground/45">{agent.description}</p>
                                </button>
                            ))}
                        </aside>

                        {selected && (
                            <section className="rounded-2xl border border-white/10 bg-card/45 p-5">
                                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h2 className="text-lg font-extrabold">{selected.label}</h2>
                                        <p className="mt-1 text-xs text-foreground/45">{selected.description}</p>
                                    </div>
                                    <span className="text-xs text-foreground/40">{draft.length.toLocaleString('pt-BR')} caracteres</span>
                                </div>
                                <textarea
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    spellCheck={false}
                                    className="min-h-[480px] w-full resize-y rounded-xl border border-white/10 bg-[#09100f] p-4 font-mono text-xs leading-relaxed text-foreground outline-none transition focus:border-brand-lime/35"
                                />
                                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-[11px] text-foreground/40">Use <code className="text-brand-lime">{'{idioma}'}</code> para inserir o idioma escolhido pelo usuário.</p>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={reset} disabled={saving || selected.usesDefault} className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-foreground/65 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35">
                                            <RotateCcw className="h-4 w-4" /> Usar padrão Mileto
                                        </button>
                                        <button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 rounded-xl bg-brand-lime px-4 py-2.5 text-xs font-black text-[#07110d] transition hover:brightness-110 disabled:opacity-50">
                                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar para a equipe
                                        </button>
                                    </div>
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
