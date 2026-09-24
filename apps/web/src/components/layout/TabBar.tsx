import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
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

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-card px-2 pt-1">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.icon] ?? TAB_ICONS.default!;
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            onClick={() => handleActivate(tab.id)}
            title={tab.title}
            className={
              isActive
                ? "relative flex max-w-[12rem] shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 border-border bg-background px-2.5 py-1 text-xs text-foreground"
                : "flex max-w-[12rem] shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 border-transparent px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary"
            }
          >
            {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" aria-hidden />}
            <Icon size={14} className={isActive ? "shrink-0 text-accent" : "shrink-0"} />
            <span className="truncate">{tab.title}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => handleClose(e, tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleClose(e as unknown as React.MouseEvent, tab.id);
              }}
              aria-label={`Close ${tab.title}`}
              className="ml-1 flex-none rounded p-0.5 hover:bg-muted-foreground/20"
            >
              <X size={12} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
