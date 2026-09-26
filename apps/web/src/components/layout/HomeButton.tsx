import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { Home } from "lucide-react";

/**
 * Always routes to /home, from any page — rendered once inside TopNav
 * (apps/web/src/components/layout/TopNav.tsx), which every protected route
 * already mounts via AppLayout, so this needs no route-by-route wiring.
 * Same NavLink active-state styling convention TopNav's own Dashboard link
 * already uses, so it reads as one more first-class nav destination rather
 * than a bolted-on button.
 */
export function HomeButton({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <NavLink
      to="/home"
      title="Home"
      end
      onClick={onNavigate}
      className={({ isActive }) => clsx("aq-nav-link", isActive && "active")}
    >
      <Home size={18} />
      <span className="aq-nav-label">Home</span>
    </NavLink>
  );
}
