import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { useCurrentCompany, useCurrentUser, useLogout } from "../../hooks/useAuth";
import { rolePhrase } from "../../lib/opsLanguage";

/** Who you are, in one place: email, role and organization, plus Settings and Logout. */
export function UserMenu() {
  const user = useCurrentUser();
  const company = useCurrentCompany();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (user?.name ?? user?.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-1.5 rounded-full border border-border py-1 pl-1 pr-2 hover:bg-secondary"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initial}</span>
        <ChevronDown size={13} className="text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-lg border border-border bg-card p-2 shadow-xl">
          <div className="border-b border-border px-3 pb-2 pt-1">
            {user?.name && <p className="truncate text-sm font-medium">{user.name}</p>}
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {user?.roleName && <span className="rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[11px] text-accent">{rolePhrase(user.roleName)}</span>}
              {company?.name && <span className="truncate text-[11px] text-muted-foreground">{company.name}</span>}
            </div>
          </div>
          <Link to="/settings" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary">
            <Settings size={15} /> Settings
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              logout.mutate();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary"
          >
            <LogOut size={15} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
