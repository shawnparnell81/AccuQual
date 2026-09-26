import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { CalendarDays } from "lucide-react";

/**
 * /calendar is a personal view available to any authenticated user (like
 * /home), not a department-permissioned module — so it gets a top-level
 * nav button next to Home/Dashboard, same convention as HomeButton.tsx,
 * rather than a slot in the RBAC-driven Modules dropdown.
 */
export function CalendarButton({ onNavigate }: { onNavigate?: () => void; iconOnly?: boolean }) {
  return (
    <NavLink to="/calendar" title="Calendar" end onClick={onNavigate} className={({ isActive }) => clsx("aq-nav-link", isActive && "active")}>
      <CalendarDays size={18} />
      <span className="aq-nav-label">Calendar</span>
    </NavLink>
  );
}
