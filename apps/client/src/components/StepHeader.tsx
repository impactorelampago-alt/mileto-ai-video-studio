import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { Check } from 'lucide-react';

const STEPS = [
    { id: 1, label: 'Informações', path: '/step/1' },
    { id: 2, label: 'Takes & Cortes', path: '/step/2' },
    { id: 3, label: 'Estilo', path: '/step/3' },
    { id: 4, label: 'Títulos & Export', path: '/step/4' },
];

export const StepHeader = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const currentPath = location.pathname;

    // Extract step number from path (e.g. /step/2 -> 2)
    const currentStepMatch = currentPath.match(/step\/(\d+)/);
    const currentStep = currentStepMatch ? parseInt(currentStepMatch[1]) : 1;

    const handleStepClick = (stepId: number, path: string) => {
        // Allow navigating back or to current step
        if (stepId <= currentStep) {
            navigate(path);
        }
    };

    return (
        <div className="w-full pt-4 pb-0 sticky top-16 z-30 bg-background/95 backdrop-blur-sm shadow-sm border-b border-border/50">
            <div className="max-w-4xl mx-auto px-4 pb-4 overflow-x-auto scrollbar-hide">
                <div className="relative min-w-[500px] flex items-start justify-between py-2">
                    {STEPS.map((step, index) => {
                        const isCompleted = step.id < currentStep;
                        const isActive = step.id === currentStep;
                        const isLast = index === STEPS.length - 1;

                        return (
                            <div key={step.id} className={cn('flex items-start mt-2', !isLast ? 'flex-1' : '')}>
                                {/* Step Item */}
                                <div
                                    className="flex flex-col items-center relative z-10 cursor-pointer group shrink-0 w-10"
                                    onClick={() => handleStepClick(step.id, step.path)}
                                >
                                    <div
                                        className={cn(
                                            'w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 border-2 bg-background',
                                            isActive
                                                ? 'bg-primary border-primary text-primary-foreground shadow-[0_0_15px_rgba(34,197,94,0.4)] scale-110'
                                                : isCompleted
                                                  ? 'border-primary text-primary hover:bg-primary/10'
                                                  : 'border-slate-700 text-slate-500 hover:border-slate-500'
                                        )}
                                    >
                                        {isCompleted ? <Check className="w-5 h-5 font-bold" /> : step.id}
                                    </div>

                                    <span
                                        className={cn(
                                            'text-[11px] font-semibold text-center transition-colors uppercase tracking-wide absolute -bottom-6 w-max',
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
                                    <div className="flex-1 h-px mt-5 mx-2 relative z-0">
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
