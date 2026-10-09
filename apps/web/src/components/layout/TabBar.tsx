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

  // One tab is just the page you're on — the strip only earns its space once there's something to switch between.
  if (tabs.length < 2) return null;

  function handleActivate(id: string) {
    if (id === activeId) return;
    const path = activateTab(id);
    if (path) navigate(path);
  }

  function handleClose(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const nextPath = closeTab(id);
    if (id === activeId && nextPath) navigate(nextPath);
  }

  const compress = tabs.length >= 6;

  return (
    <div className="hidden w-full min-w-0 max-w-full items-center gap-0.5 overflow-hidden border-b border-border bg-card px-2 pt-1 md:flex" role="tablist" aria-label="Open pages">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.icon] ?? TAB_ICONS.default!;
        const isActive = tab.id === activeId;
        const dirty = Boolean(dirtyPaths[tab.path]);
        const width = compress && !isActive ? "max-w-[4.5rem]" : "max-w-[14rem]";
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
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
            title={tab.title}
            className={
              isActive
                ? `relative flex min-w-0 ${width} shrink cursor-grab items-center gap-1.5 overflow-hidden rounded-t-md border border-b-0 border-border bg-background px-2.5 py-1 text-xs text-foreground active:cursor-grabbing`
                : `flex min-w-0 ${width} shrink cursor-grab items-center gap-1.5 overflow-hidden rounded-t-md border border-b-0 border-transparent px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary active:cursor-grabbing`
            }
          >
            {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" aria-hidden />}
            <Icon size={14} className={isActive ? "shrink-0 text-accent" : "shrink-0"} />
            {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" aria-label="Unsaved changes" />}
            <TruncatedName name={tab.title} className="flex-1 text-left" />
            <span
              role="button"
              tabIndex={0}
              draggable={false}
              aria-label={tab.pinned ? `Unpin ${tab.title}` : `Pin ${tab.title}`}
              title={tab.pinned ? "Unpin tab" : "Pin tab"}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                togglePin(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  togglePin(tab.id);
                }
              }}
              className={`shrink-0 rounded p-0.5 hover:bg-muted-foreground/20 ${tab.pinned ? "text-accent" : ""}`}
            >
              <Pin size={12} className={tab.pinned ? "fill-current" : ""} />
            </span>
            <span
              role="button"
              tabIndex={0}
              draggable={false}
              aria-label={`Open ${tab.title} in right pane`}
              title="Open in right pane"
              onClick={(e) => {
                e.stopPropagation();
                openSplit(tab.path);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  openSplit(tab.path);
                }
              }}
              className="shrink-0 rounded p-0.5 hover:bg-muted-foreground/20"
            >
              <Columns2 size={12} />
            </span>
            <span
              role="button"
              tabIndex={0}
              draggable={false}
              onClick={(e) => handleClose(e, tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleClose(e as unknown as React.MouseEvent, tab.id);
              }}
              aria-label={`Close ${tab.title}`}
              title={tab.title}
              className="ml-1 shrink-0 rounded p-0.5 hover:bg-muted-foreground/20"
            >
              <X size={12} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
