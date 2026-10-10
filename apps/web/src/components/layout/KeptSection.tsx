import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Routes, UNSAFE_LocationContext, UNSAFE_NavigationContext, UNSAFE_RouteContext, type Navigator, type To } from "react-router-dom";
import { ItemFolderPath } from "../documents/ItemFolderPath";
import { RecordEditBar } from "../shared/RecordEditBar";
import { PrintChrome } from "../records/PrintChrome";
import { PaneErrorBoundary, RouteErrorBoundary } from "../shared/ErrorBoundary";
import { LoadingPlaceholder } from "../shared/LoadingPlaceholder";
import { locationPath, resolvePaneTarget } from "../../lib/splitView";
import { workspaceRouteElements } from "../../routes/workspaceRoutes";
import {
  commitSectionPath,
  dirtyKeysInSection,
  draftKey,
  hrefFromTo,
  LEAVE_SECTION_MESSAGE,
  planSectionVisit,
  sameKept,
  takeSkipLeaveWarning,
  type KeptPage,
} from "../../lib/sectionKeepAlive";
import { normalizeTabPath } from "../../lib/tabPaths";
import { workspaceTabKey } from "../../lib/workspaceTab";
import { useDirtyPathStore } from "../../store/dirtyPathStore";
import { useDraftHandlers } from "./sectionDraft";

function keptPage(pathname: string, search: string, hash: string): KeptPage {
  return { pathname: normalizeTabPath(pathname), search, hash };
}

function SectionRouter({ entry, onNavigate, onGo }: { entry: KeptPage; onNavigate: (href: string, opts?: { replace?: boolean }) => void; onGo: (delta: number) => void }) {
  const navigateRef = useRef(onNavigate);
  const goRef = useRef(onGo);
  navigateRef.current = onNavigate;
  goRef.current = onGo;
  const location = useMemo(
    () => ({ pathname: entry.pathname, search: entry.search, hash: entry.hash, state: null, key: entry.pathname }),
    [entry.hash, entry.pathname, entry.search],
  );
  const navigator = useMemo<Navigator>(
    () => ({
      createHref(to: To) {
        return resolvePaneTarget(locationPath(entry.pathname, entry.search), to);
      },
      createURL(to: To) {
        return new URL(resolvePaneTarget(locationPath(entry.pathname, entry.search), to), window.location.origin);
      },
      encodeLocation(to: To) {
        const url = new URL(resolvePaneTarget(locationPath(entry.pathname, entry.search), to), "http://accuqual.local");
        return { pathname: url.pathname, search: url.search, hash: url.hash };
      },
      go(delta: number) {
        goRef.current(delta);
      },
      push(to: To) {
        navigateRef.current(resolvePaneTarget(locationPath(entry.pathname, entry.search), to));
      },
      replace(to: To) {
        navigateRef.current(resolvePaneTarget(locationPath(entry.pathname, entry.search), to), { replace: true });
      },
    }),
    [entry.pathname, entry.search],
  );

  return (
    <UNSAFE_RouteContext.Provider value={{ outlet: null, matches: [], isDataRoute: false }}>
      <UNSAFE_NavigationContext.Provider value={{ basename: "/", navigator, static: false, future: {}, useTransitions: false } satisfies ComponentProps<typeof UNSAFE_NavigationContext.Provider>["value"]}>
        <UNSAFE_LocationContext.Provider value={{ location, navigationType: "POP" } as ComponentProps<typeof UNSAFE_LocationContext.Provider>["value"]}>
          <RouteErrorBoundary key={entry.pathname}>
            <Suspense fallback={<LoadingPlaceholder />}>
              <Routes>{workspaceRouteElements()}</Routes>
            </Suspense>
          </RouteErrorBoundary>
        </UNSAFE_LocationContext.Provider>
      </UNSAFE_NavigationContext.Provider>
    </UNSAFE_RouteContext.Provider>
  );
}

/**
 * One mounted copy of each sub-page visited in the current section. Hidden
 * pages keep their fields and their own scroll box. A different section
 * unmounts them after a warning when something is still unsaved.
 */
