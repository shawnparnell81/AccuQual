/** Audit log page filters, as typed on the form. All strings; blank means "no filter". */
export interface AuditFilters {
  userId: string;
  entityType: string;
  from: string;
  to: string;
  q: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = { userId: "", entityType: "", from: "", to: "", q: "" };

/** Query string for GET /audit-trail. Blank filters are left out; paged=1 asks for { rows, nextBefore }. */
export function auditListParams(filters: AuditFilters, before?: number): Record<string, string | number> {
  const params: Record<string, string | number> = { paged: 1 };
  if (filters.userId) params.userId = filters.userId;
  if (filters.entityType) params.entityType = filters.entityType;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.q.trim()) params.q = filters.q.trim();
  if (before) params.before = before;
  return params;
}
