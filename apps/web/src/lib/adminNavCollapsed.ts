/** Whether the admin console menu is collapsed. Session only — no account setting. */

export const ADMIN_NAV_COLLAPSED_KEY = "accuqual-admin-nav-collapsed";

export interface AdminNavStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readAdminNavCollapsed(storage: AdminNavStorage | null | undefined): boolean {
  try {
    return storage?.getItem(ADMIN_NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAdminNavCollapsed(storage: AdminNavStorage | null | undefined, collapsed: boolean): void {
  try {
    storage?.setItem(ADMIN_NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Preference only — the menu still toggles for this session.
  }
}
