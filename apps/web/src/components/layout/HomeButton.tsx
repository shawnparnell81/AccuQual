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
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap",
          isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-secondary"
        )
      }
    >
      <Home size={18} />
      <span>Home</span>
    </NavLink>
  );
}
