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

/** `NCR QA-14 "Bent flange"` — the name shown in the delete confirmation. A blank number is left out. The database id is not the number. */
export function recordDeleteLabel(kind: string, title?: string | null, number?: string | null): string {
  const shown = (number ?? "").trim();
  const trimmed = title?.trim() ?? "";
  if (trimmed && shown) return `${kind} ${shown} "${trimmed}"`;
  if (trimmed) return `${kind} "${trimmed}"`;
  if (shown) return `${kind} ${shown}`;
  return kind;
}
