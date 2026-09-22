type AccountIdentity = { id?: unknown; orgId?: unknown } | null | undefined;
type BackupOwner = { userId?: unknown; orgId?: unknown } | null | undefined;

export function accountId(value: unknown): number | null {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) {
        return null;
    }
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function sameBackupOwner(owner: BackupOwner, user: AccountIdentity): boolean {
    const ownerUserId = accountId(owner?.userId);
    const ownerOrgId = accountId(owner?.orgId);
    return ownerUserId !== null && ownerOrgId !== null
        && ownerUserId === accountId(user?.id)
        && ownerOrgId === accountId(user?.orgId);
}
