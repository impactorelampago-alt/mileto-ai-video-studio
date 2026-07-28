import { authStorage } from './authStorage';

/**
 * Header Authorization para as chamadas ao SERVIDOR LOCAL (:3301) que ele repassa
 * ao gateway (narração, legendas, títulos). Sem sessão, volta vazio — o servidor
 * responde 401 e a UI manda entrar de novo.
 */
export async function localAuthHeaders(): Promise<Record<string, string>> {
    const token = await authStorage.get();
    return token ? { Authorization: `Bearer ${token}` } : {};
}
