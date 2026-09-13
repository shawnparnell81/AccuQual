import type { ReactNode } from "react";
import { useCurrentUser } from "../../hooks/useAuth";

/** Same "no access, plain message, not a silently-broken form" pattern as SecurityRolesSection — client-side mirror of each new endpoint's real requireRole("admin") gate, not the actual enforcement (that's the backend's job). */
export function AdminOnlyGuard({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (user?.roleName !== "admin") {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        This page is limited to Admin accounts. Ask a tenant admin if you need a change here.
      </div>
    );
  }
  return <>{children}</>;
}
