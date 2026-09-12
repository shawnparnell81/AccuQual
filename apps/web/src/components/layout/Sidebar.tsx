import { NavLink } from "react-router-dom";
import clsx from "clsx";
import {
  LayoutDashboard,
  AlertTriangle,
  ClipboardCheck,
  FileSearch,
  FileText,
  GraduationCap,
  GitBranch,
  ShieldAlert,
  Truck,
  Gauge,
  MessageSquareWarning,
  Workflow,
  Sparkles,
  Boxes,
  Building2,
  ClipboardList,
  Factory,
  Landmark,
  BarChart3,
  SearchCheck,
} from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useCurrentTenant, useCurrentUser } from "../../hooks/useAuth";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ncr", label: "NCR", icon: AlertTriangle },
  { to: "/capa", label: "CAPA", icon: ClipboardCheck },
  { to: "/8d", label: "8D Reports", icon: FileSearch },
  { to: "/audits", label: "Audits", icon: ClipboardCheck },
  { to: "/quality", label: "Quality", icon: SearchCheck },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/training", label: "Training", icon: GraduationCap },
  { to: "/change", label: "Change Mgmt", icon: GitBranch },
  { to: "/risk", label: "Risk / FMEA", icon: ShieldAlert },
  { to: "/ppap", label: "PPAP / APQP", icon: ClipboardList },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
  { to: "/calibration", label: "Calibration", icon: Gauge },
  { to: "/production-logs", label: "Production Logs", icon: Factory },
  { to: "/management-system", label: "Management System", icon: Landmark },
  { to: "/pareto", label: "Pareto Analysis", icon: BarChart3 },
  { to: "/complaints", label: "Complaints", icon: MessageSquareWarning },
  { to: "/workflow", label: "Workflow Builder", icon: Workflow },
  { to: "/ai", label: "AI Insights", icon: Sparkles },
  { to: "/digital-twin", label: "Digital Twin", icon: Boxes },
] as const;

export function Sidebar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const tenant = useCurrentTenant();
  const user = useCurrentUser();
  const isPlatformAdmin = user?.roleName === "platform_admin";

  return (
    <aside
      className={clsx(
        "border-r border-border bg-card transition-all overflow-y-auto",
        sidebarOpen ? "w-60" : "w-16"
      )}
    >
      {/* TODO: apply tenant.branding.primaryColor/logoUrl once the color format (hex vs. hsl triplet) is settled */}
      <div className="h-14 flex flex-col items-start justify-center px-4">
        <span className="font-semibold text-primary leading-tight">{sidebarOpen ? "AccuQual" : "AQ"}</span>
        {sidebarOpen && tenant && <span className="text-xs text-muted-foreground leading-tight truncate max-w-full">{tenant.name}</span>}
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {isPlatformAdmin ? (
          <NavLink
            to="/platform"
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"
              )
            }
          >
            <Building2 size={18} />
            {sidebarOpen && <span>Platform Admin</span>}
          </NavLink>
        ) : (
          NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                  isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"
                )
              }
            >
              <Icon size={18} />
              {sidebarOpen && <span>{label}</span>}
            </NavLink>
          ))
        )}
      </nav>
    </aside>
  );
}
