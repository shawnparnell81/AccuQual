/** Matches the API gate. Probation stays selectable: it is conditional approval, not a block. */
export function supplierOrderBlocked(status: string | null | undefined): boolean {
  const normalized = status?.trim().toLowerCase() ?? "";
  return normalized === "disqualified" || normalized === "suspended";
}
