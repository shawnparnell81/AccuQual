import { useNavigate } from "react-router-dom";
import { Columns2, Pin, AlertTriangle,
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
import { consumeTabUserGesture, UNSAVED_TAB_TITLE, unsavedTabMessage } from "../../lib/tabSession";

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
    if (id === activeId && nextPath) navigate(nextPath);
  }

  const compress = tabs.length >= 6;

  return (
    <>
    <div className="hidden w-full min-w-0 max-w-full items-center gap-0.5 overflow-hidden border-b border-border bg-card px-2 pt-1 md:flex" role="tablist" aria-label="Open pages">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.icon] ?? TAB_ICONS.default!;
        const isActive = tab.id === activeId;
        const dirty = shouldWarnOnClose(dirtyPaths, tab.path);
        const compact = compress && !isActive;
        const titleLimit = compact ? "max-w-[2.5rem]" : "max-w-[9rem]";
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", tab.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
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
                ? "relative flex min-w-0 shrink cursor-grab items-center gap-1.5 rounded-t-md border border-b-0 border-border bg-background px-2.5 py-1 text-xs text-foreground active:cursor-grabbing"
                : "flex min-w-0 shrink cursor-grab items-center gap-1.5 rounded-t-md border border-b-0 border-transparent px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary active:cursor-grabbing"
            }
          >
            {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" aria-hidden />}
            <Icon size={14} className={isActive ? "shrink-0 text-accent" : "shrink-0"} />
            {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" aria-label="Unsaved changes" />}
            <TruncatedName name={tab.title} className={`text-left ${titleLimit}`} />
            {!compact && (
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
            )}
            {!compact && (
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
            )}
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
      })}
    </div>
    </>
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
