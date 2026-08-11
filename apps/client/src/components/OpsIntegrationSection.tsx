import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    ExternalLink,
    Link2,
    Loader2,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Unplug,
    UserCheck,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    gatewayApi,
    GatewayError,
    type OpsIntegrationStatus,
    type OpsSyncSuggestion,
} from '../lib/gateway';
import { invalidateOpsBrandDirectoryCache } from '../lib/opsProjectBrand';

interface OpsIntegrationSectionProps {
    canManage: boolean;
    currentUserId: number;
    organizationName: string;
}

const openExternal = (url: string) => {
    const electron = (window as unknown as {
        require?: (moduleName: string) => { shell?: { openExternal: (target: string) => Promise<void> } };
    }).require?.('electron');
    if (electron?.shell) void electron.shell.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
};

interface LinkConfirmationModalProps {
    candidate: OpsSyncSuggestion | null;
    busy: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

const LinkConfirmationModal = ({ candidate, busy, onClose, onConfirm }: LinkConfirmationModalProps) => {
    const aiName = candidate?.aiName || candidate?.detail?.aiName || 'Seu usuário no AI Video';
    const opsName = candidate?.opsName || candidate?.detail?.opsName || 'Perfil correspondente no Mileto Ops';

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [busy, onClose]);

    return createPortal(
        <div
            className="fixed inset-0 z-[300] grid place-items-center overflow-y-auto bg-[#020807]/90 p-5 backdrop-blur-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ops-link-title"
        >
            <div className="relative w-full max-w-xl overflow-hidden rounded-[28px] border border-brand-lime/30 bg-[#09110f] shadow-[0_32px_110px_rgba(0,0,0,0.75),0_0_70px_rgba(0,230,118,0.12)] ring-1 ring-white/5">
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-size-[24px_24px] opacity-40" />
                <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-brand-lime/15 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-28 -left-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

                <div className="relative border-b border-white/8 px-7 pb-6 pt-7">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Fechar confirmação de vínculo"
                        className="absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-full border border-white/8 bg-white/5 text-foreground/45 transition hover:border-white/15 hover:bg-white/10 hover:text-foreground disabled:opacity-40"
                    >
                        <X className="h-4 w-4" />
                    </button>

                    <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-amber-200">
                        <Sparkles className="h-3.5 w-3.5" /> Ação necessária
                    </div>
                    <div className="mt-5 flex items-start gap-4 pr-10">
                        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-brand-lime/25 bg-brand-lime/10 text-brand-lime shadow-[0_0_35px_rgba(0,230,118,0.16)]">
                            <UserCheck className="h-7 w-7" />
                        </div>
                        <div>
                            <h2 id="ops-link-title" className="text-2xl font-black tracking-tight text-foreground">
                                Sincronizou. Agora confirme seu vínculo.
                            </h2>
                            <p className="mt-2 text-sm leading-relaxed text-foreground/55">
                                A sincronização apenas encontrou as correspondências. A confirmação do dono é a etapa que libera a biblioteca e aplica a hierarquia do Mileto Ops.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="relative space-y-5 px-7 py-6">
                    {candidate ? (
                        <>
                            <div className="rounded-2xl border border-brand-lime/20 bg-brand-lime/[0.06] p-4">
                                <div className="mb-3 text-[9px] font-black uppercase tracking-[0.16em] text-brand-lime/70">
                                    Correspondência única encontrada
                                </div>
                                <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
                                    <div className="min-w-0 rounded-xl border border-white/8 bg-black/20 px-4 py-3">
                                        <div className="text-[9px] font-bold uppercase tracking-wider text-foreground/35">AI Video</div>
                                        <div className="mt-1 truncate text-sm font-black text-foreground">{aiName}</div>
                                    </div>
                                    <div className="mx-auto grid h-9 w-9 place-items-center rounded-full border border-brand-lime/20 bg-brand-lime/10 text-brand-lime">
                                        <ArrowRight className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 rounded-xl border border-white/8 bg-black/20 px-4 py-3">
                                        <div className="text-[9px] font-bold uppercase tracking-wider text-foreground/35">Mileto Ops</div>
                                        <div className="mt-1 truncate text-sm font-black text-foreground">{opsName}</div>
                                    </div>
                                </div>
                                <div className="mt-3 flex items-center gap-2 text-[11px] text-foreground/45">
                                    <ShieldCheck className="h-3.5 w-3.5 text-brand-lime" /> E-mail normalizado corresponde de forma única.
                                </div>
                            </div>

                            <div className="flex gap-3 rounded-2xl border border-amber-300/15 bg-amber-400/[0.06] px-4 py-3.5">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                                <p className="text-xs leading-relaxed text-amber-100/70">
                                    Sem esta confirmação, a aba Mileto Ops continuará bloqueada mesmo que a conexão apareça como ativa.
                                </p>
                            </div>
                        </>
                    ) : (
                        <div className="rounded-2xl border border-amber-300/15 bg-amber-400/[0.06] p-4 text-sm leading-relaxed text-amber-100/70">
                            Não encontramos uma correspondência única para o seu usuário. Revise a lista abaixo e não confirme perfis ambíguos.
                        </div>
                    )}

                    <div className="flex flex-col-reverse gap-3 sm:flex-row">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className="flex-1 rounded-xl border border-white/10 px-4 py-3 text-xs font-bold text-foreground/65 transition hover:border-white/20 hover:bg-white/5 hover:text-foreground disabled:opacity-40"
                        >
                            Revisar todas as correspondências
                        </button>
                        {candidate && (
                            <button
                                type="button"
                                onClick={onConfirm}
                                disabled={busy}
                                className="flex-[1.25] rounded-xl bg-linear-to-r from-brand-lime to-emerald-400 px-4 py-3 text-xs font-black text-[#05100d] shadow-[0_14px_38px_rgba(0,230,118,0.18)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
                            >
                                <span className="inline-flex items-center justify-center gap-2">
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                                    Confirmar meu vínculo e liberar
                                </span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export function OpsIntegrationSection({ canManage, currentUserId, organizationName }: OpsIntegrationSectionProps) {
    const [status, setStatus] = useState<OpsIntegrationStatus | null>(null);
    const [suggestions, setSuggestions] = useState<OpsSyncSuggestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [awaitingAuthorization, setAwaitingAuthorization] = useState(false);
    const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | 'link' | null>(null);
    const [linkModalOpen, setLinkModalOpen] = useState(false);
    const authorizationAttempt = useRef(0);
    const linkModalPresented = useRef(false);

    const refreshStatus = useCallback(async () => {
        try {
            const next = await gatewayApi.opsConnection();
            setStatus(next);
            if (next.connection?.status === 'error') setAwaitingAuthorization(false);
            if (canManage && next.connection?.status === 'active') {
                const pending = await gatewayApi.opsConflicts().catch(() => ({ conflicts: [] }));
                setSuggestions(pending.conflicts);
            } else {
                setSuggestions([]);
            }
        } catch (error) {
            if (error instanceof GatewayError && error.status !== 503) toast.error(error.message);
        } finally {
            setLoading(false);
        }
    }, [canManage]);

    useEffect(() => {
        void refreshStatus();
        return () => {
            authorizationAttempt.current += 1;
        };
    }, [refreshStatus]);

    const ownSuggestion = suggestions.find(
        (item) => item.kind === 'unique_match' && item.aiUserId === currentUserId && item.opsProfileId
    ) || null;

    useEffect(() => {
        const needsOwnLink = canManage
            && status?.connection?.status === 'active'
            && status.userLink?.status !== 'confirmed'
            && suggestions.length > 0;
        if (needsOwnLink && !linkModalPresented.current) {
            linkModalPresented.current = true;
            setLinkModalOpen(true);
        }
        if (status?.userLink?.status === 'confirmed') setLinkModalOpen(false);
    }, [canManage, status, suggestions]);

    const pollConnection = async (attempt: number) => {
        for (let check = 0; check < 40; check += 1) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            if (authorizationAttempt.current !== attempt) return;

            try {
                const next = await gatewayApi.opsConnection();
                if (authorizationAttempt.current !== attempt) return;
                setStatus(next);
                if (next.connection?.status === 'active') {
                    invalidateOpsBrandDirectoryCache();
                    setAwaitingAuthorization(false);
                    toast.success('Mileto Ops conectado a esta empresa. Agora sincronize a equipe.');
                    return;
                }
                if (next.connection?.status === 'error') {
                    setAwaitingAuthorization(false);
                    const mismatch = ['ops_owner_mismatch', 'ops_account_mismatch'].includes(
                        String(next.connection.lastError || '')
                    );
                    toast.error(
                        mismatch
                            ? `A conta aberta no Mileto Ops não corresponde a ${organizationName}.`
                            : 'O Mileto Ops não conseguiu concluir esta autorização.'
                    );
                    return;
                }
            } catch {
                // Uma falha momentânea não deve bloquear uma nova tentativa do usuário.
            }
        }

        if (authorizationAttempt.current === attempt) {
            setAwaitingAuthorization(false);
            toast.info('A autorização não foi concluída. Você pode abrir novamente quando quiser.');
        }
    };

    const connect = async (reconnect = false, updatingPermissions = false) => {
        if (!canManage) return;
        setBusy('connect');
        try {
            const started = await gatewayApi.startOpsConnection(reconnect);
            invalidateOpsBrandDirectoryCache();
            const attempt = authorizationAttempt.current + 1;
            authorizationAttempt.current = attempt;
            openExternal(started.authorizationUrl);
            setAwaitingAuthorization(true);
            void gatewayApi.opsConnection().then(setStatus).catch(() => undefined);
            toast.info(
                reconnect || updatingPermissions
                    ? 'Autorize novamente no navegador para renovar as permissões do Mileto Ops, incluindo o envio de vídeos.'
                    : 'Confira a conta no navegador. Se estiver errada, troque-a e abra a autorização novamente.'
            );
            void pollConnection(attempt);
        } catch (error) {
            toast.error(error instanceof GatewayError ? error.message : 'Não foi possível iniciar a conexão.');
        } finally {
            setBusy(null);
        }
    };

    const sync = async () => {
        if (!canManage) return;
        setBusy('sync');
        try {
            const result = await gatewayApi.syncOpsUsers();
            setSuggestions(result.suggestions);
            if (status?.userLink?.status !== 'confirmed' && result.suggestions.length > 0) {
                linkModalPresented.current = true;
                setLinkModalOpen(true);
            }
            const opsUsers = Number(result.stats.opsUsers || 0);
            const linked = Number(result.stats.linked || 0);
            const suggested = Number(result.stats.uniqueMatch || 0);
            if (opsUsers > 0 && linked >= opsUsers && suggested === 0) {
                toast.success(`Equipe sincronizada: os ${opsUsers} usuário(s) do Ops já estão vinculados. Nenhuma ação necessária.`);
            } else {
                toast.success(`${opsUsers} usuário(s) do Ops comparados; ${suggested} correspondência(s) sugerida(s); ${linked} já vinculada(s).`);
            }
        } catch (error) {
            toast.error(error instanceof GatewayError ? error.message : 'Não foi possível sincronizar a equipe.');
        } finally {
            setBusy(null);
        }
    };

    const confirmLink = async (suggestion: OpsSyncSuggestion) => {
        if (!canManage || !suggestion.aiUserId || !suggestion.opsProfileId) return;
        setBusy('link');
        try {
            await gatewayApi.confirmOpsUserLink(suggestion.aiUserId, suggestion.opsProfileId);
            invalidateOpsBrandDirectoryCache();
            setSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
            await refreshStatus();
            if (suggestion.aiUserId === currentUserId) setLinkModalOpen(false);
            toast.success('Usuários vinculados pelos IDs permanentes.');
        } catch (error) {
            toast.error(error instanceof GatewayError ? error.message : 'Não foi possível confirmar o vínculo.');
        } finally {
            setBusy(null);
        }
    };

    const disconnect = async () => {
        if (!canManage) return;
        setBusy('disconnect');
        try {
            await gatewayApi.disconnectOps();
            invalidateOpsBrandDirectoryCache();
            setSuggestions([]);
            await refreshStatus();
            toast.success('Conexão com o Mileto Ops revogada. Projetos e usuários foram preservados.');
        } catch (error) {
            toast.error(error instanceof GatewayError ? error.message : 'Não foi possível revogar a conexão.');
        } finally {
            setBusy(null);
        }
    };

    const connected = status?.connection?.status === 'active';
    const connectionError = status?.connection?.status === 'error'
        ? String(status.connection.lastError || '')
        : '';
    const accountMismatch = ['ops_owner_mismatch', 'ops_account_mismatch'].includes(connectionError);
    const needsAssetsWrite = connected && !status?.connection?.scopes?.includes('assets.write');
    const permissionUpdateRequired = [
        'ops_scope_missing',
        'invalid_scope',
        'insufficient_scope',
        'access_denied',
    ].includes(connectionError);
    const temporarilyUnavailable = connected && status?.connection?.temporarilyUnavailable === true;
    const configurationIssue = connected && status?.connection?.configurationIssue === true;

    return (
        <section className="rounded-2xl border border-white/10 bg-card/50 p-5 space-y-4">
            {linkModalOpen && (
                <LinkConfirmationModal
                    candidate={ownSuggestion}
                    busy={busy === 'link'}
                    onClose={() => setLinkModalOpen(false)}
                    onConfirm={() => {
                        if (ownSuggestion) void confirmLink(ownSuggestion);
                    }}
                />
            )}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-sm font-bold flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-brand-lime" /> Mileto Ops
                    </h2>
                    <p className="text-[11px] text-foreground/45 mt-1">
                        Conecte equipe, empresas autorizadas e biblioteca sem duplicar arquivos no R2.
                    </p>
                </div>
                {connected && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-lime/10 border border-brand-lime/20 px-2 py-1 text-[10px] font-bold text-brand-lime">
                        <CheckCircle2 className="w-3 h-3" /> Conectado
                    </span>
                )}
            </div>

            <div className="rounded-xl border border-brand-lime/15 bg-brand-lime/5 p-3 flex gap-2.5">
                <ShieldCheck className="w-4 h-4 shrink-0 text-brand-lime mt-0.5" />
                <div>
                    <div className="text-xs font-bold text-foreground">Escopo: {organizationName}</div>
                    <p className="text-[11px] leading-relaxed text-foreground/50 mt-0.5">
                        Esta autorização pertence somente a esta empresa. Equipe, permissões e biblioteca não são compartilhadas com outras contas do Mileto AI Video.
                    </p>
                </div>
            </div>

            <div className="rounded-xl border border-sky-300/15 bg-sky-400/[0.05] p-3 flex gap-2.5">
                <RefreshCw className="w-4 h-4 shrink-0 text-sky-300 mt-0.5" />
                <div>
                    <div className="text-xs font-bold text-foreground">Conexão persistente</div>
                    <p className="text-[11px] leading-relaxed text-foreground/65 mt-0.5">
                        Autorize uma vez: o AI Video renova o acesso quando necessário e mantém a empresa vinculada durante indisponibilidades temporárias. Uma nova autorização só é solicitada se o acesso for revogado, ficar inválido ou precisar de novas permissões.
                    </p>
                    <p className="text-[11px] leading-relaxed text-foreground/65 mt-1.5">
                        O Wi-Fi vermelho no topo indica apenas que o executor deste computador está offline. Isso não significa que {organizationName} foi desconectada do Mileto Ops.
                    </p>
                </div>
            </div>

            {(needsAssetsWrite || permissionUpdateRequired) && (
                <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.07] p-3 text-xs text-amber-100/80 flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />
                    A autorização atual precisa de novas permissões. Atualize o acesso ao Mileto Ops; seus vínculos de empresa e equipe serão preservados.
                </div>
            )}

            {temporarilyUnavailable && (
                <div className="rounded-xl border border-sky-300/20 bg-sky-400/[0.06] p-3 text-xs text-sky-100/80 flex gap-2">
                    <RefreshCw className="w-4 h-4 shrink-0 text-sky-300 animate-spin" />
                    A conexão continua salva. O Ops está temporariamente indisponível e o AI Video tentará novamente sozinho, sem pedir outro login.
                </div>
            )}

            {configurationIssue && (
                <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.07] p-3 text-xs text-amber-100/80 flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />
                    A conexão continua salva, mas o gateway precisa de uma correção de configuração. Nenhum novo login é necessário; o acesso será retomado automaticamente depois do ajuste.
                </div>
            )}

            {accountMismatch && (
                <div className="relative overflow-hidden rounded-2xl border border-rose-400/20 bg-linear-to-br from-rose-500/10 via-amber-500/5 to-transparent p-5 shadow-[0_18px_55px_rgba(244,63,94,0.08)]">
                    <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-rose-400/10 blur-3xl" />
                    <div className="relative">
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/20 bg-rose-400/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-rose-200">
                            <ShieldAlert className="h-3.5 w-3.5" /> Conexão protegida
                        </div>
                        <div className="mt-4 flex items-start gap-3">
                            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-rose-300/20 bg-rose-400/10 text-rose-300 shadow-[0_0_28px_rgba(251,113,133,0.12)]">
                                <ShieldAlert className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-base font-black tracking-tight text-foreground">
                                    Essa não é a conta de {organizationName}
                                </h3>
                                <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-foreground/55">
                                    O dono da conta aberta no Mileto Ops não corresponde ao dono desta empresa no AI Video. A conexão foi bloqueada e nenhum acesso foi mantido.
                                </p>
                            </div>
                        </div>
                        <div className="mt-5 grid gap-2 sm:grid-cols-3">
                            {[
                                ['01', 'Saia da conta errada no Ops'],
                                ['02', 'Entre com a conta do dono'],
                                ['03', 'Abra a autorização novamente'],
                            ].map(([step, label]) => (
                                <div key={step} className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-3">
                                    <div className="text-[9px] font-black tracking-[0.14em] text-rose-300/70">PASSO {step}</div>
                                    <div className="mt-1.5 text-[11px] font-semibold leading-snug text-foreground/75">{label}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex items-center gap-2 py-4 text-xs text-foreground/45">
                    <Loader2 className="w-4 h-4 animate-spin" /> Verificando conexão…
                </div>
            ) : status && !status.enabled ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300 flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    O gateway ainda não recebeu a configuração do Mileto Ops. O restante do programa continua funcionando normalmente.
                </div>
            ) : connected ? (
                <>
                    <div className={`rounded-xl px-4 py-3 flex items-center justify-between gap-4 ${status?.userLink?.status === 'confirmed'
                        ? 'border border-white/5 bg-background/40'
                        : 'border border-amber-300/20 bg-amber-400/[0.06] shadow-[0_0_32px_rgba(251,191,36,0.05)]'}`}>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">
                                {status?.connection?.accountName || 'Conta Mileto Ops'}
                            </div>
                            <div className="text-[11px] text-foreground/40 mt-0.5">
                                {status?.userLink?.status === 'confirmed'
                                    ? 'Seu usuário está vinculado e pode acessar somente a carteira autorizada para ele.'
                                    : canManage
                                        ? 'Sincronize a equipe e confirme seu vínculo antes de abrir a biblioteca.'
                                        : 'O dono da empresa precisa sincronizar e confirmar seu vínculo.'}
                            </div>
                        </div>
                        {canManage && (
                            <div className="flex gap-2 shrink-0">
                                {status?.userLink?.status !== 'confirmed' && suggestions.length > 0 && (
                                    <button
                                        onClick={() => setLinkModalOpen(true)}
                                        disabled={busy !== null}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-300 px-3 py-2 text-xs font-black text-[#171006] shadow-[0_8px_24px_rgba(251,191,36,0.16)] disabled:opacity-50"
                                    >
                                        <UserCheck className="h-3.5 w-3.5" /> Confirmar meu vínculo
                                    </button>
                                )}
                                {needsAssetsWrite && (
                                    <button
                                        onClick={() => void connect(true, true)}
                                        disabled={busy !== null}
                                        title="Atualiza as permissões do Mileto Ops sem remover seus vínculos"
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/10 border border-amber-300/25 px-3 py-2 text-xs font-bold text-amber-200 disabled:opacity-50"
                                    >
                                        {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                        Atualizar permissões
                                    </button>
                                )}
                                <button
                                    onClick={() => void sync()}
                                    disabled={busy !== null}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-lime/10 border border-brand-lime/20 px-3 py-2 text-xs font-bold text-brand-lime disabled:opacity-50"
                                >
                                    {busy === 'sync' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                    Sincronizar equipe
                                </button>
                                <button
                                    onClick={() => void disconnect()}
                                    disabled={busy !== null}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2 text-xs font-bold text-red-400 disabled:opacity-50"
                                >
                                    {busy === 'disconnect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
                                    Revogar
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="rounded-xl border border-white/5 bg-background/25 px-3 py-2.5">
                        <div className="text-[9px] font-black uppercase tracking-[0.14em] text-foreground/40">Escopos concedidos pelo Mileto Ops</div>
                        <div className="mt-1.5 break-words text-[11px] font-medium text-foreground/70">
                            {status.connection?.scopes?.length ? status.connection.scopes.join(' · ') : 'Nenhum escopo informado'}
                        </div>
                    </div>

                    {canManage && suggestions.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-[10px] uppercase tracking-wider font-bold text-foreground/45">
                                Reconciliação — nenhuma alteração é automática
                            </div>
                            {suggestions.map((item) => {
                                const aiName = item.aiName || item.detail?.aiName || 'Sem usuário no AI Video';
                                const opsName = item.opsName || item.detail?.opsName || 'Sem usuário no Ops';
                                return (
                                    <div key={item.id} className="rounded-xl border border-white/5 bg-background/30 p-3 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-xs font-semibold truncate">{aiName} ↔ {opsName}</div>
                                            <div className="text-[10px] text-foreground/40 mt-0.5">
                                                {item.kind === 'unique_match' && 'E-mail normalizado corresponde de forma única.'}
                                                {item.kind === 'ambiguous' && 'Correspondência ambígua; exige análise manual.'}
                                                {item.kind === 'ops_only' && 'Existe somente no Ops; ninguém será criado automaticamente.'}
                                                {item.kind === 'ai_only' && 'Existe somente no AI Video; ninguém será removido.'}
                                            </div>
                                        </div>
                                        {item.kind === 'unique_match' && item.aiUserId && item.opsProfileId && (
                                            <button
                                                onClick={() => void confirmLink(item)}
                                                disabled={busy !== null}
                                                className="rounded-lg bg-brand-accent/10 border border-brand-accent/20 px-3 py-1.5 text-[11px] font-bold text-brand-accent disabled:opacity-50"
                                            >
                                                Confirmar vínculo
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : canManage ? (
                <div className="space-y-3">
                    {awaitingAuthorization && (
                        <div className="rounded-xl border border-sky-400/15 bg-sky-400/5 p-3 text-xs text-sky-200 flex items-start gap-2">
                            <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
                            <span>
                                Aguardando a autorização no navegador. O botão continua disponível caso você precise trocar a conta ou abrir a página novamente.
                            </span>
                        </div>
                    )}
                    <button
                        onClick={() => void connect(false, permissionUpdateRequired)}
                        disabled={!status?.enabled || busy === 'connect'}
                        className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[#07100e] disabled:opacity-40"
                        style={{ background: 'linear-gradient(135deg, #5bc63c, #0fa08d)' }}
                    >
                        {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        {awaitingAuthorization
                            ? 'Abrir autorização novamente'
                            : permissionUpdateRequired
                              ? 'Atualizar permissões do Mileto Ops'
                              : `Conectar ${organizationName} ao Mileto Ops`}
                    </button>
                </div>
            ) : (
                <div className="rounded-xl border border-white/5 bg-background/30 p-3 text-xs text-foreground/50">
                    A integração ainda não foi ativada. Somente o dono desta empresa pode iniciar a conexão.
                </div>
            )}
        </section>
    );
}
