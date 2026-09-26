import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";
import type { EffectivePermissions } from "../api/types";

/**
 * The current user's own live, DB-driven access level on every real module
 * (GET /permissions/effective — see the Roles & Permissions module). This is
 * the replacement for reading navConfig.ts's static `access` maps directly:
 * an administrator's change to department_permissions or a custom role grant
 * shows up here on the very next fetch, no re-login, no redeploy.
 *
 * navConfig.ts's own `access` maps aren't deleted — they're still the
 * fallback used while this query is loading (avoids a flash of "none"
 * hiding every button for a moment) and they still drive which nav GROUP a
 * leaf structurally belongs to (see navConfig.ts's own comment on that
 * remaining, documented limitation).
 */
export function useEffectivePermissions() {
  const user = useCurrentUser();
  const { data, isLoading } = useQuery({
    queryKey: ["permissions", "effective"],
    queryFn: async () => (await apiClient.get<EffectivePermissions>("/permissions/effective")).data,
    enabled: !!user,
    staleTime: 30_000,
  });
  return { effective: data, isLoading };
}
