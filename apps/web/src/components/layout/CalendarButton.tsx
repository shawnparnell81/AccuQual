import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { CalendarDays } from "lucide-react";

/**
 * /calendar is a personal view available to any authenticated user (like
 * /home), not a department-permissioned module — so it gets a top-level
 * nav button next to Home/Dashboard, same convention as HomeButton.tsx,
 * rather than a slot in the RBAC-driven Modules dropdown.
 */
export function CalendarButton({ onNavigate, iconOnly = false }: { onNavigate?: () => void; iconOnly?: boolean }) {
  return (
    <NavLink
      to="/calendar"
      title="Calendar"
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          iconOnly ? "flex items-center rounded-md p-2 text-sm" : "flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap",
          isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-secondary"
        )
      }
    >
      <CalendarDays size={18} />
      {!iconOnly && <span>Calendar</span>}
    </NavLink>
  );
}
