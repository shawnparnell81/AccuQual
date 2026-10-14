/**
 * Receiving & Inventory on/off. Same rule as receivingInventoryEnabled in
 * services/api/src/modules/company/digitalTwinFlag.ts: unset means off.
 * Off only hides the screens; no pages, data or API routes are removed.
 */
export function receivingInventoryEnabled(flag: boolean | null | undefined): boolean {
  return flag === true;
}

const NAV_KEYS = new Set(["inventory", "erp", "receiving", "admin-receiving", "receiving_inventory", "receivingInventory"]);

export function isReceivingInventoryNavKey(key: string | undefined): boolean {
  return key != null && NAV_KEYS.has(key);
}

const PREFIXES = ["/inventory", "/erp", "/receiving", "/admin/receiving-inventory-settings"];

/** /inventory, /erp (purchase orders and receiving), and the admin settings page, including a saved pin that points there. */
export function isReceivingInventoryPath(path: string | undefined | null): boolean {
  if (!path) return false;
  const pathname = path.split("?")[0]?.split("#")[0] ?? "";
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

/** True when this menu row, search result or link must stay out of the UI. */
export function hideReceivingInventoryTarget(flag: boolean | null | undefined, target: { key?: string; path?: string }): boolean {
  if (receivingInventoryEnabled(flag)) return false;
  return isReceivingInventoryNavKey(target.key) || isReceivingInventoryPath(target.path);
}
