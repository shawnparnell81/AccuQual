import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Columns2, Pin, AlertTriangle,
  ClipboardCheck,
  Truck,
  Package,
  Gauge,
  ShieldAlert,
  GraduationCap,
  Receipt,
  Boxes,
  FileText,
  ShieldCheck,
  Settings,
  Shield,
  LayoutDashboard,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTabStore } from "../../store/useTabStore";
import { TruncatedName } from "../shared/TruncatedName";
import { useSplitStore } from "../../store/useSplitStore";
import { useDirtyPathStore } from "../../store/dirtyPathStore";
import { dirtyKeysInSection, dirtySubtabs, shouldWarnOnClose, shouldWarnOnNavigate, skipNextLeaveWarning } from "../../lib/sectionKeepAlive";
import { canSaveDirtySection, saveDirtySection, useAskUnsavedChanges } from "./unsavedChanges";
import { useDialogBehavior } from "../shared/useDialogBehavior";
import { consumeTabUserGesture } from "../../lib/workspaceTab";
import { UNSAVED_TAB_TITLE, unsavedTabMessage } from "../../lib/tabSession";

// Same icon-per-module choices as navConfig.ts, reused here for visual
// consistency between the top nav and the tab strip.
const TAB_ICONS: Record<string, LucideIcon> = {
  ncr: AlertTriangle,
  capa: ClipboardCheck,
  supplier: Truck,
  inventory: Package,
  audit: ClipboardCheck,
  training: GraduationCap,
  calibration: Gauge,
  quarantine: ShieldAlert,
  erp: Receipt,
  rma: Undo2,
  digitaltwin: Boxes,
  documents: FileText,
  quality: ShieldCheck,
  settings: Settings,
  admin: Shield,
  dashboard: LayoutDashboard,
  default: FileText,
};

/**
 * The tab strip itself — real internal tabs (React state + localStorage,
 * see useTabStore), never a browser window. Sits above <Outlet/> in
 * AppLayout; switching tabs calls navigate() so the existing router (and
 * every page's own data fetching) behaves exactly as it always has —
 * tabs are a layer on top of normal routing, not a replacement for it.
 */
