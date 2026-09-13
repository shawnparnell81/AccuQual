import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { TopNav } from "./TopNav";
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { WindowContainer } from "../../window-manager/WindowContainer";
import { useWindowStore } from "../../window-manager/useWindowStore";
import { useTabStore } from "../../store/useTabStore";
import { useAuthStore } from "../../store/authStore";
import { AiAssistantPanelGate } from "../shared/AiAssistantPanel";
import { useThemeSync } from "../../hooks/useThemeSync";
import { deriveTabMeta } from "../../lib/tabMeta";

export function AppLayout() {
  const userTenantId = useAuthStore((s) => s.user?.tenantId);
  const loadWindowsForTenant = useWindowStore((s) => s.loadForTenant);
  const loadTabsForTenant = useTabStore((s) => s.loadForTenant);
  const syncActiveTabLocation = useTabStore((s) => s.syncActiveTabLocation);
  const location = useLocation();
  useThemeSync();

  // Restores only the active tenant's saved windows/tabs, and re-runs
  // (clearing the previous tenant's) if the logged-in tenant ever changes —
  // see the Multi-Tenant Patch Pack §D "Clear windows when tenant changes";
  // tabs (useTabStore) follow the exact same isolation rule.
  useEffect(() => {
    if (userTenantId != null) {
      loadWindowsForTenant(String(userTenantId));
      loadTabsForTenant(String(userTenantId));
    }
  }, [userTenantId, loadWindowsForTenant, loadTabsForTenant]);

  // Keeps the *active* tab's own path/title in sync with normal navigation
  // (existing nav links, back/forward) — see syncActiveTabLocation's own
  // comment for why this never opens a new tab by itself; only explicit
  // entry points (useOpenTab — global search results today) do that.
  useEffect(() => {
    const { title, icon } = deriveTabMeta(location.pathname);
    syncActiveTabLocation(location.pathname, title, icon);
  }, [location.pathname, syncActiveTabLocation]);

  return (
    <div className="flex h-screen w-full flex-col">
      <TopNav />
      <Header />
      <TabBar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
      <WindowContainer />
      <AiAssistantPanelGate />
    </div>
  );
}
