import { LogOut } from "lucide-react";
import { useCurrentUser, useLogout } from "../../hooks/useAuth";
import { WhatsNewDropdown } from "./WhatsNewDropdown";
import { NotificationDropdown } from "./NotificationDropdown";

export function Header() {
  const user = useCurrentUser();
  const logout = useLogout();

  return (
    <header className="h-14 border-b border-border flex items-center justify-end px-4">
      <div className="flex items-center gap-3 text-sm">
        <NotificationDropdown />
        <WhatsNewDropdown />
        <span className="text-muted-foreground">{user?.email}</span>
        {user?.roleName && (
          <span className="rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-xs text-accent">{user.roleName}</span>
        )}
        <button
          onClick={() => logout.mutate()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-secondary"
        >
          <LogOut size={16} /> Logout
        </button>
      </div>
    </header>
  );
}
