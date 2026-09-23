import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import type { Person } from "../api/training";
import { personLabel } from "../lib/opsLanguage";
import { useCurrentUser } from "./useAuth";
import { useEffectivePermissions } from "./useEffectivePermissions";

/**
 * Names for owner / assignee ids. Uses the training employee list, which
 * every department can read. Skips the request when this user can't.
 */
export function usePersonDirectory() {
  const user = useCurrentUser();
  const { effective, isLoading } = useEffectivePermissions();
  const bypass = user?.roleName === "admin" || user?.roleName === "platform_admin";
  const allowed = bypass || (!isLoading && !!effective && effective.training !== undefined && effective.training !== "none");
  const query = useQuery({
    queryKey: ["training", "people"],
    queryFn: async () => (await apiClient.get<Person[]>("/training/employees")).data,
    enabled: allowed,
    staleTime: 60_000,
    retry: false,
  });

  return {
    people: query.data ?? [],
    label: (id: number | null | undefined) => personLabel(query.data, id),
  };
}
