import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { WindowContainer } from "../../window-manager/WindowContainer";
import { useWindowStore } from "../../window-manager/useWindowStore";
import { useAuthStore } from "../../store/authStore";

export function AppLayout() {
  const userTenantId = useAuthStore((s) => s.user?.tenantId);
  const loadForTenant = useWindowStore((s) => s.loadForTenant);

  // Restores only the active tenant's saved windows, and re-runs (clearing the
  // previous tenant's) if the logged-in tenant ever changes — see the
  // Multi-Tenant Patch Pack §D "Clear windows when tenant changes".
  useEffect(() => {
    if (userTenantId != null) loadForTenant(String(userTenantId));
  }, [userTenantId, loadForTenant]);

  return (
    <div className="flex h-screen w-full">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <WindowContainer />
    </div>
  );
}
