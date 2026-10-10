import { Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, Navigate } from "react-router-dom";
import { NavigationShell } from "./NavigationShell";
import { SplitWorkspace } from "./SplitWorkspace";
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
import { noteTabUserGesture } from "../../lib/tabSession";
import { normalizeTabPath } from "../../lib/tabPaths";
import { StandardsDisclaimer } from "../shared/StandardsDisclaimer";
import { MfaGraceBanner } from "../auth/MfaGraceBanner";
import { LoadingPlaceholder } from "../shared/LoadingPlaceholder";
import { RouteErrorBoundary } from "../shared/ErrorBoundary";
import { DmaLogo, ProductLine } from "../brand/DmaLogo";
import { GridClipboard } from "../shared/GridClipboard";
import { isSectionPathCommitted, subscribeCommittedPath } from "../../lib/sectionKeepAlive";
import { useDirtyPathStore } from "../../store/dirtyPathStore";

/**
 * An external Supplier Portal login (roleName:"supplier") gets none of the
 * internal department chrome — no sidebar, no tabs, no floating
 * windows, none of which apply to it — and can only
 * ever land on /supplier-portal, matching the module's own "Only access
 * supplier portal, never internal modules" requirement. Client-side UX only
 * (every internal route's own API calls already 403 a supplier login
 * server-side regardless — see requireSupplierPortalAccess); this just
 * avoids showing a broken/empty internal page before that 403 lands.
 */
function SupplierPortalShell() {
  const logout = useLogout();
  const location = useLocation();
  return (
    <div className="flex h-screen w-full flex-col">
      <header className="aq-brand-bar flex h-[62px] items-center justify-between border-b border-border bg-[hsl(var(--brand-header))] px-4 text-white">
        <span className="aq-brand">
          <DmaLogo height={34} />
          <ProductLine />
        </span>
        <button onClick={() => logout.mutate()} className="rounded-md border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">
          Log Out
        </button>
      </header>
      <GridClipboard />
      <main className="flex-1 overflow-y-auto p-6">
        <RouteErrorBoundary key={location.pathname}>
          <Suspense fallback={<LoadingPlaceholder />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
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
  const tabOwnerId = useTabStore((s) => s.ownerId);
  const location = useLocation();
  const navigate = useNavigate();
  const redirectGuard = useRef<string | null>(null);
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

  // A click opens a page on purpose. The tab's close control is not one of those clicks.
  useEffect(() => {
    if (isSupplierPortal) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-tab-close]")) return;
      noteTabUserGesture();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [isSupplierPortal]);

  // Sub-pages of the current section rewrite that tab. A closed section is not
  // created again; the strip's neighbor replaces that URL.
  useEffect(() => {
    if (isSupplierPortal) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const pending = Object.values(useDirtyPathStore.getState().paths).some(Boolean);
      if (!pending) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isSupplierPortal]);

  const [commitTick, setCommitTick] = useState(0);
  useEffect(() => subscribeCommittedPath(() => setCommitTick((tick) => tick + 1)), []);

  useEffect(() => {
    if (isSupplierPortal) return;
    if (!isSectionPathCommitted(location.pathname)) return;
    const { title, icon } = deriveTabMeta(location.pathname);
    const redirectTo = syncActiveTabLocation(location.pathname, title, icon);
    document.title = title && title !== location.pathname ? `${title} · AccuQual` : "AccuQual";
    if (!redirectTo || normalizeTabPath(redirectTo) === normalizeTabPath(location.pathname)) {
      redirectGuard.current = null;
      return;
    }
    const hop = `${location.pathname}->${redirectTo}`;
    if (redirectGuard.current === hop) return;
    redirectGuard.current = hop;
    navigate(redirectTo, { replace: true });
  }, [commitTick, isSupplierPortal, location.pathname, navigate, syncActiveTabLocation, tabOwnerId]);

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
        <div className="w-full min-w-0 print:hidden">
          <TabBar />
          <MfaGraceBanner />
        </div>
        <main id="main-content" className="min-h-0 flex-1 overflow-hidden print:overflow-visible print:p-0">
          <SplitWorkspace />
        </main>
        <div className="border-t border-border bg-card px-4 py-1 text-center print:hidden">
          <StandardsDisclaimer />
        </div>
      </div>
      <GridClipboard />
      <div className="print:hidden">
        <WindowContainer />
        <OpenWindowsTaskbar />
        <AiAssistantPanelGate />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </div>
  );
}
