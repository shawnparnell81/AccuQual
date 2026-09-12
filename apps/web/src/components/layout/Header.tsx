import { LogOut } from "lucide-react";
import { useCurrentUser, useLogout } from "../../hooks/useAuth";

export function Header() {
  const user = useCurrentUser();
  const logout = useLogout();

  return (
    <header className="h-14 border-b border-border flex items-center justify-end px-4">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">{user?.email}</span>
        {user?.roleName && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{user.roleName}</span>}
        <button
          onClick={() => logout.mutate()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
        >
          <LogOut size={16} /> Logout
        </button>
      </div>
    </header>
  );
}
