/** Owner, Administrator, and Quality Manager may delete any record. A record's owner may delete that record. */
export function canDeleteRecord(roleName: string | null | undefined, userId: number | undefined, ownerIds: Array<number | null | undefined>): boolean {
  if (roleName === "admin" || roleName === "owner" || roleName === "quality_manager") return true;
  if (userId == null) return false;
  return ownerIds.some((id) => id != null && id === userId);
}

export function canViewAuditLog(roleName: string | null | undefined): boolean {
  return roleName === "admin" || roleName === "owner" || roleName === "quality_manager";
}

/** `NCR #3 "Bent flange"` — the name shown in the confirmation and the audit line. */
export function recordDeleteLabel(kind: string, id: number | string, title?: string | null): string {
  const trimmed = title?.trim();
  if (trimmed) return `${kind} #${id} "${trimmed}"`;
  return `${kind} #${id}`;
}

export function auditEventLabel(entry: { action: string; changes?: Record<string, unknown> | null }): string {
  if (entry.action === "delete" && typeof entry.changes?.summary === "string") return entry.changes.summary;
  return entry.action.replace(/_/g, " ");
}