export function TabBar() {
  const navigate = useNavigate();
  const tabs = useTabStore((s) => s.tabs);
  const activeId = useTabStore((s) => s.activeId);
  const activateTab = useTabStore((s) => s.activateTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const reorderTabs = useTabStore((s) => s.reorderTabs);
  const togglePin = useTabStore((s) => s.togglePin);
  const dirtyPaths = useDirtyPathStore((s) => s.paths);
  const openSplit = useSplitStore((s) => s.openSplit);
  const askUnsaved = useAskUnsavedChanges();

  // One tab is just the page you're on — the strip only earns its space once there's something to switch between.
  if (tabs.length < 2) return null;

  function forgetSection(path: string) {
    for (const key of dirtyKeysInSection(useDirtyPathStore.getState().paths, path)) {
      useDirtyPathStore.getState().setDirtyPath(key, false);
    }
  }

  async function confirmLeave(path: string): Promise<boolean> {
    const labels = dirtySubtabs(useDirtyPathStore.getState().paths, path).map((item) => item.label);
    const choice = await askUnsaved({
      labels,
      canSave: canSaveDirtySection(path),
      save: () => saveDirtySection(path),
    });
    if (choice === "cancel") return false;
    if (choice === "discard") forgetSection(path);
    return true;
  }

  async function handleActivate(id: string) {
    consumeTabUserGesture();
    if (id === activeId) return;
    const current = tabs.find((tab) => tab.id === activeId);
    const next = tabs.find((tab) => tab.id === id);
    if (current && next && shouldWarnOnNavigate(dirtyPaths, current.path, next.path)) {
      if (!(await confirmLeave(current.path))) return;
      skipNextLeaveWarning();
    }
    const path = activateTab(id);
    if (path) navigate(path);
  }

  async function handleClose(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const tab = tabs.find((item) => item.id === id);
    if (tab && shouldWarnOnClose(dirtyPaths, tab.path)) {
      if (!(await confirmLeave(tab.path))) return;
      if (id === activeId) skipNextLeaveWarning();
    }
    const nextPath = closeTab(id);
    if (id === activeId && nextPath) navigate(nextPath, { replace: true });
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const measurerRef = useRef<HTMLDivElement>(null);
  const [overflowIds, setOverflowIds] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  // Escape closes the overflow menu.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Tabs never squeeze: measure which ones fit at natural width and put the
  // rest in the "More tabs" menu. An off-screen measurer renders the same tab
  // markup so widths match exactly; the visible strip only renders what fits.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const measurer = measurerRef.current;
    if (!container || !measurer) return;
    const containerEl: HTMLDivElement = container;
    const measurerEl: HTMLDivElement = measurer;
    function measure() {
      const width = containerEl.clientWidth;
      const els = measurerEl.querySelectorAll<HTMLElement>("[data-measure-id]");
      const over: string[] = [];
      const fits = (reserve: number) => {
        over.length = 0;
        for (const el of els) {
          if (el.offsetLeft + el.offsetWidth > width - reserve) over.push(el.dataset.measureId!);
        }
      };
      fits(0);
      if (over.length > 0) fits(120); // room for the "More tabs" button
      // The active tab is always on the strip — swap it with the last visible tab.
      if (activeId && over.includes(activeId)) {
        const rest = over.filter((id) => id !== activeId);
        const visibleIds = tabs.map((t) => t.id).filter((id) => !rest.includes(id) && id !== activeId);
        const lastVisible = visibleIds[visibleIds.length - 1];
        setOverflowIds(lastVisible ? [...rest, lastVisible] : rest);
      } else {
        setOverflowIds(over);
      }
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, [tabs, activeId]);

  const overflowSet = new Set(overflowIds);
  const visibleTabs = tabs.filter((tab) => !overflowSet.has(tab.id));
  const overflowTabs = tabs.filter((tab) => overflowSet.has(tab.id));

  function renderTab(tab: (typeof tabs)[number]) {
    const Icon = TAB_ICONS[tab.icon] ?? TAB_ICONS.default!;
    const isActive = tab.id === activeId;
    const dirty = shouldWarnOnClose(dirtyPaths, tab.path);
    return (
      <div
        key={tab.id}
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        draggable
        data-tab-id={tab.id}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", tab.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          event.dataTransfer.dropEffect = "move";
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const fromId = event.dataTransfer.getData("text/plain");
          if (fromId) reorderTabs(fromId, tab.id);
        }}
        onClick={() => handleActivate(tab.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") handleActivate(tab.id);
        }}
        title={tab.title}
        className={
          isActive
            ? "relative flex min-w-0 shrink-0 cursor-grab items-center gap-1.5 rounded-t-md border border-b-0 border-border bg-background px-2.5 py-1 text-xs text-foreground active:cursor-grabbing"
            : "flex min-w-0 shrink-0 cursor-grab items-center gap-1.5 rounded-t-md border border-b-0 border-transparent px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary active:cursor-grabbing"
        }
      >
        {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" aria-hidden />}
        <Icon size={14} className={isActive ? "shrink-0 text-accent" : "shrink-0"} />
        {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" aria-label="Unsaved changes" />}
        <TruncatedName name={tab.title} className="text-left max-w-[9rem]" />
        <button
          type="button"
          draggable={false}
          aria-label={tab.pinned ? `Unpin ${tab.title}` : `Pin ${tab.title}`}
          title={tab.pinned ? "Unpin tab" : "Pin tab"}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            consumeTabUserGesture();
            togglePin(tab.id);
          }}
          className={`shrink-0 rounded p-0.5 hover:bg-muted-foreground/20 ${tab.pinned ? "text-accent" : ""}`}
        >
          <Pin size={12} className={tab.pinned ? "fill-current" : ""} />
        </button>
        <button
          type="button"
          draggable={false}
          aria-label={`Open ${tab.title} in right pane`}
          title="Open in right pane"
          onClick={(e) => {
            e.stopPropagation();
            consumeTabUserGesture();
            openSplit(tab.path);
          }}
          className="shrink-0 rounded p-0.5 hover:bg-muted-foreground/20"
        >
          <Columns2 size={12} />
        </button>
        <button
          type="button"
          draggable={false}
          data-tab-close=""
          onClick={(e) => void handleClose(e, tab.id)}
          aria-label={`Close ${tab.title}`}
          title={tab.title}
          className="ml-1 shrink-0 rounded p-0.5 hover:bg-muted-foreground/20"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Off-screen measurer — same tab markup, so natural widths match the strip exactly.
          h-0 + overflow-hidden so it can never add a page-wide horizontal scrollbar. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-hidden">
        <div ref={measurerRef} className="flex gap-0.5 px-2 pt-1">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab.icon] ?? TAB_ICONS.default!;
            return (
              <div key={tab.id} data-measure-id={tab.id} className="flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs">
                <Icon size={14} className="shrink-0" />
                <span className="max-w-[9rem] truncate">{tab.title}</span>
                <span className="shrink-0 p-0.5"><Pin size={12} /></span>
                <span className="shrink-0 p-0.5"><Columns2 size={12} /></span>
                <span className="ml-1 shrink-0 p-0.5"><X size={12} /></span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-stretch border-b border-border bg-card">
        <div ref={containerRef} className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-hidden px-2 pt-1 md:flex" role="tablist" aria-label="Open pages">
          {visibleTabs.map(renderTab)}
        </div>
        {overflowTabs.length > 0 && (
          <div className="relative hidden shrink-0 items-end px-2 pt-1 md:flex">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={`${overflowTabs.length} more tabs`}
              title={`${overflowTabs.length} more tabs`}
              className="flex items-center gap-1 rounded-t-md border border-b-0 border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-secondary"
            >
              <ChevronDown size={14} className="shrink-0" />
              <span>{overflowTabs.length} more</span>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                <div role="menu" aria-label="More tabs" className="absolute right-0 top-full z-50 mt-1 max-h-96 w-64 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg">
                  {overflowTabs.map((tab) => {
                    const Icon = TAB_ICONS[tab.icon] ?? TAB_ICONS.default!;
                    return (
                      <div key={tab.id} role="menuitem" className="flex items-center gap-2 px-2 py-1 hover:bg-secondary">
                        <button
                          type="button"
                          onClick={() => { setMenuOpen(false); void handleActivate(tab.id); }}
                          title={tab.title}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-foreground"
                        >
                          <Icon size={14} className="shrink-0" />
                          <span className="truncate">{tab.title}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => void handleClose(e, tab.id)}
                          aria-label={`Close ${tab.title}`}
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/20"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function UnsavedTabDialog({ label, onDiscard, onCancel }: { label: string; onDiscard: () => void; onCancel: () => void }) {
  const ref = useDialogBehavior(true, onCancel);
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onCancel} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-tab-title"
        aria-describedby="unsaved-tab-body"
        tabIndex={-1}
        data-testid="unsaved-changes-dialog"
        className="modal-in fixed left-1/2 top-24 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-card p-4 shadow-xl outline-none"
      >
        <h2 id="unsaved-tab-title" className="text-sm font-medium">
          {UNSAVED_TAB_TITLE}
        </h2>
        <p id="unsaved-tab-body" className="mt-2 text-sm text-muted-foreground">
          {unsavedTabMessage(label)}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" data-testid="unsaved-cancel" onClick={onCancel} className="order-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Cancel
          </button>
          <button type="button" data-testid="unsaved-discard" onClick={onDiscard} className="order-1 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground">
            Discard and close
          </button>
        </div>
      </div>
    </>
  );
}
