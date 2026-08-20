import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { useWizard } from '../context/WizardContext';
import { missingBeforeStep, pendingWarningText } from '../lib/workflowWarnings';

const TAKES_STEPS = [
    { id: 1, label: 'Informações', path: '/wizard/step/1' },
    { id: 2, label: 'Takes & Cortes', path: '/wizard/step/2' },
    { id: 3, label: 'Estilo', path: '/wizard/step/3' },
    { id: 4, label: 'Títulos & Export', path: '/wizard/step/4' },
];

// Vídeo Moldura: só narração + takes/moldura & export (sem legenda/título).
const MOLDURA_STEPS = [
    { id: 1, label: 'Narração', path: '/wizard/step/1' },
    { id: 2, label: 'Moldura & Export', path: '/wizard/step/2' },
];

export const StepHeader = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { adData, mediaTakes } = useWizard();
    const STEPS = adData.videoModel === 'moldura' ? MOLDURA_STEPS : TAKES_STEPS;
    const currentPath = location.pathname;

    // Only render on wizard/step pages
    if (!currentPath.includes('/wizard/step/')) return null;

    // Extract step number from path (e.g. /wizard/step/2 -> 2)
    const currentStepMatch = currentPath.match(/step\/(\d+)/);
    const currentStep = currentStepMatch ? parseInt(currentStepMatch[1]) : 1;

    const handleStepClick = (stepId: number, path: string) => {
        if (stepId > currentStep) {
            const missing = missingBeforeStep(stepId, adData, mediaTakes);
            if (missing.length) toast.warning(pendingWarningText(missing), { duration: 7000 });
        }
        navigate(path);
    };

    return (
        <div className="w-full bg-background/95 shadow-sm backdrop-blur-sm">
            <div className="mx-auto max-w-3xl overflow-x-auto px-4 scrollbar-hide">
                <div className="relative flex min-w-[460px] items-start justify-between pb-4 pt-1.5">
                    {STEPS.map((step, index) => {
                        const isCompleted = step.id < currentStep;
                        const isActive = step.id === currentStep;
                        const isLast = index === STEPS.length - 1;

                        return (
                            <div key={step.id} className={cn('mt-1 flex items-start', !isLast ? 'flex-1' : '')}>
                                {/* Step Item */}
                                <div
                                    className="group relative z-10 flex w-9 shrink-0 cursor-pointer flex-col items-center"
                                    onClick={() => handleStepClick(step.id, step.path)}
                                >
                                    <div
                                        className={cn(
                                            'flex h-9 w-9 items-center justify-center rounded-full border-2 bg-background text-xs font-bold transition-all duration-300',
                                            isActive
                                                ? 'bg-primary border-primary text-primary-foreground shadow-[0_0_15px_rgba(34,197,94,0.4)] scale-110'
                                                : isCompleted
                                                  ? 'border-primary text-primary hover:bg-primary/10'
                                                  : 'border-slate-700 text-slate-500 hover:border-slate-500'
                                        )}
                                    >
                                        {isCompleted ? <Check className="h-4 w-4 font-bold" /> : step.id}
                                    </div>

                                    <span
                                        className={cn(
                                            'absolute -bottom-4 w-max text-center text-[9px] font-bold uppercase tracking-[0.08em] transition-colors',
                                            isActive
                                                ? 'text-foreground'
                                                : isCompleted
                                                  ? 'text-foreground/70 group-hover:text-primary'
                                                  : 'text-slate-500'
                                        )}
                                    >
                                        {step.label}
                                    </span>
                                </div>

                                {/* Connector Line (Only for non-last items) */}
                                {!isLast && (
                                    <div className="relative z-0 mx-2 mt-[17px] h-px flex-1">
                                        <div
                                            className={cn(
                                                'absolute inset-0 transition-all duration-500 rounded-full h-[2px]',
                                                step.id < currentStep ? 'bg-primary' : 'bg-slate-800'
                                            )}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
