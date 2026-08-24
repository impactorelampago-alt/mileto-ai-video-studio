import { useEffect, useRef } from 'react';
import { GatewayError, gatewayApi } from '../lib/gateway';
import {
    readCustomVoicesFromStorage,
    syncOpsVoiceCatalog,
} from '../lib/opsVoiceCatalog';

// "Não conectado / não vinculado" não é erro a tratar — só não há o que
// sincronizar para este usuário; ignoramos em silêncio.
const isSkippable = (error: unknown): boolean =>
    error instanceof GatewayError &&
    (error.status === 409 ||
        ['ops_not_connected', 'ops_user_link_missing', 'ops_reconnect_required'].includes(error.code || ''));

/**
 * Empurra o catálogo de vozes do usuário para o Mileto Ops ao abrir o app e
 * sempre que as vozes custom mudam. É best-effort e nunca bloqueia nada: usuários sem
 * conexão/vínculo simplesmente não sincronizam. Renderiza nada.
 */
export const OpsVoiceCatalogSync = () => {
    const runningRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        let debounce: ReturnType<typeof setTimeout> | undefined;

        const run = async () => {
            if (runningRef.current || cancelled) return;
            runningRef.current = true;
            try {
                await syncOpsVoiceCatalog({
                    readCustomVoices: () => readCustomVoicesFromStorage(),
                    heartbeat: (catalogVersion) => gatewayApi.opsVoiceCatalogHeartbeat(catalogVersion),
                    put: (payload) => gatewayApi.putOpsVoiceCatalog(payload),
                    isSkippable,
                    onLog: (message) => console.warn('[voice-catalog]', message),
                });
            } catch {
                // syncOpsVoiceCatalog já engole o esperado; aqui é só a rede de
                // segurança para nunca derrubar o app por causa das vozes.
            } finally {
                runningRef.current = false;
            }
        };

        const schedule = () => {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => void run(), 400);
        };

        // Ao abrir o app (backfill natural das vozes padrão) e a cada mudança custom.
        schedule();
        window.addEventListener('mileto:custom-voices-changed', schedule);
        return () => {
            cancelled = true;
            if (debounce) clearTimeout(debounce);
            window.removeEventListener('mileto:custom-voices-changed', schedule);
        };
    }, []);

    return null;
};
