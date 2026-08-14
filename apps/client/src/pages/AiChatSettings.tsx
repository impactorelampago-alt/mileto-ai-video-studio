import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { AiChatAgentSetting, GatewayError, gatewayApi } from '../lib/gateway';

export const AiChatSettings = () => {
    const [agents, setAgents] = useState<AiChatAgentSetting[]>([]);
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const selected = useMemo(() => agents.find((agent) => agent.id === 'prompt_sales'), [agents]);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await gatewayApi.aiChatSettings();
            setAgents(data.agents);
            const current = data.agents.find((agent) => agent.id === 'prompt_sales');
            if (!current) throw new Error('O prompt do Narrador não foi encontrado.');
            setDraft(current.effectivePrompt);
        } catch (error) {
            const message = error instanceof GatewayError || error instanceof Error
                ? error.message
                : 'Não foi possível carregar o prompt do Narrador.';
            setLoadError(message);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        if (!selected) return;
        setSaving(true);
        const promptToSave = draft;
        try {
            // Prompt vazio é intencional: o Narrador deve poder operar sem uma
            // instrução de sistema definida pela agência.
            const data = await gatewayApi.saveAiAgentPrompt(selected.id, promptToSave);
            setAgents(data.agents);
            const updated = data.agents.find((agent) => agent.id === selected.id);
            if (updated) setDraft(updated.effectivePrompt);
            toast.success(promptToSave.length === 0
                ? 'Narrador salvo sem prompt para toda a equipe.'
                : 'Prompt do Narrador salvo para toda a equipe.');
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
            toast.success('Narrador voltou a usar o padrão Mileto.');
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
                        <h1 className="text-3xl font-black tracking-tight">Prompt do Narrador</h1>
                        <p className="mt-2 max-w-3xl text-sm text-foreground/55">
                            Personalize como o Narrador conversa. O novo prompt passa a valer para o dono e toda a equipe desta agência.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-brand-lime/20 bg-brand-lime/5 px-3 py-2 text-xs text-brand-lime">
                        <ShieldCheck className="h-4 w-4" /> Isolado por agência
                    </div>
                </header>

                {loading ? (
                    <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-foreground/50"><Loader2 className="h-5 w-5 animate-spin" /> Carregando Narrador…</div>
                ) : loadError ? (
                    <div className="flex min-h-80 flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-card/45 px-6 text-center">
                        <p className="max-w-xl text-sm text-foreground/60">{loadError}</p>
                        <button type="button" onClick={() => void load()} className="rounded-xl border border-brand-lime/25 px-4 py-2.5 text-xs font-black text-brand-lime hover:bg-brand-lime/10">Tentar novamente</button>
                    </div>
                ) : (
                    <div>
                        {selected ? (
                            <section className="rounded-2xl border border-white/10 bg-card/45 p-5">
                                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-lg font-extrabold">Narrador</h2>
                                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${selected.usesDefault ? 'bg-white/5 text-foreground/45' : 'bg-brand-lime/15 text-brand-lime'}`}>
                                                {draft.length === 0 ? 'Sem prompt' : selected.usesDefault ? 'Padrão' : 'Agência'}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-foreground/45">IA de conversa do Mileto.</p>
                                    </div>
                                    <span className="text-xs text-foreground/40">{draft.length.toLocaleString('pt-BR')} caracteres</span>
                                </div>
                                <textarea
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    aria-label="Prompt do Narrador"
                                    spellCheck={false}
                                    className="min-h-[480px] w-full resize-y rounded-xl border border-white/10 bg-[#09100f] p-4 font-mono text-xs leading-relaxed text-foreground outline-none transition focus:border-brand-lime/35"
                                />
                                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-[11px] text-foreground/40">O campo pode ficar completamente vazio. Nenhum texto será inserido automaticamente.</p>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={reset} disabled={saving || selected.usesDefault} className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-foreground/65 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35">
                                            <RotateCcw className="h-4 w-4" /> Remover personalização
                                        </button>
                                        <button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 rounded-xl bg-brand-lime px-4 py-2.5 text-xs font-black text-[#07110d] transition hover:brightness-110 disabled:opacity-50">
                                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar para a equipe
                                        </button>
                                    </div>
                                </div>
                            </section>
                        ) : (
                            <div className="flex min-h-80 items-center justify-center rounded-2xl border border-white/10 bg-card/45 px-6 text-center text-sm text-foreground/50">
                                O prompt do Narrador não está disponível.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
