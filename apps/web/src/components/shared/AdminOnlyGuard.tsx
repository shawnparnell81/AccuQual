import type { ReactNode } from "react";
import { useCurrentUser } from "../../hooks/useAuth";
import { isFullAccessRole } from "../../lib/fullAccess";

/** Same "no access, plain message, not a silently-broken form" pattern as SecurityRolesSection — client-side mirror of the API's full-access gate, not the actual enforcement (that's the backend's job). */
export function AdminOnlyGuard({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (!isFullAccessRole(user?.roleName)) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        This page is limited to Owner and Admin accounts. Ask an administrator if you need a change here.
      </div>
    );
  }
  return <>{children}</>;
}
