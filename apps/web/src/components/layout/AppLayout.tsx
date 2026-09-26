import { useEffect, useState } from "react";
import { Outlet, useLocation, Navigate } from "react-router-dom";
import { NavigationShell } from "./NavigationShell";
import { TabBar } from "./TabBar";
import { CommandPalette } from "./CommandPalette";
import { useGlobalHotkey } from "../../hooks/useGlobalHotkey";
import { WindowContainer } from "../../window-manager/WindowContainer";
import { OpenWindowsTaskbar } from "../../window-manager/OpenWindowsTaskbar";
import { useWindowStore } from "../../window-manager/useWindowStore";
import { useTabStore } from "../../store/useTabStore";
import { useAuthStore } from "../../store/authStore";
import { useLogout } from "../../hooks/useAuth";
import { AiAssistantPanelGate } from "../shared/AiAssistantPanel";
import { useThemeSync } from "../../hooks/useThemeSync";
import { deriveTabMeta } from "../../lib/tabMeta";
import { StandardsDisclaimer } from "../shared/StandardsDisclaimer";
import { MfaGraceBanner } from "../auth/MfaGraceBanner";

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
      <header className="flex h-[62px] items-center justify-between border-b border-border bg-[hsl(var(--brand-header))] px-4 text-white">
        <span className="font-display text-base font-extrabold tracking-[0.06em]">
          ACCU<span className="text-primary">QUAL</span>
        </span>
        <button onClick={() => logout.mutate()} className="rounded-md border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">
          Log Out
        </button>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
      <div className="border-t border-border bg-card px-4 py-1 text-center print:hidden">
        <StandardsDisclaimer />
      </div>
    </div>
  );
}

export function AppLayout() {
  const roleName = useAuthStore((s) => s.user?.roleName);
  const userId = useAuthStore((s) => s.user?.id);
  const loadWindowsForUser = useWindowStore((s) => s.loadForUser);
  const loadTabsForUser = useTabStore((s) => s.loadForUser);
  const syncActiveTabLocation = useTabStore((s) => s.syncActiveTabLocation);
  const location = useLocation();
  const isSupplierPortal = roleName === "supplier";
  useThemeSync();

  // Cmd/Ctrl+K quick-jump — internal shell only (see below), not the
  // Supplier Portal's minimal shell, same reasoning every other piece of
  // internal chrome here (TabBar, floating windows, AI panel) is skipped
  // for that login type.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useGlobalHotkey(() => {
    if (!isSupplierPortal) setPaletteOpen(true);
  });
  useEffect(() => {
    if (isSupplierPortal) return;
    const open = () => setPaletteOpen(true);
    window.addEventListener("accuqual-open-palette", open);
    return () => window.removeEventListener("accuqual-open-palette", open);
  }, [isSupplierPortal]);

  // A file dropped anywhere that ISN'T an upload area would make the browser
  // navigate away to open it, throwing the whole session's page state away.
  // Upload areas (FileDropZone) handle their own drops; this catches the rest.
  useEffect(() => {
    const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const stop = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // Restores only the signed-in user's saved windows/tabs, and re-runs
  // (clearing the previous user's) if a different user signs in;
  // tabs (useTabStore) follow the exact same rule. Skipped
  // entirely for a Supplier Portal login — floating windows/tabs are an
  // internal-app concept that login never touches.
  useEffect(() => {
    if (isSupplierPortal || userId == null) return;
    loadWindowsForUser(String(userId));
    loadTabsForUser(String(userId));
  }, [isSupplierPortal, userId, loadWindowsForUser, loadTabsForUser]);

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
    <div className="app-shell print:block print:h-auto print:overflow-visible">
      {/* print:hidden — a printable page (e.g. QmsFormRecordPage's Print button) shows only
          <main>'s own content; the app chrome has no place on a printed QMS record. */}
      <div className="print:hidden">
        <NavigationShell />
      </div>
      <div className="app-main print:block print:h-auto">
        <div className="print:hidden">
          <TabBar />
          <MfaGraceBanner />
        </div>
        <main id="main-content" className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 print:overflow-visible print:p-0">
          <div key={location.pathname} className="page-enter mx-auto h-full max-w-[1500px]">
            <Outlet />
          </div>
        </main>
        <div className="border-t border-border bg-card px-4 py-1 text-center print:hidden">
          <StandardsDisclaimer />
        </div>
      </div>
      <div className="print:hidden">
        <WindowContainer />
        <OpenWindowsTaskbar />
        <AiAssistantPanelGate />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </div>
  );
}