export function KeptSectionStack({
  pathname,
  search,
  hash,
  onNavigate,
  onGo,
}: {
  pathname: string;
  search: string;
  hash: string;
  onNavigate: (href: string, opts?: { replace?: boolean }) => void;
  onGo: (delta: number) => void;
}) {
  const normalized = normalizeTabPath(pathname);
  const [kept, setKept] = useState<KeptPage[]>(() => [keptPage(normalized, search, hash)]);
  const [active, setActive] = useState(normalized);
  const keptRef = useRef(kept);
  const activeRef = useRef(active);
  const navigateRef = useRef(onNavigate);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrolls = useRef<Record<string, number>>({});
  keptRef.current = kept;
  activeRef.current = active;
  navigateRef.current = onNavigate;
  const setDirtyPath = useDirtyPathStore((state) => state.setDirtyPath);

  useLayoutEffect(() => {
    const from = activeRef.current;
    const dirty = useDirtyPathStore.getState().paths;
    const leavingSection = Boolean(from) && from !== normalized && workspaceTabKey(from) !== workspaceTabKey(normalized);
    const plan = planSectionVisit({
      kept: keptRef.current,
      from,
      toPath: normalized,
      toSearch: search,
      toHash: hash,
      dirty,
      confirmedLeave: leavingSection ? takeSkipLeaveWarning() : false,
    });
    const apply = (nextKept: KeptPage[], nextActive: string) => {
      commitSectionPath(nextActive);
      if (sameKept(keptRef.current, nextKept) && nextActive === activeRef.current) return;
      const scroller = hostRef.current?.querySelector<HTMLElement>(`[data-kept-path="${activeRef.current}"]`);
      if (scroller) scrolls.current[activeRef.current] = scroller.scrollTop;
      activeRef.current = nextActive;
      keptRef.current = nextKept;
      setKept(nextKept);
      setActive(nextActive);
    };
    if (plan.action === "ask") {
      const leave = window.confirm(LEAVE_SECTION_MESSAGE);
      if (!leave) {
        const current = keptRef.current.find((entry) => entry.pathname === from);
        navigateRef.current(`${from}${current?.search ?? ""}${current?.hash ?? ""}`, { replace: true });
        return;
      }
      for (const key of dirtyKeysInSection(useDirtyPathStore.getState().paths, from)) setDirtyPath(key, false);
      const left = planSectionVisit({
        kept: keptRef.current,
        from,
        toPath: normalized,
        toSearch: search,
        toHash: hash,
        dirty: useDirtyPathStore.getState().paths,
        confirmedLeave: true,
      });
      apply(left.kept, left.active);
      return;
    }
    apply(plan.kept, plan.active);
  }, [hash, normalized, search, setDirtyPath]);

  const ordered = [...kept.filter((entry) => entry.pathname === active), ...kept.filter((entry) => entry.pathname !== active)];

  return (
    <div ref={hostRef} className="relative min-h-0 flex-1" data-testid="section-keep">
      {ordered.map((entry) => (
        <KeptRoutePane
          key={entry.pathname}
          entry={entry}
          active={entry.pathname === active}
          savedScroll={scrolls.current[entry.pathname] ?? 0}
          onNavigate={onNavigate}
          onGo={onGo}
        />
      ))}
    </div>
  );
}

function KeptRoutePane({
  entry,
  active,
  savedScroll,
  onNavigate,
  onGo,
}: {
  entry: KeptPage;
  active: boolean;
  savedScroll: number;
  onNavigate: (href: string, opts?: { replace?: boolean }) => void;
  onGo: (delta: number) => void;
}) {
  const handlers = useDraftHandlers(draftKey(entry.pathname));
  const scroller = useRef<{ node: HTMLDivElement | null }>({ node: null });
  useLayoutEffect(() => {
    const node = scroller.current.node;
    if (!node || !active) return;
    node.scrollTop = savedScroll;
  }, [active, savedScroll]);
  useEffect(() => {
    const node = scroller.current.node;
    if (!node || !active) return;
    node.scrollTop = savedScroll;
  }, [active, savedScroll]);
  return (
    <div
      ref={(node) => {
        scroller.current.node = node;
        if (node) node.inert = !active;
      }}
      hidden={!active}
      data-kept-path={entry.pathname}
      className="absolute inset-0 overflow-y-auto px-4 py-5 sm:px-7"
      {...handlers}
    >
      <PaneErrorBoundary>
        <div className="page-enter mx-auto h-full w-full max-w-none">
          <ItemFolderPath />
          <PrintChrome />
          <RecordEditBar />
          <SectionRouter entry={entry} onNavigate={onNavigate} onGo={onGo} />
        </div>
      </PaneErrorBoundary>
    </div>
  );
}
