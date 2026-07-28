import { Building2, Link2, ShieldCheck } from 'lucide-react';
import { OpsIntegrationSection } from '../components/OpsIntegrationSection';
import { useAuth } from '../context/AuthContext';

export const Integrations = () => {
    const { user } = useAuth();
    const isPlatformAdmin = user?.role === 'super_admin' || !user?.orgId;
    const organizationName = user?.orgName || 'Sua empresa';

    return (
        <div className="w-full text-foreground">
            <div className="max-w-4xl mx-auto py-8 space-y-6">
                <header>
                    <div className="flex items-center gap-2 text-brand-lime mb-2">
                        <Link2 className="w-5 h-5" />
                        <span className="text-[10px] font-black uppercase tracking-[0.18em]">Conexões externas</span>
                    </div>
                    <h1 className="text-2xl font-extrabold tracking-tight">Integrações</h1>
                    <p className="text-sm text-foreground/50 mt-1">
                        Conecte o Mileto AI Video aos serviços usados pela sua empresa.
                    </p>
                </header>

                {isPlatformAdmin ? (
                    <section className="rounded-2xl border border-amber-500/20 bg-card/50 p-5 space-y-3">
                        <div className="flex items-center gap-2 text-amber-300">
                            <ShieldCheck className="w-5 h-5" />
                            <h2 className="text-sm font-bold">Administração da plataforma</h2>
                        </div>
                        <p className="text-sm leading-relaxed text-foreground/60">
                            O superadministrador do Mileto AI Video não representa uma empresa e, por segurança, não possui uma conexão própria com o Mileto Ops.
                        </p>
                        <p className="text-xs leading-relaxed text-foreground/45">
                            Cada empresa — Impacto Relâmpago e as próximas que forem cadastradas — deve autorizar sua própria integração pelo respectivo usuário dono. As equipes, permissões e bibliotecas permanecem separadas.
                        </p>
                    </section>
                ) : (
                    <>
                        <section className="rounded-2xl border border-white/10 bg-card/30 p-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl border border-brand-lime/20 bg-brand-lime/10 flex items-center justify-center">
                                <Building2 className="w-5 h-5 text-brand-lime" />
                            </div>
                            <div>
                                <div className="text-[10px] uppercase tracking-wider font-bold text-foreground/40">Empresa atual</div>
                                <div className="text-sm font-bold mt-0.5">{organizationName}</div>
                            </div>
                        </section>

                        <OpsIntegrationSection
                            canManage={user?.role === 'owner'}
                            currentUserId={user!.id}
                            organizationName={organizationName}
                        />
                    </>
                )}
            </div>
        </div>
    );
};

export default Integrations;
