import { useNavigate } from 'react-router-dom';
import { Video, Clock, Loader2 } from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { useWizard } from '../context/WizardContext';
import { DraftCard } from '../components/DraftCard';
import type { DraftProject } from '../hooks/useProjects';

export const HomePage = () => {
    const navigate = useNavigate();
    const { projects, loading, deleteProject, saveProject } = useProjects();
    const { loadDraft, startNewProject } = useWizard();

    const handleCreateVideo = async () => {
        // Atomically reset wizard state + generate new project ID
        const newId = startNewProject();

        // Immediately persist a blank draft so it shows on the home screen
        await saveProject({
            id: newId,
            title: 'Novo Projeto',
            updatedAt: new Date().toISOString(),
            format: '9:16',
            thumbnail: null,
            adData: {} as any,
            mediaTakes: [],
            captionStyle: null,
            selectedMusicId: null,
        });

        navigate('/step/1');
    };

    const handleOpenDraft = (draft: DraftProject) => {
        loadDraft(draft);
        navigate('/step/1');
    };

    const handleDeleteDraft = async (id: string) => {
        await deleteProject(id);
    };

    const handleRenameDraft = async (id: string, newTitle: string) => {
        const existing = projects.find((p) => p.id === id);
        if (!existing) return;
        await saveProject({ ...existing, title: newTitle });
    };

    return (
        <div className="min-h-full bg-background p-8 lg:p-12">
            {/* Greeting */}
            <div className="mb-10">
                <h2 className="text-2xl font-black text-foreground tracking-tight mb-1">Bem-vindo de volta 👋</h2>
                <p className="text-sm text-foreground/50">Crie um novo vídeo ou continue de onde parou.</p>
            </div>

            {/* Create New Video Card */}
            <div className="mb-12">
                <button
                    onClick={handleCreateVideo}
                    className="group relative w-full max-w-xs h-44 rounded-3xl overflow-hidden border border-brand-accent/25 bg-card transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_40px_rgba(0,230,118,0.18)] hover:border-brand-accent/60 flex flex-col items-center justify-center gap-3 cursor-pointer"
                    style={{
                        background: 'linear-gradient(135deg, rgba(0,230,118,0.07) 0%, rgba(0,200,100,0.03) 100%)',
                    }}
                >
                    {/* Hover glow */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-[radial-gradient(ellipse_at_center,rgba(0,230,118,0.10)_0%,transparent_70%)]" />

                    {/* Icon box */}
                    <div className="relative z-10 w-16 h-16 rounded-2xl bg-brand-accent/10 border border-dashed border-brand-accent/50 group-hover:border-brand-accent group-hover:bg-brand-accent/20 transition-all duration-300 flex items-center justify-center">
                        <Video className="w-7 h-7 text-brand-accent drop-shadow-[0_0_8px_rgba(0,230,118,0.6)]" />
                    </div>

                    <div className="relative z-10 text-center">
                        <span className="block text-sm font-bold text-foreground group-hover:text-brand-accent transition-colors duration-200">
                            Criar Novo Vídeo
                        </span>
                        <span className="block text-xs text-foreground/40 mt-0.5">Narração + Trilha + Legendas</span>
                    </div>

                    <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-brand-accent opacity-60 group-hover:opacity-100 group-hover:scale-150 transition-all duration-300" />
                </button>
            </div>

            {/* Drafts Section */}
            <div>
                <div className="flex items-center gap-2 mb-5">
                    <Clock className="w-4 h-4 text-foreground/40" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-foreground/40">
                        Rascunhos Recentes
                    </h3>
                    {projects.length > 0 && (
                        <span className="ml-1 px-2 py-0.5 rounded-full bg-brand-accent/10 text-brand-accent text-[10px] font-bold">
                            {projects.length}
                        </span>
                    )}
                </div>

                {loading ? (
                    /* Loading state */
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-5 h-5 animate-spin text-foreground/30" />
                    </div>
                ) : projects.length === 0 ? (
                    /* Empty state */
                    <div className="flex flex-col items-center justify-center py-20 px-6 rounded-3xl border border-dashed border-black/10 dark:border-white/8 bg-black/2 dark:bg-white/2">
                        <div className="w-16 h-16 rounded-2xl bg-background border border-black/10 dark:border-white/8 flex items-center justify-center mb-5 shadow-inner">
                            <Video className="w-8 h-8 text-foreground/20" />
                        </div>
                        <p className="text-sm font-bold text-foreground/30 mb-1">Nenhum projeto ainda</p>
                        <p className="text-xs text-foreground/30 text-center max-w-xs leading-relaxed">
                            Seus projetos aparecerão aqui. Cada vídeo criado fica salvo automaticamente como rascunho.
                        </p>
                    </div>
                ) : (
                    /* Draft grid */
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {projects.map((draft) => (
                            <DraftCard
                                key={draft.id}
                                draft={draft}
                                onOpen={handleOpenDraft}
                                onDelete={handleDeleteDraft}
                                onRename={handleRenameDraft}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
