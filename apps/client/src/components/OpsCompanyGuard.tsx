import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useWizard } from '../context/WizardContext';
import {
    bindTitlesToBrandPalette,
    opsProjectCompanyName,
    opsViewContextIdentity,
    resolveOpsProjectBrand,
} from '../lib/opsProjectBrand';

export const OpsCompanyGuard = ({ children }: { children: ReactNode }) => {
    const { adData, updateAdData } = useWizard();
    const [checking, setChecking] = useState(true);
    const [blocked, setBlocked] = useState(false);
    const warnedRef = useRef(false);
    const adDataRef = useRef(adData);
    adDataRef.current = adData;

    useEffect(() => {
        let cancelled = false;
        setChecking(true);
        void resolveOpsProjectBrand(adData.opsCompany).then((resolved) => {
            if (cancelled) return;
            if (resolved.required && (!resolved.company || !resolved.context)) {
                setBlocked(true);
                return;
            }
            if (resolved.required && resolved.company && resolved.context) {
                const storedCompany = adData.opsCompany;
                const resolvedContextIdentity = opsViewContextIdentity(resolved.context);
                if (
                    !storedCompany
                    || resolved.company.id !== storedCompany.id
                    || resolvedContextIdentity !== storedCompany.viewContextIdentity
                ) {
                    setBlocked(true);
                    if (!warnedRef.current) {
                        warnedRef.current = true;
                        toast.warning('A visão ou a empresa selecionada não está mais disponível. Confirme novamente na etapa 1.');
                    }
                    return;
                }
                const currentAdData = adDataRef.current;
                const nextAdData = {
                    ...currentAdData,
                    opsCompany: {
                        id: resolved.company.id,
                        name: opsProjectCompanyName(resolved.company),
                        viewContextIdentity: resolvedContextIdentity,
                        viewContextLabel: resolved.context.label,
                    },
                    brandPalette: resolved.palette,
                    brandPaletteUpdatedAt: resolved.paletteUpdatedAt,
                };
                updateAdData({
                    opsCompany: nextAdData.opsCompany,
                    brandPalette: resolved.palette,
                    brandPaletteUpdatedAt: resolved.paletteUpdatedAt,
                    dynamicTitles: bindTitlesToBrandPalette(nextAdData),
                });
            }
            setBlocked(false);
        }).catch((error) => {
            if (cancelled) return;
            setBlocked(true);
            if (!warnedRef.current) {
                warnedRef.current = true;
                toast.warning(error instanceof Error ? error.message : 'Selecione a empresa do projeto para continuar.');
            }
        }).finally(() => {
            if (!cancelled) setChecking(false);
        });
        return () => { cancelled = true; };
    }, [adData.opsCompany?.id, adData.opsCompany?.viewContextIdentity, updateAdData]);

    if (checking) return <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-brand-muted"><Loader2 className="h-5 w-5 animate-spin" /> Validando a empresa no Mileto Ops…</div>;
    if (blocked) return <Navigate to="/wizard/step/1" replace />;
    return children;
};
