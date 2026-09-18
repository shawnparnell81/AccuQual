import { useEffect } from "react";
import { Outlet, useLocation, Navigate } from "react-router-dom";
import { NavigationShell } from "./NavigationShell";
import { TabBar } from "./TabBar";
import { WindowContainer } from "../../window-manager/WindowContainer";
import { OpenWindowsTaskbar } from "../../window-manager/OpenWindowsTaskbar";
import { useWindowStore } from "../../window-manager/useWindowStore";
import { useTabStore } from "../../store/useTabStore";
import { useAuthStore } from "../../store/authStore";
import { useLogout } from "../../hooks/useAuth";
import { AiAssistantPanelGate } from "../shared/AiAssistantPanel";
import { useThemeSync } from "../../hooks/useThemeSync";
import { deriveTabMeta } from "../../lib/tabMeta";

/**
 * An external Supplier Portal login (roleName:"supplier") gets none of the
 * internal department chrome — no TopNav dropdowns, no tabs, no floating
 * windows or AI assistant panel, none of which apply to it — and can only
 * ever land on /supplier-portal, matching the module's own "Only access
 * supplier portal, never internal modules" requirement. Client-side UX only
 * (every internal route's own API calls already 403 a supplier login
 * server-side regardless — see requireSupplierPortalAccess); this just
 * avoids showing a broken/empty internal page before that 403 lands.
 */
function SupplierPortalShell() {
  const logout = useLogout();
  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <h1 className="text-lg font-semibold">Supplier Portal</h1>
        <button onClick={() => logout.mutate()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          Log Out
        </button>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

export function AppLayout() {
  const roleName = useAuthStore((s) => s.user?.roleName);
  const userTenantId = useAuthStore((s) => s.user?.tenantId);
  const loadWindowsForTenant = useWindowStore((s) => s.loadForTenant);
  const loadTabsForTenant = useTabStore((s) => s.loadForTenant);
  const syncActiveTabLocation = useTabStore((s) => s.syncActiveTabLocation);
  const location = useLocation();
  const isSupplierPortal = roleName === "supplier";
  useThemeSync();

  // Restores only the active tenant's saved windows/tabs, and re-runs
  // (clearing the previous tenant's) if the logged-in tenant ever changes —
  // see the Multi-Tenant Patch Pack §D "Clear windows when tenant changes";
  // tabs (useTabStore) follow the exact same isolation rule. Skipped
  // entirely for a Supplier Portal login — floating windows/tabs are an
  // internal-app concept that login never touches.
  useEffect(() => {
    if (isSupplierPortal || userTenantId == null) return;
    loadWindowsForTenant(String(userTenantId));
    loadTabsForTenant(String(userTenantId));
  }, [isSupplierPortal, userTenantId, loadWindowsForTenant, loadTabsForTenant]);

  // Keeps the *active* tab's own path/title in sync with normal navigation
  // (existing nav links, back/forward) — see syncActiveTabLocation's own
  // comment for why this never opens a new tab by itself; only explicit
  // entry points (useOpenTab — global search results today) do that.
  useEffect(() => {
    if (isSupplierPortal) return;
    const { title, icon } = deriveTabMeta(location.pathname);
    syncActiveTabLocation(location.pathname, title, icon);
  }, [isSupplierPortal, location.pathname, syncActiveTabLocation]);

  if (isSupplierPortal) {
    return location.pathname === "/supplier-portal" ? <SupplierPortalShell /> : <Navigate to="/supplier-portal" replace />;
  }

  return (
    <div className="flex h-screen w-full flex-col print:block print:h-auto">
      {/* print:hidden — a printable page (e.g. QmsFormRecordPage's Print button) shows only
          <main>'s own content; the app chrome has no place on a printed QMS record. */}
      <div className="print:hidden">
        <NavigationShell />
        <TabBar />
      </div>
      <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">
        <Outlet />
      </main>
      <div className="print:hidden">
        <WindowContainer />
        <OpenWindowsTaskbar />
        <AiAssistantPanelGate />
      </div>
    </div>
  );
}
