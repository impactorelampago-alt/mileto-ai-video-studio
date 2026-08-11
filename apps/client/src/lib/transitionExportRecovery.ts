import { API_BASE_URL } from './apiBase';
import { localAuthHeaders } from './serverAuth';
import type { TransitionAsset } from '../types';

interface TransitionListResponse {
    ok?: boolean;
    transitions?: TransitionAsset[];
}

interface MaterializedTransitionResponse {
    ok?: boolean;
    transition?: Partial<TransitionAsset>;
}

interface TransitionExportRecoveryDependencies {
    fetchImpl?: typeof fetch;
    authHeaders?: typeof localAuthHeaders;
    apiBaseUrl?: string;
}

const normalizedIdentity = (value: unknown) => String(value || '').trim().toLocaleLowerCase('pt-BR');

export const isIncludedTransition = (transition: Partial<TransitionAsset> | null | undefined) => {
    if (!transition) return false;
    const id = normalizedIdentity(transition.id);
    const identityCode = normalizedIdentity(transition.identityCode);
    const publicUrl = String(transition.publicUrl || '').trim().toLowerCase().replace(/\\/g, '/');
    return transition.isBuiltIn === true
        || id.startsWith('builtin-')
        || identityCode.startsWith('mileto:')
        || /(?:^|\/)system-transitions\//.test(publicUrl);
};

const normalizedName = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

const currentFilePath = (transition: Partial<TransitionAsset> | undefined) => {
    const filePath = typeof transition?.filePath === 'string' ? transition.filePath.trim() : '';
    return filePath || undefined;
};

const findCurrentBuiltIn = (
    selected: TransitionAsset,
    transitions: TransitionAsset[],
): TransitionAsset | undefined => {
    const builtIns = transitions.filter((candidate) => candidate.isBuiltIn === true);
    const selectedId = normalizedIdentity(selected.id);
    const selectedIdentityCode = normalizedIdentity(selected.identityCode);
    const selectedName = normalizedName(selected.originalName);

    if (selectedId) {
        const byId = builtIns.find((candidate) => normalizedIdentity(candidate.id) === selectedId);
        if (byId) return byId;
    }
    if (selectedIdentityCode) {
        const byIdentityCode = builtIns.find(
            (candidate) => normalizedIdentity(candidate.identityCode) === selectedIdentityCode,
        );
        if (byIdentityCode) return byIdentityCode;
    }
    if (selectedName) {
        return builtIns.find((candidate) => normalizedName(candidate.originalName) === selectedName);
    }
    return undefined;
};

/**
 * Resolve a fonte da transição no computador que executará o FFmpeg.
 * O caminho persistido no projeto nunca é reutilizado para efeitos incluídos
 * ou compartilhados, pois ele pode pertencer a outra instalação.
 */
export const resolveTransitionPathForExport = async (
    globalTransition: TransitionAsset | null | undefined,
    dependencies: TransitionExportRecoveryDependencies = {},
): Promise<string | undefined> => {
    // Um projeto sem transição global não deve ressuscitar transitionPath legado.
    if (!globalTransition) return undefined;

    const fetchImpl = dependencies.fetchImpl || fetch;
    const apiBaseUrl = dependencies.apiBaseUrl || API_BASE_URL;

    if (globalTransition.sharedAssetId) {
        try {
            const headers = await (dependencies.authHeaders || localAuthHeaders)();
            const response = await fetchImpl(
                `${apiBaseUrl}/api/shared/files/item/${encodeURIComponent(globalTransition.sharedAssetId)}/materialize-transition`,
                { method: 'POST', headers },
            );
            const data = await response.json().catch(() => ({})) as MaterializedTransitionResponse;
            const filePath = currentFilePath(data.transition);
            if (!response.ok || !data.ok || !filePath) throw new Error('materialization_failed');
            return filePath;
        } catch {
            throw new Error(
                'export_transition_unavailable: Não foi possível preparar a transição compartilhada. Selecione-a novamente.',
            );
        }
    }

    if (isIncludedTransition(globalTransition)) {
        try {
            const response = await fetchImpl(`${apiBaseUrl}/api/transitions/list`);
            const data = await response.json().catch(() => ({})) as TransitionListResponse;
            const current = response.ok && data.ok
                ? findCurrentBuiltIn(globalTransition, data.transitions || [])
                : undefined;
            const filePath = currentFilePath(current);
            if (!filePath) throw new Error('built_in_not_found');
            return filePath;
        } catch {
            throw new Error(
                'export_transition_unavailable: A transição incluída não está disponível nesta instalação. Atualize ou reinstale o Mileto.',
            );
        }
    }

    const filePath = currentFilePath(globalTransition);
    if (!filePath) {
        throw new Error(
            'export_transition_unavailable: A transição selecionada não está disponível neste computador. Selecione-a novamente.',
        );
    }
    return filePath;
};
