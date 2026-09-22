import { API_BASE_URL } from './apiBase';
import { gatewayApi, type PrivateBackupFile, type SharedAsset } from './gateway';
import { localAuthHeaders } from './serverAuth';

export interface LocalBackupFile {
    sourceId: string;
    relPath: string;
    sourceUrl: string;
    name: string;
    size: number;
    sourceMtime: string;
    category: string;
}

const projectVersionKey = (orgId: number, userId: number, projectId: string) =>
    `mileto-personal-backup-v1:${orgId}:${userId}:${projectId}`;
const fileVersionKey = (orgId: number, userId: number, sourceId: string) =>
    `mileto-personal-file-v1:${orgId}:${userId}:${sourceId}`;

export function readProjectBackupVersion(orgId: number, userId: number, projectId: string): {
    version: number; sourceUpdatedAt: string;
} | null {
    try {
        const value = JSON.parse(localStorage.getItem(projectVersionKey(orgId, userId, projectId)) || 'null');
        return value && Number.isSafeInteger(value.version) && value.version > 0
            && typeof value.sourceUpdatedAt === 'string' ? value : null;
    } catch { return null; }
}

export function writeProjectBackupVersion(orgId: number, userId: number, projectId: string,
    version: number, sourceUpdatedAt: string): void {
    if (!Number.isSafeInteger(version) || version <= 0) return;
    try { localStorage.setItem(projectVersionKey(orgId, userId, projectId),
        JSON.stringify({ version, sourceUpdatedAt })); } catch { /* indisponível */ }
}

function readFileVersion(orgId: number, userId: number, sourceId: string): number | null {
    try {
        const value = Number(localStorage.getItem(fileVersionKey(orgId, userId, sourceId)));
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    } catch { return null; }
}

function writeFileVersion(orgId: number, userId: number, sourceId: string, version: number): void {
    if (!Number.isSafeInteger(version) || version <= 0) return;
    try { localStorage.setItem(fileVersionKey(orgId, userId, sourceId), String(version)); } catch { /* indisponível */ }
}

export async function localBackupFiles(): Promise<LocalBackupFile[]> {
    const response = await fetch(`${API_BASE_URL}/api/private-backup/files`);
    const result = await response.json() as { ok?: boolean; files?: LocalBackupFile[]; message?: string };
    if (!response.ok || !result.ok || !Array.isArray(result.files)) {
        throw new Error(result.message || 'Não foi possível listar o acervo local.');
    }
    return result.files;
}

export async function syncPersonalFiles(orgId: number, userId: number,
    onProgress?: (done: number, total: number) => void): Promise<{
    uploaded: number; total: number;
}> {
    const [local, cloud] = await Promise.all([localBackupFiles(), gatewayApi.privateBackupFiles()]);
    const remote = new Map(cloud.map((file) => [file.sourceId, file]));
    let uploaded = 0;
    let done = 0;
    const failures: string[] = [];
    for (const file of local) {
        const previous = remote.get(file.sourceId);
        const remoteVersion = previous ? Number(previous.version) : null;
        let marker = readFileVersion(orgId, userId, file.sourceId);
        const unchanged = previous
            && previous.relPath === file.relPath
            && Number(previous.size) === file.size
            && new Date(previous.sourceMtime).getTime() === new Date(file.sourceMtime).getTime();
        if (unchanged && !marker && remoteVersion) {
            writeFileVersion(orgId, userId, file.sourceId, remoteVersion);
            marker = remoteVersion;
        }
        if ((previous && marker !== remoteVersion) || (!previous && marker)) {
            failures.push(`${file.name}: versão diferente na nuvem; o arquivo local foi preservado`);
        } else if (!unchanged) {
            try {
                const parent = file.relPath.split('/').slice(0, -1).join('/');
                const response = await fetch(`${API_BASE_URL}/api/shared/files/import-local`, {
                    method: 'POST',
                    headers: { ...(await localAuthHeaders()), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sourceUrl: file.sourceUrl,
                        name: file.name,
                        parent,
                        visibility: 'backup',
                    }),
                });
                const result = await response.json() as { ok?: boolean; entry?: SharedAsset; message?: string };
                if (!response.ok || !result.ok || !result.entry?.id) {
                    throw new Error(result.message || 'Upload do arquivo falhou.');
                }
                const version = await gatewayApi.savePrivateBackupFile(file.sourceId, {
                    assetId: result.entry.id,
                    relPath: file.relPath,
                    size: file.size,
                    sourceMtime: file.sourceMtime,
                    expectedVersion: marker,
                    ownerOrgId: orgId,
                    ownerUserId: userId,
                });
                writeFileVersion(orgId, userId, file.sourceId, version);
                uploaded += 1;
            } catch (error) {
                failures.push(`${file.name}: ${error instanceof Error ? error.message : 'falha'}`);
            }
        }
        done += 1;
        onProgress?.(done, local.length);
    }
    if (failures.length) throw new Error(`Backup incompleto (${failures.length} arquivo(s)): ${failures.slice(0, 3).join('; ')}`);
    return { uploaded, total: local.length };
}

export async function restoreMissingPersonalFiles(orgId: number, userId: number,
    onProgress?: (done: number, total: number) => void): Promise<{
    restored: number; total: number;
}> {
    const [local, cloud] = await Promise.all([localBackupFiles(), gatewayApi.privateBackupFiles()]);
    const localIds = new Set(local.map((file) => file.sourceId));
    const missing: PrivateBackupFile[] = cloud.filter((file) => !localIds.has(file.sourceId));
    let restored = 0;
    const failures: string[] = [];
    for (const [index, file] of missing.entries()) {
        try {
            const response = await fetch(
                `${API_BASE_URL}/api/private-backup/files/${encodeURIComponent(file.sourceId)}/restore`,
                { method: 'POST', headers: await localAuthHeaders() }
            );
            const result = await response.json() as { ok?: boolean; message?: string };
            if (!response.ok || !result.ok) throw new Error(result.message || 'Falha ao restaurar.');
            writeFileVersion(orgId, userId, file.sourceId, Number(file.version));
            restored += 1;
        } catch (error) {
            failures.push(`${file.name}: ${error instanceof Error ? error.message : 'falha'}`);
        }
        onProgress?.(index + 1, missing.length);
    }
    if (failures.length) throw new Error(`Restauração incompleta (${failures.length} arquivo(s)): ${failures.slice(0, 3).join('; ')}`);
    return { restored, total: cloud.length };
}
