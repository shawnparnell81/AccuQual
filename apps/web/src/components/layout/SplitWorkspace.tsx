import { Suspense, useLayoutEffect, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { Outlet, Router, Routes, useLocation, useNavigate, type Navigator, type To } from "react-router-dom";
import { Columns2, Maximize2, X } from "lucide-react";
import { LoadingPlaceholder } from "../shared/LoadingPlaceholder";
import { workspaceRouteElements } from "../../routes/workspaceRoutes";
import { useSplitStore } from "../../store/useSplitStore";
import { useTabStore } from "../../store/useTabStore";
import { deriveTabMeta } from "../../lib/tabMeta";
import { isLiveTabPath } from "../../lib/tabPaths";
import { locationPath, paneLocation, readSplit, resolvePaneTarget, writeSplit } from "../../lib/splitView";
import { RecordEditBar } from "../shared/RecordEditBar";
import { ItemFolderPath } from "../documents/ItemFolderPath";
import { PrintChrome } from "../records/PrintChrome";
import { RouteErrorBoundary } from "../shared/ErrorBoundary";

/**
 * Main workspace under the tab bar. One pane is the real router outlet.
 * Split view mounts a second router on the right so each form keeps its own
 * location, params, and useState. The right path lives in the URL hash.
 */
export function SplitWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const open = useSplitStore((s) => s.open);
  const rightPath = useSplitStore((s) => s.rightPath);
  const ratio = useSplitStore((s) => s.ratio);
  const setRatio = useSplitStore((s) => s.setRatio);
  const openSplit = useSplitStore((s) => s.openSplit);
  const closeSplit = useSplitStore((s) => s.closeSplit);
  const takeSwap = useSplitStore((s) => s.takeSwap);

  useLayoutEffect(() => {
    const fromUrl = readSplit(location.hash);
    const state = useSplitStore.getState();
    if (fromUrl.open === state.open && fromUrl.path === state.rightPath) return;
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: writeSplit(location.hash, state.open, state.rightPath),
      },
      { replace: true },
    );
  }, [location.hash, location.pathname, location.search, navigate, open, rightPath]);

  const leftPath = locationPath(location.pathname, location.search);

  function swap() {
    const nextLeft = takeSwap(leftPath);
    const parts = paneLocation(nextLeft);
    navigate({ pathname: parts.pathname, search: parts.search, hash: writeSplit(location.hash, true, useSplitStore.getState().rightPath) });
  }

  function expandLeft() {
    closeSplit();
  }

  function expandRight() {
    if (!rightPath) {
      closeSplit();
      return;
    }
    const parts = paneLocation(rightPath);
    closeSplit();
    navigate({ pathname: parts.pathname, search: parts.search, hash: writeSplit(location.hash, false, null) });
  }

  return (
    <div className={`flex h-full min-h-0 flex-col ${open ? "aq-split" : ""}`} data-testid="split-workspace" data-split={open ? "open" : "closed"}>
      <div className="aq-split-bar flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1 text-xs">
        <button type="button" className="rounded-md border border-border px-2 py-1 hover:bg-muted" onClick={() => (open ? closeSplit() : openSplit(null))}>
          <span className="inline-flex items-center gap-1">
            <Columns2 size={13} /> Split View
          </span>
        </button>
        {open && (
          <>
            <button type="button" className="rounded-md border border-border px-2 py-1 hover:bg-muted" onClick={swap}>
              Swap Panes
            </button>
            <span className="ml-auto text-muted-foreground">Two forms stay independent. Open a tab into the right pane to compare.</span>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <section
          className="aq-split-pane flex min-h-0 min-w-0 flex-col overflow-hidden"
          style={open ? { width: `${ratio * 100}%`, flex: "none" } : { flex: "1 1 auto" }}
          data-pane="left"
        >
          {open && <PaneBar title="Left pane" onExpand={expandLeft} onClose={expandRight} closeLabel="Close left pane" />}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7">
            <div key={location.pathname + location.search} className="page-enter mx-auto h-full w-full max-w-none">
              <ItemFolderPath />
              <PrintChrome />
              <RecordEditBar />
              <RouteErrorBoundary key={location.pathname}>
                <Suspense fallback={<LoadingPlaceholder />}>
                  <Outlet />
                </Suspense>
              </RouteErrorBoundary>
            </div>
          </div>
        </section>
        {open && (
          <>
            <SplitDivider ratio={ratio} onRatio={setRatio} />
            <section className="aq-split-pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border" data-pane="right">
              <PaneBar title="Right pane" onExpand={expandRight} onClose={expandLeft} closeLabel="Close right pane" />
              <RightPaneTabs />
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7">
                <div key={rightPath ?? "empty"} className="page-enter mx-auto h-full max-w-none">
                  {rightPath ? <RightPaneRouter path={rightPath} /> : <RightPanePicker />}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function PaneBar({ title, onExpand, onClose, closeLabel }: { title: string; onExpand: () => void; onClose: () => void; closeLabel: string }) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/40 px-2 py-1 text-xs">
      <span className="font-medium text-muted-foreground">{title}</span>
      <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted" onClick={onExpand}>
        <Maximize2 size={12} /> Full width
      </button>
      <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted" aria-label={closeLabel} onClick={onClose}>
        <X size={12} /> Close
      </button>
    </div>
  );
}

function SplitDivider({ ratio, onRatio }: { ratio: number; onRatio: (ratio: number) => void }) {
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    const move = (ev: PointerEvent) => {
      const rect = parent.getBoundingClientRect();
      if (rect.width <= 0) return;
      onRatio((ev.clientX - rect.left) / rect.width);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={22}
      aria-valuemax={78}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      className="aq-split-divider w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/70"
      title="Drag to resize the panes"
      onPointerDown={onPointerDown}
    />
  );
}

function RightPaneTabs() {
  const tabs = useSplitStore((s) => s.tabs);
  const rightPath = useSplitStore((s) => s.rightPath);
  const replaceRight = useSplitStore((s) => s.replaceRight);
  if (tabs.length === 0) return null;
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1" aria-label="Right pane tabs">
      {tabs.map((path) => {
        const meta = deriveTabMeta(paneLocation(path).pathname);
        const active = path === rightPath;
        return (
          <button
            key={path}
            type="button"
            className={active ? "shrink-0 rounded-md bg-background px-2 py-1 text-xs text-foreground" : "shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"}
            onClick={() => replaceRight(path)}
          >
            {meta.title}
          </button>
        );
      })}
    </div>
  );
}

function RightPanePicker() {
  const tabs = useTabStore((s) => s.tabs);
  const openSplit = useSplitStore((s) => s.openSplit);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border bg-card p-4">
      <p className="text-sm font-medium">Right pane</p>
      <p className="text-sm text-muted-foreground">Pick an open tab, or use Open in right pane on a tab. The left form stays where it is.</p>
      {tabs.length === 0 && <p className="text-sm text-muted-foreground">No other tabs yet. Open a form, then send it here.</p>}
      <div className="flex flex-col gap-1">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => openSplit(tab.path)}>
            {tab.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function RightPaneRouter({ path }: { path: string }) {
  const parts = paneLocation(path);
  const location = useMemo(
    () => ({ pathname: parts.pathname, search: parts.search, hash: parts.hash, state: null, key: path }),
    [parts.hash, parts.pathname, parts.search, path],
  );
  const navigator = useMemo<Navigator>(() => {
    const current = () => useSplitStore.getState().rightPath ?? path;
    return {
      createHref(to: To) {
        return resolvePaneTarget(current(), to);
      },
      createURL(to: To) {
        return new URL(resolvePaneTarget(current(), to), "http://accuqual.local");
      },
      encodeLocation(to: To) {
        return paneLocation(resolvePaneTarget(current(), to));
      },
      go(delta: number) {
        useSplitStore.getState().goRight(delta);
      },
      push(to: To) {
        useSplitStore.getState().pushRight(resolvePaneTarget(current(), to));
      },
      replace(to: To) {
        useSplitStore.getState().replaceRight(resolvePaneTarget(current(), to));
      },
    };
  }, [path]);

  if (!isLiveTabPath(parts.pathname)) {
    return <p className="text-sm text-muted-foreground">That page can’t be opened beside another form.</p>;
  }

  return (
    <Router location={location} navigator={navigator}>
      <ItemFolderPath />
      <PrintChrome />
      <RecordEditBar />
      <RouteErrorBoundary key={path}>
        <Suspense fallback={<LoadingPlaceholder />}>
          <Routes key={path}>{workspaceRouteElements()}</Routes>
        </Suspense>
      </RouteErrorBoundary>
    </Router>
  );
}
