/** Owner, Administrator, and Quality Manager may delete any record. A record's owner may delete that record. */
export function canDeleteRecord(roleName: string | null | undefined, userId: number | undefined, ownerIds: Array<number | null | undefined>): boolean {
  if (roleName === "admin" || roleName === "owner" || roleName === "quality_manager") return true;
  if (userId == null) return false;
  return ownerIds.some((id) => id != null && id === userId);
}

/** Company audit log. Any signed-in role can open it. The API hides other people's sign-in rows. */
export function canViewAuditLog(roleName: string | null | undefined): boolean {
  return !!roleName;
}

/** `NCR #3 "Bent flange"` — the name shown in the delete confirmation. The audit line uses this same wording when the delete is recorded. */
export function recordDeleteLabel(kind: string, id: number | string, title?: string | null): string {
  const trimmed = title?.trim();
  if (trimmed) return `${kind} #${id} "${trimmed}"`;
  return `${kind} #${id}`;
}
