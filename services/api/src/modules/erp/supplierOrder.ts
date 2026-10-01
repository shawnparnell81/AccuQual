/**
 * Suppliers a purchase order or a receipt must not use.
 * Probation stays allowed: that status is conditional approval, not a block.
 * Active suppliers, and any other status, are unchanged.
 */
const BLOCKED_SUPPLIER_ORDER_STATUSES = new Set(["disqualified", "suspended"]);

export function supplierOrderBlockMessage(status: string | null | undefined): string | null {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (!BLOCKED_SUPPLIER_ORDER_STATUSES.has(normalized)) return null;
  return `This supplier is ${normalized} and cannot be used on a purchase order or receipt.`;
}
